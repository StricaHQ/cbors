import { Buffer } from 'buffer';

export default class BufferList {
  private chunks: Array<Buffer> = [];

  // consumed bytes within chunks[0]
  private offset: number = 0;

  private totalLength: number = 0;

  get length(): number {
    return this.totalLength;
  }

  read(n: number): Buffer {
    if (n === 0) {
      return Buffer.alloc(0);
    }
    if (n < 0) {
      throw new Error('invalid length');
    }
    if (n > this.totalLength) {
      throw new Error('Insufficient data');
    }

    const first = this.chunks[0];
    let out: Buffer;
    if (first.length - this.offset >= n) {
      out = first.subarray(this.offset, this.offset + n);
      this.offset += n;
      if (this.offset === first.length) {
        this.chunks.shift();
        this.offset = 0;
      }
    } else {
      out = Buffer.allocUnsafe(n);
      let copied = 0;
      while (copied < n) {
        const chunk = this.chunks[0];
        const take = Math.min(chunk.length - this.offset, n - copied);
        chunk.copy(out, copied, this.offset, this.offset + take);
        copied += take;
        this.offset += take;
        if (this.offset === chunk.length) {
          this.chunks.shift();
          this.offset = 0;
        }
      }
    }
    this.totalLength -= n;
    return out;
  }

  push(chunk: Buffer): void {
    if (!chunk.length) return;
    this.chunks.push(chunk);
    this.totalLength += chunk.length;
  }
}
