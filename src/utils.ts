/* eslint-disable max-classes-per-file */
import { Buffer } from 'buffer';
import BigNumber from 'bignumber.js';

const MAX_SAFE_HIGH = 0x1fffff;
export const SHIFT32 = 0x100000000;
export const POW_2_24 = 5.960464477539063e-8;
export const POW_2_32 = 4294967296;
export const POW_2_53 = 9007199254740992;
export const MAX_BIG_NUM_INT = new BigNumber('0x20000000000000');
export const MAX_BIG_NUM_INT32 = new BigNumber('0xffffffff');
export const MAX_BIG_NUM_INT64 = new BigNumber('0xffffffffffffffff');

export const getBigNum = (f: number, g: number): number | BigNumber => {
  if (f > MAX_SAFE_HIGH) {
    return new BigNumber(f).times(SHIFT32).plus(g);
  }
  return f * SHIFT32 + g;
};

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

const td = new TextDecoder('utf8', { fatal: true, ignoreBOM: true });
export const utf8Decoder = (buf: Buffer) => td.decode(buf);
