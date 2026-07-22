import { describe, it, expect } from 'vitest';
import * as _ from 'lodash';
import { decode, getCborBytes, hasByteSpan, SimpleValue } from '../src/index';

const deepEql = _.isEqual;

describe('byte span annotation', (): void => {
  it('Indefinite Array byteSpan', () => {
    const indAryItems = Buffer.from('9fa10001a10101a10200ff', 'hex');
    const decoded = decode(indAryItems).value;
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
    const decoded = decode(indBuf).value;
    const byteSpan = decoded.getByteSpan();
    expect(byteSpan[0]).to.eq(0);
    expect(byteSpan[1]).to.eq(71);
  });

  it('Indefinite Map byteSpan', () => {
    const indMapItems = Buffer.from('bf00a1000101a1010102a10200ff', 'hex');
    const decoded = decode(indMapItems).value;
    const firstByteSpan = decoded.get(0).getByteSpan();
    expect(firstByteSpan[0]).to.eq(2);
    expect(firstByteSpan[1]).to.eq(5);

    const secondByteSpan = decoded.get(1).getByteSpan();
    expect(secondByteSpan[0]).to.eq(6);
    expect(secondByteSpan[1]).to.eq(9);
  });

  it('SimpleValue byteSpan', () => {
    const oneByte = decode(Buffer.from('ef', 'hex')).value as SimpleValue;
    expect(oneByte.value).to.eq(15);
    expect(deepEql(oneByte.getByteSpan(), [0, 1])).eq(true);

    const twoByte = decode(Buffer.from('f8ff', 'hex')).value as SimpleValue;
    expect(twoByte.value).to.eq(255);
    expect(deepEql(twoByte.getByteSpan(), [0, 2])).eq(true);

    const nested = decode(Buffer.from('81f8ff', 'hex')).value;
    expect(deepEql(nested[0].getByteSpan(), [1, 3])).eq(true);
  });

  it('byteSpan properties are non-enumerable', () => {
    const decodedBuffer = decode(Buffer.from('42aabb', 'hex')).value as Buffer;
    expect(Object.keys(decodedBuffer)).to.not.include('byteSpan');
    expect(Object.keys(decodedBuffer)).to.not.include('getByteSpan');
    // decoded buffers deep-equal plain buffers of the same content
    expect(deepEql(decodedBuffer, Buffer.from('aabb', 'hex'))).eq(true);

    const decodedBigNum = decode(Buffer.from('c249010000000000000000', 'hex')).value;
    expect(Object.keys(decodedBigNum)).to.not.include('byteSpan');
    expect(Object.keys(decodedBigNum)).to.not.include('getByteSpan');
  });

  it('getByteSpan getter is shared across decoded values', () => {
    const a = decode(Buffer.from('42aabb', 'hex')).value as any;
    const b = decode(Buffer.from('42ccdd', 'hex')).value as any;
    expect(a.getByteSpan).to.eq(b.getByteSpan);
  });

  it('hasByteSpan type guard', () => {
    const dec = (hex: string) => decode(Buffer.from(hex, 'hex')).value;
    expect(hasByteSpan(dec('a10001'))).eq(true); // map
    expect(hasByteSpan(dec('8100'))).eq(true); // array
    expect(hasByteSpan(dec('d86600'))).eq(true); // tag
    expect(hasByteSpan(dec('42aabb'))).eq(true); // bytes
    expect(hasByteSpan(dec('c249010000000000000000'))).eq(true); // bignum
    expect(hasByteSpan(dec('ef'))).eq(true); // simple value

    expect(hasByteSpan(dec('0a'))).eq(false); // small int
    expect(hasByteSpan(dec('66417368697368'))).eq(false); // text string
    expect(hasByteSpan(dec('f5'))).eq(false); // bool
    expect(hasByteSpan(dec('f6'))).eq(false); // null
    expect(hasByteSpan(dec('fb4009000000000000'))).eq(false); // float
  });

  it('getCborBytes returns original sub-encoding', () => {
    // {0: [h'AA', h'BB']}
    const original = Buffer.from('a1008241aa41bb', 'hex');
    const decoded = decode(original).value;

    expect(getCborBytes(original, decoded).toString('hex')).to.eq('a1008241aa41bb');

    const nestedArray = decoded.get(0);
    expect(getCborBytes(original, nestedArray).toString('hex')).to.eq('8241aa41bb');
    expect(getCborBytes(original, nestedArray[0]).toString('hex')).to.eq('41aa');

    // accepts the chunk array shape emitted by the streaming decoder
    const chunks = [original.subarray(0, 3), original.subarray(3)];
    expect(getCborBytes(chunks, nestedArray).toString('hex')).to.eq('8241aa41bb');
  });
});
