import { Buffer } from 'buffer';

// [start, end) byte offsets of a decoded item within the original CBOR buffer
export type ByteSpan = [number, number];

// decoded values that carry the byte offsets of their original CBOR encoding
export interface Spanned {
  getByteSpan(): ByteSpan;
}

// a single shared getter avoids allocating a closure per decoded value
// eslint-disable-next-line no-unused-vars
function sharedGetByteSpan(this: { byteSpan: ByteSpan }): ByteSpan {
  return this.byteSpan;
}

export const addSpanBytesToObject = <T extends object>(obj: T, span: ByteSpan): T & Spanned => {
  Object.defineProperty(obj, 'byteSpan', {
    value: span,
    enumerable: false,
    writable: true,
    configurable: true,
  });
  Object.defineProperty(obj, 'getByteSpan', {
    value: sharedGetByteSpan,
    enumerable: false,
    writable: true,
    configurable: true,
  });

  return obj as T & Spanned;
};

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
