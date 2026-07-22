import { Buffer } from 'buffer';
import BufferList from '../internal/BufferList';
import Parser, { DecoderOptions } from './parse';
import plainBuilder from './decodePlain';

// dependency-free replacement for the v1 stream.Transform decoder. Push buffer
// chunks as they arrive; each push returns the top-level items completed so far.
export default class IncrementalDecoder {
  private options: DecoderOptions;

  private bl: BufferList = new BufferList();

  private needed: number | null = null;

  private fresh: boolean = true;

  private parser: Parser<any>;

  private gen: Generator<number, any, Buffer>;

  constructor(options: DecoderOptions = {}) {
    this.options = options;
    this.parser = new Parser(plainBuilder, options);
    this.gen = this.parser.parse();
  }

  push(chunk: Buffer): Array<{ value: any; bytes: Buffer }> {
    this.bl.push(chunk);
    const completed: Array<{ value: any; bytes: Buffer }> = [];

    while (this.bl.length >= (this.needed ?? 0)) {
      let inBytes: Buffer | undefined;
      if (this.needed === null) {
        inBytes = undefined;
      } else {
        inBytes = this.bl.read(this.needed);
      }

      const ret = this.gen.next(inBytes as Buffer);

      if (this.needed) {
        this.fresh = false;
      }

      if (ret.done) {
        completed.push({
          value: ret.value,
          bytes: Buffer.concat(this.parser.usedBytes),
        });
        this.restart();
      } else {
        this.needed = ret.value ?? Infinity;
      }
    }

    return completed;
  }

  end(): void {
    if (!this.fresh) {
      throw new Error('unexpected end of input');
    }
  }

  private restart() {
    this.needed = null;
    this.parser = new Parser(plainBuilder, this.options);
    this.gen = this.parser.parse();
    this.fresh = true;
  }
}
