import CborTag from '../values/CborTag';
import EncodedCbor from '../values/EncodedCbor';
import SimpleValue from '../values/SimpleValue';
import { bigIntToBytes, POW_2_32, POW_2_53 } from '../internal/numbers';
import { BRAND } from '../internal/brand';
import { typedArrayType } from '../internal/bytes';
import { RECURSION_LIMIT } from '../internal/limits';

const NAN_BUF = Uint8Array.of(0xf9, 0x7e, 0x00);
const POS_INFINITY_BUF = Uint8Array.of(0xf9, 0x7c, 0x00);
const NEG_INFINITY_BUF = Uint8Array.of(0xf9, 0xfc, 0x00);
const NEG_ZERO_BUF = Uint8Array.of(0xf9, 0x80, 0x00);
const BREAK = Uint8Array.of(0xff);

const utf8Encoder = new TextEncoder();

const MAX_U64 = 0xffffffffffffffffn;

// getters that throw unless their receiver really is a Map / ArrayBuffer, which
// unlike instanceof also holds for one from another realm
const mapSize = Object.getOwnPropertyDescriptor(Map.prototype, 'size')!.get!;
const arrayBufferLength = Object.getOwnPropertyDescriptor(
  ArrayBuffer.prototype,
  'byteLength'
)!.get!;

const hasSlot = (getter: () => unknown, value: object): boolean => {
  try {
    getter.call(value);
    return true;
  } catch {
    return false;
  }
};

// no prototype, or Object.prototype of any realm
const isPlainObject = (value: object): boolean => {
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null || Object.getPrototypeOf(proto) === null;
};

const unsupported = (value: object): Error => {
  let type = Object.prototype.toString.call(value);
  if (type === '[object Object]') {
    const name = typeof value.constructor === 'function' ? value.constructor.name : '';
    if (name === 'CborNode') {
      // by name, not by brand: a brand on CborNode would keep the annotation
      // tree in bundles that only encode
      type = 'CborNode (splice its original bytes with new EncodedCbor(node.bytes))';
    } else if (['CborTag', 'EncodedCbor', 'SimpleValue'].includes(name)) {
      type = `${name} from another copy of cbors`;
    } else {
      type = `${name || 'object'} instance, only plain objects encode as maps`;
    }
  }
  return new Error(`Unsupported type for CBOR encoding: ${type}`);
};

export type EncodeOptions = {
  // collapse a bigint that fits in 64 bits into a minimal-width major type 0/1
  // integer instead of a bignum tag (2/3). Defaults to true.
  collapseBigInt?: boolean;
};

const INITIAL_CAPACITY = 256;

type Nested = { container: object; items: ArrayLike<any>; next: number; indefinite: boolean };

// the state of one encode() call: a single growable output buffer that tokens
// are written straight into
class Writer {
  out = new Uint8Array(INITIAL_CAPACITY);

  view = new DataView(this.out.buffer);

  pos = 0;

  collapseBigInt: boolean;

  // containers whose items are still to be written by nest(), and the same
  // containers as a set, to catch a value that contains itself
  nested: Nested[] | undefined;

  open: Set<object> | undefined;

  constructor(collapseBigInt: boolean) {
    this.collapseBigInt = collapseBigInt;
  }

  reserve(n: number) {
    const needed = this.pos + n;
    if (needed <= this.out.length) return;
    let capacity = this.out.length * 2;
    while (capacity < needed) capacity *= 2;
    const grown = new Uint8Array(capacity);
    grown.set(this.out.subarray(0, this.pos));
    this.out = grown;
    this.view = new DataView(grown.buffer);
  }

  pushFloat64(value: number) {
    this.reserve(8);
    this.view.setFloat64(this.pos, value);
    this.pos += 8;
  }

  pushUInt8(value: number) {
    this.reserve(1);
    this.out[this.pos] = value & 0xff;
    this.pos += 1;
  }

  pushBuffer(value: Uint8Array) {
    this.reserve(value.length);
    this.out.set(value, this.pos);
    this.pos += value.length;
  }

  pushUInt16(value: number) {
    this.reserve(2);
    this.view.setUint16(this.pos, value);
    this.pos += 2;
  }

  pushUInt32(value: number) {
    this.reserve(4);
    this.view.setUint32(this.pos, value);
    this.pos += 4;
  }

  pushUInt64(value: number) {
    const low = value % POW_2_32;
    const high = (value - low) / POW_2_32;
    this.reserve(8);
    this.view.setUint32(this.pos, high);
    this.view.setUint32(this.pos + 4, low);
    this.pos += 8;
  }

  pushTypeAndLength(type: number, length: number) {
    if (length < 24) {
      this.pushUInt8((type << 5) | length);
    } else if (length < 0x100) {
      this.pushUInt8((type << 5) | 24);
      this.pushUInt8(length);
    } else if (length < 0x10000) {
      this.pushUInt8((type << 5) | 25);
      this.pushUInt16(length);
    } else if (length < 0x100000000) {
      this.pushUInt8((type << 5) | 26);
      this.pushUInt32(length);
    } else {
      this.pushUInt8((type << 5) | 27);
      this.pushUInt64(length);
    }
  }

  // minimal-width head byte + payload for a magnitude that fits in 0..2^64-1
  pushUintHead(type: number, v: bigint) {
    if (v < 24n) {
      this.pushUInt8((type << 5) | Number(v));
    } else if (v <= 0xffn) {
      this.pushUInt8((type << 5) | 24);
      this.pushUInt8(Number(v));
    } else if (v <= 0xffffn) {
      this.pushUInt8((type << 5) | 25);
      this.pushUInt16(Number(v));
    } else if (v <= 0xffffffffn) {
      this.pushUInt8((type << 5) | 26);
      this.pushUInt32(Number(v));
    } else {
      this.pushUInt8((type << 5) | 27);
      this.pushUInt32(Number(v >> 32n));
      this.pushUInt32(Number(v & 0xffffffffn));
    }
  }

  pushTagNumber(tag: number | bigint) {
    if (typeof tag === 'bigint') {
      if (tag < 0n || tag > MAX_U64) {
        throw new Error(`Invalid tag number: ${tag}`);
      }
      return this.pushUintHead(6, tag);
    }
    if (!Number.isInteger(tag) || tag < 0 || tag >= 2 ** 64) {
      throw new Error(`Invalid tag number: ${tag}`);
    }
    return this.pushTypeAndLength(6, tag);
  }

  pushBigInt(value: bigint) {
    let v = value;
    let type = 0;
    let tag = 2;

    if (v < 0n) {
      v = -v - 1n;
      type = 1;
      tag = 3;
    }

    if (this.collapseBigInt && v <= MAX_U64) {
      this.pushUintHead(type, v);
    } else {
      const buf = bigIntToBytes(v);
      this.pushTypeAndLength(6, tag);
      this.pushTypeAndLength(2, buf.length);
      this.pushBuffer(buf);
    }
  }

  pushIntNum(value: number) {
    if (Object.is(value, -0)) {
      return this.pushBuffer(NEG_ZERO_BUF);
    }
    if (value >= 0 && value <= POW_2_53) {
      return this.pushTypeAndLength(0, value);
    }
    if (-POW_2_53 <= value && value < 0) {
      return this.pushTypeAndLength(1, -(value + 1));
    }
    return this.pushBigInt(BigInt(value));
  }

  pushBytes(value: Uint8Array) {
    this.pushTypeAndLength(2, value.length);
    this.pushBuffer(value);
  }

  pushSimple(value: SimpleValue) {
    // simple values 24-31 are reserved/not encodable in one-byte form
    if (
      !Number.isInteger(value.value) ||
      value.value < 0 ||
      value.value > 255 ||
      (value.value >= 24 && value.value < 32)
    ) {
      throw new Error(`Invalid simple value: ${value.value}`);
    }
    this.pushTypeAndLength(7, value.value);
  }

  // past RECURSION_LIMIT a container's items are written by this loop instead
  // of by recursion. The outermost call runs it for the whole subtree; a
  // container opened meanwhile only queues its items.
  nest(container: object, items: ArrayLike<any>, indefinite: boolean) {
    const stack = (this.nested ??= []);
    const path = (this.open ??= new Set());
    if (path.has(container)) {
      throw new Error('Cannot encode a value that contains itself');
    }
    path.add(container);
    stack.push({ container, items, next: 0, indefinite });
    if (stack.length > 1) return;
    while (stack.length > 0) {
      const top = stack[stack.length - 1];
      if (top.next < top.items.length) {
        top.next += 1;
        this.encodeItem(top.items[top.next - 1], RECURSION_LIMIT);
      } else {
        stack.pop();
        path.delete(top.container);
        if (top.indefinite) this.pushBuffer(BREAK);
      }
    }
  }

  encodeArray(value: any[], depth: number) {
    const indefinite = (value as any)[BRAND] === 'IndefiniteArray';
    if (indefinite) {
      this.pushUInt8((4 << 5) | 31);
    } else {
      this.pushTypeAndLength(4, value.length);
    }
    if (depth >= RECURSION_LIMIT) {
      this.nest(value, value, indefinite);
      return;
    }
    for (const v of value) {
      this.encodeItem(v, depth + 1);
    }
    if (indefinite) {
      this.pushBuffer(BREAK);
    }
  }

  encodeMap(value: Map<any, any>, depth: number) {
    const indefinite = (value as any)[BRAND] === 'IndefiniteMap';
    if (indefinite) {
      this.pushUInt8((5 << 5) | 31);
    } else {
      this.pushTypeAndLength(5, value.size);
    }
    if (depth >= RECURSION_LIMIT) {
      const items: any[] = [];
      value.forEach((v, key) => {
        items.push(key, v);
      });
      this.nest(value, items, indefinite);
      return;
    }
    // forEach, so no per-entry [key, value] tuple is materialised
    value.forEach((v, key) => {
      this.encodeItem(key, depth + 1);
      this.encodeItem(v, depth + 1);
    });
    if (indefinite) {
      this.pushBuffer(BREAK);
    }
  }

  encodeTag(value: CborTag, depth: number) {
    this.pushTagNumber(value.tag);
    if (depth >= RECURSION_LIMIT) {
      this.nest(value, [value.value], false);
    } else {
      this.encodeItem(value.value, depth + 1);
    }
  }

  encodeObject(value: any, depth: number) {
    const keys = Object.keys(value);
    this.pushTypeAndLength(5, keys.length);
    if (depth >= RECURSION_LIMIT) {
      const items: any[] = [];
      for (const key of keys) items.push(key, value[key]);
      this.nest(value, items, false);
      return;
    }
    for (let i = 0; i < keys.length; i += 1) {
      const key = keys[i];
      this.encodeItem(key, depth + 1);
      this.encodeItem(value[key], depth + 1);
    }
  }

  // an object the instanceof checks miss: a value class from another copy of
  // cbors, a builtin from another realm, or something that has no encoding
  encodeForeign(value: any, depth: number) {
    switch (value[BRAND]) {
      case 'CborTag':
        return this.encodeTag(value, depth);
      case 'EncodedCbor':
        return this.pushBuffer(value.cborBytes);
      case 'SimpleValue':
        return this.pushSimple(value);
    }
    if (hasSlot(mapSize, value)) {
      return this.encodeMap(value, depth);
    }
    const type = typedArrayType(value);
    if (type === 'Uint8Array') {
      return this.pushBytes(value);
    }
    if (type === 'Uint8ClampedArray') {
      return this.pushBytes(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
    }
    if (hasSlot(arrayBufferLength, value)) {
      return this.pushBytes(new Uint8Array(value));
    }
    throw unsupported(value);
  }

  encodeItem(value: any, depth: number): void {
    if (value === false) return this.pushUInt8(0xf4);
    if (value === true) return this.pushUInt8(0xf5);
    if (value === null) return this.pushUInt8(0xf6);
    if (value === undefined) return this.pushUInt8(0xf7);

    switch (typeof value) {
      case 'number': {
        if (!Number.isFinite(value)) {
          if (Number.isNaN(value)) {
            return this.pushBuffer(NAN_BUF);
          }
          return this.pushBuffer(value > 0 ? POS_INFINITY_BUF : NEG_INFINITY_BUF);
        }
        if (Math.round(value) === value) {
          return this.pushIntNum(value);
        }
        this.pushUInt8(0xfb);
        return this.pushFloat64(value);
      }
      case 'string': {
        const strBuff = utf8Encoder.encode(value);
        this.pushTypeAndLength(3, strBuff.length);
        return this.pushBuffer(strBuff);
      }
      case 'bigint': {
        return this.pushBigInt(value);
      }
      case 'function':
      case 'symbol': {
        throw new Error(`Unsupported type for CBOR encoding: ${typeof value}`);
      }
      default: {
        // ordered by how often each shape appears in real (Cardano) payloads:
        // arrays, maps, byte strings and tags dominate, so they are matched first
        if (Array.isArray(value)) {
          this.encodeArray(value, depth);
        } else if (value instanceof Map) {
          this.encodeMap(value, depth);
        } else if (value instanceof Uint8Array) {
          this.pushBytes(value);
        } else if (value instanceof CborTag) {
          this.encodeTag(value, depth);
        } else if (value instanceof EncodedCbor) {
          this.pushBuffer(value.cborBytes);
        } else if (value instanceof ArrayBuffer) {
          this.pushBytes(new Uint8Array(value));
        } else if (value instanceof Uint8ClampedArray) {
          this.pushBytes(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
        } else if (value instanceof SimpleValue) {
          this.pushSimple(value);
        } else if (value._isBigNumber === true) {
          // BigNumber support was dropped in v2; its {s,e,c} fields would otherwise
          // be silently encoded as a map
          throw new Error(
            'Unsupported type for CBOR encoding: BigNumber (convert to a bigint, or use CborTag for decimal fractions)'
          );
        } else if (isPlainObject(value)) {
          this.encodeObject(value, depth);
        } else {
          this.encodeForeign(value, depth);
        }
      }
    }
  }
}

export const encode = (input: any, options: EncodeOptions = {}): Uint8Array => {
  const writer = new Writer(options?.collapseBigInt ?? true);
  writer.encodeItem(input, 0);
  return writer.out.slice(0, writer.pos);
};
