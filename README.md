<p align="center">
  <a href="https://strica.io/" target="_blank">
    <img src="https://docs.strica.io/images/logo.png" width="200">
  </a>
</p>

# @stricahq/cbors

[![npm](https://img.shields.io/npm/v/@stricahq/cbors.svg)](https://www.npmjs.com/package/@stricahq/cbors)
[![downloads](https://img.shields.io/npm/dm/@stricahq/cbors.svg)](https://www.npmjs.com/package/@stricahq/cbors)
[![node](https://img.shields.io/node/v/@stricahq/cbors.svg)](https://nodejs.org)
[![dependencies](https://img.shields.io/badge/dependencies-0-brightgreen.svg)](https://github.com/StricaHQ/cbors/blob/master/package.json)
[![license](https://img.shields.io/npm/l/@stricahq/cbors.svg)](./LICENSE)

CBOR ([RFC 8949](https://www.rfc-editor.org/rfc/rfc8949)) encoder and decoder for JavaScript, with no dependencies.

The thing that makes it different is what it remembers. Most decoders hand you a value and throw the encoding away. cbors can hand you an annotation tree instead: every item, primitives included, still knows which bytes it came from. That matters on Cardano, where a transaction is hashed and signed over its exact bytes and re-encoding a decoded value is not guaranteed to give you those bytes back.

## v2 is a breaking change

v2 is not a drop-in upgrade. It is ESM-only and needs Node >= 22.12, and the API, the number type, and the byte type all changed, so v1 code will not run unchanged against it. [Migrating from v1](#migrating-from-v1) lists every change and its replacement.

Moving to v2 is the recommended path: it is faster than v1 (see [Benchmarks](#benchmarks)), carries no dependencies and no Node.js builtins, and it will get new features and fixes from here on.

### Staying on v1

v1 remains on npm and keeps working. Pin the major version to stay there:

```sh
yarn add @stricahq/cbors@1
```

```html
<script src="https://cdn.jsdelivr.net/npm/@stricahq/cbors@1/dist/index.min.js"></script>
```

v1 is a CJS + ESM dual package, runs on older Node, and uses `bignumber.js` and `Buffer`. Everything below documents v2.

## Installation

### yarn/npm

```sh
yarn add @stricahq/cbors
```

### Browser

```html
<script src="https://cdn.jsdelivr.net/npm/@stricahq/cbors/dist/index.min.js"></script>

// access the cbors global variable
```

cbors has no dependencies and uses no Node.js builtins, so bundlers need no polyfills or aliases for it.

## Quick start

```js
import { encode, decode } from "@stricahq/cbors";

const bytes = encode(new Map().set(0, [1, 2])); // Uint8Array a1 00 82 01 02
const value = decode(bytes);                    // Map(1) { 0 => [ 1, 2 ] }
```

`decode` returns the value directly, and throws if the input holds anything other than exactly one complete CBOR item.

That is the whole surface for simple work. Everything else the package exports:

```js
import {
  encode,             // value  -> Uint8Array
  decode,             // bytes  -> value
  decodeAnnotated,    // bytes  -> CborNode tree, keeps the original bytes of every item
  IncrementalDecoder, // push chunks, get items as they complete
  CborTag,            // a tagged value
  SimpleValue,        // a simple value other than true/false/null/undefined
  EncodedCbor,        // pre-encoded bytes to splice into the output as-is
  IndefiniteArray,    // Array subclass that encodes in indefinite form
  IndefiniteMap,      // Map subclass that encodes in indefinite form
} from "@stricahq/cbors";
```

For more examples, the [tests](https://github.com/StricaHQ/cbors/tree/master/tests) cover every supported data type.

## What decodes to what

```js
decode(bytes);
```

| CBOR | you get |
|---|---|
| integer within ±2^53 | `number` |
| integer beyond ±2^53 | `bigint` |
| bignum (tags 2 and 3) | `bigint` |
| float16 / float32 / float64 | `number` |
| byte string | `Uint8Array` |
| text string | `string` |
| array | `Array`, or `IndefiniteArray` if it was indefinite |
| map | `Map`, or `IndefiniteMap` if it was indefinite |
| any other tag | `CborTag { tag, value }` |
| `true` / `false` / `null` / `undefined` | the same, unwrapped |
| any other simple value | `SimpleValue { value }` |

Maps always come back as a `Map`, never a plain object, because CBOR keys are not limited to strings. A decoded byte string is a zero-copy view into the buffer you passed in, so it stays valid as long as that buffer does.

```js
encode(value);
```

| you pass | you get |
|---|---|
| `number`, integral | integer, in the smallest head that fits |
| `number`, fractional | float64 |
| `NaN`, `±Infinity`, `-0` | the two-byte float16 forms |
| `bigint` | integer if it fits in 64 bits, else a bignum tag |
| `string` | text string |
| `Uint8Array`, `Buffer`, `ArrayBuffer`, `Uint8ClampedArray` | byte string |
| `Array` / `IndefiniteArray` | definite / indefinite array |
| `Map` / `IndefiniteMap` | definite / indefinite map |
| plain object | map with text keys |
| `CborTag` | tagged item |
| `SimpleValue` | simple value |
| `EncodedCbor` | its bytes, spliced in untouched |
| `Date`, `Set`, `RegExp`, other typed arrays, functions, symbols | throws |

Anything the encoder cannot represent faithfully throws rather than being silently mangled into a map of its fields. Note that an integral `number` always encodes as an integer, so `1.0` goes out as `01`, and floats are never shrunk to half or single precision. If you need a specific float encoding on the wire, splice it in with `EncodedCbor`.

Indefinite-length arrays and maps survive a full round trip: they decode to `IndefiniteArray` / `IndefiniteMap`, which encode back to indefinite form.

```js
import { IndefiniteArray } from "@stricahq/cbors";

const list = new IndefiniteArray();
list.push(1, 2);
encode(list);                       // 9f 01 02 ff
encode(decode(encode(list)));       // 9f 01 02 ff, still indefinite
```

Indefinite byte and text strings are the exception: they decode to a single joined `Uint8Array` / `string`, so a re-encode produces the definite form. If you need those bytes back exactly, use the annotation tree below.

## Cardano

Everything on Cardano is hashed and signed over exact CBOR bytes, and a value has more than one valid encoding. The integer 23 can be written as `17` or as `1817`. An array can be definite or indefinite. Both are legal, both decode to the same thing, and they hash to different values. So decoding a transaction and encoding it again is not a safe way to move it around: you may get different bytes, and different bytes mean a different transaction id or a broken signature.

cbors handles both directions of this problem: `decodeAnnotated` on the way in, `EncodedCbor` on the way out.

### The annotation tree

`decodeAnnotated` returns a `CborNode` tree instead of a plain value. Every item carries its `kind`, its byte `span` in the source buffer, and the head-byte `encoding` info. `node.bytes` is a zero-copy slice of the original bytes of that item, header included.

So a transaction id is the hash of the body node's bytes:

```js
import { decodeAnnotated } from "@stricahq/cbors";

// tx = [body, witnessSet, isValid, auxiliaryData]
const tx = decodeAnnotated(txBytes);
const txId = blake2b256(tx.at(0).bytes); // any hash function
```

`tx.at(0).bytes` is the same stretch of memory as in `txBytes`, so the hash matches the on-chain id. The same trick covers datum hashes, script integrity hashes and anything else hashed over original bytes.

Walking a node:

- `node.at(k)` — array index, or the value of the first map entry whose key matches `k`. Keys can be a number/bigint (they cross-match), a string, a bool, or a `Uint8Array` matched by content. Returns a `CborNode` or `undefined`.
- `node.bytes` — the exact source bytes for this item, header included.
- `node.toJS()` — the plain `decode()` value for this subtree (joins indefinite chunks, collapses bignum tags, last-wins for duplicate keys).
- `node.kind` — `uint`, `nint`, `bytes`, `text`, `array`, `map`, `tag`, `simple`, `float`, `bool`, `null` or `undefined`.
- `node.value` — the payload of a leaf. For a byte string that is the bytes *without* the header, unlike `node.bytes`.
- `node.items` — array children. `node.entries` — map entries, keeping order **and** duplicate keys. `node.chunks` — the pieces of an indefinite byte/text string. `node.child` — a tag's payload.
- `node.span` — `[start, end)` offsets into the input. `node.encoding` — `{ ai, indefinite }`, the head byte's additional info and whether the item was indefinite.

Reading a couple of fields out of a transaction body:

```js
const body = tx.at(0);
const fee = body.at(2).toJS();  // body key 2 is the fee

const inputs = body.at(0);      // body key 0 is the inputs
// since Conway, sets arrive wrapped in tag 258
const inputItems = inputs.kind === "tag" ? inputs.child.items : inputs.items;
```

`decodeAnnotated` is one-shot: spans are offsets into a single contiguous buffer.

### Splicing pre-encoded bytes with EncodedCbor

`EncodedCbor` wraps a buffer that already holds one encoded CBOR item, and the encoder writes those bytes into the output untouched instead of re-encoding them. Any bytes, from anywhere, at any position in the value you are encoding.

```js
import { encode, EncodedCbor } from "@stricahq/cbors";

const raw = encode(new Map().set(1, 2).set(3, 4)); // a2 01 02 03 04, from wherever

encode(new EncodedCbor(raw));      // a2 01 02 03 04, spliced in as-is
encode(raw);                       // 45 a2 01 02 03 04, a Uint8Array is a byte string
encode([1, new EncodedCbor(raw)]); // 82 01 a2 01 02 03 04, nests like any other value
```

Pair it with `node.bytes` from the annotation tree and you can rebuild a transaction with one subtree replaced, while every untouched subtree keeps its original bytes. Attaching a witness set from a CIP-30 wallet is exactly that:

```js
import { decodeAnnotated, encode, EncodedCbor } from "@stricahq/cbors";

const tx = decodeAnnotated(txBytes);
const witnessSet = await api.signTx(txHex, true); // CIP-30, hex string

const signedTx = encode([
  new EncodedCbor(tx.at(0).bytes),      // body, spliced verbatim, its hash unchanged
  new EncodedCbor(toBytes(witnessSet)), // fresh witness set from the wallet
  true,                                 // isValid
  null,                                 // auxiliaryData
]);
```

The buffer can come from anywhere: a wallet, a node, a cache, a slice of an annotation tree. It is spliced as given and never re-parsed or validated, so it has to be exactly one well-formed item.

cbors ships no hex helper of its own. Anything that produces a `Uint8Array` works: `Buffer.from(hex, "hex")` on Node, `Uint8Array.fromHex(hex)` on runtimes that have it, or whichever hex utility your project already uses.

## Tags

Tags are first class in both directions. Anything cbors does not fold into a native value decodes to a `CborTag`, and a `CborTag` encodes back to the same tag number and payload.

```js
import { encode, decode, CborTag } from "@stricahq/cbors";

const bytes = encode(new CborTag([1, 2, 3], 258)); // d9 0102 83 01 02 03

const tagged = decode(bytes);
tagged.tag;     // 258
tagged.value;   // [1, 2, 3], the payload decoded normally
encode(tagged); // the same bytes back
```

There is no tag registry and no way to register a decoder for a tag: cbors gives you the number and the payload, and your code decides what it means. The one exception is bignums, tags 2 and 3, which decode straight to `bigint` because there is no lossless way to hand them back otherwise.

Tag numbers are supported over the full CBOR range, up to 2^64 - 1. Numbers beyond 2^53 come back as a `bigint` and can be passed back to `encode` the same way.

Tags you will meet on Cardano:

| Tag | Used for | In cbors |
|---|---|---|
| 2, 3 | bignums | decode to `bigint`; `encode` emits them when a `bigint` exceeds 64 bits |
| 24 | a byte string that holds another CBOR item | `new CborTag(bytes, 24)`; the payload stays a `Uint8Array`, run `decode` on it yourself if you want the value |
| 30 | rational numbers, e.g. protocol parameters | `new CborTag([numerator, denominator], 30)` |
| 258 | sets, since Conway | `new CborTag(items, 258)` |
| 121-127, 1280-1400, 102 | Plutus data constructors | plain `CborTag`, the alternative is in the tag number |

Decimal fractions (tag 4) work the same way, built explicitly:

```js
encode(new CborTag([-1, 15], 4)); // c4 82 20 0f, i.e. 15 * 10^-1
```

## Streaming

`IncrementalDecoder` is a dependency-free push decoder for a stream of concatenated CBOR items, a chain-sync feed or a file of blocks. Feed it chunks as they arrive; each `push` returns the top-level items that completed in that chunk, as `{ value, bytes }`. Chunk boundaries can fall anywhere, including in the middle of an item. Call `end()` when the input is done, and it throws if the stream stopped mid-item.

```js
import { IncrementalDecoder } from "@stricahq/cbors";

const decoder = new IncrementalDecoder();
socket.on("data", (chunk) => {
  for (const { value, bytes } of decoder.push(chunk)) {
    // one entry per completed top-level item
  }
});
socket.on("end", () => decoder.end());
```

To `.pipe()` it into a Node.js stream, wrap it in a `Transform`: `push` each chunk on `transform`, and `end` on `flush`. The decoder stays dependency-free; you bring the stream glue.

```js
import { createReadStream } from "node:fs";
import { Transform } from "node:stream";
import { IncrementalDecoder } from "@stricahq/cbors";

const decoder = new IncrementalDecoder();
const decodeStream = new Transform({
  readableObjectMode: true,
  transform(chunk, _enc, cb) {
    try {
      for (const item of decoder.push(chunk)) this.push(item);
      cb();
    } catch (err) {
      cb(err);
    }
  },
  flush(cb) {
    try {
      decoder.end();
      cb();
    } catch (err) {
      cb(err);
    }
  },
});

createReadStream("stream.cbor")
  .pipe(decodeStream)
  .on("data", ({ value, bytes }) => {
    // one entry per completed top-level item
  });
```

## Options

Options are plain objects and always optional.

`decode(bytes, options)`, `decodeAnnotated(bytes, options)` and `new IncrementalDecoder(options)` take the same decoder options:

| Option | Default | What it does |
|---|---|---|
| `maxDepth` | `1024` | Rejects items nested deeper than this. Deep nesting is what a hostile input uses to blow the stack. |
| `maxStringLength` | `4294967295` | Rejects a byte or text string, or an indefinite chunk, that declares a length above this. Stops a two-byte header from asking for a gigabyte allocation. This is also the ceiling: a larger value is clamped to it. |

```js
decode(bytes, { maxDepth: 32, maxStringLength: 1 << 20 });
```

`encode(value, options)`:

| Option | Default | What it does |
|---|---|---|
| `collapseBigInt` | `true` | Writes a `bigint` as a plain integer when it fits in 64 bits. Set it to `false` to always emit a bignum tag. |

```js
encode(10n);                             // 0a
encode(10n, { collapseBigInt: false });  // c2 41 0a
```

### What the decoder rejects

The decoder is strict about well-formedness, and throws a plain `Error` rather than guessing:

- trailing bytes after the item, or an item that ends early
- reserved additional info 28-30
- indefinite length on a major type that has no indefinite form
- indefinite string chunks of the wrong major type, or themselves indefinite
- text strings that are not valid UTF-8
- two-byte simple values below 32, which RFC 8949 forbids
- anything past `maxDepth` or `maxStringLength`

## Benchmarks

Real Cardano CBOR data, single threaded.

| Workload | Size | `decode` | `decodeAnnotated` | `encode` | `IncrementalDecoder` |
|---|---|---|---|---|---|
| Smallest tx | 193 B | 351 MB/s | 266 MB/s | 200 MB/s | 172 MB/s |
| Median tx | 576 B | 521 MB/s | 411 MB/s | 287 MB/s | 303 MB/s |
| Largest tx | 16.0 kB | 410 MB/s | 748 MB/s | 612 MB/s | 404 MB/s |
| Full block (1 item, 15 txs) | 86.9 kB | 386 MB/s | 627 MB/s | 586 MB/s | 321 MB/s |
| 32 random blocks (32 items, 191 txs) | 162.4 kB | 358 MB/s | 331 MB/s | 272 MB/s | 266 MB/s |

A median 576 B transaction decodes in about 1.1 µs, a full 87 kB block in about 0.22 ms. `decodeAnnotated` tracks plain `decode` closely, and runs ahead of it on large map-heavy items.

Measured on an Apple M1 Pro, Node 24.13.0.

## Migrating from v1

| v1 | v2 |
|---|---|
| `Encoder.encode(x)` | `encode(x)` |
| `Decoder.decode(x).value` | `decode(x)` (returns the value directly) |
| `getCborBytes(buf, item)` / byte spans | `decodeAnnotated(buf)` → `node.at(...).bytes` |
| `hasByteSpan` / `Spanned` guards | annotation tree carries spans for every item |
| `new Decoder()` Transform stream | `new IncrementalDecoder()` (`push` / `end`) |
| BigNumber (via `bignumber.js`) | native `bigint` (BigNumber inputs now throw) |
| `collapseBigNumber` encode option | `collapseBigInt` |
| decimal fractions via BigNumber | `new CborTag([exponent, mantissa], 4)` |
| `Buffer` in and out | `Uint8Array` out; `Buffer` still accepted as input |
| `buffer` polyfill for browsers | no dependencies, no Node.js builtins |
| CJS + ESM dual package | ESM only, `require(esm)` on Node >= 22.12 |

## API Doc

Find the API documentation [here](https://docs.strica.io/lib/cbors).

# License
Copyright 2022 Strica

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
