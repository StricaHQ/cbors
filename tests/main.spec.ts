import { expect } from 'chai';
import * as _ from 'lodash';
import { BigNumber } from 'bignumber.js';
import {
  CborTag,
  Decoder,
  Encoder,
  IndefiniteArray,
  IndefiniteMap,
  SimpleValue,
} from '../src/index';

const deepEql = _.isEqual;

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
  byteSpan: [number, number];
  indefiniteSupport?: boolean;
  tag?: number;
  isBigNumber?: boolean;
};

const tests: Array<TestCase> = [
  { name: 'unsigned 0', cbor: '00', value: 0, byteSpan: [0, 1] },
  { name: 'unsigned 10', cbor: '0a', value: 10, byteSpan: [0, 1] },
  { name: 'unsigned8 25', cbor: '1819', value: 25, byteSpan: [0, 2] },
  { name: 'unsigned16 1000', cbor: '1903e8', value: 1000, byteSpan: [0, 2] },
  { name: 'unsigned32 1000000', cbor: '1a000f4240', value: 1000000, byteSpan: [0, 6] },
  {
    name: 'unsigned64 1000000000000',
    cbor: '1b000000e8d4a51000',
    value: 1000000000000,
    byteSpan: [0, 9],
  },
  {
    name: 'BigNumber64 18446744073709551615',
    cbor: '1bffffffffffffffff',
    value: new BigNumber('18446744073709551615'),
    byteSpan: [0, 9],
  },
  { name: 'negative -1', cbor: '20', value: -1, byteSpan: [0, 1] },
  { name: 'negative -10', cbor: '29', value: -10, byteSpan: [0, 1] },
  { name: 'negative -25', cbor: '3818', value: -25, byteSpan: [0, 2] },
  { name: 'negative16 -1000', cbor: '3903e7', value: -1000, byteSpan: [0, 2] },
  { name: 'negative32 -1000000', cbor: '3a000f423f', value: -1000000, byteSpan: [0, 5] },
  {
    name: 'negative64 1000000000000',
    cbor: '3b000000e8d4a50fff',
    value: -1000000000000,
    byteSpan: [0, 9],
  },
  {
    name: 'NegativeBigNumber64 -18446744073709551616',
    cbor: '3bffffffffffffffff',
    value: new BigNumber('-18446744073709551616'),
    byteSpan: [0, 9],
  },
  { name: "bytes ''", cbor: '40', value: Buffer.alloc(0), byteSpan: [0, 1] },
  {
    name: 'bytes 0x01020304',
    cbor: '4401020304',
    value: Buffer.from('01020304', 'hex'),
    byteSpan: [0, 5],
  },
  {
    name: 'bytes 0x010203040506070809100a0b0c0d0e0f11121314151617181920',
    cbor: '581a010203040506070809100a0b0c0d0e0f11121314151617181920',
    value: Buffer.from('010203040506070809100A0B0C0D0E0F11121314151617181920', 'hex'),
    byteSpan: [0, 28],
  },
  {
    name: 'indefinite bytes 0x0102030405',
    cbor: '5f42010243030405ff',
    value: Buffer.from('0102030405', 'hex'),
    indefiniteSupport: true,
    byteSpan: [0, 9],
  },
  { name: "string ''", cbor: '60', value: '', byteSpan: [0, 1] },
  { name: "string 'Ashish'", cbor: '66417368697368', value: 'Ashish', byteSpan: [0, 7] },
  {
    name: "Indefinite 'Ashish'",
    cbor: '7f6a496E646566696E69746566417368697368ff',
    value: 'IndefiniteAshish',
    indefiniteSupport: true,
    byteSpan: [0, 20],
  },
  { name: 'array []', cbor: '80', value: [], byteSpan: [0, 1] },
  {
    name: 'array [].26',
    cbor: '981a0101010101010101010101010101010101010101010101010101',
    value: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
    byteSpan: [0, 28],
  },
  {
    name: "Array ['a', {'b': 'c'}]",
    cbor: '826161a161626163',
    value: ['a', new Map().set('b', 'c')],
    byteSpan: [0, 8],
  },
  { name: 'IndefiniteArray []', cbor: '9fff', value: emptyIndefiniteArray, byteSpan: [0, 2] },
  { name: 'IndefiniteArray [1, 2]', cbor: '9f0102ff', value: indefiniteArray, byteSpan: [0, 4] },
  { name: 'Map {}', cbor: 'a0', value: new Map(), byteSpan: [0, 1] },
  {
    name: 'Map {1: 2, 3: 4}',
    cbor: 'a201020304',
    value: new Map().set(1, 2).set(3, 4),
    byteSpan: [0, 5],
  },
  { name: 'IndefiniteMap {}', cbor: 'bfff', value: emptyIndefiniteMap, byteSpan: [0, 2] },
  {
    name: 'IndefiniteMap {1: 2, 3: 4}',
    cbor: 'bf01020304ff',
    value: indefiniteMap,
    byteSpan: [0, 6],
  },
  {
    name: 'Tagged [123, []]',
    cbor: 'd86682187b80',
    value: [123, []],
    tag: 102,
    byteSpan: [0, 6],
  },
  {
    name: 'Bignumber Tagged 1000000000000000000000',
    cbor: 'c2493635c9adc5dea00000',
    value: new BigNumber('1000000000000000000000'),
    byteSpan: [0, 11],
    tag: 2,
  },
  {
    name: 'Bignumber Tagged -1000000000000000000000000',
    cbor: 'c3493635c9adc5de9fffff',
    value: new BigNumber('-1000000000000000000000'),
    byteSpan: [0, 11],
    tag: 3,
  },
];

describe('cbors', (): void => {
  before(async () => {});

  for (const test of tests) {
    it(`Decode ${test.name}`, () => {
      const decoded = Decoder.decode(Buffer.from(test.cbor, 'hex')).value as any;
      if (BigNumber.isBigNumber(decoded)) {
        expect(decoded.eq(test.value)).eq(true);
      } else if (decoded instanceof Buffer) {
        expect(decoded.compare(test.value)).eq(0);
      } else if (decoded instanceof Array || decoded instanceof Map) {
        expect(deepEql(decoded, test.value)).eq(true);
      } else if (test.tag) {
        const dValue = JSON.parse(JSON.stringify(decoded.value));
        expect(deepEql(dValue, test.value)).eq(true);
      } else {
        expect(decoded).eq(test.value);
      }
      if (typeof decoded !== 'number' && typeof decoded !== 'string') {
        const span = decoded.getByteSpan();
        expect(deepEql(span, test.byteSpan)).eq(true);
      }
    });
    it(`Encode ${test.value}`, () => {
      // indefinite encoded not supported for some types
      let encoded;
      if (!test.indefiniteSupport) {
        if (test.tag) {
          if (BigNumber.isBigNumber(test.value)) {
            encoded = Encoder.encode(test.value, { collapseBigNumber: false }).toString('hex');
          } else {
            const value = new CborTag(test.value, test.tag);
            encoded = Encoder.encode(value).toString('hex');
          }
        } else if (BigNumber.isBigNumber(test.value)) {
          encoded = Encoder.encode(test.value).toString('hex');
        } else {
          encoded = Encoder.encode(test.value).toString('hex');
        }
        expect(encoded).eq(test.cbor);
      }
    });
  }

  it('Indefinite Array byteSpan', () => {
    const indAryItems = Buffer.from('9fa10001a10101a10200ff', 'hex');
    const decoded = Decoder.decode(indAryItems).value;
    const firstByteSpan = decoded[0].getByteSpan();
    expect(firstByteSpan[0]).to.eq(1);
    expect(firstByteSpan[1]).to.eq(4);

    const secondByteSpan = decoded[1].getByteSpan();
    expect(secondByteSpan[0]).to.eq(4);
    expect(secondByteSpan[1]).to.eq(7);
  });

  it('Indefinite Buffer byteSpan', () => {
    // indef buffer containing 2 def buffers
    const indBuf = Buffer.from(
      '5f5840697066733a2f2f626166796265696571616c727875627969737734326c696472327a746b68677767686563783571746b7173726f32793769696b6e6935797168426365ff',
      'hex'
    );
    const decoded = Decoder.decode(indBuf).value;
    const byteSpan = decoded.getByteSpan();
    expect(byteSpan[0]).to.eq(0);
    expect(byteSpan[1]).to.eq(71);
  });

  it('Indefinite Map byteSpan', () => {
    const indMapItems = Buffer.from('bf00a1000101a1010102a10200ff', 'hex');
    const decoded = Decoder.decode(indMapItems).value;
    const firstByteSpan = decoded.get(0).getByteSpan();
    expect(firstByteSpan[0]).to.eq(2);
    expect(firstByteSpan[1]).to.eq(5);

    const secondByteSpan = decoded.get(1).getByteSpan();
    expect(secondByteSpan[0]).to.eq(6);
    expect(secondByteSpan[1]).to.eq(9);
  });

  it('Decode negative and special float16', () => {
    expect(Decoder.decode(Buffer.from('f9c400', 'hex')).value).eq(-4);
    expect(Object.is(Decoder.decode(Buffer.from('f98000', 'hex')).value, -0)).eq(true);
    expect(Decoder.decode(Buffer.from('f98001', 'hex')).value).eq(-5.960464477539063e-8);
    expect(Decoder.decode(Buffer.from('f97c00', 'hex')).value).eq(Infinity);
    expect(Decoder.decode(Buffer.from('f9fc00', 'hex')).value).eq(-Infinity);
    expect(Number.isNaN(Decoder.decode(Buffer.from('f97e00', 'hex')).value)).eq(true);
    expect(Decoder.decode(Buffer.from('f93c00', 'hex')).value).eq(1);
  });

  it('Encode integers beyond ±2^53 exactly as integers', () => {
    expect(Encoder.encode(2 ** 60).toString('hex')).eq('1b1000000000000000');
    expect(Encoder.encode(-(2 ** 60)).toString('hex')).eq('3b0fffffffffffffff');
    expect(Encoder.encode([2 ** 60, 1]).toString('hex')).eq('821b100000000000000001');

    const encoded = Encoder.encode(45000000000000000);
    expect(encoded[0]).eq(0x1b); // unsigned int major type, not a float
    const roundTripped = Decoder.decode(encoded).value as BigNumber;
    expect(roundTripped.toString()).eq('45000000000000000');

    // beyond 2^64 falls back to bignum tags
    expect(Encoder.encode(2 ** 70).toString('hex')).eq('c249400000000000000000');
    expect(Encoder.encode(-(2 ** 70)).toString('hex')).eq('c3493fffffffffffffffff');
  });

  it('Encode non-finite numbers', () => {
    expect(Encoder.encode(Infinity).toString('hex')).eq('f97c00');
    expect(Encoder.encode(-Infinity).toString('hex')).eq('f9fc00');
    expect(Encoder.encode(NaN).toString('hex')).eq('f97e00');
    expect(Encoder.encode(new BigNumber(Infinity)).toString('hex')).eq('f97c00');
    expect(Encoder.encode(new BigNumber(-Infinity)).toString('hex')).eq('f9fc00');
    expect(Object.is(Decoder.decode(Encoder.encode(-0)).value, -0)).eq(true);
  });

  it('SimpleValue round trip', () => {
    const decoded = Decoder.decode(Buffer.from('f0', 'hex')).value;
    expect(decoded instanceof SimpleValue).eq(true);
    expect(decoded.value).eq(16);
    expect(Encoder.encode(decoded).toString('hex')).eq('f0');
    expect(Encoder.encode(new SimpleValue(255)).toString('hex')).eq('f8ff');
    expect(() => Encoder.encode(new SimpleValue(24))).to.throw('Invalid simple value');
    expect(() => Encoder.encode(new SimpleValue(300))).to.throw('Invalid simple value');
  });

  it('Stream decode zero-length bytes and string', (done) => {
    const decoder = new Decoder();
    const results: any[] = [];
    decoder.on('data', (data: any) => results.push(data.value));
    decoder.on('error', done);
    decoder.on('end', () => {
      expect(results.length).eq(3);
      expect(Buffer.isBuffer(results[0])).eq(true);
      expect(results[0].length).eq(0);
      expect(results[1]).eq('');
      expect(results[2]).eq(1);
      done();
    });
    decoder.write(Buffer.from('40', 'hex')); // empty byte string
    decoder.write(Buffer.from('60', 'hex')); // empty text string
    decoder.write(Buffer.from('01', 'hex')); // unsigned 1
    decoder.end();
  });
});
