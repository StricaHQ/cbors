/* eslint-disable no-bitwise */

import { Buffer } from 'buffer';
import BigNumber from 'bignumber.js';
import { addSpanBytesToObject } from '../span';
import { getBigNum, POW_2_24 } from '../internal/numbers';
import SimpleValue from '../values/SimpleValue';
import CborTag from '../values/CborTag';
import CborArray from '../values/CborArray';
import CborMap from '../values/CborMap';

const td = new TextDecoder('utf8', { fatal: true, ignoreBOM: true });
const utf8Decoder = (buf: Buffer) => td.decode(buf);

const bytesToBigNumber = (buf: Buffer): BigNumber => {
  if (buf.length === 0) {
    return new BigNumber(0);
  }

  const hex = buf.toString('hex') || '0';
  return new BigNumber(hex, 16);
};

const readFloat16 = (value: number): number => {
  const sign = value & 0x8000;
  let exponent = value & 0x7c00;
  const fraction = value & 0x03ff;

  if (exponent === 0x7c00) exponent = 0xff << 10;
  else if (exponent !== 0) exponent += (127 - 15) << 10;
  else if (fraction !== 0) return (sign ? -1 : 1) * fraction * POW_2_24;

  const buf = Buffer.alloc(4);
  buf.writeUInt32BE(((sign << 16) | (exponent << 13) | (fraction << 13)) >>> 0);
  return buf.readFloatBE(0);
};

const isBreakPoint = (value: number): boolean => {
  if (value !== 0xff) return false;
  return true;
};

// a single Buffer can never exceed 2^32 - 1 bytes, so any string/bytes item
// declaring a larger length can never be decoded
const MAX_POSSIBLE_STRING_LENGTH = 4294967295;
const DEFAULT_MAX_DEPTH = 1024;

export type DecoderOptions = {
  // reject byte/text strings (or indefinite chunks) declaring a length above this
  maxStringLength?: number;
  // reject items nested deeper than this
  maxDepth?: number;
};

// low-level recursive-descent reader shared by decode() and IncrementalDecoder.
export default class Reader {
  offset: number = 0;

  usedBytes: Array<Buffer> = [];

  private maxStringLength: number;

  private maxDepth: number;

  constructor(options: DecoderOptions = {}) {
    this.maxStringLength = Math.min(
      options.maxStringLength ?? MAX_POSSIBLE_STRING_LENGTH,
      MAX_POSSIBLE_STRING_LENGTH
    );
    this.maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
  }

  private readUInt64(f: number, g: number, startByte: number): number | BigNumber {
    const bigNum = getBigNum(f, g);
    if (BigNumber.isBigNumber(bigNum)) {
      return addSpanBytesToObject(bigNum, [startByte, this.offset]);
    }
    return bigNum;
  }

  private updateTracker(bytes: Buffer) {
    this.usedBytes.push(bytes);
    this.offset += bytes.length;
  }

  private checkStringLength(length: number | BigNumber): number {
    if (BigNumber.isBigNumber(length) || length > this.maxStringLength) {
      throw new Error(`String length ${length.toString()} exceeds maximum allowed`);
    }
    return length;
  }

  private *readIndefiniteStringLength(
    majorType: number,
    startByte: number
  ): Generator<number, any, Buffer> {
    let bytes = yield 1;
    let length;
    const number = bytes.readUInt8(0);

    if (number === 0xff) {
      length = -1;
    } else {
      const ai = number & 0x1f;
      // read length
      const lengthReader = this.readLength(ai, startByte);
      let lengthStatus = lengthReader.next();
      while (!lengthStatus.done) {
        bytes = yield lengthStatus.value;
        lengthStatus = lengthReader.next(bytes);
      }
      length = lengthStatus.value;
      //
      if (length < 0 || number >> 5 !== majorType) {
        throw new Error('Invalid indefinite length encoding');
      }
      length = this.checkStringLength(length);
    }
    return length;
  }

  private *readLength(
    additionalInformation: number,
    startByte: number
  ): Generator<number, any, Buffer> {
    if (additionalInformation < 24) {
      return additionalInformation;
    }
    if (additionalInformation === 24) {
      const bytes = yield 1;
      return bytes.readUInt8(0);
    }
    if (additionalInformation === 25) {
      const bytes = yield 2;
      return bytes.readUInt16BE(0);
    }
    if (additionalInformation === 26) {
      const bytes = yield 4;
      return bytes.readUInt32BE(0);
    }
    if (additionalInformation === 27) {
      const fBytes = yield 4;
      const f = fBytes.readUInt32BE(0);
      const gBytes = yield 4;
      const g = gBytes.readUInt32BE(0);

      return this.readUInt64(f, g, startByte);
    }
    if (additionalInformation === 31) {
      return -1;
    }
    throw new Error('Invalid length encoding');
  }

  *parse(suppliedBytes?: Buffer, depth: number = 0): Generator<number, any, Buffer> {
    if (depth > this.maxDepth) {
      throw new Error('Maximum depth exceeded');
    }
    let startByte = this.offset;
    let bytes;
    if (suppliedBytes) {
      bytes = suppliedBytes;
      startByte -= suppliedBytes.length;
    } else {
      bytes = yield 1;
      this.updateTracker(bytes);
    }

    const value = bytes.readUInt8(0);
    const majorType = value >> 5;
    const additionalInformation = value & 0x1f;
    let length;
    if (majorType === 7) {
      if (additionalInformation === 25) {
        bytes = yield 2;
        this.updateTracker(bytes);
        const number = bytes.readUInt16BE(0);
        return readFloat16(number);
      }
      if (additionalInformation === 26) {
        bytes = yield 4;
        this.updateTracker(bytes);
        return bytes.readFloatBE(0);
      }
      if (additionalInformation === 27) {
        bytes = yield 8;
        this.updateTracker(bytes);
        return bytes.readDoubleBE(0);
      }
    }

    // read length
    const lengthReader = this.readLength(additionalInformation, startByte);
    let lengthStatus = lengthReader.next();
    while (!lengthStatus.done) {
      bytes = yield lengthStatus.value;
      this.updateTracker(bytes);
      lengthStatus = lengthReader.next(bytes);
    }
    length = lengthStatus.value;
    //

    if (length < 0 && (majorType < 2 || majorType > 5)) throw new Error('Invalid length');

    switch (majorType) {
      case 0:
        return length;
      case 1: {
        if (length === Number.MAX_SAFE_INTEGER) {
          const bigNum = new BigNumber(-1).minus(
            new BigNumber(Number.MAX_SAFE_INTEGER.toString(16), 16)
          );
          return addSpanBytesToObject(bigNum, [startByte, this.offset]);
        }
        if (BigNumber.isBigNumber(length)) {
          const bigNum = new BigNumber(-1).minus(length);
          return addSpanBytesToObject(bigNum, [startByte, this.offset]);
        }
        return -1 - length;
      }
      case 2: {
        if (length < 0) {
          const chunks = [];
          {
            // read indefinite length
            const inDefLengthReader = this.readIndefiniteStringLength(majorType, startByte);
            let inDefLengthStatus = inDefLengthReader.next();
            while (!inDefLengthStatus.done) {
              bytes = yield inDefLengthStatus.value;
              this.updateTracker(bytes);
              inDefLengthStatus = inDefLengthReader.next(bytes);
            }
            length = inDefLengthStatus.value;
            //
          }
          while (length >= 0) {
            bytes = yield length as number;
            this.updateTracker(bytes);
            chunks.push(bytes);
            {
              // read indefinite length
              const inDefLengthReader = this.readIndefiniteStringLength(majorType, startByte);
              let inDefLengthStatus = inDefLengthReader.next();
              while (!inDefLengthStatus.done) {
                bytes = yield inDefLengthStatus.value;
                this.updateTracker(bytes);
                inDefLengthStatus = inDefLengthReader.next(bytes);
              }
              length = inDefLengthStatus.value;
              //
            }
          }
          const buf = Buffer.concat(chunks);
          return addSpanBytesToObject(buf, [startByte, this.offset]);
        }
        bytes = yield this.checkStringLength(length);
        this.updateTracker(bytes);
        return addSpanBytesToObject(bytes, [startByte, this.offset]);
      }
      case 3: {
        const stringParts: Array<string> = [];
        if (length < 0) {
          {
            // read indefinite length
            const inDefLengthReader = this.readIndefiniteStringLength(majorType, startByte);
            let inDefLengthStatus = inDefLengthReader.next();
            while (!inDefLengthStatus.done) {
              bytes = yield inDefLengthStatus.value;
              this.updateTracker(bytes);
              inDefLengthStatus = inDefLengthReader.next(bytes);
            }
            length = inDefLengthStatus.value;
            //
          }

          while (length >= 0) {
            bytes = yield length as number;
            this.updateTracker(bytes);
            // RFC 8949: each indefinite text chunk must be valid UTF-8 on its own
            stringParts.push(utf8Decoder(bytes));
            //

            {
              // read indefinite length
              const inDefLengthReader = this.readIndefiniteStringLength(majorType, startByte);
              let inDefLengthStatus = inDefLengthReader.next();
              while (!inDefLengthStatus.done) {
                bytes = yield inDefLengthStatus.value;
                this.updateTracker(bytes);
                inDefLengthStatus = inDefLengthReader.next(bytes);
              }
              length = inDefLengthStatus.value;
              //
            }
          }

          return stringParts.join('');
        }
        bytes = yield this.checkStringLength(length);
        this.updateTracker(bytes);
        const string = utf8Decoder(bytes);
        return string;
      }
      case 4: {
        // a definite element count beyond 2^53 can never be satisfied
        if (BigNumber.isBigNumber(length)) throw new Error('Invalid array length');
        if (length < 0) {
          const ary = new CborArray();
          bytes = yield 1;
          this.updateTracker(bytes);
          let bp = bytes.readUInt8(0);
          while (!isBreakPoint(bp)) {
            ary.push(yield* this.parse(bytes, depth + 1));

            bytes = yield 1;
            this.updateTracker(bytes);
            bp = bytes.readUInt8(0);
          }
          ary.setByteSpan([startByte, this.offset]);
          return ary;
        }
        const ary = new CborArray();
        for (let i = 0; i < length; i += 1) {
          ary.push(yield* this.parse(undefined, depth + 1));
        }
        ary.setByteSpan([startByte, this.offset]);
        return ary;
      }
      case 5: {
        // a definite entry count beyond 2^53 can never be satisfied
        if (BigNumber.isBigNumber(length)) throw new Error('Invalid map length');
        if (length < 0) {
          const obj = new CborMap();
          bytes = yield 1;
          this.updateTracker(bytes);
          let bp = bytes.readUInt8(0);
          while (!isBreakPoint(bp)) {
            const key = yield* this.parse(bytes, depth + 1);
            const val = yield* this.parse(undefined, depth + 1);
            obj.set(key, val);

            bytes = yield 1;
            this.updateTracker(bytes);
            bp = bytes.readUInt8(0);
          }
          obj.setByteSpan([startByte, this.offset]);
          return obj;
        }
        const obj = new CborMap();

        for (let i = 0; i < length; i += 1) {
          const key = yield* this.parse(undefined, depth + 1);
          const val = yield* this.parse(undefined, depth + 1);
          obj.set(key, val);
        }

        obj.setByteSpan([startByte, this.offset]);
        return obj;
      }
      case 6: {
        const tagNumber = length;
        const taggedValue = yield* this.parse(undefined, depth + 1);

        // Handle bignum tags (RFC 8949 / RFC 7049):
        // Tag 2: positive bignum
        // Tag 3: negative bignum (-1 - n)
        if (typeof tagNumber === 'number' && (tagNumber === 2 || tagNumber === 3)) {
          if (!Buffer.isBuffer(taggedValue)) {
            // as per spec the tagged value for bignums must be a byte string
            throw new Error('Invalid bignum encoding: expected byte string');
          }

          let big = bytesToBigNumber(taggedValue);

          if (tagNumber === 3) {
            // negative bignum = -1 - n = -(n + 1)
            big = big.plus(1).negated();
          }

          // Track byte span from tag start to end of payload
          return addSpanBytesToObject(big, [startByte, this.offset]);
        }

        // generic tag handling for everything else
        const tag = new CborTag(taggedValue, tagNumber as number);
        tag.setByteSpan([startByte, this.offset]);
        return tag;
      }
      case 7: {
        // RFC 8949 §3.3: two-byte simple values below 32 are ill-formed
        if (additionalInformation === 24 && (length as number) < 32) {
          throw new Error(`Invalid two-byte simple value encoding: ${length}`);
        }
        switch (length) {
          case 20:
            return false;
          case 21:
            return true;
          case 22:
            return null;
          case 23:
            return undefined;
          default: {
            const simpleValue = new SimpleValue(length as number);
            simpleValue.setByteSpan([startByte, this.offset]);
            return simpleValue;
          }
        }
      }
      default: {
        throw new Error('Invalid CBOR encoding');
      }
    }
  }
}
