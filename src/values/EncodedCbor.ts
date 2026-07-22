import { Buffer } from 'buffer';

/**
 * Wraps an already encoded CBOR item, which the encoder splices into the
 * output verbatim instead of re-encoding it. The buffer must contain exactly
 * one well-formed CBOR data item; it is not validated.
 */
export default class EncodedCbor {
  private cborBuffer: Buffer;

  constructor(cborBuffer: Buffer) {
    this.cborBuffer = cborBuffer;
  }

  get cborBytes(): Buffer {
    return this.cborBuffer;
  }
}
