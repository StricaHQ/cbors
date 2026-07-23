const MAX_SAFE_HIGH = 0x1fffff;
export const SHIFT32 = 0x100000000;
export const POW_2_24 = 5.960464477539063e-8;
export const POW_2_32 = 4294967296;
export const POW_2_53 = 9007199254740992;

// big-endian bytes → non-negative bigint (used for bignum tags 2/3)
export const bytesToBigInt = (bytes: Uint8Array): bigint => {
  let result = 0n;
  for (const byte of bytes) {
    result = (result << 8n) | BigInt(byte);
  }
  return result;
};

// combine the high/low 32-bit halves of a CBOR uint64; stays a JS number while
// it fits in ±2^53, otherwise a bigint
export const getBigNum = (f: number, g: number): number | bigint => {
  if (f > MAX_SAFE_HIGH) {
    return BigInt(f) * 0x100000000n + BigInt(g);
  }
  return f * SHIFT32 + g;
};

// big-endian readers over exact-width byte slices
export const readUInt8 = (b: Uint8Array): number => b[0];
export const readUInt16BE = (b: Uint8Array): number => (b[0] << 8) | b[1];
export const readUInt32BE = (b: Uint8Array): number =>
  ((b[0] << 24) | (b[1] << 16) | (b[2] << 8) | b[3]) >>> 0;
export const readFloat32BE = (b: Uint8Array): number =>
  new DataView(b.buffer, b.byteOffset, b.byteLength).getFloat32(0);
export const readFloat64BE = (b: Uint8Array): number =>
  new DataView(b.buffer, b.byteOffset, b.byteLength).getFloat64(0);
