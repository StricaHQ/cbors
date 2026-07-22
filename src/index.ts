export { decode } from './decode/decode';
export { default as IncrementalDecoder } from './decode/IncrementalDecoder';
export type { DecoderOptions } from './decode/Reader';

export { encode } from './encode/encode';
export type { EncodeOptions } from './encode/encode';

export { default as CborTag } from './values/CborTag';
export { default as SimpleValue } from './values/SimpleValue';
export { default as IndefiniteArray } from './values/IndefiniteArray';
export { default as IndefiniteMap } from './values/IndefiniteMap';
export { default as EncodedCbor } from './values/EncodedCbor';

export type { ByteSpan } from './span';
