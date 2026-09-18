import { brand } from '../internal/brand';

export default class SimpleValue {
  static {
    brand(this, 'SimpleValue');
  }

  value: number;

  constructor(value: number) {
    this.value = value;
  }
}
