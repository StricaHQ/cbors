import { bytesToBigInt } from '../internal/numbers';
import { concat } from '../internal/bytes';
import CborTag from '../values/CborTag';
import SimpleValue from '../values/SimpleValue';
import IndefiniteArray from '../values/IndefiniteArray';
import IndefiniteMap from '../values/IndefiniteMap';
import { Builder } from './parse';

// builder that produces the plain decode() values (numbers, Uint8Arrays, Maps, …)
const plainBuilder: Builder<any> = {
  int(value) {
    return value;
  },
  bytes(payload) {
    return Array.isArray(payload) ? concat(payload) : payload;
  },
  text(payload) {
    return Array.isArray(payload) ? payload.join('') : payload;
  },
  array(items, meta) {
    if (meta.indefinite) {
      const ary = new IndefiniteArray();
      for (const item of items) ary.push(item);
      return ary;
    }
    return items;
  },
  map(entries, meta) {
    const obj = meta.indefinite ? new IndefiniteMap() : new Map();
    for (const [key, val] of entries) obj.set(key, val);
    return obj;
  },
  tag(tag, child) {
    // bignum tags (RFC 8949 3.4.3) collapse to bigint: tag 2 positive, tag 3 = -1 - n
    if (tag === 2 || tag === 3) {
      if (!(child instanceof Uint8Array)) {
        throw new Error('Invalid bignum encoding: expected byte string');
      }
      const big = bytesToBigInt(child);
      return tag === 3 ? -1n - big : big;
    }
    return new CborTag(child, tag);
  },
  float(value) {
    return value;
  },
  simple(value) {
    switch (value) {
      case 20:
        return false;
      case 21:
        return true;
      case 22:
        return null;
      case 23:
        return undefined;
      default:
        return new SimpleValue(value);
    }
  },
};

export default plainBuilder;
