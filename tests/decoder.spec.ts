import { describe, it, expect } from 'vitest';
import { decode, SimpleValue } from '../src/index';

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
  });

  it('Decode rejects unsatisfiable declared lengths fast', () => {
    expect(() => decode(Buffer.from('5bffffffffffffffff', 'hex'))).to.throw(
      'exceeds maximum'
    );
    expect(() => decode(Buffer.from('7b0020000000000000', 'hex'))).to.throw(
      'exceeds maximum'
    );
    expect(() => decode(Buffer.from('9bffffffffffffffff', 'hex'))).to.throw(
      'Invalid array length'
    );
    expect(() => decode(Buffer.from('bbffffffffffffffff', 'hex'))).to.throw(
      'Invalid map length'
    );
    // configurable per-string cap
    expect(() => decode(Buffer.from('4401020304', 'hex'), { maxStringLength: 3 })).to.throw(
      'exceeds maximum'
    );
    expect(decode(Buffer.from('4401020304', 'hex'), { maxStringLength: 4 }).length).eq(4);
  });

  it('Decode enforces max nesting depth', () => {
    const nested = (depth: number) =>
      Buffer.concat([Buffer.alloc(depth, 0x81), Buffer.from([0x00])]);
    expect(() => decode(nested(2000))).to.throw('Maximum depth exceeded');
    expect(decode(nested(1000))).to.be.an('array');
    expect(() => decode(nested(5), { maxDepth: 3 })).to.throw('Maximum depth exceeded');
    expect(decode(nested(3), { maxDepth: 3 })).to.be.an('array');
  });

  it('Truncated input throws Insufficient data', () => {
    expect(() => decode(Buffer.from('4401', 'hex'))).to.throw('Insufficient data');
    expect(() => decode(Buffer.alloc(0))).to.throw('Insufficient data');
  });
});
