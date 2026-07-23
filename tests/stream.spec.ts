import { describe, it, expect } from 'vitest';
import { IncrementalDecoder } from '../src/index';

describe('IncrementalDecoder', (): void => {
  it('Errors instead of hanging on absurd declared string length', () => {
    const decoder = new IncrementalDecoder();
    expect(() => decoder.push(Buffer.from('5bffffffffffffffff', 'hex'))).to.throw(
      'exceeds maximum'
    );
  });

  it('Decodes a large item split into small chunks', () => {
    const payload = Buffer.alloc(1024 * 1024, 0xaa);
    const item = Buffer.concat([Buffer.from('5a00100000', 'hex'), payload]);
    const decoder = new IncrementalDecoder();

    const items: Array<{ value: any; bytes: Uint8Array }> = [];
    for (let off = 0; off < item.length; off += 2048) {
      items.push(...decoder.push(item.subarray(off, off + 2048)));
    }
    decoder.end();

    expect(items.length).eq(1);
    const [data] = items;
    expect(data.value instanceof Uint8Array).eq(true);
    expect(data.value.length).eq(payload.length);
    expect(Buffer.from(data.value).equals(payload)).eq(true);
    expect(Buffer.from(data.bytes).equals(item)).eq(true);
  });

  it('Decodes multiple items across pushes, including zero-length bytes and string', () => {
    const decoder = new IncrementalDecoder();
    const results: any[] = [];
    results.push(...decoder.push(Buffer.from('40', 'hex'))); // empty byte string
    results.push(...decoder.push(Buffer.from('60', 'hex'))); // empty text string
    results.push(...decoder.push(Buffer.from('01', 'hex'))); // unsigned 1
    decoder.end();

    expect(results.length).eq(3);
    expect(results[0].value instanceof Uint8Array).eq(true);
    expect(results[0].value.length).eq(0);
    expect(results[1].value).eq('');
    expect(results[2].value).eq(1);
  });

  it('end() throws when the stream ends mid-item', () => {
    const decoder = new IncrementalDecoder();
    // major type 2, length 4, but only one payload byte follows
    expect(decoder.push(Buffer.from('4401', 'hex'))).to.have.length(0);
    expect(() => decoder.end()).to.throw('unexpected end of input');
  });
});
