import { brand } from '../internal/brand';

export default class IndefiniteArray extends Array {
  static {
    brand(this, 'IndefiniteArray');
  }
}
