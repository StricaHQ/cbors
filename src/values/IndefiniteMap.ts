import { brand } from '../internal/brand';

export default class IndefiniteMap extends Map {
  static {
    brand(this, 'IndefiniteMap');
  }
}
