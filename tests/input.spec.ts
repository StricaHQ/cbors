import { describe, it, expect } from 'vitest';
import { runInNewContext } from 'node:vm';
import { decode, decodeAnnotated, IncrementalDecoder } from '../src/index';

// the given CBOR in every form an entry point should take
class Bytes extends Uint8Array {}
const validInputs = (hex: string): Array<[string, Uint8Array]> => {
  const bytes = Uint8Array.from(Buffer.from(hex, 'hex'));
  const padded = new Uint8Array(bytes.length + 2);
  padded.set(bytes, 1);
  return [
    ['Uint8Array', bytes],
    ['Buffer', Buffer.from(bytes)],
    ['subclass', Bytes.from(bytes)],
    ['Uint8Array from another realm', runInNewContext('Uint8Array.from(b)', { b: [...bytes] })],
    ['subarray', padded.subarray(1, 1 + bytes.length)],
  ];
};

// what an entry point should refuse, with the type name its error reports
const invalidInputs = (): Array<[string, unknown]> => {
  const bytes = Uint8Array.of(0x82, 0x01, 0x02);
  return [
    ['ArrayBuffer', bytes.buffer],
    ['Array', [0x82, 0x01, 0x02]],
    ['string', '820102'],
    ['DataView', new DataView(bytes.buffer)],
    ['Uint16Array', new Uint16Array([0x0182])],
    ['Uint8ClampedArray', new Uint8ClampedArray(bytes)],
    ['Object', { 0: 0x82, 1: 0x01, 2: 0x02, length: 3 }],
    ['number', 820102],
    ['undefined', undefined],
    ['null', null],
  ];
};

const streamed = (input: Uint8Array) => {
  const [item, ...rest] = new IncrementalDecoder().push(input);
  if (rest.length) throw new Error('expected one item');
  return item;
};

const entryPoints: Array<[string, (input: any) => any]> = [
  ['decode()', (input) => decode(input)],
  ['decodeAnnotated()', (input) => decodeAnnotated(input).toJS()],
  ['IncrementalDecoder.push()', (input) => streamed(input).value],
];

describe('decoder input', (): void => {
  for (const [name, run] of entryPoints) {
    describe(name, () => {
      it('takes any Uint8Array', () => {
        for (const [type, input] of validInputs('820102')) {
          expect(run(input), type).deep.eq([1, 2]);
        }
      });

      it('throws a TypeError for anything else', () => {
        for (const [type, input] of invalidInputs()) {
          expect(() => run(input), type).to.throw(
            TypeError,
            `${name} expects a Uint8Array, got ${type}`
          );
        }
      });

      it('hands out plain Uint8Arrays, whatever the input was', () => {
        // [h'0102', h'03' in indefinite form, {h'04': 5}, bignum 2(h'01')]
        for (const [type, input] of validInputs('84420102' + '5f4103ff' + 'a1410405' + 'c24101')) {
          const [definite, indefinite, map, bignum] = run(input);
          for (const bytes of [definite, indefinite, [...map.keys()][0]]) {
            expect(bytes.constructor, type).eq(Uint8Array);
          }
          expect([...definite, ...indefinite], type).deep.eq([1, 2, 3]);
          // the bignum check is an instanceof, which a foreign realm used to fail
          expect(bignum, type).eq(1n);
        }
      });
    });
  }

  it('says how to get bytes from an ArrayBuffer or a string', () => {
    expect(() => decode(new ArrayBuffer(1) as any)).to.throw('new Uint8Array(buffer)');
    expect(() => decode('00' as any)).to.throw('convert hex or base64 to bytes first');
  });

  it('a refused chunk leaves the stream as it was', () => {
    const decoder = new IncrementalDecoder();
    expect(decoder.push(Uint8Array.of(0x82, 0x01))).to.have.length(0);
    expect(() => decoder.push('02' as any)).to.throw(TypeError);
    expect(() => decoder.push([0x02] as any)).to.throw(TypeError);
    const [{ value }] = decoder.push(Uint8Array.of(0x02));
    expect(value).deep.eq([1, 2]);
    decoder.end();
  });

  it('node.bytes and item bytes are plain Uint8Arrays too', () => {
    for (const [type, input] of validInputs('82420102' + '5f4103ff')) {
      const node = decodeAnnotated(input);
      const [definite, indefinite] = node.items!;
      for (const n of [node, definite, indefinite, indefinite.chunks![0]]) {
        expect(n.bytes.constructor, type).eq(Uint8Array);
      }
      expect(definite.value!.constructor, type).eq(Uint8Array);
      expect(indefinite.chunks![0].value!.constructor, type).eq(Uint8Array);

      const item = streamed(input);
      expect(item.bytes.constructor, type).eq(Uint8Array);
      expect(item.value[0].constructor, type).eq(Uint8Array);
    }
  });

  it('decoded bytes still share memory with the input', () => {
    // a Buffer view that does not start at the beginning of its memory
    const whole = Buffer.from('ff' + '43010203' + 'ff', 'hex');
    const input = whole.subarray(1, 5);

    const value = decode(input);
    expect(value.buffer).eq(whole.buffer);
    expect(value.byteOffset).eq(whole.byteOffset + 2);

    const node = decodeAnnotated(input);
    expect(node.span).deep.eq([0, 4]);
    expect(node.bytes.buffer).eq(whole.buffer);
    expect(node.bytes.byteOffset).eq(whole.byteOffset + 1);
    expect(node.value).deep.eq(value);

    // a change to the input shows through
    whole[2] = 0x09;
    expect([...value]).deep.eq([9, 2, 3]);
  });
});
