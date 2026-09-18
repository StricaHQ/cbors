// items nested deeper than this are walked on an explicit stack instead of by
// recursion (decode, toJS, encode), so depth is not bounded by the call stack
export const RECURSION_LIMIT = 128;
