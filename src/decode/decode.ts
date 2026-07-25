import Reader, { DecoderOptions } from './read';
import plainBuilder from './decodePlain';

// decode a single, complete CBOR item from a contiguous buffer.
export const decode = (inputBytes: Uint8Array, options?: DecoderOptions): any => {
  const reader = new Reader(inputBytes, plainBuilder, options);
  const value = reader.read();

  if (reader.pos < inputBytes.length) {
    throw new Error('Remaining Bytes');
  }
  return value;
};
