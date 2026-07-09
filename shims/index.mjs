// ESM facade over the CJS build: require() and import must share one copy of
// the classes, the encoder dispatches on instanceof of these exports
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

export default cjs;
