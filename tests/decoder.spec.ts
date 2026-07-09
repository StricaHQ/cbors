import { describe, it, expect } from 'vitest';
import { Decoder, SimpleValue } from '../src/index';

describe('decoder', (): void => {
  it('Decode negative and special float16', () => {
    expect(Decoder.decode(Buffer.from('f9c400', 'hex')).value).eq(-4);
    expect(Object.is(Decoder.decode(Buffer.from('f98000', 'hex')).value, -0)).eq(true);
    expect(Decoder.decode(Buffer.from('f98001', 'hex')).value).eq(-5.960464477539063e-8);
    expect(Decoder.decode(Buffer.from('f97c00', 'hex')).value).eq(Infinity);
    expect(Decoder.decode(Buffer.from('f9fc00', 'hex')).value).eq(-Infinity);
    expect(Number.isNaN(Decoder.decode(Buffer.from('f97e00', 'hex')).value)).eq(true);
    expect(Decoder.decode(Buffer.from('f93c00', 'hex')).value).eq(1);
  });

  it('Decode rejects ill-formed two-byte simple values', () => {
    expect(() => Decoder.decode(Buffer.from('f800', 'hex'))).to.throw('Invalid two-byte simple');
    expect(() => Decoder.decode(Buffer.from('f818', 'hex'))).to.throw('Invalid two-byte simple');
    expect(() => Decoder.decode(Buffer.from('f81f', 'hex'))).to.throw('Invalid two-byte simple');
    expect((Decoder.decode(Buffer.from('f820', 'hex')).value as SimpleValue).value).eq(32);
  });

  it('Decode rejects indefinite text chunks that are not valid UTF-8 alone', () => {
    // "ü" (c3bc) split across two chunks
    expect(() => Decoder.decode(Buffer.from('7f61c361bcff', 'hex'))).to.throw();
    // valid chunks still concatenate
    expect(Decoder.decode(Buffer.from('7f62c3bc6161ff', 'hex')).value).eq('üa');
  });

  it('Decode rejects unsatisfiable declared lengths fast', () => {
    expect(() => Decoder.decode(Buffer.from('5bffffffffffffffff', 'hex'))).to.throw(
      'exceeds maximum'
    );
    expect(() => Decoder.decode(Buffer.from('7b0020000000000000', 'hex'))).to.throw(
      'exceeds maximum'
    );
    expect(() => Decoder.decode(Buffer.from('9bffffffffffffffff', 'hex'))).to.throw(
      'Invalid array length'
    );
    expect(() => Decoder.decode(Buffer.from('bbffffffffffffffff', 'hex'))).to.throw(
      'Invalid map length'
    );
    // configurable per-string cap
    expect(() => Decoder.decode(Buffer.from('4401020304', 'hex'), { maxStringLength: 3 })).to.throw(
      'exceeds maximum'
    );
    expect(
      Decoder.decode(Buffer.from('4401020304', 'hex'), { maxStringLength: 4 }).value.length
    ).eq(4);
  });

  it('Decode enforces max nesting depth', () => {
    const nested = (depth: number) =>
      Buffer.concat([Buffer.alloc(depth, 0x81), Buffer.from([0x00])]);
    expect(() => Decoder.decode(nested(2000))).to.throw('Maximum depth exceeded');
    expect(Decoder.decode(nested(1000)).value).to.be.an('array');
    expect(() => Decoder.decode(nested(5), { maxDepth: 3 })).to.throw('Maximum depth exceeded');
    expect(Decoder.decode(nested(3), { maxDepth: 3 }).value).to.be.an('array');
  });

  it('Truncated input throws Insufficient data', () => {
    expect(() => Decoder.decode(Buffer.from('4401', 'hex'))).to.throw('Insufficient data');
    expect(() => Decoder.decode(Buffer.alloc(0))).to.throw('Insufficient data');
  });
});
