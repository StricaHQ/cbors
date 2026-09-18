import { getBigNum } from '../internal/numbers';
import { ResolvedOptions } from './read';

// stack entries for indefinite-length items (any negative count): they end at a
// break marker rather than after a known number of items. A map tracks whether
// a key or a value comes next, since a break in place of a value is malformed.
// Indefinite strings get their own markers, because their chunks are not nested
// items: they do not count towards depth, and each must be a definite string of
// the same major type.
const INDEFINITE_ARRAY = -1;
const INDEFINITE_MAP_KEY = -2;
const INDEFINITE_MAP_VALUE = -3;
const INDEFINITE_BYTES = -4;
const INDEFINITE_TEXT = -5;

export const NEED_MORE = -1;

const readUInt32 = (buf: Uint8Array, at: number): number =>
  ((buf[at] << 24) | (buf[at + 1] << 16) | (buf[at + 2] << 8) | buf[at + 3]) >>> 0;

// resumable framing pass: walks CBOR structure without building any values, to
// find where the next top-level item ends. It suspends at any byte boundary and
// resumes with no rework, so a stream costs one scan end to end however it is
// chunked. Only errors visible from the head bytes are raised here; Reader
// re-checks the full grammar when it parses the framed slice.
export default class Scanner {
  // absolute offset of the next byte to look at
  pos: number;

  // remaining item counts for open containers, innermost last. The bottom entry
  // stands for the top level, so the stack is never empty and the current depth
  // is its length minus one.
  #stack: number[] = [0];

  #maxStringLength: number;

  #maxDepth: number;

  constructor(start: number, options: ResolvedOptions) {
    this.pos = start;
    this.#maxStringLength = options.maxStringLength;
    this.#maxDepth = options.maxDepth;
  }

  restart(at: number): void {
    this.pos = at;
    this.#stack.length = 1;
  }

  shift(by: number): void {
    this.pos -= by;
  }

  private checkStringLength(length: number | bigint): number {
    if (typeof length === 'bigint' || length > this.#maxStringLength) {
      throw new Error(`String length ${length.toString()} exceeds maximum allowed`);
    }
    return length;
  }

  // one item has just been consumed: charge it to the enclosing container and
  // close out any containers it completed. True once the top-level item is done.
  private settle(): boolean {
    const stack = this.#stack;
    for (;;) {
      const depth = stack.length - 1;
      if (depth === 0) return true;
      const remaining = stack[depth];
      if (remaining < 0) {
        // indefinite: waits for its break marker
        if (remaining === INDEFINITE_MAP_KEY) stack[depth] = INDEFINITE_MAP_VALUE;
        else if (remaining === INDEFINITE_MAP_VALUE) stack[depth] = INDEFINITE_MAP_KEY;
        return false;
      }
      if (remaining > 1) {
        stack[depth] = remaining - 1;
        return false;
      }
      stack.pop(); // that was the container's last item; it completes too
    }
  }

  // end offset of the completed top-level item, or NEED_MORE. pos only advances
  // over bytes that are fully buffered, so a suspended scan resumes in place.
  scan(buf: Uint8Array, end: number): number {
    const stack = this.#stack;
    for (;;) {
      const depth = stack.length - 1;
      // remaining count of the innermost open item, 0 at the top level
      const top = stack[depth];
      // mirrors Reader, which checks an item's depth (= open container count)
      // before reading its head
      const tooDeep = depth > this.#maxDepth;

      // the next byte of a definite container can only be an item, so the depth
      // check does not wait for it
      if (tooDeep && top >= 0) {
        throw new Error('Maximum depth exceeded');
      }
      if (this.pos >= end) return NEED_MORE;

      const head = buf[this.pos];
      const majorType = head >> 5;
      const ai = head & 0x1f;
      const indefinite = ai === 31;

      if (top < 0) {
        if (head === 0xff) {
          // closes the indefinite item, unless that is a map still owed a value
          if (top === INDEFINITE_MAP_VALUE) {
            throw new Error('Invalid length');
          }
          stack.pop();
          this.pos += 1;
          if (this.settle()) return this.pos;
          continue;
        }
        if (top === INDEFINITE_BYTES || top === INDEFINITE_TEXT) {
          // RFC 8949 3.2.3: a chunk is a definite string of the enclosing major
          // type. Reserved ai 28-30 is left to the length check below, which
          // Reader applies first too. A chunk is not a nested item, so it gets
          // no depth check of its own.
          const expected = top === INDEFINITE_BYTES ? 2 : 3;
          if (indefinite || (ai < 28 && majorType !== expected)) {
            throw new Error('Invalid indefinite length encoding');
          }
        } else if (tooDeep) {
          // an item rather than the break marker, so the depth check applies
          throw new Error('Maximum depth exceeded');
        }
      } else if (head === 0xff) {
        throw new Error('Invalid length');
      }

      let headLen = 1;
      if (ai >= 24) {
        if (ai === 24) headLen = 2;
        else if (ai === 25) headLen = 3;
        else if (ai === 26) headLen = 5;
        else if (ai === 27) headLen = 9;
        else if (!indefinite) throw new Error('Invalid length encoding');
      }
      if (this.pos + headLen > end) return NEED_MORE;

      if (indefinite && (majorType < 2 || majorType > 5)) {
        throw new Error('Invalid length');
      }

      let length: number | bigint = ai;
      if (ai === 24) length = buf[this.pos + 1];
      else if (ai === 25) length = (buf[this.pos + 1] << 8) | buf[this.pos + 2];
      else if (ai === 26) length = readUInt32(buf, this.pos + 1);
      else if (ai === 27) {
        length = getBigNum(readUInt32(buf, this.pos + 1), readUInt32(buf, this.pos + 5));
      }

      // a definite string is stepped over whole, so its payload must be buffered
      let itemLen = headLen;
      if (!indefinite && (majorType === 2 || majorType === 3)) {
        itemLen += this.checkStringLength(length);
        if (this.pos + itemLen > end) return NEED_MORE;
      }
      this.pos += itemLen;

      switch (majorType) {
        case 4:
        case 5: {
          if (indefinite) {
            this.push(majorType === 4 ? INDEFINITE_ARRAY : INDEFINITE_MAP_KEY);
            break;
          }
          if (typeof length === 'bigint') {
            throw new Error(majorType === 4 ? 'Invalid array length' : 'Invalid map length');
          }
          const count = majorType === 4 ? length : length * 2;
          if (count === 0) {
            if (this.settle()) return this.pos;
            break;
          }
          this.push(count);
          break;
        }
        case 6:
          this.push(1); // a tag encloses exactly one item
          break;
        case 2:
        case 3:
          if (indefinite) {
            this.push(majorType === 2 ? INDEFINITE_BYTES : INDEFINITE_TEXT);
            break;
          }
          if (this.settle()) return this.pos;
          break;
        default:
          if (this.settle()) return this.pos;
          break;
      }
    }
  }

  private push(count: number): void {
    this.#stack.push(count);
  }
}
