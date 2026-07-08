import { expect } from 'chai';
import * as _ from 'lodash';
import { BigNumber } from 'bignumber.js';
import { Decoder, EncodedCbor, Encoder } from '../src/index';

const deepEql = _.isEqual;

describe('encoder', (): void => {
  it('Encode integers beyond ±2^53 exactly as integers', () => {
    expect(Encoder.encode(2 ** 60).toString('hex')).eq('1b1000000000000000');
    expect(Encoder.encode(-(2 ** 60)).toString('hex')).eq('3b0fffffffffffffff');
    expect(Encoder.encode([2 ** 60, 1]).toString('hex')).eq('821b100000000000000001');

    const encoded = Encoder.encode(45000000000000000);
    expect(encoded[0]).eq(0x1b); // unsigned int major type, not a float
    const roundTripped = Decoder.decode(encoded).value as BigNumber;
    expect(roundTripped.toString()).eq('45000000000000000');

    // beyond 2^64 falls back to bignum tags
    expect(Encoder.encode(2 ** 70).toString('hex')).eq('c249400000000000000000');
    expect(Encoder.encode(-(2 ** 70)).toString('hex')).eq('c3493fffffffffffffffff');
  });

  it('Encode non-finite numbers', () => {
    expect(Encoder.encode(Infinity).toString('hex')).eq('f97c00');
    expect(Encoder.encode(-Infinity).toString('hex')).eq('f9fc00');
    expect(Encoder.encode(NaN).toString('hex')).eq('f97e00');
    expect(Encoder.encode(new BigNumber(Infinity)).toString('hex')).eq('f97c00');
    expect(Encoder.encode(new BigNumber(-Infinity)).toString('hex')).eq('f9fc00');
    expect(Object.is(Decoder.decode(Encoder.encode(-0)).value, -0)).eq(true);
  });

  it('EncodedCbor splices pre-encoded bytes verbatim', () => {
    const raw = Buffer.from('a201020304', 'hex'); // {1: 2, 3: 4}

    // spliced as-is, unlike a plain Buffer which gets a byte string header
    expect(Encoder.encode(new EncodedCbor(raw)).toString('hex')).eq('a201020304');
    expect(Encoder.encode(raw).toString('hex')).eq('45a201020304');

    // nested inside arrays and maps
    const strAshish = new EncodedCbor(Buffer.from('66417368697368', 'hex'));
    expect(Encoder.encode([1, strAshish, 2]).toString('hex')).eq('83016641736869736802');
    expect(Encoder.encode(new Map().set(1, new EncodedCbor(raw))).toString('hex')).eq(
      'a101a201020304'
    );

    // preserves a non-canonical representation that re-encoding would normalize
    expect(Encoder.encode(23).toString('hex')).eq('17');
    expect(Encoder.encode(new EncodedCbor(Buffer.from('1817', 'hex'))).toString('hex')).eq('1817');

    // spliced output decodes as the embedded item
    const decoded = Decoder.decode(Encoder.encode([new EncodedCbor(raw)])).value;
    expect(deepEql(decoded[0], new Map().set(1, 2).set(3, 4))).eq(true);
  });

  it('Encode bigint', () => {
    expect(Encoder.encode(BigInt(10)).toString('hex')).eq('0a');
    expect(Encoder.encode(BigInt(-10)).toString('hex')).eq('29');
    expect(Encoder.encode(BigInt(1000000000000)).toString('hex')).eq('1b000000e8d4a51000');
    expect(Encoder.encode(BigInt('18446744073709551615')).toString('hex')).eq('1bffffffffffffffff');
    expect(Encoder.encode(BigInt('-18446744073709551616')).toString('hex')).eq(
      '3bffffffffffffffff'
    );
    // beyond 64-bit falls back to bignum tags
    expect(Encoder.encode(BigInt('18446744073709551616')).toString('hex')).eq(
      'c249010000000000000000'
    );
    expect(Encoder.encode(BigInt('-18446744073709551617')).toString('hex')).eq(
      'c349010000000000000000'
    );
    expect(
      Encoder.encode(BigInt('1000000000000000000000'), { collapseBigNumber: false }).toString('hex')
    ).eq('c2493635c9adc5dea00000');
    // round trip through the decoder's BigNumber representation
    const decoded = Decoder.decode(Encoder.encode(BigInt('18446744073709551616')))
      .value as BigNumber;
    expect(decoded.toFixed()).eq('18446744073709551616');
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
    ];
    for (const [name, v] of unsupported) {
      expect(() => Encoder.encode(v), name).to.throw('Unsupported type');
    }
    // plain objects, Maps and the byte-string family still encode
    expect(Encoder.encode({ a: 1 }).toString('hex')).eq('a1616101');
    expect(Encoder.encode(new Uint8Array([1])).toString('hex')).eq('4101');
    expect(Encoder.encode(new Uint8ClampedArray([1])).toString('hex')).eq('4101');
  });

  it('Encode options merge with defaults', () => {
    expect(Encoder.encode(new BigNumber(5)).toString('hex')).eq('05');
    expect(Encoder.encode(new BigNumber(5), {}).toString('hex')).eq('05');
    expect(Encoder.encode(new BigNumber(5), { collapseBigNumber: false }).toString('hex')).eq(
      'c24105'
    );
  });
});
