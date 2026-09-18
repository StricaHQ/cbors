// the value a decode produced, or the message it threw
export const outcome = (fn: () => any): { value?: any; error?: string } => {
  try {
    return { value: fn() };
  } catch (err) {
    return { error: (err as Error).message };
  }
};

// deterministic PRNG (mulberry32), so a failing case reproduces
export const prng = (seed: number) => {
  let state = seed;
  return (): number => {
    state = (state + 0x6d2b79f5) | 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

// a random CBOR item: every major type, heads of any width that fits (not only
// the shortest), indefinite forms, containers nested up to six deep
export const randomItem = (rand: () => number): number[] => {
  const int = (n: number) => Math.floor(rand() * n);
  const head = (major: number, n: number): number[] => {
    const widths = [4, 8];
    if (n < 0x10000) widths.push(2);
    if (n < 0x100) widths.push(1);
    if (n < 24) widths.push(0);
    const width = widths[int(widths.length)];
    if (width === 0) return [(major << 5) | n];
    const out = [(major << 5) | { 1: 24, 2: 25, 4: 26, 8: 27 }[width as 1 | 2 | 4 | 8]];
    for (let i = width - 1; i >= 0; i -= 1) out.push(i < 4 ? (n >>> (i * 8)) & 0xff : 0);
    return out;
  };
  const string = (major: number): number[] => {
    const payload = (n: number) =>
      Array.from({ length: n }, () => (major === 2 ? int(256) : 0x61 + int(26)));
    if (int(3) > 0) {
      const n = int(5);
      return [...head(major, n), ...payload(n)];
    }
    const out = [(major << 5) | 31];
    for (let chunks = int(3); chunks > 0; chunks -= 1) {
      const n = int(4);
      out.push(...head(major, n), ...payload(n));
    }
    return [...out, 0xff];
  };
  const item = (level: number): number[] => {
    const kind = int(level > 5 ? 4 : 8);
    if (kind === 0) return head(int(2), int(2) ? int(30) : int(1000000));
    if (kind === 1) return string(2);
    if (kind === 2) return string(3);
    if (kind === 3) {
      const leaves = [
        [0xf4],
        [0xf5],
        [0xf6],
        [0xf7],
        [0xf0],
        [0xf8, 32 + int(200)],
        [0xf9, int(256), int(256)],
        [0xfa, 0x47, 0xc3, 0x50, int(256)],
        [0xfb, 0x3f, 0xf1, 0, 0, 0, 0, 0, int(256)],
      ];
      return leaves[int(leaves.length)];
    }
    if (kind === 7) {
      return [...head(6, [2, 3, 24, 30, 258, 121, int(100000)][int(7)]), ...item(level + 1)];
    }
    const major = kind === 6 ? 5 : 4;
    const count = int(major === 5 ? 3 : 4);
    const items: number[] = [];
    for (let i = 0; i < (major === 5 ? count * 2 : count); i += 1) items.push(...item(level + 1));
    return int(3) > 0 ? [...head(major, count), ...items] : [(major << 5) | 31, ...items, 0xff];
  };
  return item(0);
};

// the item with one byte dropped, inserted or replaced, or cut short
export const corrupt = (bytes: number[], rand: () => number): number[] => {
  const int = (n: number) => Math.floor(rand() * n);
  const out = bytes.slice();
  const at = int(out.length + 1);
  const structural = [0xff, 0x5f, 0x7f, 0x9f, 0xbf, 0x1c, 0x41, 0x61, int(256)];
  switch (int(4)) {
    case 0:
      out.splice(at, 1);
      return out;
    case 1:
      out.splice(at, 0, int(256));
      return out;
    case 2:
      out.splice(at, 1, structural[int(structural.length)]);
      return out;
    default:
      return out.slice(0, at);
  }
};
