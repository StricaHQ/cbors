import Reader, { DecoderOptions } from './read';
import Scanner, { NEED_MORE } from './scan';
import plainBuilder from './decodePlain';

const INITIAL_CAPACITY = 1024;

// dependency-free replacement for the v1 stream.Transform decoder. Push buffer
// chunks as they arrive; each push returns the top-level items completed so far.
//
// Chunks are accumulated into one contiguous buffer. A resumable Scanner frames
// each top-level item, then Reader parses the framed slice — so the stream is
// walked once
export default class IncrementalDecoder {
  #options: DecoderOptions;

  #buf: Uint8Array = new Uint8Array(INITIAL_CAPACITY);

  #start: number = 0; // first byte of the item being scanned

  #end: number = 0; // one past the last buffered byte

  #scanner: Scanner;

  constructor(options: DecoderOptions = {}) {
    this.#options = options;
    this.#scanner = new Scanner(0, options);
  }

  push(chunk: Uint8Array): Array<{ value: any; bytes: Uint8Array }> {
    this.append(chunk);
    const completed: Array<{ value: any; bytes: Uint8Array }> = [];

    for (;;) {
      const itemEnd = this.#scanner.scan(this.#buf, this.#end);
      if (itemEnd === NEED_MORE) break;

      const bytes = this.#buf.slice(this.#start, itemEnd);
      const reader = new Reader(bytes, plainBuilder, this.#options);
      const value = reader.read();
      if (reader.pos !== bytes.length) {
        throw new Error('Invalid CBOR encoding');
      }

      completed.push({ value, bytes });
      this.#start = itemEnd;
      this.#scanner.restart(itemEnd);
    }

    this.compact();
    return completed;
  }

  end(): void {
    if (this.#end > this.#start) {
      throw new Error('unexpected end of input');
    }
  }

  private append(chunk: Uint8Array): void {
    const needed = this.#end + chunk.length;
    if (needed > this.#buf.length) {
      let capacity = this.#buf.length * 2;
      while (capacity < needed) capacity *= 2;
      const grown = new Uint8Array(capacity);
      grown.set(this.#buf.subarray(0, this.#end));
      this.#buf = grown;
    }
    this.#buf.set(chunk, this.#end);
    this.#end = needed;
  }

  // drop the bytes of already-emitted items.
  private compact(): void {
    if (this.#start === 0) return;
    this.#buf.copyWithin(0, this.#start, this.#end);
    this.#end -= this.#start;
    this.#scanner.shift(this.#start);
    this.#start = 0;
  }
}
