import * as cjs from './index.js';

export {
  CborTag,
  Decoder,
  EncodedCbor,
  Encoder,
  IndefiniteArray,
  IndefiniteMap,
  SimpleValue,
  getCborBytes,
  hasByteSpan,
} from './index.js';
export type { ByteSpan, DecoderOptions, Spanned } from './index.js';

declare const cbors: typeof cjs;
export default cbors;
