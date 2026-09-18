import { brand } from '../internal/brand';

export default class CborTag {
  static {
    brand(this, 'CborTag');
  }

  value: any;

  tag: number | bigint;

  constructor(value: any, tag: number | bigint) {
    this.value = value;
    this.tag = tag;
  }
}
