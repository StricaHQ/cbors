import { describe, it, expect } from 'vitest';
import { decode, decodeAnnotated, IncrementalDecoder, SimpleValue } from '../src/index';

describe('decoder', (): void => {
  it('Decode negative and special float16', () => {
    expect(decode(Buffer.from('f9c400', 'hex'))).eq(-4);
    expect(Object.is(decode(Buffer.from('f98000', 'hex')), -0)).eq(true);
    expect(decode(Buffer.from('f98001', 'hex'))).eq(-5.960464477539063e-8);
    expect(decode(Buffer.from('f97c00', 'hex'))).eq(Infinity);
    expect(decode(Buffer.from('f9fc00', 'hex'))).eq(-Infinity);
    expect(Number.isNaN(decode(Buffer.from('f97e00', 'hex')))).eq(true);
    expect(decode(Buffer.from('f93c00', 'hex'))).eq(1);
  });

  it('Decode ints beyond ±2^53 as bigint', () => {
    expect(decode(Buffer.from('1bffffffffffffffff', 'hex'))).eq(18446744073709551615n);
    expect(decode(Buffer.from('3bffffffffffffffff', 'hex'))).eq(-18446744073709551616n);
    // bignum tags collapse to bigint
    expect(decode(Buffer.from('c249010000000000000000', 'hex'))).eq(18446744073709551616n);
    expect(decode(Buffer.from('c349010000000000000000', 'hex'))).eq(-18446744073709551617n);
    // within ±2^53 stays a number
    expect(decode(Buffer.from('1b000000e8d4a51000', 'hex'))).eq(1000000000000);
    expect(typeof decode(Buffer.from('1b000000e8d4a51000', 'hex'))).eq('number');
    // the boundary itself: ±(2^53 - 1) are numbers, ±2^53 are bigint
    expect(decode(Buffer.from('1b001fffffffffffff', 'hex'))).eq(9007199254740991);
    expect(decode(Buffer.from('3b001ffffffffffffe', 'hex'))).eq(-9007199254740991);
    expect(decode(Buffer.from('1b0020000000000000', 'hex'))).eq(9007199254740992n);
    expect(decode(Buffer.from('3b001fffffffffffff', 'hex'))).eq(-9007199254740992n);
  });

  it('Decode bignums of any length', () => {
    expect(decode(Buffer.from('c240', 'hex'))).eq(0n);
    expect(decode(Buffer.from('c340', 'hex'))).eq(-1n);
    expect(decode(Buffer.from('c2430000ff', 'hex'))).eq(255n);
    expect(decode(Buffer.from('c250000102030405060708090a0b0c0d0e0f', 'hex'))).eq(
      0x0102030405060708090a0b0c0d0e0fn
    );

    const n = 256 * 1024;
    const head = Buffer.from('5a00040000', 'hex');
    const one = Buffer.alloc(n);
    one[0] = 1;
    const ones = Buffer.alloc(n, 0xff);
    expect(decode(Buffer.concat([Buffer.of(0xc2), head, one]))).eq(1n << BigInt(8 * (n - 1)));
    expect(decode(Buffer.concat([Buffer.of(0xc3), head, ones]))).eq(-(1n << BigInt(8 * n)));
  });

  it('Decode float32 and float64 payloads', () => {
    expect(decode(Buffer.from('fa47c35000', 'hex'))).eq(100000);
    expect(decode(Buffer.from('fa7f800000', 'hex'))).eq(Infinity);
    expect(decode(Buffer.from('fb3ff199999999999a', 'hex'))).eq(1.1);
    expect(decode(Buffer.from('fbc010666666666666', 'hex'))).eq(-4.1);
    // float16 range: smallest subnormal, smallest normal, largest finite
    expect(decode(Buffer.from('f90001', 'hex'))).eq(5.960464477539063e-8);
    expect(decode(Buffer.from('f90400', 'hex'))).eq(0.00006103515625);
    expect(decode(Buffer.from('f97bff', 'hex'))).eq(65504);
  });

  it('Decode rejects reserved additional info 28-30', () => {
    for (const h of ['1c', '3d', '5e', '7c', '9d', 'be', 'dc', 'fc', 'fd', 'fe']) {
      expect(() => decode(Buffer.from(h, 'hex')), h).to.throw('Invalid length encoding');
    }
  });

  it('Decode rejects indefinite length on non-container major types', () => {
    // only byte/text strings, arrays and maps have an indefinite form
    for (const h of ['1f', '3f', 'df', 'ff']) {
      expect(() => decode(Buffer.from(h, 'hex')), h).to.throw('Invalid length');
    }
  });

  it('Decode rejects malformed indefinite string chunks', () => {
    // chunks must share the major type of the string they belong to
    expect(() => decode(Buffer.from('5f6161ff', 'hex'))).to.throw('Invalid indefinite length');
    expect(() => decode(Buffer.from('7f4101ff', 'hex'))).to.throw('Invalid indefinite length');
    expect(() => decode(Buffer.from('5f00ff', 'hex'))).to.throw('Invalid indefinite length');
    // and may not themselves be indefinite
    expect(() => decode(Buffer.from('5f5f4101ffff', 'hex'))).to.throw('Invalid indefinite length');
  });

  it('Decode indefinite strings with no chunks', () => {
    const bytes = decode(Buffer.from('5fff', 'hex'));
    expect(bytes instanceof Uint8Array).eq(true);
    expect(bytes.length).eq(0);
    expect(decode(Buffer.from('7fff', 'hex'))).eq('');
  });

  it('Decode rejects bignum tags whose content is not a byte string', () => {
    expect(() => decode(Buffer.from('c200', 'hex'))).to.throw('Invalid bignum encoding');
    expect(() => decode(Buffer.from('c38101', 'hex'))).to.throw('Invalid bignum encoding');
  });

  it('Decode rejects ill-formed two-byte simple values', () => {
    expect(() => decode(Buffer.from('f800', 'hex'))).to.throw('Invalid two-byte simple');
    expect(() => decode(Buffer.from('f818', 'hex'))).to.throw('Invalid two-byte simple');
    expect(() => decode(Buffer.from('f81f', 'hex'))).to.throw('Invalid two-byte simple');
    expect((decode(Buffer.from('f820', 'hex')) as SimpleValue).value).eq(32);
  });

  it('Decode rejects indefinite text chunks that are not valid UTF-8 alone', () => {
    // "ü" (c3bc) split across two chunks
    expect(() => decode(Buffer.from('7f61c361bcff', 'hex'))).to.throw();
    // valid chunks still concatenate
    expect(decode(Buffer.from('7f62c3bc6161ff', 'hex'))).eq('üa');
    // definite text strings are validated just as strictly
    expect(() => decode(Buffer.from('61ff', 'hex'))).to.throw();
    expect(() => decode(Buffer.from('62c328', 'hex'))).to.throw();
  });

  it('Decode rejects unsatisfiable declared lengths fast', () => {
    expect(() => decode(Buffer.from('5bffffffffffffffff', 'hex'))).to.throw('exceeds maximum');
    expect(() => decode(Buffer.from('7b0020000000000000', 'hex'))).to.throw('exceeds maximum');
    expect(() => decode(Buffer.from('9bffffffffffffffff', 'hex'))).to.throw('Invalid array length');
    expect(() => decode(Buffer.from('bbffffffffffffffff', 'hex'))).to.throw('Invalid map length');
    // configurable per-string cap
    expect(() => decode(Buffer.from('4401020304', 'hex'), { maxStringLength: 3 })).to.throw(
      'exceeds maximum'
    );
    expect(decode(Buffer.from('4401020304', 'hex'), { maxStringLength: 4 }).length).eq(4);
    // the cap also applies to each chunk of an indefinite string
    expect(() => decode(Buffer.from('5f43010203ff', 'hex'), { maxStringLength: 2 })).to.throw(
      'exceeds maximum'
    );
  });

  it('Decode enforces max nesting depth', () => {
    const nested = (depth: number) =>
      Buffer.concat([Buffer.alloc(depth, 0x81), Buffer.from([0x00])]);
    expect(() => decode(nested(2000))).to.throw('Maximum depth exceeded');
    expect(decode(nested(1000))).to.be.an('array');
    expect(() => decode(nested(5), { maxDepth: 3 })).to.throw('Maximum depth exceeded');
    expect(decode(nested(3), { maxDepth: 3 })).to.be.an('array');
    // Infinity turns the depth limit off; the string length keeps its ceiling
    expect(decode(nested(2000), { maxDepth: Infinity })).to.be.an('array');
    expect(() =>
      decode(Buffer.from('5bffffffffffffffff', 'hex'), { maxStringLength: Infinity })
    ).to.throw('exceeds maximum');
  });

  describe('Decoder options are validated by every entry point', () => {
    const entryPoints: Array<[string, (options: any) => unknown]> = [
      ['decode', (options) => decode(Buffer.from('00', 'hex'), options)],
      ['decodeAnnotated', (options) => decodeAnnotated(Buffer.from('00', 'hex'), options)],
      ['new IncrementalDecoder', (options) => new IncrementalDecoder(options)],
      ['IncrementalDecoder.annotated', (options) => IncrementalDecoder.annotated(options)],
    ];
    for (const [name, run] of entryPoints) {
      it(name, () => {
        for (const option of ['maxDepth', 'maxStringLength']) {
          // NaN compares false against every value, so it would turn the limit off
          for (const bad of [NaN, -1, 1.5, -Infinity]) {
            expect(() => run({ [option]: bad }), `${option}: ${bad}`).to.throw(
              RangeError,
              `Invalid ${option}: expected a non-negative integer, got ${bad}`
            );
          }
          for (const bad of ['5', 5n, {}, true]) {
            expect(() => run({ [option]: bad }), `${option}: ${typeof bad}`).to.throw(
              TypeError,
              `Invalid ${option}: expected a number, got ${typeof bad}`
            );
          }
          // undefined and null keep the default
          for (const good of [0, 7, Infinity, undefined, null]) {
            expect(() => run({ [option]: good }), `${option}: ${good}`).not.to.throw();
          }
        }
        expect(() => run(undefined)).not.to.throw();
        expect(() => run(null)).not.to.throw();
      });
    }
  });

  it('Truncated input throws Insufficient data', () => {
    expect(() => decode(Buffer.from('4401', 'hex'))).to.throw('Insufficient data');
    expect(() => decode(Buffer.alloc(0))).to.throw('Insufficient data');
    // an indefinite container that never reaches its break marker
    expect(() => decode(Buffer.from('9f0102', 'hex'))).to.throw('Insufficient data');
    expect(() => decode(Buffer.from('bf0102', 'hex'))).to.throw('Insufficient data');
  });

  it('Trailing bytes after a complete item are rejected', () => {
    expect(() => decode(Buffer.from('0000', 'hex'))).to.throw('Remaining Bytes');
  });
});
