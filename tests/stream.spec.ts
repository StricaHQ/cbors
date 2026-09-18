import { describe, it, expect } from 'vitest';
import {
  IncrementalDecoder,
  CborNode,
  CborTag,
  IndefiniteArray,
  IndefiniteMap,
  SimpleValue,
  decode,
  decodeAnnotated,
  encode,
} from '../src/index';
import type { DecoderOptions } from '../src/index';
import { corrupt, outcome, prng, randomItem } from './helpers/random';

const hex = (h: string) => new Uint8Array(Buffer.from(h, 'hex'));
const toHex = (u: Uint8Array): string => Buffer.from(u).toString('hex');

// decode() for a stream: push the bytes in chunks of the given size and expect
// exactly one item out of them
const decodeStreamed = (bytes: Uint8Array, options?: DecoderOptions, chunkSize = bytes.length) => {
  const decoder = new IncrementalDecoder(options);
  const items: Array<{ value: any; bytes: Uint8Array }> = [];
  for (let off = 0; off < bytes.length; off += chunkSize) {
    items.push(...decoder.push(bytes.subarray(off, off + chunkSize)));
  }
  decoder.end();
  if (items.length !== 1) {
    throw new Error(`expected one item, got ${items.length}`);
  }
  return items[0].value;
};

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
    // two-byte simple value, a text chunk that is not UTF-8 alone, a bignum that
    // does not wrap bytes, a text string that is not UTF-8
    for (const h of ['f800', '7f61c361bcff', 'c200', '61ff']) {
      expect(() => new IncrementalDecoder().push(hex(h)), h).to.throw();
    }
    // what the framing pass can see itself, it rejects up front
    expect(() => new IncrementalDecoder().push(hex('1c'))).to.throw('Invalid length encoding');
    expect(() => new IncrementalDecoder().push(hex('1f'))).to.throw('Invalid length');
  });

  it('Rejects a bad indefinite string chunk from its head byte', () => {
    // RFC 8949 3.2.3: a chunk is a definite string of the same major type. No
    // break marker follows any of these, so the framing pass rejects them alone.
    const wrongType = ['5f01', '5f21', '5f61', '5f80', '5fa0', '5fc0', '5ff6', '5ff93c00', '5f18'];
    const indefinite = ['5f5f', '5f7f', '5f9f', '5fbf', '5f1f', '7f7f', '7f5f'];
    const inText = ['7f41', '7f01', '7f616141'];
    for (const h of [...wrongType, ...indefinite, ...inText, '5f410061']) {
      expect(() => new IncrementalDecoder().push(hex(h)), h).to.throw(
        'Invalid indefinite length encoding'
      );
      // decode() gives the same answer once the string is complete
      expect(() => decode(hex(`${h}00ff`)), h).to.throw('Invalid indefinite length encoding');
    }
    // like decode(), reserved additional info is reported as such
    expect(() => new IncrementalDecoder().push(hex('5f1c'))).to.throw('Invalid length encoding');
    expect(() => decode(hex('5f1c00ff'))).to.throw('Invalid length encoding');

    // well-formed chunks keep waiting for the break
    const decoder = new IncrementalDecoder();
    expect(decoder.push(hex('5f4101'))).to.have.length(0);
    expect(decoder.push(hex('4102'))).to.have.length(0);
    const [{ value }] = decoder.push(hex('ff'));
    expect(value).deep.eq(Uint8Array.of(1, 2));
  });

  it('Rejects a break in place of an indefinite map value', () => {
    expect(() => new IncrementalDecoder().push(hex('bf01ff'))).to.throw('Invalid length');
    expect(() => decode(hex('bf01ff'))).to.throw('Invalid length');
    // inside an open container: rejected before the enclosing item is complete
    expect(() => new IncrementalDecoder().push(hex('9fbf01ff'))).to.throw('Invalid length');
    expect(() => new IncrementalDecoder().push(hex('bf01bf0102bf03ff'))).to.throw('Invalid length');
    // a break after a value, or in place of a key, closes the map
    expect(decodeStreamed(hex('bf0102ff'))).deep.eq(new IndefiniteMap().set(1, 2));
    expect(decodeStreamed(hex('bfbf0102ff03ff'))).to.have.property('size', 1);
    expect(decodeStreamed(hex('bfff'))).to.have.property('size', 0);
  });

  it('Agrees with decode() on nesting at the depth limit', () => {
    // an indefinite string is one item whose chunks do not nest, and an
    // indefinite container is only too deep once an item follows, not its break
    const vectors = [
      '00',
      '8100',
      '818100',
      'c600',
      'c6c600',
      '5f4100ff',
      '5fff',
      '7f6161ff',
      '7fff',
      '815f4100ff',
      '9f5f4100ffff',
      'bf5f4100ff7f6161ffff',
      '9fff',
      'bfff',
      '9f01ff',
      'bf0102ff',
      '819fff',
      '81bfff',
      'c69fff',
      '9f9fffff',
      '9f9f01ffff',
    ];
    for (const h of vectors) {
      for (const maxDepth of [0, 1, 2, 3]) {
        const expected = outcome(() => decode(hex(h), { maxDepth }));
        for (const size of [1, 64]) {
          const got = outcome(() => decodeStreamed(hex(h), { maxDepth }, size));
          expect(got, `${h} maxDepth ${maxDepth} chunk ${size}`).deep.eq(expected);
        }
      }
    }
    // shapes the framing pass used to reject
    expect(decodeStreamed(hex('5f4100ff'), { maxDepth: 0 })).deep.eq(Uint8Array.of(0));
    expect(decodeStreamed(hex('7f6161ff'), { maxDepth: 0 })).eq('a');
    expect(decodeStreamed(hex('815f4100ff'), { maxDepth: 1 })).deep.eq([Uint8Array.of(0)]);
    expect(decodeStreamed(hex('9fff'), { maxDepth: 0 })).instanceOf(IndefiniteArray);
    expect(decodeStreamed(hex('bfff'), { maxDepth: 0 })).instanceOf(IndefiniteMap);
    expect(decodeStreamed(hex('c69fff'), { maxDepth: 1 })).instanceOf(CborTag);
    // and those it still rejects
    expect(() => decodeStreamed(hex('9f01ff'), { maxDepth: 0 })).to.throw('Maximum depth');
    expect(() => decodeStreamed(hex('818100'), { maxDepth: 1 })).to.throw('Maximum depth');
  });

  it('Matches decode() on random and corrupted items', () => {
    const rand = prng(20260917);
    const optionSets: Array<DecoderOptions | undefined> = [
      undefined,
      { maxDepth: 0 },
      { maxDepth: 1 },
      { maxDepth: 2 },
      { maxStringLength: 1 },
      { maxDepth: 1, maxStringLength: 0 },
    ];
    const runs = 1500;
    let accepted = 0;
    for (let i = 0; i < runs; i += 1) {
      const item = randomItem(rand);
      const bytes = Uint8Array.from(rand() < 0.5 ? item : corrupt(item, rand));
      for (const options of optionSets) {
        const expected = outcome(() => decode(bytes, options));
        if ('value' in expected) accepted += 1;
        for (const size of [bytes.length, 1]) {
          const got = outcome(() => decodeStreamed(bytes, options, size));
          const where = `${toHex(bytes)} ${JSON.stringify(options)} chunk ${size}`;
          // a stream reports truncation and trailing bytes in its own words, so
          // errors are compared by whether they happen, values in full
          expect('value' in got, `${where}: ${got.error ?? expected.error}`).eq(
            'value' in expected
          );
          if ('value' in expected) expect(got.value, where).deep.eq(expected.value);
        }
      }
    }
    // both outcomes are well represented
    const checks = runs * optionSets.length;
    expect(accepted).within(checks * 0.25, checks * 0.75);
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

  it('Reads its options once, for both passes', () => {
    const options = { maxDepth: 1 };
    const decoder = new IncrementalDecoder(options);
    options.maxDepth = 0;
    // framing and parsing both still allow depth 1
    expect(decoder.push(hex('8100'))).to.have.length(1);
    expect(() => decoder.push(hex('818100'))).to.throw('Maximum depth exceeded');
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

  describe('after a malformed item', () => {
    const thrown = (fn: () => unknown): Error => {
      try {
        fn();
      } catch (err) {
        return err as Error;
      }
      throw new Error('expected a throw');
    };

    it('hands out the items before it, and throws from the next call on', () => {
      const decoder = new IncrementalDecoder();
      // [1] and 2 complete, then 1c: reserved additional info
      const got = decoder.push(hex('8101021c'));
      expect(got.map((item) => item.value)).deep.eq([[1], 2]);
      expect(got.map((item) => toHex(item.bytes))).deep.eq(['8101', '02']);

      const error = thrown(() => decoder.push(hex('03')));
      expect(error.message).eq('Invalid length encoding');
      // the same error, every time
      expect(thrown(() => decoder.push(hex('03')))).eq(error);
      expect(thrown(() => decoder.push(new Uint8Array(0)))).eq(error);
      expect(thrown(() => decoder.end())).eq(error);
      expect(thrown(() => decoder.end())).eq(error);
    });

    it('throws at once when no item completed before it', () => {
      const decoder = new IncrementalDecoder();
      expect(decoder.push(hex('8201'))).to.have.length(0);
      // a break marker inside a definite array
      const error = thrown(() => decoder.push(hex('ff02')));
      expect(error.message).eq('Invalid length');
      expect(thrown(() => decoder.push(hex('02')))).eq(error);
      expect(thrown(() => decoder.end())).eq(error);
    });

    it('fails the same way when only the parser can tell', () => {
      // f800 frames fine, but a two-byte simple value below 32 is ill-formed
      for (const decoder of [new IncrementalDecoder(), IncrementalDecoder.annotated()]) {
        expect(decoder.push(hex('0102f80003'))).to.have.length(2);
        const error = thrown(() => decoder.push(hex('04')));
        expect(error.message).contains('Invalid two-byte simple value');
        expect(thrown(() => decoder.end())).eq(error);
      }
    });

    it('reports it from end() when it came last', () => {
      const decoder = new IncrementalDecoder();
      // 61ff is not UTF-8
      expect(decoder.push(hex('0161ff'))).to.have.length(1);
      expect(() => decoder.end()).to.throw(TypeError);
    });
  });
});

describe('IncrementalDecoder.annotated', (): void => {
  it('Emits the tree decodeAnnotated builds, at any chunk size', () => {
    const items = corpus();
    const stream = Buffer.concat(items.map((i) => Buffer.from(i)));

    for (const size of [1, 2, 3, 7, 64, 1024, 65536]) {
      const decoder = IncrementalDecoder.annotated();
      const got: Array<{ value: CborNode; bytes: Uint8Array }> = [];
      for (let off = 0; off < stream.length; off += size) {
        got.push(...decoder.push(new Uint8Array(stream.subarray(off, off + size))));
      }
      decoder.end();

      expect(got.length, `chunk size ${size}`).eq(items.length);
      got.forEach((item, i) => {
        expect(item.value, `chunk ${size} item ${i}`).deep.eq(decodeAnnotated(items[i]));
        expect(toHex(item.value.bytes), `chunk ${size} item ${i}`).eq(toHex(items[i]));
      });
    }
  });

  it('Spans are offsets into the item, not into the stream', () => {
    const decoder = IncrementalDecoder.annotated();
    const [first, second] = decoder.push(hex('43010203' + '820102'));

    expect(first.value.span).deep.eq([0, 4]);
    expect(second.value.span).deep.eq([0, 3]);
    expect(second.value.items!.map((i) => i.span)).deep.eq([
      [1, 2],
      [2, 3],
    ]);
  });

  it('Anchors node.bytes to the item, so a later push cannot move them', () => {
    const decoder = IncrementalDecoder.annotated();
    const [{ value }] = decoder.push(hex('82430102034401020304'));
    const item = value.items![1];
    expect(toHex(item.bytes)).eq('4401020304');

    decoder.push(hex('4405060708'));
    expect(toHex(item.bytes)).eq('4401020304');
  });

  it('Applies decoder options', () => {
    const nested = (depth: number) =>
      Buffer.concat([Buffer.alloc(depth, 0x81), Buffer.from([0x00])]);
    expect(() => IncrementalDecoder.annotated({ maxDepth: 3 }).push(nested(5))).to.throw(
      'Maximum depth exceeded'
    );
    expect(IncrementalDecoder.annotated({ maxDepth: 3 }).push(nested(3))).to.have.length(1);
  });

  it('Applies the full grammar to framed items', () => {
    for (const h of ['5f6161ff', '5f5f4101ffff', 'f800', '7f61c361bcff']) {
      expect(() => IncrementalDecoder.annotated().push(hex(h)), h).to.throw();
    }
    // the tree keeps tag 2/3 uncollapsed, so a malformed bignum only fails on toJS()
    const [{ value }] = IncrementalDecoder.annotated().push(hex('c200'));
    expect(value.kind).eq('tag');
    expect(() => value.toJS()).to.throw('Invalid bignum encoding');
  });
});
