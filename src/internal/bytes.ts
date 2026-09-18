const td = new TextDecoder('utf8', { fatal: true, ignoreBOM: true });

// strict UTF-8 decode; throws on malformed input
export const utf8Decode = (bytes: Uint8Array): string => td.decode(bytes);

export const concat = (chunks: Array<Uint8Array>): Uint8Array => {
  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
};

export const bytesEqual = (a: Uint8Array, b: Uint8Array): boolean => {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
};

// %TypedArray%.prototype[Symbol.toStringTag] reads the type name from the
// value's internal slots (undefined for anything but a typed array), so unlike
// instanceof it also recognises a Uint8Array from another realm
const typedArrayName = Object.getOwnPropertyDescriptor(
  Object.getPrototypeOf(Uint8Array.prototype),
  Symbol.toStringTag
)!.get!;

export const typedArrayType = (value: unknown): string | undefined => typedArrayName.call(value);

const typeName = (value: unknown): string => {
  if (value === null) return 'null';
  if (typeof value !== 'object') return typeof value;
  return typedArrayType(value) ?? Object.prototype.toString.call(value).slice(8, -1);
};

const hints: Record<string, string> = {
  ArrayBuffer: ' (wrap it: new Uint8Array(buffer))',
  string: ' (convert hex or base64 to bytes first)',
};

// any Uint8Array passes, subclasses and other realms included
export const asBytes = (input: unknown, caller: string): Uint8Array => {
  if (input instanceof Uint8Array || typedArrayType(input) === 'Uint8Array') {
    return input as Uint8Array;
  }
  const type = typeName(input);
  throw new TypeError(`${caller} expects a Uint8Array, got ${type}${hints[type] ?? ''}`);
};

// the same bytes as a plain Uint8Array of this realm, sharing the input's
// memory: subarray() keeps the input's class, so node.bytes would otherwise be
// Buffers, or another realm's arrays
export const plainView = (bytes: Uint8Array): Uint8Array =>
  bytes.constructor === Uint8Array
    ? bytes
    : new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
