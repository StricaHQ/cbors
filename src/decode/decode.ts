import { Buffer } from 'buffer';
import BufferList from '../internal/BufferList';
import Parser, { DecoderOptions } from './parse';
import plainBuilder from './decodePlain';

// decode a single, complete CBOR item from a contiguous buffer.
export const decode = (inputBytes: Buffer, options?: DecoderOptions): any => {
  const parser = new Parser(plainBuilder, options);
  const bs = new BufferList();
  bs.push(inputBytes);
  const gen = parser.parse();
  let state = gen.next();

  while (!state.done) {
    // read throws 'Insufficient data' when the input is truncated
    const b = bs.read(state.value);
    state = gen.next(b);
  }

  if (bs.length > 0) {
    throw new Error('Remaining Bytes');
  }
  return state.value;
};
