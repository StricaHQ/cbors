import { describe, it, expect, vi } from 'vitest';
import { runInNewContext } from 'node:vm';
import * as _ from 'lodash';
import { CborTag, decode, decodeAnnotated, encode as baseEncode, EncodedCbor } from '../src/index';

const deepEql = _.isEqual;
const hex = (s: string) => Buffer.from(s, 'hex');
const toHex = (u: Uint8Array): string => Buffer.from(u).toString('hex');
// encode() returns a plain Uint8Array; wrap it as a Buffer so these tests can
// keep asserting via .toString('hex') and other Buffer conveniences
const encode = (value: any, options?: any): Buffer => Buffer.from(baseEncode(value, options));

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

    // the ±2^53 boundary, where decode switches between number and bigint
    expect(encode(9007199254740991).toString('hex')).eq('1b001fffffffffffff');
    expect(encode(9007199254740992).toString('hex')).eq('1b0020000000000000');
    expect(encode(-9007199254740991).toString('hex')).eq('3b001ffffffffffffe');
    expect(encode(-9007199254740992).toString('hex')).eq('3b001fffffffffffff');
  });

  it('Encode non-integer numbers as float64', () => {
    expect(encode(1.5).toString('hex')).eq('fb3ff8000000000000');
    expect(encode(1.1).toString('hex')).eq('fb3ff199999999999a');
    expect(encode(-4.1).toString('hex')).eq('fbc010666666666666');
    // integer-valued numbers stay integers, whatever width they arrived in
    expect(encode(decode(hex('fa47c35000'))).toString('hex')).eq('1a000186a0');
    expect(encode(decode(hex('f93c00'))).toString('hex')).eq('01');
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
    expect(encode(new Map().set(1, new EncodedCbor(raw))).toString('hex')).eq('a101a201020304');

    // preserves a non-canonical representation that re-encoding would normalize
    expect(encode(23).toString('hex')).eq('17');
    expect(encode(new EncodedCbor(Buffer.from('1817', 'hex'))).toString('hex')).eq('1817');

    // spliced output decodes as the embedded item
    const decoded = decode(encode([new EncodedCbor(raw)]));
    expect(deepEql(decoded[0], new Map().set(1, 2).set(3, 4))).eq(true);
  });

  it('EncodedCbor only takes a non-empty Uint8Array', () => {
    // a hex string used to be spliced one character per byte (00 01 00 02), and
    // an empty buffer left the array below one item short (81)
    expect(() => new EncodedCbor('0102' as any)).to.throw(
      TypeError,
      'EncodedCbor expects a Uint8Array, got string'
    );
    expect(() => encode([new EncodedCbor(new Uint8Array(0))])).to.throw(
      RangeError,
      'EncodedCbor expects one encoded CBOR item, got no bytes'
    );
    for (const [type, input] of [
      ['Array', [0x01, 0x02]],
      ['ArrayBuffer', new ArrayBuffer(2)],
      ['Uint16Array', new Uint16Array(1)],
      ['Object', { cborBytes: Uint8Array.of(0x01) }],
      ['undefined', undefined],
    ] as Array<[string, any]>) {
      expect(() => new EncodedCbor(input), type).to.throw(TypeError, `got ${type}`);
    }

    // any Uint8Array is fine, and cborBytes hands back exactly what was given
    const buf = Buffer.from('0a', 'hex');
    expect(new EncodedCbor(buf).cborBytes).eq(buf);
    expect(encode([new EncodedCbor(buf)]).toString('hex')).eq('810a');
    const otherRealm = runInNewContext('Uint8Array.of(0x0b)');
    expect(encode(new EncodedCbor(otherRealm)).toString('hex')).eq('0b');
  });

  it('Encode bigint', () => {
    expect(encode(BigInt(10)).toString('hex')).eq('0a');
    expect(encode(BigInt(-10)).toString('hex')).eq('29');
    expect(encode(BigInt(1000000000000)).toString('hex')).eq('1b000000e8d4a51000');
    expect(encode(BigInt('18446744073709551615')).toString('hex')).eq('1bffffffffffffffff');
    expect(encode(BigInt('-18446744073709551616')).toString('hex')).eq('3bffffffffffffffff');
    // beyond 64-bit falls back to bignum tags
    expect(encode(BigInt('18446744073709551616')).toString('hex')).eq('c249010000000000000000');
    expect(encode(BigInt('-18446744073709551617')).toString('hex')).eq('c349010000000000000000');
    expect(encode(BigInt('1000000000000000000000'), { collapseBigInt: false }).toString('hex')).eq(
      'c2493635c9adc5dea00000'
    );
    // collapseBigInt: false forces a bignum tag even for 64-bit-representable values
    expect(encode(BigInt(10), { collapseBigInt: false }).toString('hex')).eq('c2410a');
    // undefined and null keep the default, as with the decoder options
    expect(encode(BigInt(10), { collapseBigInt: undefined }).toString('hex')).eq('0a');
    expect(encode(BigInt(10), null as any).toString('hex')).eq('0a');
    // round trip through the decoder's bigint representation
    const decoded = decode(encode(BigInt('18446744073709551616'))) as bigint;
    expect(decoded.toString()).eq('18446744073709551616');
  });

  it('Encode bignums of any length', () => {
    expect(encode(0n, { collapseBigInt: false }).toString('hex')).eq('c24100');
    expect(encode(-1n, { collapseBigInt: false }).toString('hex')).eq('c34100');
    // a magnitude with an odd number of hex digits and every digit value
    expect(encode(0x0123456789abcdef0123456789abcdefn).toString('hex')).eq(
      'c2500123456789abcdef0123456789abcdef'
    );
    // 256 KiB magnitudes, which took seconds each while bytes were shifted out one by one
    const n = 256 * 1024;
    const value = 1n << BigInt(8 * (n - 1));
    const expected = Buffer.concat([hex('c25a00040000'), Buffer.from([1]), Buffer.alloc(n - 1)]);
    expect(encode(value).equals(expected)).eq(true);
    expected[0] = 0xc3;
    expect(encode(-value - 1n).equals(expected)).eq(true);
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

  it('Encode throws for objects that are not plain, instead of mapping their fields', () => {
    class Point {
      x = 1;
    }
    expect(() => encode(new Point())).to.throw(
      'Unsupported type for CBOR encoding: Point instance, only plain objects encode as maps'
    );
    expect(() => encode(Object.create({ inherited: 1 }))).to.throw('Unsupported type');
    expect(() => encode(new SharedArrayBuffer(1))).to.throw('Unsupported type');
    // a tree node points at the way to splice its bytes
    expect(() => encode([decodeAnnotated(hex('1817'))])).to.throw('new EncodedCbor(node.bytes)');
    // a prototype-less object is still plain
    expect(encode(Object.assign(Object.create(null), { a: 1 })).toString('hex')).eq('a1616101');
  });

  it('Encode takes the value classes of another copy of cbors', async () => {
    vi.resetModules();
    const other = await import('../src/index');
    expect(other.CborTag).not.eq(CborTag);

    expect(encode(new other.CborTag([1, 2], 258)).toString('hex')).eq('d90102820102');
    expect(encode(new other.EncodedCbor(hex('1817'))).toString('hex')).eq('1817');
    expect(encode(new other.SimpleValue(99)).toString('hex')).eq('f863');
    const array = new other.IndefiniteArray();
    array.push(1);
    expect(encode(array).toString('hex')).eq('9f01ff');
    expect(encode(new other.IndefiniteMap().set(1, 2)).toString('hex')).eq('bf0102ff');

    // either copy re-encodes what the other decoded, byte for byte
    const bytes = 'd9010284c60a9f01ffbf0102fff863';
    expect(encode(other.decode(hex(bytes))).toString('hex')).eq(bytes);
    expect(toHex(other.encode(decode(hex(bytes))))).eq(bytes);

    // the brand stays off the instances
    const tag = new CborTag(1, 2);
    expect(Object.keys(tag)).deep.eq(['value', 'tag']);
    expect(Object.getOwnPropertySymbols(tag)).deep.eq([]);
    expect(JSON.stringify(tag)).eq('{"value":1,"tag":2}');
  });

  it('Encode takes builtins from another realm', () => {
    const [map, object, bytes, clamped, buffer, array] = runInNewContext(
      '[new Map([[1, 2]]), { a: 1 }, Uint8Array.of(3), Uint8ClampedArray.of(4), Uint8Array.of(5).buffer, [6]]'
    );
    expect(encode(map).toString('hex')).eq('a10102');
    expect(encode(object).toString('hex')).eq('a1616101');
    expect(encode(bytes).toString('hex')).eq('4103');
    expect(encode(clamped).toString('hex')).eq('4104');
    expect(encode(buffer).toString('hex')).eq('4105');
    expect(encode(array).toString('hex')).eq('8106');
    // a Map subclass carrying the IndefiniteMap brand, from another realm
    const indefinite = runInNewContext(`
      class IndefiniteMap extends Map {}
      Object.defineProperty(IndefiniteMap.prototype, Symbol.for('@stricahq/cbors'), { value: 'IndefiniteMap' });
      new IndefiniteMap([[1, 2]]);
    `);
    expect(encode(indefinite).toString('hex')).eq('bf0102ff');

    for (const source of [
      'new Date()',
      'new Set([1])',
      'new WeakMap()',
      'Float32Array.of(1)',
      'new DataView(new ArrayBuffer(1))',
      'new Error("x")',
      'new (class Point {})()',
    ]) {
      expect(() => encode(runInNewContext(source)), source).to.throw('Unsupported type');
    }
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
      expect(toHex(bodyNode.bytes)).eq('a1001817');
      expect(toHex(witnessNode.bytes)).eq('a0');

      // reassemble with a fresh witness set, keeping body/isValid/auxData verbatim
      const newWitnessSet = new Map().set(1, 'sig');
      const rebuilt = encode([new EncodedCbor(bodyNode.bytes), newWitnessSet, true, null]);
      expect(rebuilt.toString('hex')).eq('84a1001817a10163736967f5f6');

      // the body subtree is byte-identical to the input; a decode→re-encode of the
      // body would have normalized 23 to '17' and broken any hash over these bytes
      const rebuiltTx = decodeAnnotated(rebuilt);
      expect(toHex(rebuiltTx.at(0)!.bytes)).eq('a1001817');
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
