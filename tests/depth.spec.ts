import { describe, it, expect } from 'vitest';
import {
  CborNode,
  CborTag,
  IncrementalDecoder,
  IndefiniteArray,
  IndefiniteMap,
  decode,
  decodeAnnotated,
  encode,
} from '../src/index';
import { corrupt, outcome, prng, randomItem } from './helpers/random';

const hex = (h: string) => new Uint8Array(Buffer.from(h, 'hex'));
const toHex = (u: Uint8Array): string => Buffer.from(u).toString('hex');
const concat = (...parts: Uint8Array[]) => new Uint8Array(Buffer.concat(parts));
const unlimited = { maxDepth: Infinity };

// far deeper than a default call stack could recurse
const DEPTH = 50_000;

const MISSING = Symbol('missing');

// one level of nesting around an inner item: the bytes before and after it,
// and how to step into it in a decoded value or a tree
type Level = {
  name: string;
  head: string;
  tail: string;
  step: (v: any) => any;
  stepNode: (n: CborNode) => CborNode | typeof MISSING;
};

const levels: Level[] = [
  {
    name: 'arrays',
    head: '81',
    tail: '',
    step: (v) => (Array.isArray(v) && !(v instanceof IndefiniteArray) ? v[0] : MISSING),
    stepNode: (n) => n.items?.[0] ?? MISSING,
  },
  {
    name: 'arrays with an item before',
    head: '8201',
    tail: '',
    step: (v) => (Array.isArray(v) && v[0] === 1 ? v[1] : MISSING),
    stepNode: (n) => n.items?.[1] ?? MISSING,
  },
  {
    name: 'maps',
    head: 'a100',
    tail: '',
    step: (v) => (v instanceof Map && !(v instanceof IndefiniteMap) ? v.get(0) : MISSING),
    stepNode: (n) => n.entries?.[0].value ?? MISSING,
  },
  {
    name: 'maps with an entry after',
    head: 'a200',
    tail: '0102',
    step: (v) => (v instanceof Map && v.get(1) === 2 ? v.get(0) : MISSING),
    stepNode: (n) => n.entries?.[0].value ?? MISSING,
  },
  {
    name: 'tags',
    head: 'd87b',
    tail: '',
    step: (v) => (v instanceof CborTag && v.tag === 123 ? v.value : MISSING),
    stepNode: (n) => n.child ?? MISSING,
  },
  {
    name: 'indefinite arrays',
    head: '9f',
    tail: 'ff',
    step: (v) => (v instanceof IndefiniteArray ? v[0] : MISSING),
    stepNode: (n) => (n.encoding.indefinite && n.items?.[0]) || MISSING,
  },
  {
    name: 'indefinite maps',
    head: 'bf00',
    tail: 'ff',
    step: (v) => (v instanceof IndefiniteMap ? v.get(0) : MISSING),
    stepNode: (n) => (n.encoding.indefinite && n.entries?.[0].value) || MISSING,
  },
];

// what sits under `depth` levels, or a note on where the shape broke
const unwrap = <T>(root: T, depth: number, step: (v: T) => T | typeof MISSING): T | string => {
  let v = root;
  for (let i = 0; i < depth; i += 1) {
    const inner = step(v);
    if (inner === MISSING) return `no inner item at level ${i}`;
    v = inner;
  }
  return v;
};

// a tree as plain data, with spans relative to where it starts
const plainTree = (node: CborNode, base = node.span[0]): any => ({
  kind: node.kind,
  span: [node.span[0] - base, node.span[1] - base],
  encoding: node.encoding,
  value: node.value,
  tag: node.tag,
  items: node.items?.map((n) => plainTree(n, base)),
  entries: node.entries?.map((e) => [plainTree(e.key, base), plainTree(e.value, base)]),
  chunks: node.chunks?.map((n) => plainTree(n, base)),
  child: node.child && plainTree(node.child, base),
});

describe('nesting deeper than the call stack', () => {
  for (const level of levels) {
    it(`${DEPTH} ${level.name}`, () => {
      const bytes = concat(hex(level.head.repeat(DEPTH)), hex('00'), hex(level.tail.repeat(DEPTH)));
      const leafAt = (level.head.length / 2) * DEPTH;

      const value = decode(bytes, unlimited);
      expect(unwrap(value, DEPTH, level.step)).eq(0);
      expect(Buffer.compare(encode(value), bytes)).eq(0);

      const node = decodeAnnotated(bytes, unlimited);
      expect(node.span).deep.eq([0, bytes.length]);
      const leaf = unwrap(node, DEPTH, level.stepNode) as CborNode;
      expect(leaf.span).deep.eq([leafAt, leafAt + 1]);
      const js = node.toJS();
      expect(unwrap(js, DEPTH, level.step)).eq(0);
      expect(Buffer.compare(encode(js), bytes)).eq(0);

      const decoder = new IncrementalDecoder(unlimited);
      const items = [];
      for (let at = 0; at < bytes.length; at += 4096) {
        items.push(...decoder.push(bytes.subarray(at, at + 4096)));
      }
      decoder.end();
      expect(items).to.have.length(1);
      expect(unwrap(items[0].value, DEPTH, level.step)).eq(0);

      // the limit holds at any depth
      const limited = { maxDepth: DEPTH - 1 };
      expect(() => decode(bytes, limited)).to.throw('Maximum depth exceeded');
      expect(() => decodeAnnotated(bytes, limited)).to.throw('Maximum depth exceeded');
      expect(() => new IncrementalDecoder(limited).push(bytes)).to.throw('Maximum depth exceeded');
      expect(unwrap(decode(bytes, { maxDepth: DEPTH }), DEPTH, level.step)).eq(0);
    });
  }

  it('reads, walks and encodes deep items the same as shallow ones', () => {
    // the same random items at the top and under 200 arrays, which puts them
    // past the depth where the recursive code hands over to an explicit stack
    const wrap = 200;
    const under = (v: any) =>
      unwrap(v, wrap, (a: any) => (Array.isArray(a) && a.length === 1 ? a[0] : MISSING));
    const rand = prng(20260918);
    for (let i = 0; i < 300; i += 1) {
      const item = randomItem(rand);
      const bytes = Uint8Array.from(rand() < 0.5 ? item : corrupt(item, rand));
      const wrapped = concat(hex('81'.repeat(wrap)), bytes);
      for (const maxDepth of [1, 1024]) {
        const where = `${toHex(bytes)} maxDepth ${maxDepth}`;
        const top = { maxDepth };
        const deep = { maxDepth: maxDepth + wrap };

        const expected = outcome(() => decode(bytes, top));
        const got = outcome(() => under(decode(wrapped, deep)));
        expect(got, where).deep.eq(expected);
        if ('value' in expected) {
          const encoded = toHex(encode(decode(wrapped, deep)));
          expect(encoded, where).eq('81'.repeat(wrap) + toHex(encode(expected.value)));
        }

        const tree = outcome(() => plainTree(decodeAnnotated(bytes, top)));
        const deepTree = outcome(() =>
          plainTree(
            unwrap(decodeAnnotated(wrapped, deep), wrap, (n) => n.items?.[0] ?? MISSING) as CborNode
          )
        );
        expect(deepTree, where).deep.eq(tree);

        const js = outcome(() => decodeAnnotated(bytes, top).toJS());
        const deepJs = outcome(() => under(decodeAnnotated(wrapped, deep).toJS()));
        expect(deepJs, where).deep.eq(js);
      }
    }
  });

  it('a transaction whose native script nests 10,771 levels', () => {
    // the shape of a testnet transaction: script_all nested 5,383 times around
    // one script_pubkey, in the witness set. The whole transaction is 16 kB.
    let script: any = [0, new Uint8Array(28)];
    for (let i = 0; i < 5383; i += 1) script = [1, [script]];
    const witnesses = new Map([[1, new CborTag([script], 258)]]);
    const tx = encode([new Map([[2, 170000]]), witnesses, true, null]);
    expect(tx.length).lessThan(16384);

    expect(() => decode(tx)).to.throw('Maximum depth exceeded');
    const node = decodeAnnotated(tx, unlimited);
    const scriptNode = node.at(1)!.at(1)!.child!.items![0];
    expect(Buffer.compare(scriptNode.bytes, encode(script))).eq(0);
    expect(Buffer.compare(encode(node.toJS()), tx)).eq(0);
    expect(Buffer.compare(encode(decode(tx, unlimited)), tx)).eq(0);
  });

  it('encode throws for a value that contains itself', () => {
    const array: any[] = [1];
    array.push([array]);
    const map = new Map<string, any>();
    map.set('self', map);
    const object: any = { a: {} };
    object.a.b = [object];
    const tag = new CborTag(null, 1);
    tag.value = [tag];
    for (const value of [array, map, object, tag]) {
      expect(() => encode(value)).to.throw('Cannot encode a value that contains itself');
    }

    // a value used twice is not a cycle, however deep it sits
    const shared = [1];
    let twice: any = shared;
    for (let i = 0; i < 1000; i += 1) twice = [twice, shared];
    const bytes = encode(twice);
    expect(Buffer.compare(encode(decode(bytes, unlimited)), bytes)).eq(0);
  });
});
