import { expect } from 'chai';
import * as _ from 'lodash';
import { BigNumber } from 'bignumber.js';
import {
  CborTag,
  Decoder,
  EncodedCbor,
  Encoder,
  getCborBytes,
  hasByteSpan,
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

  it('SimpleValue byteSpan', () => {
    const oneByte = Decoder.decode(Buffer.from('ef', 'hex')).value as SimpleValue;
    expect(oneByte.value).to.eq(15);
    expect(deepEql(oneByte.getByteSpan(), [0, 1])).eq(true);

    const twoByte = Decoder.decode(Buffer.from('f8ff', 'hex')).value as SimpleValue;
    expect(twoByte.value).to.eq(255);
    expect(deepEql(twoByte.getByteSpan(), [0, 2])).eq(true);

    const nested = Decoder.decode(Buffer.from('81f8ff', 'hex')).value;
    expect(deepEql(nested[0].getByteSpan(), [1, 3])).eq(true);
  });

  it('byteSpan properties are non-enumerable', () => {
    const decodedBuffer = Decoder.decode(Buffer.from('42aabb', 'hex')).value as Buffer;
    expect(Object.keys(decodedBuffer)).to.not.include('byteSpan');
    expect(Object.keys(decodedBuffer)).to.not.include('getByteSpan');
    // decoded buffers deep-equal plain buffers of the same content
    expect(deepEql(decodedBuffer, Buffer.from('aabb', 'hex'))).eq(true);

    const decodedBigNum = Decoder.decode(Buffer.from('c249010000000000000000', 'hex')).value;
    expect(Object.keys(decodedBigNum)).to.not.include('byteSpan');
    expect(Object.keys(decodedBigNum)).to.not.include('getByteSpan');
  });

  it('getByteSpan getter is shared across decoded values', () => {
    const a = Decoder.decode(Buffer.from('42aabb', 'hex')).value as any;
    const b = Decoder.decode(Buffer.from('42ccdd', 'hex')).value as any;
    expect(a.getByteSpan).to.eq(b.getByteSpan);
  });

  it('hasByteSpan type guard', () => {
    const decode = (hex: string) => Decoder.decode(Buffer.from(hex, 'hex')).value;
    expect(hasByteSpan(decode('a10001'))).eq(true); // map
    expect(hasByteSpan(decode('8100'))).eq(true); // array
    expect(hasByteSpan(decode('d86600'))).eq(true); // tag
    expect(hasByteSpan(decode('42aabb'))).eq(true); // bytes
    expect(hasByteSpan(decode('c249010000000000000000'))).eq(true); // bignum
    expect(hasByteSpan(decode('ef'))).eq(true); // simple value

    expect(hasByteSpan(decode('0a'))).eq(false); // small int
    expect(hasByteSpan(decode('66417368697368'))).eq(false); // text string
    expect(hasByteSpan(decode('f5'))).eq(false); // bool
    expect(hasByteSpan(decode('f6'))).eq(false); // null
    expect(hasByteSpan(decode('fb4009000000000000'))).eq(false); // float
  });

  it('getCborBytes returns original sub-encoding', () => {
    // {0: [h'AA', h'BB']}
    const original = Buffer.from('a1008241aa41bb', 'hex');
    const decoded = Decoder.decode(original).value;

    expect(getCborBytes(original, decoded).toString('hex')).to.eq('a1008241aa41bb');

    const nestedArray = decoded.get(0);
    expect(getCborBytes(original, nestedArray).toString('hex')).to.eq('8241aa41bb');
    expect(getCborBytes(original, nestedArray[0]).toString('hex')).to.eq('41aa');

    // accepts the chunk array shape emitted by the streaming decoder
    const chunks = [original.subarray(0, 3), original.subarray(3)];
    expect(getCborBytes(chunks, nestedArray).toString('hex')).to.eq('8241aa41bb');
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

  it('EncodedCbor splices pre-encoded bytes verbatim', () => {
    const raw = Buffer.from('a201020304', 'hex'); // {1: 2, 3: 4}

    // spliced as-is, unlike a plain Buffer which gets a byte string header
    expect(Encoder.encode(new EncodedCbor(raw)).toString('hex')).eq('a201020304');
    expect(Encoder.encode(raw).toString('hex')).eq('45a201020304');

    // nested inside arrays and maps
    const strAshish = new EncodedCbor(Buffer.from('66417368697368', 'hex'));
    expect(Encoder.encode([1, strAshish, 2]).toString('hex')).eq('83016641736869736802');
    expect(Encoder.encode(new Map().set(1, new EncodedCbor(raw))).toString('hex')).eq(
      'a101a201020304'
    );

    // preserves a non-canonical representation that re-encoding would normalize
    expect(Encoder.encode(23).toString('hex')).eq('17');
    expect(Encoder.encode(new EncodedCbor(Buffer.from('1817', 'hex'))).toString('hex')).eq('1817');

    // spliced output decodes as the embedded item
    const decoded = Decoder.decode(Encoder.encode([new EncodedCbor(raw)])).value;
    expect(deepEql(decoded[0], new Map().set(1, 2).set(3, 4))).eq(true);
  });

  it('Encode bigint', () => {
    expect(Encoder.encode(BigInt(10)).toString('hex')).eq('0a');
    expect(Encoder.encode(BigInt(-10)).toString('hex')).eq('29');
    expect(Encoder.encode(BigInt(1000000000000)).toString('hex')).eq('1b000000e8d4a51000');
    expect(Encoder.encode(BigInt('18446744073709551615')).toString('hex')).eq('1bffffffffffffffff');
    expect(Encoder.encode(BigInt('-18446744073709551616')).toString('hex')).eq(
      '3bffffffffffffffff'
    );
    // beyond 64-bit falls back to bignum tags
    expect(Encoder.encode(BigInt('18446744073709551616')).toString('hex')).eq(
      'c249010000000000000000'
    );
    expect(Encoder.encode(BigInt('-18446744073709551617')).toString('hex')).eq(
      'c349010000000000000000'
    );
    expect(
      Encoder.encode(BigInt('1000000000000000000000'), { collapseBigNumber: false }).toString('hex')
    ).eq('c2493635c9adc5dea00000');
    // round trip through the decoder's BigNumber representation
    const decoded = Decoder.decode(Encoder.encode(BigInt('18446744073709551616')))
      .value as BigNumber;
    expect(decoded.toFixed()).eq('18446744073709551616');
  });

  it('Encode throws for unsupported types instead of corrupting', () => {
    const unsupported: Array<[string, any]> = [
      ['Date', new Date()],
      ['Set', new Set([1, 2])],
      ['WeakMap', new WeakMap()],
      ['RegExp', /x/],
      ['Error', new Error('x')],
      ['Promise', Promise.resolve()],
      ['boxed Number', Object(5)],
      ['Float32Array', new Float32Array([1.5])],
      ['Int8Array', new Int8Array([1])],
      ['DataView', new DataView(new ArrayBuffer(1))],
      ['function', () => 1],
      ['symbol', Symbol('x')],
    ];
    for (const [name, v] of unsupported) {
      expect(() => Encoder.encode(v), name).to.throw('Unsupported type');
    }
    // plain objects, Maps and the byte-string family still encode
    expect(Encoder.encode({ a: 1 }).toString('hex')).eq('a1616101');
    expect(Encoder.encode(new Uint8Array([1])).toString('hex')).eq('4101');
    expect(Encoder.encode(new Uint8ClampedArray([1])).toString('hex')).eq('4101');
  });

  it('Encode options merge with defaults', () => {
    expect(Encoder.encode(new BigNumber(5)).toString('hex')).eq('05');
    expect(Encoder.encode(new BigNumber(5), {}).toString('hex')).eq('05');
    expect(Encoder.encode(new BigNumber(5), { collapseBigNumber: false }).toString('hex')).eq(
      'c24105'
    );
  });

  it('Tag numbers beyond 2^53 round trip', () => {
    const hex = 'dbffffffffffffffff00';
    const decoded = Decoder.decode(Buffer.from(hex, 'hex')).value as CborTag;
    expect(BigNumber.isBigNumber(decoded.tag)).eq(true);
    expect(Encoder.encode(decoded).toString('hex')).eq(hex);
    // tag numbers needing 8 bytes but below 2^53 still work
    expect(Encoder.encode(new CborTag(0, 4294967296)).toString('hex')).eq('db000000010000000000');
    expect(() => Encoder.encode(new CborTag(0, -1))).to.throw('Invalid tag number');
    expect(() => Encoder.encode(new CborTag(0, 1.5))).to.throw('Invalid tag number');
  });

  it('Decode rejects ill-formed two-byte simple values', () => {
    expect(() => Decoder.decode(Buffer.from('f800', 'hex'))).to.throw('Invalid two-byte simple');
    expect(() => Decoder.decode(Buffer.from('f818', 'hex'))).to.throw('Invalid two-byte simple');
    expect(() => Decoder.decode(Buffer.from('f81f', 'hex'))).to.throw('Invalid two-byte simple');
    expect((Decoder.decode(Buffer.from('f820', 'hex')).value as SimpleValue).value).eq(32);
  });

  it('Decode rejects indefinite text chunks that are not valid UTF-8 alone', () => {
    // "ü" (c3bc) split across two chunks
    expect(() => Decoder.decode(Buffer.from('7f61c361bcff', 'hex'))).to.throw();
    // valid chunks still concatenate
    expect(Decoder.decode(Buffer.from('7f62c3bc6161ff', 'hex')).value).eq('üa');
  });

  it('Decode rejects unsatisfiable declared lengths fast', () => {
    expect(() => Decoder.decode(Buffer.from('5bffffffffffffffff', 'hex'))).to.throw(
      'exceeds maximum'
    );
    expect(() => Decoder.decode(Buffer.from('7b0020000000000000', 'hex'))).to.throw(
      'exceeds maximum'
    );
    expect(() => Decoder.decode(Buffer.from('9bffffffffffffffff', 'hex'))).to.throw(
      'Invalid array length'
    );
    expect(() => Decoder.decode(Buffer.from('bbffffffffffffffff', 'hex'))).to.throw(
      'Invalid map length'
    );
    // configurable per-string cap
    expect(() => Decoder.decode(Buffer.from('4401020304', 'hex'), { maxStringLength: 3 })).to.throw(
      'exceeds maximum'
    );
    expect(
      Decoder.decode(Buffer.from('4401020304', 'hex'), { maxStringLength: 4 }).value.length
    ).eq(4);
  });

  it('Decode enforces max nesting depth', () => {
    const nested = (depth: number) =>
      Buffer.concat([Buffer.alloc(depth, 0x81), Buffer.from([0x00])]);
    expect(() => Decoder.decode(nested(2000))).to.throw('Maximum depth exceeded');
    expect(Decoder.decode(nested(1000)).value).to.be.an('array');
    expect(() => Decoder.decode(nested(5), { maxDepth: 3 })).to.throw('Maximum depth exceeded');
    expect(Decoder.decode(nested(3), { maxDepth: 3 }).value).to.be.an('array');
  });

  it('Truncated input throws Insufficient data', () => {
    expect(() => Decoder.decode(Buffer.from('4401', 'hex'))).to.throw('Insufficient data');
    expect(() => Decoder.decode(Buffer.alloc(0))).to.throw('Insufficient data');
  });

  it('Stream errors instead of hanging on absurd declared string length', (done) => {
    const decoder = new Decoder();
    decoder.on('data', () => done(new Error('should not decode')));
    decoder.on('error', (e: Error) => {
      expect(e.message).to.contain('exceeds maximum');
      done();
    });
    decoder.write(Buffer.from('5bffffffffffffffff', 'hex'));
  });

  it('Stream decode of a large item split into small chunks', (done) => {
    const payload = Buffer.alloc(1024 * 1024, 0xaa);
    const item = Buffer.concat([Buffer.from('5a00100000', 'hex'), payload]);
    const decoder = new Decoder();
    decoder.on('data', (data: any) => {
      expect(Buffer.isBuffer(data.value)).eq(true);
      expect(data.value.length).eq(payload.length);
      expect(data.value.equals(payload)).eq(true);
      expect(Buffer.concat(data.bytes).equals(item)).eq(true);
      done();
    });
    decoder.on('error', done);
    for (let off = 0; off < item.length; off += 2048) {
      decoder.write(item.slice(off, off + 2048));
    }
    decoder.end();
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
