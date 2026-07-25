import { getBigNum, readFloat16 } from '../internal/numbers';
import { utf8Decode } from '../internal/bytes';

// a single byte string can never exceed 2^32 - 1 bytes, so any string/bytes item
// declaring a larger length can never be decoded
export const MAX_POSSIBLE_STRING_LENGTH = 4294967295;
export const DEFAULT_MAX_DEPTH = 1024;

export type DecoderOptions = {
  // reject byte/text strings (or indefinite chunks) declaring a length above this
  maxStringLength?: number;
  // reject items nested deeper than this
  maxDepth?: number;
};

// the parse core constructs values only through a Builder: one recursive-descent
// pass drives both plain decode() and the annotation tree. Every call carries the
// item's byte span [start, end) (head byte included) and the head-byte ai, so
// builders never re-read bytes; indefinite marks the *-length forms. These arrive
// as primitives, not a Meta object, so the plain path allocates nothing per item.
export interface Builder<V> {
  int(value: number | bigint, ai: number, start: number, end: number): V;
  bytes(payload: Uint8Array | V[], indefinite: boolean, ai: number, start: number, end: number): V; // V[] = chunk nodes when indefinite
  text(payload: string | V[], indefinite: boolean, ai: number, start: number, end: number): V; // V[] = chunk nodes when indefinite
  array(items: V[], indefinite: boolean, ai: number, start: number, end: number): V;
  map(keys: V[], values: V[], indefinite: boolean, ai: number, start: number, end: number): V; // parallel arrays; duplicate keys reach the builder
  tag(tag: number | bigint, child: V, ai: number, start: number, end: number): V;
  float(value: number, ai: number, start: number, end: number): V;
  simple(value: number, ai: number, start: number, end: number): V;
}

// recursive-descent reader over one contiguous buffer, driving every decode
// entry point through the Builder protocol. The whole input is in hand, so it
// reads fields straight out of the buffer.
export default class Reader<V> {
  // offset of the next unread byte; also the end offset of the item just read
  pos: number = 0;

  private buf: Uint8Array;

  private view: DataView;

  private builder: Builder<V>;

  private maxStringLength: number;

  private maxDepth: number;

  constructor(buf: Uint8Array, builder: Builder<V>, options: DecoderOptions = {}) {
    this.buf = buf;
    this.view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    this.builder = builder;
    this.maxStringLength = Math.min(
      options.maxStringLength ?? MAX_POSSIBLE_STRING_LENGTH,
      MAX_POSSIBLE_STRING_LENGTH
    );
    this.maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
  }

  // claim n bytes and return the offset they start at
  private take(n: number): number {
    const at = this.pos;
    if (at + n > this.buf.length) {
      throw new Error('Insufficient data');
    }
    this.pos = at + n;
    return at;
  }

  private checkStringLength(length: number | bigint): number {
    if (typeof length === 'bigint' || length > this.maxStringLength) {
      throw new Error(`String length ${length.toString()} exceeds maximum allowed`);
    }
    return length;
  }

  private readLength(ai: number): number | bigint {
    if (ai < 24) {
      return ai;
    }
    if (ai === 24) {
      return this.buf[this.take(1)];
    }
    if (ai === 25) {
      return this.view.getUint16(this.take(2));
    }
    if (ai === 26) {
      return this.view.getUint32(this.take(4));
    }
    if (ai === 27) {
      const at = this.take(8);
      return getBigNum(this.view.getUint32(at), this.view.getUint32(at + 4));
    }
    if (ai === 31) {
      return -1;
    }
    throw new Error('Invalid length encoding');
  }

  // read one chunk header of an indefinite byte/text string. Returns null on the
  // break marker, otherwise the (definite) chunk length and its head-byte ai.
  private readChunkHead(majorType: number): { length: number; ai: number } | null {
    const n = this.buf[this.take(1)];
    if (n === 0xff) {
      return null;
    }
    const ai = n & 0x1f;
    const length = this.readLength(ai);
    if (length < 0 || n >> 5 !== majorType) {
      throw new Error('Invalid indefinite length encoding');
    }
    return { length: this.checkStringLength(length), ai };
  }

  // true when the next byte is the break marker, consuming it if so
  private atBreak(): boolean {
    if (this.pos >= this.buf.length) {
      throw new Error('Insufficient data');
    }
    if (this.buf[this.pos] !== 0xff) {
      return false;
    }
    this.pos += 1;
    return true;
  }

  read(depth: number = 0): V {
    if (depth > this.maxDepth) {
      throw new Error('Maximum depth exceeded');
    }

    const start = this.pos;
    const head = this.buf[this.take(1)];
    const majorType = head >> 5;
    const ai = head & 0x1f;

    if (majorType === 7) {
      if (ai === 25) {
        const n = readFloat16(this.view.getUint16(this.take(2)));
        return this.builder.float(n, ai, start, this.pos);
      }
      if (ai === 26) {
        const n = this.view.getFloat32(this.take(4));
        return this.builder.float(n, ai, start, this.pos);
      }
      if (ai === 27) {
        const n = this.view.getFloat64(this.take(8));
        return this.builder.float(n, ai, start, this.pos);
      }
    }

    const length = this.readLength(ai);
    const indefinite = length < 0;

    if (indefinite && (majorType < 2 || majorType > 5)) {
      throw new Error('Invalid length');
    }

    switch (majorType) {
      case 0:
        return this.builder.int(length, ai, start, this.pos);
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
        return this.builder.int(v, ai, start, this.pos);
      }
      case 2: {
        if (indefinite) {
          const chunks: V[] = [];
          for (;;) {
            const chunkStart = this.pos;
            const chunkHead = this.readChunkHead(majorType);
            if (!chunkHead) break;
            const at = this.take(chunkHead.length);
            chunks.push(
              this.builder.bytes(
                this.buf.subarray(at, at + chunkHead.length),
                false,
                chunkHead.ai,
                chunkStart,
                this.pos
              )
            );
          }
          return this.builder.bytes(chunks, true, ai, start, this.pos);
        }
        const len = this.checkStringLength(length);
        const at = this.take(len);
        return this.builder.bytes(this.buf.subarray(at, at + len), false, ai, start, this.pos);
      }
      case 3: {
        if (indefinite) {
          const chunks: V[] = [];
          for (;;) {
            const chunkStart = this.pos;
            const chunkHead = this.readChunkHead(majorType);
            if (!chunkHead) break;
            const at = this.take(chunkHead.length);
            // RFC 8949: each indefinite text chunk must be valid UTF-8 on its own
            chunks.push(
              this.builder.text(
                utf8Decode(this.buf.subarray(at, at + chunkHead.length)),
                false,
                chunkHead.ai,
                chunkStart,
                this.pos
              )
            );
          }
          return this.builder.text(chunks, true, ai, start, this.pos);
        }
        const len = this.checkStringLength(length);
        const at = this.take(len);
        return this.builder.text(
          utf8Decode(this.buf.subarray(at, at + len)),
          false,
          ai,
          start,
          this.pos
        );
      }
      case 4: {
        // a definite element count beyond 2^53 can never be satisfied
        if (typeof length === 'bigint') throw new Error('Invalid array length');
        const items: V[] = [];
        if (indefinite) {
          while (!this.atBreak()) {
            items.push(this.read(depth + 1));
          }
        } else {
          for (let i = 0; i < length; i += 1) {
            items.push(this.read(depth + 1));
          }
        }
        return this.builder.array(items, indefinite, ai, start, this.pos);
      }
      case 5: {
        // a definite entry count beyond 2^53 can never be satisfied
        if (typeof length === 'bigint') throw new Error('Invalid map length');
        const keys: V[] = [];
        const values: V[] = [];
        if (indefinite) {
          while (!this.atBreak()) {
            keys.push(this.read(depth + 1));
            values.push(this.read(depth + 1));
          }
        } else {
          for (let i = 0; i < length; i += 1) {
            keys.push(this.read(depth + 1));
            values.push(this.read(depth + 1));
          }
        }
        return this.builder.map(keys, values, indefinite, ai, start, this.pos);
      }
      case 6: {
        const child = this.read(depth + 1);
        return this.builder.tag(length, child, ai, start, this.pos);
      }
      case 7: {
        // RFC 8949 3.3: two-byte simple values below 32 are ill-formed
        if (ai === 24 && (length as number) < 32) {
          throw new Error(`Invalid two-byte simple value encoding: ${length}`);
        }
        return this.builder.simple(length as number, ai, start, this.pos);
      }
      default:
        throw new Error('Invalid CBOR encoding');
    }
  }
}
