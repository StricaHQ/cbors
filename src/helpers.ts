/* eslint-disable max-classes-per-file */
import { Buffer } from 'buffer';
import { Spanned } from './utils';

export class IndefiniteMap extends Map {}
export class IndefiniteArray extends Array {}
export { default as CborTag } from './CborTag';
export { default as SimpleValue } from './SimpleValue';
export type { ByteSpan, Spanned } from './utils';

/**
 * Whether a decoded value carries the byte span of its original encoding.
 * True for decoded maps, arrays, tags, simple values, byte strings and
 * bignums; false for values decoded to JS primitives (numbers, text
 * strings, floats, booleans, null, undefined), which cannot carry spans.
 */
export const hasByteSpan = (value: unknown): value is Spanned => {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) {
    return false;
  }
  return typeof (value as Spanned).getByteSpan === 'function';
};

/**
 * Returns the exact original CBOR bytes of a decoded item (including its
 * header) as a zero-copy slice of the buffer it was decoded from. Accepts
 * the chunk array emitted by the streaming decoder as well; chunks are
 * concatenated before slicing.
 */
export const getCborBytes = (originalBytes: Buffer | Array<Buffer>, value: Spanned): Buffer => {
  const buf = Array.isArray(originalBytes) ? Buffer.concat(originalBytes) : originalBytes;
  const [start, end] = value.getByteSpan();
  return buf.subarray(start, end);
};

/**
 * Wraps an already encoded CBOR item, which the encoder splices into the
 * output verbatim instead of re-encoding it. The buffer must contain exactly
 * one well-formed CBOR data item; it is not validated.
 */
export class EncodedCbor {
  private cborBuffer: Buffer;

  constructor(cborBuffer: Buffer) {
    this.cborBuffer = cborBuffer;
  }

  get cborBytes(): Buffer {
    return this.cborBuffer;
  }
}
