import { getBigNum } from '../internal/numbers';
import { DecoderOptions, DEFAULT_MAX_DEPTH, MAX_POSSIBLE_STRING_LENGTH } from './read';

// stack entry for an indefinite-length container: it ends at a break marker
// rather than after a known number of items
const INDEFINITE = -1;

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

  // remaining item counts for open containers, innermost last
  #stack: number[] = [];

  #maxStringLength: number;

  #maxDepth: number;

  constructor(start: number, options: DecoderOptions = {}) {
    this.pos = start;
    this.#maxStringLength = Math.min(
      options.maxStringLength ?? MAX_POSSIBLE_STRING_LENGTH,
      MAX_POSSIBLE_STRING_LENGTH
    );
    this.#maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
  }

  restart(at: number): void {
    this.pos = at;
    this.#stack.length = 0;
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
      const depth = stack.length;
      if (depth === 0) return true;
      const remaining = stack[depth - 1];
      if (remaining === INDEFINITE) return false; // waits for its break marker
      if (remaining > 1) {
        stack[depth - 1] = remaining - 1;
        return false;
      }
      stack.pop(); // that was the container's last item; it completes too
    }
  }

  // end offset of the completed top-level item, or NEED_MORE. pos only advances
  // over bytes that are fully buffered, so a suspended scan resumes in place.
  scan(buf: Uint8Array, end: number): number {
    for (;;) {
      // mirrors Reader's depth check: an item sits at depth = open container count
      if (this.#stack.length > this.#maxDepth) {
        throw new Error('Maximum depth exceeded');
      }
      if (this.pos >= end) return NEED_MORE;

      const head = buf[this.pos];

      if (head === 0xff) {
        const depth = this.#stack.length;
        if (depth === 0 || this.#stack[depth - 1] !== INDEFINITE) {
          throw new Error('Invalid length');
        }
        this.#stack.pop();
        this.pos += 1;
        if (this.settle()) return this.pos;
        continue;
      }

      const majorType = head >> 5;
      const ai = head & 0x1f;
      const indefinite = ai === 31;

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
            this.push(INDEFINITE);
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
            this.push(INDEFINITE);
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
