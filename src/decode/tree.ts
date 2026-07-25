import Reader, { Builder, DecoderOptions } from './read';
import { bytesToBigInt } from '../internal/numbers';
import { bytesEqual, concat } from '../internal/bytes';
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

// does the map key node match lookup key k? int keys cross-match number/bigint;
// byte-string keys match by content.
const keyMatches = (
  keyNode: CborNode,
  k: number | bigint | string | boolean | Uint8Array
): boolean => {
  if (typeof k === 'boolean') {
    return keyNode.kind === 'bool' && keyNode.value === k;
  }
  if (typeof k === 'string') {
    return keyNode.kind === 'text' && keyNode.toJS() === k;
  }
  if (k instanceof Uint8Array) {
    return keyNode.kind === 'bytes' && bytesEqual(keyNode.toJS() as Uint8Array, k);
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

  value?: number | bigint | string | boolean | Uint8Array; // leaves (definite bytes/text incl.)

  items?: CborNode[]; // array

  entries?: Array<{ key: CborNode; value: CborNode }>; // map — order AND duplicates preserved

  chunks?: CborNode[]; // indefinite bytes/text: chunk nodes with own spans

  tag?: number | bigint; // tag — tags 2/3 NOT collapsed here

  child?: CborNode; // tag payload

  // the source buffer, held in a private field so it stays off the enumerable
  // surface: nodes remain clean for inspection/comparison while bytes stays
  // zero-copy
  #source: Uint8Array;

  /** @hidden — nodes come from decodeAnnotated(), not direct construction */
  constructor(
    source: Uint8Array,
    kind: CborNodeKind,
    start: number,
    end: number,
    ai: number,
    indefinite: boolean
  ) {
    this.kind = kind;
    this.span = [start, end];
    this.encoding = { ai, indefinite };
    this.#source = source;
  }

  // zero-copy subarray of the source buffer, header included
  get bytes(): Uint8Array {
    return this.#source.subarray(this.span[0], this.span[1]);
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
          ? concat(this.chunks.map((c) => c.value as Uint8Array))
          : (this.value as Uint8Array);
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
          if (!(child instanceof Uint8Array)) {
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
  at(k: number | bigint | string | boolean | Uint8Array): CborNode | undefined {
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
class TreeBuilder implements Builder<CborNode> {
  #source: Uint8Array;

  constructor(source: Uint8Array) {
    this.#source = source;
  }

  int(value: number | bigint, ai: number, start: number, end: number): CborNode {
    const node = new CborNode(this.#source, value < 0 ? 'nint' : 'uint', start, end, ai, false);
    node.value = value;
    return node;
  }

  bytes(
    payload: Uint8Array | CborNode[],
    indefinite: boolean,
    ai: number,
    start: number,
    end: number
  ): CborNode {
    const node = new CborNode(this.#source, 'bytes', start, end, ai, indefinite);
    if (Array.isArray(payload)) node.chunks = payload;
    else node.value = payload;
    return node;
  }

  text(
    payload: string | CborNode[],
    indefinite: boolean,
    ai: number,
    start: number,
    end: number
  ): CborNode {
    const node = new CborNode(this.#source, 'text', start, end, ai, indefinite);
    if (Array.isArray(payload)) node.chunks = payload;
    else node.value = payload;
    return node;
  }

  array(items: CborNode[], indefinite: boolean, ai: number, start: number, end: number): CborNode {
    const node = new CborNode(this.#source, 'array', start, end, ai, indefinite);
    node.items = items;
    return node;
  }

  map(
    keys: CborNode[],
    values: CborNode[],
    indefinite: boolean,
    ai: number,
    start: number,
    end: number
  ): CborNode {
    const node = new CborNode(this.#source, 'map', start, end, ai, indefinite);
    const entries = new Array<{ key: CborNode; value: CborNode }>(keys.length);
    for (let i = 0; i < keys.length; i += 1) entries[i] = { key: keys[i], value: values[i] };
    node.entries = entries;
    return node;
  }

  tag(tag: number | bigint, child: CborNode, ai: number, start: number, end: number): CborNode {
    const node = new CborNode(this.#source, 'tag', start, end, ai, false);
    node.tag = tag;
    node.child = child;
    return node;
  }

  float(value: number, ai: number, start: number, end: number): CborNode {
    const node = new CborNode(this.#source, 'float', start, end, ai, false);
    node.value = value;
    return node;
  }

  simple(value: number, ai: number, start: number, end: number): CborNode {
    if (value === 20 || value === 21) {
      const node = new CborNode(this.#source, 'bool', start, end, ai, false);
      node.value = value === 21;
      return node;
    }
    if (value === 22) return new CborNode(this.#source, 'null', start, end, ai, false);
    if (value === 23) return new CborNode(this.#source, 'undefined', start, end, ai, false);
    const node = new CborNode(this.#source, 'simple', start, end, ai, false);
    node.value = value;
    return node;
  }
}

// decode a single CBOR item into an annotation tree. One-shot only: spans are
// offsets into this one contiguous buffer.
export const decodeAnnotated = (inputBytes: Uint8Array, options?: DecoderOptions): CborNode => {
  const reader = new Reader(inputBytes, new TreeBuilder(inputBytes), options);
  const node = reader.read();

  if (reader.pos < inputBytes.length) {
    throw new Error('Remaining Bytes');
  }
  return node;
};
