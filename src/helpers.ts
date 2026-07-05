/* eslint-disable max-classes-per-file */
import { Buffer } from 'buffer';

export class IndefiniteMap extends Map {}
export class IndefiniteArray extends Array {}
export { default as CborTag } from './CborTag';
export { default as SimpleValue } from './SimpleValue';

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

  get cborBytes() {
    return this.cborBuffer;
  }
}
