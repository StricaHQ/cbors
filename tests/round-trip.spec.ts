import { describe, it, expect } from 'vitest';
import * as _ from 'lodash';
import {
  CborTag,
  decode,
  encode as baseEncode,
  IndefiniteArray,
  IndefiniteMap,
  SimpleValue,
} from '../src/index';

const deepEql = _.isEqual;
// encode() returns a plain Uint8Array; wrap it as a Buffer so these tests can
// keep asserting via .toString('hex')
const encode = (value: any, options?: any): Buffer => Buffer.from(baseEncode(value, options));

const emptyIndefiniteArray = new IndefiniteArray();
const indefiniteArray = new IndefiniteArray();
indefiniteArray.push(1);
indefiniteArray.push(2);
const emptyIndefiniteMap = new IndefiniteMap();
const indefiniteMap = new IndefiniteMap().set(1, 2).set(3, 4);

type TestCase = {
  name: string;
  cbor: string;
  value: any;
  // encoder can't reproduce these (indefinite byte/text strings collapse on decode)
  decodeOnly?: boolean;
  // generic (non-bignum) tag: decoded is a CborTag, encoded from one
  tag?: number;
};

const tests: Array<TestCase> = [
  { name: 'unsigned 0', cbor: '00', value: 0 },
  { name: 'unsigned 10', cbor: '0a', value: 10 },
  { name: 'unsigned8 25', cbor: '1819', value: 25 },
  { name: 'unsigned16 1000', cbor: '1903e8', value: 1000 },
  { name: 'unsigned32 1000000', cbor: '1a000f4240', value: 1000000 },
  { name: 'unsigned64 1000000000000', cbor: '1b000000e8d4a51000', value: 1000000000000 },
  {
    name: 'bigint64 18446744073709551615',
    cbor: '1bffffffffffffffff',
    value: 18446744073709551615n,
  },
  { name: 'negative -1', cbor: '20', value: -1 },
  { name: 'negative -10', cbor: '29', value: -10 },
  { name: 'negative -25', cbor: '3818', value: -25 },
  { name: 'negative16 -1000', cbor: '3903e7', value: -1000 },
  { name: 'negative32 -1000000', cbor: '3a000f423f', value: -1000000 },
  { name: 'negative64 1000000000000', cbor: '3b000000e8d4a50fff', value: -1000000000000 },
  {
    name: 'negativeBigint64 -18446744073709551616',
    cbor: '3bffffffffffffffff',
    value: -18446744073709551616n,
  },
  { name: "bytes ''", cbor: '40', value: Buffer.alloc(0) },
  { name: 'bytes 0x01020304', cbor: '4401020304', value: Buffer.from('01020304', 'hex') },
  {
    name: 'bytes 0x010203040506070809100a0b0c0d0e0f11121314151617181920',
    cbor: '581a010203040506070809100a0b0c0d0e0f11121314151617181920',
    value: Buffer.from('010203040506070809100A0B0C0D0E0F11121314151617181920', 'hex'),
  },
  {
    name: 'indefinite bytes 0x0102030405',
    cbor: '5f42010243030405ff',
    value: Buffer.from('0102030405', 'hex'),
    decodeOnly: true,
  },
  { name: "string ''", cbor: '60', value: '' },
  { name: "string 'Ashish'", cbor: '66417368697368', value: 'Ashish' },
  {
    name: "Indefinite 'Ashish'",
    cbor: '7f6a496E646566696E69746566417368697368ff',
    value: 'IndefiniteAshish',
    decodeOnly: true,
  },
  { name: 'array []', cbor: '80', value: [] },
  {
    name: 'array [].26',
    cbor: '981a0101010101010101010101010101010101010101010101010101',
    value: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
  },
  {
    name: "Array ['a', {'b': 'c'}]",
    cbor: '826161a161626163',
    value: ['a', new Map().set('b', 'c')],
  },
  { name: 'IndefiniteArray []', cbor: '9fff', value: emptyIndefiniteArray },
  { name: 'IndefiniteArray [1, 2]', cbor: '9f0102ff', value: indefiniteArray },
  { name: 'Map {}', cbor: 'a0', value: new Map() },
  { name: 'Map {1: 2, 3: 4}', cbor: 'a201020304', value: new Map().set(1, 2).set(3, 4) },
  { name: 'IndefiniteMap {}', cbor: 'bfff', value: emptyIndefiniteMap },
  { name: 'IndefiniteMap {1: 2, 3: 4}', cbor: 'bf01020304ff', value: indefiniteMap },
  { name: 'Tagged [123, []]', cbor: 'd86682187b80', value: [123, []], tag: 102 },
  {
    name: 'Bignum Tagged 1000000000000000000000',
    cbor: 'c2493635c9adc5dea00000',
    value: 1000000000000000000000n,
  },
  {
    name: 'Bignum Tagged -1000000000000000000000',
    cbor: 'c3493635c9adc5de9fffff',
    value: -1000000000000000000000n,
  },
  { name: 'float64 1.1', cbor: 'fb3ff199999999999a', value: 1.1 },
  { name: 'float64 -4.1', cbor: 'fbc010666666666666', value: -4.1 },
];

describe('encode/decode round trip', (): void => {
  for (const test of tests) {
    it(`Decode ${test.name}`, () => {
      const decoded = decode(Buffer.from(test.cbor, 'hex')) as any;
      if (typeof test.value === 'bigint') {
        expect(decoded).eq(test.value);
      } else if (decoded instanceof Uint8Array) {
        expect(Buffer.from(decoded).equals(test.value)).eq(true);
      } else if (test.tag) {
        expect((decoded as CborTag).tag).eq(test.tag);
        expect(deepEql((decoded as CborTag).value, test.value)).eq(true);
      } else if (decoded instanceof Array || decoded instanceof Map) {
        expect(deepEql(decoded, test.value)).eq(true);
        // indefiniteness survives decode
        expect(decoded instanceof IndefiniteArray).eq(test.value instanceof IndefiniteArray);
        expect(decoded instanceof IndefiniteMap).eq(test.value instanceof IndefiniteMap);
      } else {
        expect(decoded).eq(test.value);
      }
    });
    if (!test.decodeOnly) {
      it(`Encode ${test.name}`, () => {
        const value = test.tag ? new CborTag(test.value, test.tag) : test.value;
        expect(encode(value).toString('hex')).eq(test.cbor);
      });
    }
  }

  it('Indefinite array/map survive decode → encode', () => {
    for (const hex of ['9fff', '9f0102ff', 'bfff', 'bf01020304ff']) {
      expect(encode(decode(Buffer.from(hex, 'hex'))).toString('hex')).eq(hex);
    }
    // definite forms stay definite
    expect(encode(decode(Buffer.from('820102', 'hex'))).toString('hex')).eq('820102');
    expect(encode(decode(Buffer.from('a201020304', 'hex'))).toString('hex')).eq('a201020304');
    // and nesting in either direction is preserved
    for (const hex of ['9f018202039f0102ffff', '829fff9fff', '81bf0102ff']) {
      expect(encode(decode(Buffer.from(hex, 'hex'))).toString('hex')).eq(hex);
    }
  });

  it('SimpleValue round trip', () => {
    const decoded = decode(Buffer.from('f0', 'hex'));
    expect(decoded instanceof SimpleValue).eq(true);
    expect(decoded.value).eq(16);
    expect(encode(decoded).toString('hex')).eq('f0');
    expect(encode(new SimpleValue(255)).toString('hex')).eq('f8ff');
    expect(() => encode(new SimpleValue(24))).to.throw('Invalid simple value');
    expect(() => encode(new SimpleValue(300))).to.throw('Invalid simple value');
  });

  it('Tag numbers beyond 2^53 round trip', () => {
    const hex = 'dbffffffffffffffff00';
    const decoded = decode(Buffer.from(hex, 'hex')) as CborTag;
    expect(typeof decoded.tag).eq('bigint');
    expect(encode(decoded).toString('hex')).eq(hex);
    // tag numbers needing 8 bytes but below 2^53 still work
    expect(encode(new CborTag(0, 4294967296)).toString('hex')).eq('db000000010000000000');
    expect(() => encode(new CborTag(0, -1))).to.throw('Invalid tag number');
    expect(() => encode(new CborTag(0, 1.5))).to.throw('Invalid tag number');
    // bigint tag numbers are bounded the same way
    expect(() => encode(new CborTag(0, -1n))).to.throw('Invalid tag number');
    expect(() => encode(new CborTag(0, 18446744073709551616n))).to.throw('Invalid tag number');
  });
});
