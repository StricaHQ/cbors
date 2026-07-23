import {
  getBigNum,
  POW_2_24,
  readUInt8,
  readUInt16BE,
  readUInt32BE,
  readFloat32BE,
  readFloat64BE,
} from '../internal/numbers';
import { ByteSpan } from '../span';

const td = new TextDecoder('utf8', { fatal: true, ignoreBOM: true });
const utf8Decoder = (buf: Uint8Array): string => td.decode(buf);

const f16Scratch = new DataView(new ArrayBuffer(4));
const readFloat16 = (value: number): number => {
  const sign = value & 0x8000;
  let exponent = value & 0x7c00;
  const fraction = value & 0x03ff;

  if (exponent === 0x7c00) exponent = 0xff << 10;
  else if (exponent !== 0) exponent += (127 - 15) << 10;
  else if (fraction !== 0) return (sign ? -1 : 1) * fraction * POW_2_24;

  f16Scratch.setUint32(0, ((sign << 16) | (exponent << 13) | (fraction << 13)) >>> 0);
  return f16Scratch.getFloat32(0);
};

// a single byte string can never exceed 2^32 - 1 bytes, so any string/bytes item
// declaring a larger length can never be decoded
const MAX_POSSIBLE_STRING_LENGTH = 4294967295;
const DEFAULT_MAX_DEPTH = 1024;

export type DecoderOptions = {
  // reject byte/text strings (or indefinite chunks) declaring a length above this
  maxStringLength?: number;
  // reject items nested deeper than this
  maxDepth?: number;
};

// fidelity information handed to every builder call. span is [start, end) byte
// offsets of the whole item (head byte included); ai is the head byte's
// additional information; indefinite marks the *-length forms.
export type Meta = { span: ByteSpan; ai: number; indefinite: boolean };

// the parse core constructs values only through a Builder: one recursive-descent
// pass drives both plain decode() and the annotation tree. Builders never re-read
// bytes — everything they need is in the value/Meta they receive.
export interface Builder<V> {
  int(value: number | bigint, meta: Meta): V;
  bytes(payload: Uint8Array | V[], meta: Meta): V; // V[] = chunk nodes when indefinite
  text(payload: string | V[], meta: Meta): V; // V[] = chunk nodes when indefinite
  array(items: V[], meta: Meta): V;
  map(entries: Array<[V, V]>, meta: Meta): V; // duplicate keys reach the builder
  tag(tag: number | bigint, child: V, meta: Meta): V;
  float(value: number, meta: Meta): V;
  simple(value: number, meta: Meta): V;
}

// low-level recursive-descent reader shared by decode(), IncrementalDecoder and
// decodeAnnotated(). parse() is a generator: it yields the byte count it needs
// and is resumed with that many bytes.
export default class Parser<V> {
  // every consumed chunk, in order — IncrementalDecoder concatenates these for
  // the raw bytes of each completed top-level item
  usedBytes: Array<Uint8Array> = [];

  // running byte offset; for a one-shot contiguous buffer this equals the
  // absolute offset into the source, which is what the tree spans record
  pos: number = 0;

  private builder: Builder<V>;

  private maxStringLength: number;

  private maxDepth: number;

  constructor(builder: Builder<V>, options: DecoderOptions = {}) {
    this.builder = builder;
    this.maxStringLength = Math.min(
      options.maxStringLength ?? MAX_POSSIBLE_STRING_LENGTH,
      MAX_POSSIBLE_STRING_LENGTH
    );
    this.maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
  }

  private consume(bytes: Uint8Array): Uint8Array {
    this.usedBytes.push(bytes);
    this.pos += bytes.length;
    return bytes;
  }

  private checkStringLength(length: number | bigint): number {
    if (typeof length === 'bigint' || length > this.maxStringLength) {
      throw new Error(`String length ${length.toString()} exceeds maximum allowed`);
    }
    return length;
  }

  private *readLength(ai: number): Generator<number, number | bigint, Uint8Array> {
    if (ai < 24) {
      return ai;
    }
    if (ai === 24) {
      return readUInt8(this.consume(yield 1));
    }
    if (ai === 25) {
      return readUInt16BE(this.consume(yield 2));
    }
    if (ai === 26) {
      return readUInt32BE(this.consume(yield 4));
    }
    if (ai === 27) {
      const f = readUInt32BE(this.consume(yield 4));
      const g = readUInt32BE(this.consume(yield 4));
      return getBigNum(f, g);
    }
    if (ai === 31) {
      return -1;
    }
    throw new Error('Invalid length encoding');
  }

  // read one chunk header of an indefinite byte/text string. Returns null on the
  // break marker, otherwise the (definite) chunk length and its head-byte ai.
  private *readChunkHead(
    majorType: number
  ): Generator<number, { length: number; ai: number } | null, Uint8Array> {
    const head = this.consume(yield 1);
    const n = readUInt8(head);
    if (n === 0xff) {
      return null;
    }
    const ai = n & 0x1f;
    const length = yield* this.readLength(ai);
    if (length < 0 || n >> 5 !== majorType) {
      throw new Error('Invalid indefinite length encoding');
    }
    return { length: this.checkStringLength(length), ai };
  }

  // build the Meta for an item spanning [start, this.pos); called after the item
  // is fully consumed so this.pos is its end offset
  private meta(start: number, ai: number, indefinite: boolean): Meta {
    return { span: [start, this.pos], ai, indefinite };
  }

  *parse(suppliedBytes?: Uint8Array, depth: number = 0): Generator<number, V, Uint8Array> {
    if (depth > this.maxDepth) {
      throw new Error('Maximum depth exceeded');
    }

    let start: number;
    let head: Uint8Array;
    if (suppliedBytes) {
      // the caller already read (and tracked) this head byte while looking for a
      // break marker, so pos is already past it
      head = suppliedBytes;
      start = this.pos - suppliedBytes.length;
    } else {
      start = this.pos;
      head = this.consume(yield 1);
    }

    const value = readUInt8(head);
    const majorType = value >> 5;
    const ai = value & 0x1f;

    if (majorType === 7) {
      if (ai === 25) {
        const n = readUInt16BE(this.consume(yield 2));
        return this.builder.float(readFloat16(n), this.meta(start, ai, false));
      }
      if (ai === 26) {
        const n = readFloat32BE(this.consume(yield 4));
        return this.builder.float(n, this.meta(start, ai, false));
      }
      if (ai === 27) {
        const n = readFloat64BE(this.consume(yield 8));
        return this.builder.float(n, this.meta(start, ai, false));
      }
    }

    const length = yield* this.readLength(ai);
    const indefinite = length < 0;

    if (indefinite && (majorType < 2 || majorType > 5)) {
      throw new Error('Invalid length');
    }

    switch (majorType) {
      case 0:
        return this.builder.int(length, this.meta(start, ai, false));
      case 1: {
        let v: number | bigint;
        if (typeof length === 'bigint') {
          v = -1n - length;
        } else if (length === Number.MAX_SAFE_INTEGER) {
          // -1 - (2^53 - 1) = -2^53, kept as bigint for symmetry with +2^53
          v = -1n - BigInt(Number.MAX_SAFE_INTEGER);
        } else {
          v = -1 - length;
        }
        return this.builder.int(v, this.meta(start, ai, false));
      }
      case 2: {
        if (indefinite) {
          const chunks: V[] = [];
          for (;;) {
            const chunkStart = this.pos;
            const chunkHead = yield* this.readChunkHead(majorType);
            if (!chunkHead) break;
            const payload = this.consume(yield chunkHead.length);
            chunks.push(this.builder.bytes(payload, this.meta(chunkStart, chunkHead.ai, false)));
          }
          return this.builder.bytes(chunks, this.meta(start, ai, true));
        }
        const payload = this.consume(yield this.checkStringLength(length));
        return this.builder.bytes(payload, this.meta(start, ai, false));
      }
      case 3: {
        if (indefinite) {
          const chunks: V[] = [];
          for (;;) {
            const chunkStart = this.pos;
            const chunkHead = yield* this.readChunkHead(majorType);
            if (!chunkHead) break;
            const payload = this.consume(yield chunkHead.length);
            // RFC 8949: each indefinite text chunk must be valid UTF-8 on its own
            chunks.push(
              this.builder.text(utf8Decoder(payload), this.meta(chunkStart, chunkHead.ai, false))
            );
          }
          return this.builder.text(chunks, this.meta(start, ai, true));
        }
        const payload = this.consume(yield this.checkStringLength(length));
        return this.builder.text(utf8Decoder(payload), this.meta(start, ai, false));
      }
      case 4: {
        // a definite element count beyond 2^53 can never be satisfied
        if (typeof length === 'bigint') throw new Error('Invalid array length');
        const items: V[] = [];
        if (indefinite) {
          for (;;) {
            const b = this.consume(yield 1);
            if (readUInt8(b) === 0xff) break;
            items.push(yield* this.parse(b, depth + 1));
          }
        } else {
          for (let i = 0; i < length; i += 1) {
            items.push(yield* this.parse(undefined, depth + 1));
          }
        }
        return this.builder.array(items, this.meta(start, ai, indefinite));
      }
      case 5: {
        // a definite entry count beyond 2^53 can never be satisfied
        if (typeof length === 'bigint') throw new Error('Invalid map length');
        const entries: Array<[V, V]> = [];
        if (indefinite) {
          for (;;) {
            const b = this.consume(yield 1);
            if (readUInt8(b) === 0xff) break;
            const key = yield* this.parse(b, depth + 1);
            const val = yield* this.parse(undefined, depth + 1);
            entries.push([key, val]);
          }
        } else {
          for (let i = 0; i < length; i += 1) {
            const key = yield* this.parse(undefined, depth + 1);
            const val = yield* this.parse(undefined, depth + 1);
            entries.push([key, val]);
          }
        }
        return this.builder.map(entries, this.meta(start, ai, indefinite));
      }
      case 6: {
        const child = yield* this.parse(undefined, depth + 1);
        return this.builder.tag(length, child, this.meta(start, ai, false));
      }
      case 7: {
        // RFC 8949 §3.3: two-byte simple values below 32 are ill-formed
        if (ai === 24 && (length as number) < 32) {
          throw new Error(`Invalid two-byte simple value encoding: ${length}`);
        }
        return this.builder.simple(length as number, this.meta(start, ai, false));
      }
      default:
        throw new Error('Invalid CBOR encoding');
    }
  }
}
