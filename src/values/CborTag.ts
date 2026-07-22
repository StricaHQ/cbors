export default class CborTag {
  value: any;

  tag: number | bigint;

  constructor(value: any, tag: number | bigint) {
    this.value = value;
    this.tag = tag;
  }
}
