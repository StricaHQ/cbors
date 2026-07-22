const MAX_SAFE_HIGH = 0x1fffff;
export const SHIFT32 = 0x100000000;
export const POW_2_24 = 5.960464477539063e-8;
export const POW_2_32 = 4294967296;
export const POW_2_53 = 9007199254740992;

// combine the high/low 32-bit halves of a CBOR uint64; stays a JS number while
// it fits in ±2^53, otherwise a bigint
export const getBigNum = (f: number, g: number): number | bigint => {
  if (f > MAX_SAFE_HIGH) {
    return BigInt(f) * 0x100000000n + BigInt(g);
  }
  return f * SHIFT32 + g;
};
