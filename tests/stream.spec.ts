import { describe, it, expect } from 'vitest';
import {
  IncrementalDecoder,
  CborTag,
  IndefiniteArray,
  IndefiniteMap,
  SimpleValue,
  decode,
  encode,
} from '../src/index';

const hex = (h: string) => new Uint8Array(Buffer.from(h, 'hex'));

// one item of every shape the framing pass has to step over
const corpus = (): Uint8Array[] => {
  const indefArray = new IndefiniteArray();
  indefArray.push(1, 'two', new Uint8Array([3]), null);
  const indefMap = new IndefiniteMap();
  indefMap.set(1, [2, 3]).set('k', new Map([[1, 2]]));

  return [
    hex('40'), // empty byte string
    hex('60'), // empty text string
    hex('80'), // empty array
    hex('a0'), // empty map
    hex('f6'),
    hex('f7'),
    hex('5f42010243040506ff'), // indefinite bytes, 2 chunks
    hex('5fff'), // indefinite bytes, no chunks
    hex('7f62c3bc6161ff'), // indefinite text
    hex('7fff'), // indefinite text, no chunks
    hex('9fff'), // empty indefinite array
    hex('bfff'), // empty indefinite map
    hex('8280a0'), // empty containers nested: the parent closes as they settle
    hex('c680'), // tag wrapping an empty array
    hex('829fff9fff'), // indefinite arrays inside a definite one
    hex('9f018202039f0102ffff'), // indefinite arrays nested
    hex('bf6346756ef563416d7421ff'), // indefinite map
    hex('f97e00'),
    hex('fa47c35000'),
    hex('fb3ff199999999999a'),
    hex('1bffffffffffffffff'),
    hex('c249010000000000000000'), // bignum tag
    hex('d818450102030405'), // tag wrapping a byte string
    encode(indefArray),
    encode(indefMap),
    encode(new CborTag(new CborTag([1, 2], 42), 7)),
    encode(new SimpleValue(32)),
    encode(Array.from({ length: 300 }, (_, i) => i)), // 2-byte length header
    encode(new Uint8Array(70000)), // 4-byte length header
  ];
};

describe('IncrementalDecoder', (): void => {
  it('Reassembles every item shape at any chunk size', () => {
    const items = corpus();
    const stream = Buffer.concat(items.map((i) => Buffer.from(i)));

    for (const size of [1, 2, 3, 7, 64, 1024, 65536]) {
      const decoder = new IncrementalDecoder();
      const got: Array<{ value: any; bytes: Uint8Array }> = [];
      for (let off = 0; off < stream.length; off += size) {
        got.push(...decoder.push(new Uint8Array(stream.subarray(off, off + size))));
      }
      decoder.end();

      expect(got.length, `chunk size ${size}`).eq(items.length);
      got.forEach((item, i) => {
        expect(Buffer.from(item.bytes).equals(Buffer.from(items[i])), `chunk ${size} item ${i}`).eq(
          true
        );
        // same value the one-shot decoder produces for those bytes
        expect(encode(item.value)).deep.eq(encode(decode(items[i])));
      });
    }
  });

  it('Rejects a break marker outside an indefinite container', () => {
    expect(() => new IncrementalDecoder().push(hex('ff'))).to.throw('Invalid length');
  });

  it('Applies the full grammar to framed items, not just the framing pass', () => {
    for (const h of ['5f6161ff', '5f5f4101ffff', 'f800', '7f61c361bcff', 'c200']) {
      expect(() => new IncrementalDecoder().push(hex(h)), h).to.throw();
    }
    // what the framing pass can see itself, it rejects up front
    expect(() => new IncrementalDecoder().push(hex('1c'))).to.throw('Invalid length encoding');
    expect(() => new IncrementalDecoder().push(hex('1f'))).to.throw('Invalid length');
  });

  it('Tolerates empty chunks', () => {
    const decoder = new IncrementalDecoder();
    expect(decoder.push(new Uint8Array(0))).to.have.length(0);
    expect(decoder.push(hex('01'))).to.have.length(1);
    expect(decoder.push(new Uint8Array(0))).to.have.length(0);
    decoder.end();
  });

  it('Enforces max nesting depth while framing', () => {
    const nested = (depth: number) =>
      Buffer.concat([Buffer.alloc(depth, 0x81), Buffer.from([0x00])]);
    expect(() => new IncrementalDecoder({ maxDepth: 3 }).push(nested(5))).to.throw(
      'Maximum depth exceeded'
    );
    expect(new IncrementalDecoder({ maxDepth: 3 }).push(nested(3))).to.have.length(1);
  });

  it('Leaves the caller owning the emitted bytes across pushes', () => {
    const decoder = new IncrementalDecoder();
    const [first] = decoder.push(hex('43010203'));
    const before = Buffer.from(first.bytes).toString('hex');
    // a later push reuses the internal buffer; already-emitted bytes must not move
    decoder.push(hex('4404050607'));
    expect(Buffer.from(first.bytes).toString('hex')).eq(before);
  });

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
