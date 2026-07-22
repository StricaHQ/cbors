import { Buffer } from 'buffer';
import BufferList from '../internal/BufferList';
import Reader, { DecoderOptions } from './Reader';

// decode a single, complete CBOR item from a contiguous buffer.
export const decode = (inputBytes: Buffer, options?: DecoderOptions): any => {
  const reader = new Reader(options);
  const bs = new BufferList();
  bs.push(inputBytes);
  const parser = reader.parse();
  let state = parser.next();

  while (!state.done) {
    // read throws 'Insufficient data' when the input is truncated
    const b = bs.read(state.value);
    state = parser.next(b);
  }

  if (bs.length > 0) {
    throw new Error('Remaining Bytes');
  }
  return state.value;
};
