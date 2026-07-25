import CborTag from '../values/CborTag';
import EncodedCbor from '../values/EncodedCbor';
import IndefiniteArray from '../values/IndefiniteArray';
import IndefiniteMap from '../values/IndefiniteMap';
import SimpleValue from '../values/SimpleValue';
import { POW_2_32, POW_2_53 } from '../internal/numbers';

const NAN_BUF = Uint8Array.of(0xf9, 0x7e, 0x00);
const POS_INFINITY_BUF = Uint8Array.of(0xf9, 0x7c, 0x00);
const NEG_INFINITY_BUF = Uint8Array.of(0xf9, 0xfc, 0x00);
const NEG_ZERO_BUF = Uint8Array.of(0xf9, 0x80, 0x00);
const BREAK = Uint8Array.of(0xff);

const utf8Encoder = new TextEncoder();

const MAX_U64 = 0xffffffffffffffffn;

export type EncodeOptions = {
  // collapse a bigint that fits in 64 bits into a minimal-width major type 0/1
  // integer instead of a bignum tag (2/3). Defaults to true.
  collapseBigInt?: boolean;
};

const INITIAL_CAPACITY = 256;

export const encode = (input: any, options: EncodeOptions = {}): Uint8Array => {
  const opts = { collapseBigInt: true, ...options };

  // single growable output buffer: tokens are written straight into it
  let out = new Uint8Array(INITIAL_CAPACITY);
  let view = new DataView(out.buffer);
  let pos = 0;

  function reserve(n: number) {
    const needed = pos + n;
    if (needed <= out.length) return;
    let capacity = out.length * 2;
    while (capacity < needed) capacity *= 2;
    const grown = new Uint8Array(capacity);
    grown.set(out.subarray(0, pos));
    out = grown;
    view = new DataView(grown.buffer);
  }
  function pushFloat64(value: number) {
    reserve(8);
    view.setFloat64(pos, value);
    pos += 8;
  }
  function pushUInt8(value: number) {
    reserve(1);
    out[pos] = value & 0xff;
    pos += 1;
  }
  function pushBuffer(value: Uint8Array) {
    reserve(value.length);
    out.set(value, pos);
    pos += value.length;
  }
  function pushUInt16(value: number) {
    reserve(2);
    view.setUint16(pos, value);
    pos += 2;
  }
  function pushUInt32(value: number) {
    reserve(4);
    view.setUint32(pos, value);
    pos += 4;
  }
  function pushUInt64(value: number) {
    const low = value % POW_2_32;
    const high = (value - low) / POW_2_32;
    reserve(8);
    view.setUint32(pos, high);
    view.setUint32(pos + 4, low);
    pos += 8;
  }
  function pushTypeAndLength(type: number, length: number) {
    if (length < 24) {
      pushUInt8((type << 5) | length);
    } else if (length < 0x100) {
      pushUInt8((type << 5) | 24);
      pushUInt8(length);
    } else if (length < 0x10000) {
      pushUInt8((type << 5) | 25);
      pushUInt16(length);
    } else if (length < 0x100000000) {
      pushUInt8((type << 5) | 26);
      pushUInt32(length);
    } else {
      pushUInt8((type << 5) | 27);
      pushUInt64(length);
    }
  }
  // minimal-width head byte + payload for a magnitude that fits in 0..2^64-1
  function pushUintHead(type: number, v: bigint) {
    if (v < 24n) {
      pushUInt8((type << 5) | Number(v));
    } else if (v <= 0xffn) {
      pushUInt8((type << 5) | 24);
      pushUInt8(Number(v));
    } else if (v <= 0xffffn) {
      pushUInt8((type << 5) | 25);
      pushUInt16(Number(v));
    } else if (v <= 0xffffffffn) {
      pushUInt8((type << 5) | 26);
      pushUInt32(Number(v));
    } else {
      pushUInt8((type << 5) | 27);
      pushUInt32(Number(v >> 32n));
      pushUInt32(Number(v & 0xffffffffn));
    }
  }
  function pushTagNumber(tag: number | bigint) {
    if (typeof tag === 'bigint') {
      if (tag < 0n || tag > MAX_U64) {
        throw new Error(`Invalid tag number: ${tag}`);
      }
      return pushUintHead(6, tag);
    }
    if (!Number.isInteger(tag) || tag < 0 || tag >= 2 ** 64) {
      throw new Error(`Invalid tag number: ${tag}`);
    }
    return pushTypeAndLength(6, tag);
  }
  // big-endian magnitude bytes of a non-negative bigint (empty magnitude → 0x00)
  function bigIntToBytes(v: bigint): Uint8Array {
    if (v === 0n) {
      return Uint8Array.of(0);
    }
    const bytes: number[] = [];
    let n = v;
    while (n > 0n) {
      bytes.push(Number(n & 0xffn));
      n >>= 8n;
    }
    bytes.reverse();
    return Uint8Array.from(bytes);
  }
  function pushBigInt(value: bigint) {
    let v = value;
    let type = 0;
    let tag = 2;

    if (v < 0n) {
      v = -v - 1n;
      type = 1;
      tag = 3;
    }

    if (opts.collapseBigInt && v <= MAX_U64) {
      pushUintHead(type, v);
    } else {
      const buf = bigIntToBytes(v);
      // push tag
      pushTypeAndLength(6, tag);
      // push buffer
      pushTypeAndLength(2, buf.length);
      pushBuffer(buf);
    }
  }
  function pushIntNum(value: number) {
    if (Object.is(value, -0)) {
      return pushBuffer(NEG_ZERO_BUF);
    }
    if (value >= 0 && value <= POW_2_53) {
      return pushTypeAndLength(0, value);
    }
    if (-POW_2_53 <= value && value < 0) {
      return pushTypeAndLength(1, -(value + 1));
    }
    return pushBigInt(BigInt(value));
  }
  function encodeItem(value: any) {
    if (value === false) return pushUInt8(0xf4);
    if (value === true) return pushUInt8(0xf5);
    if (value === null) return pushUInt8(0xf6);
    if (value === undefined) return pushUInt8(0xf7);

    switch (typeof value) {
      case 'number': {
        if (!Number.isFinite(value)) {
          if (Number.isNaN(value)) {
            return pushBuffer(NAN_BUF);
          }
          return pushBuffer(value > 0 ? POS_INFINITY_BUF : NEG_INFINITY_BUF);
        }
        if (Math.round(value) === value) {
          return pushIntNum(value);
        }
        pushUInt8(0xfb);
        return pushFloat64(value);
      }
      case 'string': {
        const strBuff = utf8Encoder.encode(value);
        pushTypeAndLength(3, strBuff.length);
        return pushBuffer(strBuff);
      }
      case 'bigint': {
        return pushBigInt(value);
      }
      case 'function':
      case 'symbol': {
        throw new Error(`Unsupported type for CBOR encoding: ${typeof value}`);
      }
      default: {
        // ordered by how often each shape appears in real (Cardano) payloads:
        // arrays, maps, byte strings and tags dominate, so they are matched first
        if (Array.isArray(value)) {
          const indefinite = value instanceof IndefiniteArray;
          if (indefinite) {
            pushUInt8((4 << 5) | 31);
          } else {
            pushTypeAndLength(4, value.length);
          }
          for (const v of value) {
            encodeItem(v);
          }
          if (indefinite) {
            pushBuffer(BREAK);
          }
        } else if (value instanceof Map) {
          // also covers IndefiniteMap (a Map subclass); iterate with forEach so no
          // per-entry [key, value] tuple is materialised
          const indefinite = value instanceof IndefiniteMap;
          if (indefinite) {
            pushUInt8((5 << 5) | 31);
          } else {
            pushTypeAndLength(5, value.size);
          }
          value.forEach((v, key) => {
            encodeItem(key);
            encodeItem(v);
          });
          if (indefinite) {
            pushBuffer(BREAK);
          }
        } else if (value instanceof Uint8Array) {
          pushTypeAndLength(2, value.length);
          pushBuffer(value);
        } else if (value instanceof CborTag) {
          pushTagNumber(value.tag);
          encodeItem(value.value);
        } else if (value instanceof EncodedCbor) {
          pushBuffer(value.cborBytes);
        } else if (value instanceof ArrayBuffer) {
          const buf = new Uint8Array(value);
          pushTypeAndLength(2, buf.length);
          pushBuffer(buf);
        } else if (value instanceof Uint8ClampedArray) {
          const buf = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
          pushTypeAndLength(2, buf.length);
          pushBuffer(buf);
        } else if (value instanceof SimpleValue) {
          // simple values 24-31 are reserved/not encodable in one-byte form
          if (
            !Number.isInteger(value.value) ||
            value.value < 0 ||
            value.value > 255 ||
            (value.value >= 24 && value.value < 32)
          ) {
            throw new Error(`Invalid simple value: ${value.value}`);
          }
          pushTypeAndLength(7, value.value);
        } else if (value._isBigNumber === true) {
          // BigNumber support was dropped in v2; its {s,e,c} fields would otherwise
          // be silently encoded as a map by the fallback below
          throw new Error(
            'Unsupported type for CBOR encoding: BigNumber (convert to a bigint, or use CborTag for decimal fractions)'
          );
        } else {
          const proto = Object.getPrototypeOf(value);
          // a plain object or null-prototype dict encodes straight to a map; any
          // other prototype is first checked against the shapes whose (empty or
          // index-only) enumerable surface the map fallback would silently corrupt
          if (proto !== Object.prototype && proto !== null) {
            if (
              value instanceof Date ||
              value instanceof Set ||
              value instanceof WeakMap ||
              value instanceof WeakSet ||
              value instanceof RegExp ||
              value instanceof Error ||
              value instanceof Promise ||
              value instanceof Number ||
              value instanceof String ||
              value instanceof Boolean ||
              ArrayBuffer.isView(value) // typed arrays other than Uint8Array, DataView
            ) {
              throw new Error(
                `Unsupported type for CBOR encoding: ${Object.prototype.toString.call(value)}`
              );
            }
          }
          const keys = Object.keys(value);
          pushTypeAndLength(5, keys.length);
          for (let i = 0; i < keys.length; i += 1) {
            const key = keys[i];
            encodeItem(key);
            encodeItem(value[key]);
          }
        }
      }
    }
  }

  encodeItem(input);
  return out.slice(0, pos);
};
