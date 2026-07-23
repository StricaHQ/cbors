/**
 * Wraps an already encoded CBOR item, which the encoder splices into the
 * output verbatim instead of re-encoding it. The bytes must contain exactly
 * one well-formed CBOR data item; it is not validated.
 */
export default class EncodedCbor {
  private cborBuffer: Uint8Array;

  constructor(cborBuffer: Uint8Array) {
    this.cborBuffer = cborBuffer;
  }

  get cborBytes(): Uint8Array {
    return this.cborBuffer;
  }
}
