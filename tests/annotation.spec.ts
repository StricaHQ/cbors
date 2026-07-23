import { describe, it, expect } from 'vitest';
import * as _ from 'lodash';
import { decode, decodeAnnotated, CborNode, CborTag } from '../src/index';

const deepEql = _.isEqual;
const hex = (s: string) => Buffer.from(s, 'hex');
const toHex = (u: Uint8Array): string => Buffer.from(u).toString('hex');
const ann = (s: string) => decodeAnnotated(hex(s));

describe('decodeAnnotated', (): void => {
  describe('spans and kinds for every leaf', () => {
    const leaves: Array<{ cbor: string; kind: string; ai: number; span: [number, number] }> = [
      { cbor: '0a', kind: 'uint', ai: 10, span: [0, 1] },
      { cbor: '18ff', kind: 'uint', ai: 24, span: [0, 2] },
      { cbor: '1bffffffffffffffff', kind: 'uint', ai: 27, span: [0, 9] },
      { cbor: '20', kind: 'nint', ai: 0, span: [0, 1] },
      { cbor: '3818', kind: 'nint', ai: 24, span: [0, 2] },
      { cbor: '3bffffffffffffffff', kind: 'nint', ai: 27, span: [0, 9] },
      { cbor: '4401020304', kind: 'bytes', ai: 4, span: [0, 5] },
      { cbor: '66417368697368', kind: 'text', ai: 6, span: [0, 7] },
      { cbor: 'f97e00', kind: 'float', ai: 25, span: [0, 3] },
      { cbor: 'fb3ff199999999999a', kind: 'float', ai: 27, span: [0, 9] },
      { cbor: 'f4', kind: 'bool', ai: 20, span: [0, 1] },
      { cbor: 'f5', kind: 'bool', ai: 21, span: [0, 1] },
      { cbor: 'f6', kind: 'null', ai: 22, span: [0, 1] },
      { cbor: 'f7', kind: 'undefined', ai: 23, span: [0, 1] },
      { cbor: 'f0', kind: 'simple', ai: 16, span: [0, 1] },
      { cbor: 'f820', kind: 'simple', ai: 24, span: [0, 2] },
    ];
    for (const l of leaves) {
      it(`${l.kind} ${l.cbor}`, () => {
        const node = ann(l.cbor);
        expect(node.kind).eq(l.kind);
        expect(node.encoding.ai).eq(l.ai);
        expect(node.encoding.indefinite).eq(false);
        expect(node.span).deep.eq(l.span);
        // bytes is the exact source slice, header included
        expect(toHex(node.bytes)).eq(l.cbor);
      });
    }
  });

  it('carries specific leaf values', () => {
    expect(ann('18ff').value).eq(255);
    expect(ann('1bffffffffffffffff').value).eq(18446744073709551615n);
    expect(ann('3bffffffffffffffff').value).eq(-18446744073709551616n);
    expect(toHex(ann('4401020304').value as Uint8Array)).eq('01020304');
    expect(ann('66417368697368').value).eq('Ashish');
    expect(ann('f5').value).eq(true);
    expect(ann('f4').value).eq(false);
    expect(ann('f820').value).eq(32);
    expect(ann('f6').value).eq(undefined);
    expect(ann('f7').value).eq(undefined);
  });

  it('spans nested items exactly (node.bytes)', () => {
    // {"a": 1, "b": [2, 3]}
    const node = ann('a26161016162820203');
    expect(node.kind).eq('map');
    expect(node.span).deep.eq([0, 9]);
    expect(toHex(node.bytes)).eq('a26161016162820203');

    const [e0, e1] = node.entries!;
    expect(e0.key.kind).eq('text');
    expect(toHex(e0.key.bytes)).eq('6161'); // "a"
    expect(toHex(e0.value.bytes)).eq('01');
    expect(toHex(e1.key.bytes)).eq('6162'); // "b"

    const inner = e1.value;
    expect(inner.kind).eq('array');
    expect(toHex(inner.bytes)).eq('820203');
    expect(inner.items!.map((i) => toHex(i.bytes))).deep.eq(['02', '03']);
    expect(inner.items!.map((i) => i.span)).deep.eq([
      [7, 8],
      [8, 9],
    ]);
  });

  it('tag: preserves tag number and child span, does not collapse bignums', () => {
    // tag 102 wrapping [123, []]
    const node = ann('d86682187b80');
    expect(node.kind).eq('tag');
    expect(node.tag).eq(102);
    expect(node.encoding.ai).eq(24);
    expect(node.child!.kind).eq('array');
    expect(toHex(node.child!.bytes)).eq('82187b80');
    expect(deepEql(node.toJS(), new CborTag([123, []], 102))).eq(true);

    // bignum tag 2 is kept as tag syntax in the tree; toJS collapses it
    const big = ann('c2493635c9adc5dea00000');
    expect(big.kind).eq('tag');
    expect(big.tag).eq(2);
    expect(big.child!.kind).eq('bytes');
    expect(big.toJS()).eq(1000000000000000000000n);

    // tag number beyond 2^53 stays a bigint
    const bigTag = ann('dbffffffffffffffff00');
    expect(typeof bigTag.tag).eq('bigint');
    expect(bigTag.tag).eq(18446744073709551615n);
  });

  it('indefinite byte string: chunk nodes with their own spans', () => {
    const node = ann('5f42010243030405ff');
    expect(node.kind).eq('bytes');
    expect(node.encoding.indefinite).eq(true);
    expect(node.encoding.ai).eq(31);
    expect(node.span).deep.eq([0, 9]);
    expect(node.value).eq(undefined); // indefinite: chunks, not value
    expect(node.chunks!.length).eq(2);

    const [c0, c1] = node.chunks!;
    expect(c0.kind).eq('bytes');
    expect(c0.encoding.indefinite).eq(false);
    expect(c0.span).deep.eq([1, 4]);
    expect(toHex(c0.bytes)).eq('420102'); // header + payload
    expect(toHex(c0.value as Uint8Array)).eq('0102'); // payload only
    expect(c1.span).deep.eq([4, 8]);
    expect(toHex(c1.bytes)).eq('43030405');

    // joins on toJS, matching plain decode
    expect(toHex(node.toJS() as Uint8Array)).eq('0102030405');
    expect(deepEql(node.toJS(), decode(hex('5f42010243030405ff')))).eq(true);
  });

  it('indefinite text string: chunk nodes decoded per chunk', () => {
    // "ü" (c3bc) then "a", indefinite
    const node = ann('7f62c3bc6161ff');
    expect(node.kind).eq('text');
    expect(node.encoding.indefinite).eq(true);
    expect(node.chunks!.map((c) => c.value)).deep.eq(['ü', 'a']);
    expect(node.chunks!.map((c) => c.span)).deep.eq([
      [1, 4],
      [4, 6],
    ]);
    expect(node.toJS()).eq('üa');
  });

  it('indefinite array/map carry the indefinite flag', () => {
    expect(ann('9f0102ff').encoding.indefinite).eq(true);
    expect(ann('820102').encoding.indefinite).eq(false);
    expect(ann('bf01020304ff').encoding.indefinite).eq(true);
    expect(ann('a201020304').encoding.indefinite).eq(false);
    // empty indefinite forms
    expect(ann('9fff').items).deep.eq([]);
    expect(ann('bfff').entries).deep.eq([]);
  });

  it('map preserves order and duplicate keys in entries', () => {
    // {1: 2, 1: 3} — both entries kept
    const node = ann('a201020103');
    expect(node.entries!.length).eq(2);
    expect(node.entries!.map((e) => [e.key.toJS(), e.value.toJS()])).deep.eq([
      [1, 2],
      [1, 3],
    ]);
    // toJS collapses duplicates last-wins, matching decode()
    expect((node.toJS() as Map<any, any>).get(1)).eq(3);
    expect(deepEql(node.toJS(), decode(hex('a201020103')))).eq(true);
  });

  describe('at() lookups', () => {
    it('array indexes into items', () => {
      const node = ann('83010203');
      expect(node.at(0)!.toJS()).eq(1);
      expect(node.at(2)!.toJS()).eq(3);
      expect(node.at(3)).eq(undefined);
    });

    it('map int keys cross-match number and bigint', () => {
      const node = ann('a201020304'); // {1: 2, 3: 4}
      expect(node.at(1)!.toJS()).eq(2);
      expect(node.at(1n)!.toJS()).eq(2);
      expect(node.at(3)!.toJS()).eq(4);
      expect(node.at(2)).eq(undefined);

      // bigint-valued key matched by a bigint lookup
      const bigKey = ann('a11bffffffffffffffff02'); // {18446744073709551615: 2}
      expect(bigKey.at(18446744073709551615n)!.toJS()).eq(2);
      expect(bigKey.at(0)).eq(undefined);
    });

    it('map byte-string keys match by content', () => {
      const node = ann('a14401020304182a'); // {h'01020304': 42}
      expect(node.at(hex('01020304'))!.toJS()).eq(42);
      expect(node.at(hex('01020305'))).eq(undefined);
      expect(node.at(hex('010203'))).eq(undefined);
    });

    it('map text and bool keys', () => {
      const node = ann('a2616101f503'); // {"a": 1, true: 3}
      expect(node.at('a')!.toJS()).eq(1);
      expect(node.at(true)!.toJS()).eq(3);
      expect(node.at('b')).eq(undefined);
    });

    it('duplicate keys: first match wins', () => {
      const node = ann('a201020103'); // {1: 2, 1: 3}
      expect(node.at(1)!.toJS()).eq(2);
    });

    it('at() on a non-collection is undefined', () => {
      expect(ann('0a').at(0)).eq(undefined);
    });
  });

  it('root node.bytes equals the whole input', () => {
    for (const s of ['a26161016162820203', 'd86682187b80', '5f42010243030405ff']) {
      expect(toHex(ann(s).bytes)).eq(s);
    }
  });

  it('returns a CborNode instance', () => {
    expect(ann('00')).instanceOf(CborNode);
  });

  it('rejects trailing bytes like decode', () => {
    expect(() => decodeAnnotated(hex('0000'))).to.throw('Remaining Bytes');
  });

  // the refactor proof: the tree's toJS() reproduces plain decode() exactly
  describe('parity: decodeAnnotated(x).toJS() deep-equals decode(x)', () => {
    const vectors = [
      '00',
      '0a',
      '1819',
      '1903e8',
      '1a000f4240',
      '1b000000e8d4a51000',
      '1bffffffffffffffff',
      '20',
      '29',
      '3818',
      '3903e7',
      '3a000f423f',
      '3b000000e8d4a50fff',
      '3bffffffffffffffff',
      '40',
      '4401020304',
      '581a010203040506070809100a0b0c0d0e0f11121314151617181920',
      '5f42010243030405ff',
      '60',
      '66417368697368',
      '7f6a496E646566696E69746566417368697368ff',
      '80',
      '981a0101010101010101010101010101010101010101010101010101',
      '826161a161626163',
      '9fff',
      '9f0102ff',
      'a0',
      'a201020304',
      'bfff',
      'bf01020304ff',
      'a201020103',
      'd86682187b80',
      'c2493635c9adc5dea00000',
      'c3493635c9adc5de9fffff',
      'dbffffffffffffffff00',
      'f97e00',
      'f97c00',
      'f9fc00',
      'f98000',
      'f93c00',
      'f4',
      'f5',
      'f6',
      'f7',
      'f0',
      'f820',
    ];
    for (const v of vectors) {
      it(v, () => {
        const buf = hex(v);
        const viaTree = decodeAnnotated(buf).toJS();
        const viaPlain = decode(buf);
        expect(deepEql(viaTree, viaPlain)).eq(true);
        // indefiniteness is a distinction lodash misses on Array/Map subclasses,
        // so compare the exact constructor when both are objects
        if (viaPlain !== null && typeof viaPlain === 'object') {
          expect(Object.getPrototypeOf(viaTree)).eq(Object.getPrototypeOf(viaPlain));
        }
      });
    }
  });
});
