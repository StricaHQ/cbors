import Reader, { DecoderOptions, resolveOptions } from './read';
import plainBuilder from './decodePlain';
import { asBytes, plainView } from '../internal/bytes';

// decode a single, complete CBOR item from a contiguous buffer.
export const decode = (inputBytes: Uint8Array, options?: DecoderOptions): any => {
  const bytes = plainView(asBytes(inputBytes, 'decode()'));
  const reader = new Reader(bytes, plainBuilder, resolveOptions(options));
  const value = reader.read();

  if (reader.pos < bytes.length) {
    throw new Error('Remaining Bytes');
  }
  return value;
};
