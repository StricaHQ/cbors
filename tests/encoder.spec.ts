import { describe, it, expect } from 'vitest';
import * as _ from 'lodash';
import { BigNumber } from 'bignumber.js';
import { decode, encode, EncodedCbor } from '../src/index';

const deepEql = _.isEqual;

describe('encoder', (): void => {
  it('Encode integers beyond ±2^53 exactly as integers', () => {
    expect(encode(2 ** 60).toString('hex')).eq('1b1000000000000000');
    expect(encode(-(2 ** 60)).toString('hex')).eq('3b0fffffffffffffff');
    expect(encode([2 ** 60, 1]).toString('hex')).eq('821b100000000000000001');

    const encoded = encode(45000000000000000);
    expect(encoded[0]).eq(0x1b); // unsigned int major type, not a float
    const roundTripped = decode(encoded).value as BigNumber;
    expect(roundTripped.toString()).eq('45000000000000000');

    // beyond 2^64 falls back to bignum tags
    expect(encode(2 ** 70).toString('hex')).eq('c249400000000000000000');
    expect(encode(-(2 ** 70)).toString('hex')).eq('c3493fffffffffffffffff');
  });

  it('Encode non-finite numbers', () => {
    expect(encode(Infinity).toString('hex')).eq('f97c00');
    expect(encode(-Infinity).toString('hex')).eq('f9fc00');
    expect(encode(NaN).toString('hex')).eq('f97e00');
    expect(encode(new BigNumber(Infinity)).toString('hex')).eq('f97c00');
    expect(encode(new BigNumber(-Infinity)).toString('hex')).eq('f9fc00');
    expect(Object.is(decode(encode(-0)).value, -0)).eq(true);
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
    const decoded = decode(encode([new EncodedCbor(raw)])).value;
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
      encode(BigInt('1000000000000000000000'), { collapseBigNumber: false }).toString('hex')
    ).eq('c2493635c9adc5dea00000');
    // round trip through the decoder's BigNumber representation
    const decoded = decode(encode(BigInt('18446744073709551616')))
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
      expect(() => encode(v), name).to.throw('Unsupported type');
    }
    // plain objects, Maps and the byte-string family still encode
    expect(encode({ a: 1 }).toString('hex')).eq('a1616101');
    expect(encode(new Uint8Array([1])).toString('hex')).eq('4101');
    expect(encode(new Uint8ClampedArray([1])).toString('hex')).eq('4101');
  });

  it('Encode options merge with defaults', () => {
    expect(encode(new BigNumber(5)).toString('hex')).eq('05');
    expect(encode(new BigNumber(5), {}).toString('hex')).eq('05');
    expect(encode(new BigNumber(5), { collapseBigNumber: false }).toString('hex')).eq(
      'c24105'
    );
  });
});
