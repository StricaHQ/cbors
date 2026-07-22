import { Buffer } from 'buffer';
import BufferList from '../internal/BufferList';
import Parser, { Builder, DecoderOptions, Meta } from './parse';
import { bytesToBigInt } from '../internal/numbers';
import CborTag from '../values/CborTag';
import SimpleValue from '../values/SimpleValue';
import IndefiniteArray from '../values/IndefiniteArray';
import IndefiniteMap from '../values/IndefiniteMap';
import { ByteSpan } from '../span';

export type CborNodeKind =
  | 'uint'
  | 'nint'
  | 'bytes'
  | 'text'
  | 'array'
  | 'map'
  | 'tag'
  | 'simple'
  | 'float'
  | 'bool'
  | 'null'
  | 'undefined';

// each node holds a reference to the source buffer off the enumerable surface,
// so nodes stay clean for inspection/comparison while bytes stays zero-copy
const SOURCES = new WeakMap<CborNode, Buffer>();

// does the map key node match lookup key k? int keys cross-match number/bigint;
// Buffer keys match by content.
const keyMatches = (keyNode: CborNode, k: number | bigint | string | boolean | Buffer): boolean => {
  if (typeof k === 'boolean') {
    return keyNode.kind === 'bool' && keyNode.value === k;
  }
  if (typeof k === 'string') {
    return keyNode.kind === 'text' && keyNode.toJS() === k;
  }
  if (Buffer.isBuffer(k)) {
    return keyNode.kind === 'bytes' && (keyNode.toJS() as Buffer).equals(k);
  }
  // number | bigint
  if (keyNode.kind === 'uint' || keyNode.kind === 'nint') {
    if (typeof k === 'bigint') return BigInt(keyNode.value as number | bigint) === k;
    return Number.isInteger(k) && BigInt(keyNode.value as number | bigint) === BigInt(k);
  }
  if (keyNode.kind === 'float' && typeof k === 'number') {
    return keyNode.value === k;
  }
  return false;
};

// annotated view of one CBOR item: kind, byte span, head-byte encoding and the
// decoded payload/children. Syntax is preserved (bignum tags are not collapsed,
// duplicate map keys are kept); toJS() collapses to plain decode() shapes.
export class CborNode {
  kind: CborNodeKind;

  span: ByteSpan; // [start, end) incl. header, in the source buffer

  encoding: { ai: number; indefinite: boolean }; // ai = additional info of head byte

  value?: number | bigint | string | boolean | Buffer; // leaves (definite bytes/text incl.)

  items?: CborNode[]; // array

  entries?: Array<{ key: CborNode; value: CborNode }>; // map — order AND duplicates preserved

  chunks?: CborNode[]; // indefinite bytes/text: chunk nodes with own spans

  tag?: number | bigint; // tag — tags 2/3 NOT collapsed here

  child?: CborNode; // tag payload

  /** @hidden — nodes come from decodeAnnotated(), not direct construction */
  constructor(source: Buffer, kind: CborNodeKind, meta: Meta) {
    this.kind = kind;
    this.span = meta.span;
    this.encoding = { ai: meta.ai, indefinite: meta.indefinite };
    SOURCES.set(this, source);
  }

  // zero-copy subarray of the source buffer, header included
  get bytes(): Buffer {
    return SOURCES.get(this)!.subarray(this.span[0], this.span[1]);
  }

  // plain-decode value: joins indefinite chunks, collapses bignum tags, applies
  // last-wins for duplicate map keys — deep-equals decode(this.bytes)
  toJS(): any {
    switch (this.kind) {
      case 'uint':
      case 'nint':
      case 'float':
      case 'bool':
        return this.value;
      case 'null':
        return null;
      case 'undefined':
        return undefined;
      case 'simple':
        return new SimpleValue(this.value as number);
      case 'bytes':
        return this.chunks
          ? Buffer.concat(this.chunks.map((c) => c.value as Buffer))
          : (this.value as Buffer);
      case 'text':
        return this.chunks
          ? this.chunks.map((c) => c.value as string).join('')
          : (this.value as string);
      case 'array': {
        const ary = this.encoding.indefinite ? new IndefiniteArray() : [];
        for (const item of this.items!) ary.push(item.toJS());
        return ary;
      }
      case 'map': {
        const obj = this.encoding.indefinite ? new IndefiniteMap() : new Map();
        for (const { key, value } of this.entries!) obj.set(key.toJS(), value.toJS());
        return obj;
      }
      case 'tag': {
        const child = this.child!.toJS();
        if (this.tag === 2 || this.tag === 3) {
          if (!Buffer.isBuffer(child)) {
            throw new Error('Invalid bignum encoding: expected byte string');
          }
          const big = bytesToBigInt(child);
          return this.tag === 3 ? -1n - big : big;
        }
        return new CborTag(child, this.tag!);
      }
      default:
        throw new Error(`Invalid CborNode kind: ${this.kind}`);
    }
  }

  // array: item at index. map: value of the first entry whose key matches.
  at(k: number | bigint | string | boolean | Buffer): CborNode | undefined {
    if (this.kind === 'array') {
      return typeof k === 'number' ? this.items![k] : undefined;
    }
    if (this.kind === 'map') {
      return this.entries!.find((e) => keyMatches(e.key, k))?.value;
    }
    return undefined;
  }
}

// builds a CborNode tree, anchoring every node to the one source buffer
const treeBuilder = (source: Buffer): Builder<CborNode> => ({
  int(value, meta) {
    const node = new CborNode(source, value < 0 ? 'nint' : 'uint', meta);
    node.value = value;
    return node;
  },
  bytes(payload, meta) {
    const node = new CborNode(source, 'bytes', meta);
    if (Array.isArray(payload)) node.chunks = payload;
    else node.value = payload;
    return node;
  },
  text(payload, meta) {
    const node = new CborNode(source, 'text', meta);
    if (Array.isArray(payload)) node.chunks = payload;
    else node.value = payload;
    return node;
  },
  array(items, meta) {
    const node = new CborNode(source, 'array', meta);
    node.items = items;
    return node;
  },
  map(entries, meta) {
    const node = new CborNode(source, 'map', meta);
    node.entries = entries.map(([key, value]) => ({ key, value }));
    return node;
  },
  tag(tag, child, meta) {
    const node = new CborNode(source, 'tag', meta);
    node.tag = tag;
    node.child = child;
    return node;
  },
  float(value, meta) {
    const node = new CborNode(source, 'float', meta);
    node.value = value;
    return node;
  },
  simple(value, meta) {
    if (value === 20 || value === 21) {
      const node = new CborNode(source, 'bool', meta);
      node.value = value === 21;
      return node;
    }
    if (value === 22) return new CborNode(source, 'null', meta);
    if (value === 23) return new CborNode(source, 'undefined', meta);
    const node = new CborNode(source, 'simple', meta);
    node.value = value;
    return node;
  },
});

// decode a single CBOR item into an annotation tree. One-shot only: spans are
// offsets into this one contiguous buffer.
export const decodeAnnotated = (inputBytes: Buffer, options?: DecoderOptions): CborNode => {
  const parser = new Parser(treeBuilder(inputBytes), options);
  const bs = new BufferList();
  bs.push(inputBytes);
  const gen = parser.parse();
  let state = gen.next();

  while (!state.done) {
    const b = bs.read(state.value);
    state = gen.next(b);
  }

  if (bs.length > 0) {
    throw new Error('Remaining Bytes');
  }
  return state.value;
};
