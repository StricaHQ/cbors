// the value classes carry this brand on their prototype, so the encoder also
// recognises instances made by another copy of cbors, which instanceof misses.
// The encoder relies on each class's public fields, so a class whose fields
// change must get a new brand name.
export const BRAND = Symbol.for('@stricahq/cbors');

export const brand = (target: { prototype: object }, name: string): void => {
  Object.defineProperty(target.prototype, BRAND, { value: name });
};
