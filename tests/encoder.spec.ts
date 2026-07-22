import { describe, it, expect } from 'vitest';
import * as _ from 'lodash';
import { CborTag, decode, decodeAnnotated, encode, EncodedCbor } from '../src/index';

const deepEql = _.isEqual;
const hex = (s: string) => Buffer.from(s, 'hex');

describe('encoder', (): void => {
  it('Encode integers beyond ±2^53 exactly as integers', () => {
    expect(encode(2 ** 60).toString('hex')).eq('1b1000000000000000');
    expect(encode(-(2 ** 60)).toString('hex')).eq('3b0fffffffffffffff');
    expect(encode([2 ** 60, 1]).toString('hex')).eq('821b100000000000000001');

    const encoded = encode(45000000000000000);
    expect(encoded[0]).eq(0x1b); // unsigned int major type, not a float
    const roundTripped = decode(encoded) as bigint;
    expect(roundTripped.toString()).eq('45000000000000000');

    // beyond 2^64 falls back to bignum tags
    expect(encode(2 ** 70).toString('hex')).eq('c249400000000000000000');
    expect(encode(-(2 ** 70)).toString('hex')).eq('c3493fffffffffffffffff');
  });

  it('Encode non-finite numbers', () => {
    expect(encode(Infinity).toString('hex')).eq('f97c00');
    expect(encode(-Infinity).toString('hex')).eq('f9fc00');
    expect(encode(NaN).toString('hex')).eq('f97e00');
    expect(Object.is(decode(encode(-0)), -0)).eq(true);
  });

  it('EncodedCbor splices pre-encoded bytes verbatim', () => {
    const raw = Buffer.from('a201020304', 'hex'); // {1: 2, 3: 4}

    // spliced as-is, unlike a plain Buffer which gets a byte string header
    expect(encode(new EncodedCbor(raw)).toString('hex')).eq('a201020304');
    expect(encode(raw).toString('hex')).eq('45a201020304');

    // nested inside arrays and maps
    const strAshish = new EncodedCbor(Buffer.from('66417368697368', 'hex'));
    expect(encode([1, strAshish, 2]).toString('hex')).eq('83016641736869736802');
    expect(encode(new Map().set(1, new EncodedCbor(raw))).toString('hex')).eq(
      'a101a201020304'
    );

    // preserves a non-canonical representation that re-encoding would normalize
    expect(encode(23).toString('hex')).eq('17');
    expect(encode(new EncodedCbor(Buffer.from('1817', 'hex'))).toString('hex')).eq('1817');

    // spliced output decodes as the embedded item
    const decoded = decode(encode([new EncodedCbor(raw)]));
    expect(deepEql(decoded[0], new Map().set(1, 2).set(3, 4))).eq(true);
  });

  it('Encode bigint', () => {
    expect(encode(BigInt(10)).toString('hex')).eq('0a');
    expect(encode(BigInt(-10)).toString('hex')).eq('29');
    expect(encode(BigInt(1000000000000)).toString('hex')).eq('1b000000e8d4a51000');
    expect(encode(BigInt('18446744073709551615')).toString('hex')).eq('1bffffffffffffffff');
    expect(encode(BigInt('-18446744073709551616')).toString('hex')).eq(
      '3bffffffffffffffff'
    );
    // beyond 64-bit falls back to bignum tags
    expect(encode(BigInt('18446744073709551616')).toString('hex')).eq(
      'c249010000000000000000'
    );
    expect(encode(BigInt('-18446744073709551617')).toString('hex')).eq(
      'c349010000000000000000'
    );
    expect(
      encode(BigInt('1000000000000000000000'), { collapseBigInt: false }).toString('hex')
    ).eq('c2493635c9adc5dea00000');
    // collapseBigInt: false forces a bignum tag even for 64-bit-representable values
    expect(encode(BigInt(10), { collapseBigInt: false }).toString('hex')).eq('c2410a');
    // round trip through the decoder's bigint representation
    const decoded = decode(encode(BigInt('18446744073709551616'))) as bigint;
    expect(decoded.toString()).eq('18446744073709551616');
  });

  it('Encode throws for unsupported types instead of corrupting', () => {
    const unsupported: Array<[string, any]> = [
      ['Date', new Date()],
      ['Set', new Set([1, 2])],
      ['WeakMap', new WeakMap()],
      ['RegExp', /x/],
      ['Error', new Error('x')],
      ['Promise', Promise.resolve()],
      ['boxed Number', Object(5)],
      ['Float32Array', new Float32Array([1.5])],
      ['Int8Array', new Int8Array([1])],
      ['DataView', new DataView(new ArrayBuffer(1))],
      ['function', () => 1],
      ['symbol', Symbol('x')],
      // BigNumber (dropped in v2) is rejected, not silently encoded as {s,e,c}
      ['BigNumber', { _isBigNumber: true, s: 1, e: 0, c: [5] }],
    ];
    for (const [name, v] of unsupported) {
      expect(() => encode(v), name).to.throw('Unsupported type');
    }
    // plain objects, Maps and the byte-string family still encode
    expect(encode({ a: 1 }).toString('hex')).eq('a1616101');
    expect(encode(new Uint8Array([1])).toString('hex')).eq('4101');
    expect(encode(new Uint8ClampedArray([1])).toString('hex')).eq('4101');
  });

  describe('byte-exact editing via EncodedCbor(node.bytes)', () => {
    it('splices a decoded subtree’s source bytes verbatim', () => {
      const node = decodeAnnotated(hex('a201020304')); // {1: 2, 3: 4}
      expect(encode(new EncodedCbor(node.bytes)).toString('hex')).eq('a201020304');
    });

    it('preserves non-canonical encoding that re-decoding would normalize', () => {
      // 23 encoded non-minimally as two bytes; decode→encode would collapse to '17',
      // but splicing node.bytes keeps the original
      const node = decodeAnnotated(hex('1817'));
      expect(encode(new EncodedCbor(node.bytes)).toString('hex')).eq('1817');
      expect(encode(decode(hex('1817'))).toString('hex')).eq('17');
    });

    it('round-trips every source byte, including forms plain encode collapses', () => {
      // indefinite byte/text strings collapse on plain decode→encode; splicing the
      // node bytes keeps them exact
      const vectors = [
        '00',
        '1817',
        'a201020103', // duplicate map keys
        'd86682187b80', // tag 102
        '5f42010243030405ff', // indefinite bytes
        '7f6a496E646566696E69746566417368697368ff', // indefinite text
        '9f0102ff', // indefinite array
        'bf01020304ff', // indefinite map
      ];
      for (const v of vectors) {
        const spliced = encode(new EncodedCbor(decodeAnnotated(hex(v)).bytes));
        expect(spliced.toString('hex')).eq(v.toLowerCase());
      }
    });

    it('rebuilds a tx replacing one subtree while untouched bytes stay identical', () => {
      // tx = [body, witnessSet, isValid, auxiliaryData]
      // body is {0: 23} with 23 written non-minimally ('1817') — a fingerprint that
      // survives only if the original bytes are spliced, not re-encoded
      const tx = decodeAnnotated(hex('84a1001817a0f5f6'));
      const bodyNode = tx.at(0)!;
      const witnessNode = tx.at(1)!;
      expect(bodyNode.bytes.toString('hex')).eq('a1001817');
      expect(witnessNode.bytes.toString('hex')).eq('a0');

      // reassemble with a fresh witness set, keeping body/isValid/auxData verbatim
      const newWitnessSet = new Map().set(1, 'sig');
      const rebuilt = encode([
        new EncodedCbor(bodyNode.bytes),
        newWitnessSet,
        true,
        null,
      ]);
      expect(rebuilt.toString('hex')).eq('84a1001817a10163736967f5f6');

      // the body subtree is byte-identical to the input; a decode→re-encode of the
      // body would have normalized 23 to '17' and broken any hash over these bytes
      const rebuiltTx = decodeAnnotated(rebuilt);
      expect(rebuiltTx.at(0)!.bytes.toString('hex')).eq('a1001817');
    });

    it('nests spliced nodes inside arrays and maps', () => {
      const inner = new EncodedCbor(decodeAnnotated(hex('66417368697368')).bytes); // "Ashish"
      expect(encode([1, inner, 2]).toString('hex')).eq('83016641736869736802');
      expect(encode(new Map().set(1, inner)).toString('hex')).eq('a10166417368697368');
    });
  });

  it('Encode tag 4 decimal fraction via CborTag', () => {
    // bigint is integer-only; decimal fractions are built explicitly and round trip
    const oneAndHalf = new CborTag([-1, 15], 4); // 15 * 10^-1
    expect(encode(oneAndHalf).toString('hex')).eq('c482200f');
    const decoded = decode(encode(oneAndHalf)) as CborTag;
    expect(decoded.tag).eq(4);
    expect(deepEql(decoded.value, [-1, 15])).eq(true);
  });
});
