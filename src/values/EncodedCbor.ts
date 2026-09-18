import { asBytes } from '../internal/bytes';
import { brand } from '../internal/brand';

/**
 * Wraps an already encoded CBOR item, which the encoder splices into the
 * output verbatim instead of re-encoding it. The bytes must contain exactly
 * one well-formed CBOR data item. That is not validated; the constructor only
 * throws when it gets something other than a non-empty Uint8Array.
 */
export default class EncodedCbor {
  static {
    brand(this, 'EncodedCbor');
  }

  private cborBuffer: Uint8Array;

  constructor(cborBuffer: Uint8Array) {
    asBytes(cborBuffer, 'EncodedCbor');
    if (cborBuffer.length === 0) {
      throw new RangeError('EncodedCbor expects one encoded CBOR item, got no bytes');
    }
    this.cborBuffer = cborBuffer;
  }

  get cborBytes(): Uint8Array {
    return this.cborBuffer;
  }
}
