const MAX_SAFE_HIGH = 0x1fffff;
const SHIFT32 = 0x100000000;
const POW_2_24 = 5.960464477539063e-8;
export const POW_2_32 = 4294967296;
export const POW_2_53 = 9007199254740992;

const HEX = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, '0'));

// bignum magnitudes go through hex, which BigInt parses and prints in linear
// time; shifting a growing bigint a byte at a time is quadratic in the length

// big-endian bytes → non-negative bigint (used for bignum tags 2/3)
export const bytesToBigInt = (bytes: Uint8Array): bigint => {
  if (bytes.length === 0) return 0n;
  let hex = '0x';
  for (let i = 0; i < bytes.length; i += 1) hex += HEX[bytes[i]];
  return BigInt(hex);
};

// value of a lowercase hex digit's char code
const nibble = (code: number): number => (code < 97 ? code - 48 : code - 87);

// non-negative bigint → big-endian magnitude bytes (0n → 0x00)
export const bigIntToBytes = (value: bigint): Uint8Array => {
  let hex = value.toString(16);
  if (hex.length % 2 === 1) hex = `0${hex}`;
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = (nibble(hex.charCodeAt(2 * i)) << 4) | nibble(hex.charCodeAt(2 * i + 1));
  }
  return bytes;
};

// combine the high/low 32-bit halves of a CBOR uint64; stays a JS number while
// it fits in ±2^53, otherwise a bigint
export const getBigNum = (f: number, g: number): number | bigint => {
  if (f > MAX_SAFE_HIGH) {
    return BigInt(f) * 0x100000000n + BigInt(g);
  }
  return f * SHIFT32 + g;
};

const f16Scratch = new DataView(new ArrayBuffer(4));

// expand a raw 16-bit half-float to a JS number
export const readFloat16 = (value: number): number => {
  const sign = value & 0x8000;
  let exponent = value & 0x7c00;
  const fraction = value & 0x03ff;

  if (exponent === 0x7c00) exponent = 0xff << 10;
  else if (exponent !== 0) exponent += (127 - 15) << 10;
  else if (fraction !== 0) return (sign ? -1 : 1) * fraction * POW_2_24;

  f16Scratch.setUint32(0, ((sign << 16) | (exponent << 13) | (fraction << 13)) >>> 0);
  return f16Scratch.getFloat32(0);
};
