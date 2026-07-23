export default class BufferList {
  private chunks: Array<Uint8Array> = [];

  // consumed bytes within chunks[0]
  private offset: number = 0;

  private totalLength: number = 0;

  get length(): number {
    return this.totalLength;
  }

  read(n: number): Uint8Array {
    if (n === 0) {
      return new Uint8Array(0);
    }
    if (n < 0) {
      throw new Error('invalid length');
    }
    if (n > this.totalLength) {
      throw new Error('Insufficient data');
    }

    const first = this.chunks[0];
    let out: Uint8Array;
    if (first.length - this.offset >= n) {
      out = first.subarray(this.offset, this.offset + n);
      this.offset += n;
      if (this.offset === first.length) {
        this.chunks.shift();
        this.offset = 0;
      }
    } else {
      out = new Uint8Array(n);
      let copied = 0;
      while (copied < n) {
        const chunk = this.chunks[0];
        const take = Math.min(chunk.length - this.offset, n - copied);
        out.set(chunk.subarray(this.offset, this.offset + take), copied);
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

  push(chunk: Uint8Array): void {
    if (!chunk.length) return;
    this.chunks.push(chunk);
    this.totalLength += chunk.length;
  }
}
