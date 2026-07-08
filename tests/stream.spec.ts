import { expect } from 'chai';
import { Decoder } from '../src/index';

describe('streaming decoder', (): void => {
  it('Stream errors instead of hanging on absurd declared string length', (done) => {
    const decoder = new Decoder();
    decoder.on('data', () => done(new Error('should not decode')));
    decoder.on('error', (e: Error) => {
      expect(e.message).to.contain('exceeds maximum');
      done();
    });
    decoder.write(Buffer.from('5bffffffffffffffff', 'hex'));
  });

  it('Stream decode of a large item split into small chunks', (done) => {
    const payload = Buffer.alloc(1024 * 1024, 0xaa);
    const item = Buffer.concat([Buffer.from('5a00100000', 'hex'), payload]);
    const decoder = new Decoder();
    decoder.on('data', (data: any) => {
      expect(Buffer.isBuffer(data.value)).eq(true);
      expect(data.value.length).eq(payload.length);
      expect(data.value.equals(payload)).eq(true);
      expect(Buffer.concat(data.bytes).equals(item)).eq(true);
      done();
    });
    decoder.on('error', done);
    for (let off = 0; off < item.length; off += 2048) {
      decoder.write(item.slice(off, off + 2048));
    }
    decoder.end();
  });

  it('Stream decode zero-length bytes and string', (done) => {
    const decoder = new Decoder();
    const results: any[] = [];
    decoder.on('data', (data: any) => results.push(data.value));
    decoder.on('error', done);
    decoder.on('end', () => {
      expect(results.length).eq(3);
      expect(Buffer.isBuffer(results[0])).eq(true);
      expect(results[0].length).eq(0);
      expect(results[1]).eq('');
      expect(results[2]).eq(1);
      done();
    });
    decoder.write(Buffer.from('40', 'hex')); // empty byte string
    decoder.write(Buffer.from('60', 'hex')); // empty text string
    decoder.write(Buffer.from('01', 'hex')); // unsigned 1
    decoder.end();
  });
});
