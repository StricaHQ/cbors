<p align="center">
  <a href="https://strica.io/" target="_blank">
    <img src="https://docs.strica.io/images/logo.png" width="200">
  </a>
</p>

# @stricahq/cbors

CBOR ([RFC 8949](https://www.rfc-editor.org/rfc/rfc8949)) encoder and decoder for JavaScript. It keeps an annotation tree on decode so you can recover the exact original bytes of any decoded item instead of re-encoding it. That matters on Cardano, where hashes are taken over the original bytes.

> **v2** is ESM-only and needs Node >= 22.12. `Encoder.encode`/`Decoder.decode` become the top-level `encode`/`decode`, big integers are native `bigint` instead of `bignumber.js`, and bytes are `Uint8Array` instead of `Buffer`. See [Migrating from v1](#migrating-from-v1).

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

For v1, pin the major version:

```html
<script src="https://cdn.jsdelivr.net/npm/@stricahq/cbors@1/dist/index.min.js"></script>
```

## Usage

```js
import { encode, decode } from "@stricahq/cbors";

const bytes = encode(new Map().set(0, [1, 2]));
const value = decode(bytes); // Map(1) { 0 => [ 1, 2 ] }
```

`decode` returns the value directly. Integers outside ±2^53 and bignum tags (2/3) decode to `bigint`, and `encode` takes `bigint` natively. Indefinite-length arrays and maps decode to `IndefiniteArray` / `IndefiniteMap`, so indefiniteness survives a decode/encode round trip.

Everything is `Uint8Array`: what `encode` gives you, what byte strings decode to, what `node.bytes` points at. Node's `Buffer` is a `Uint8Array`, so passing one in still works.

For more examples, the [tests](https://github.com/StricaHQ/cbors/tree/master/tests) cover every supported data type.

## Cardano

On Cardano everything is hashed and signed over exact CBOR bytes. Decode a transaction and encode it again and you may not get the same bytes back, and different bytes produce a different hash. cbors covers both sides of this: the annotation tree on decode, and `EncodedCbor` on encode.

### Annotation tree

`decodeAnnotated` returns a `CborNode` tree instead of a plain value. Every item, primitives included, carries its `kind`, its byte `span` in the source buffer, and head-byte `encoding` info. `node.bytes` is a zero-copy slice of the original bytes of any nested item, so to compute a transaction id you decode the transaction, walk to the body, and hash its bytes:

```js
import { decodeAnnotated } from "@stricahq/cbors";

// tx = [body, witnessSet, isValid, auxiliaryData]
const tx = decodeAnnotated(txBytes);
const bodyBytes = tx.at(0).bytes;
const txId = blake2b256(bodyBytes); // any hash function
```

`bodyBytes` is the same stretch of bytes as in `txBytes`, so the hash matches the on-chain transaction id. The same works for datum hashes, script integrity hashes, and anything else hashed over original bytes.

Navigating a `CborNode`:

- `node.at(k)` — array index, or the value of the first map entry whose key matches `k` (a number/bigint cross-match, a string, a bool, or a `Uint8Array` matched by content). Returns a `CborNode` or `undefined`.
- `node.bytes` — the exact source bytes for this item, header included.
- `node.toJS()` — the plain `decode()` value for this subtree (joins indefinite chunks, collapses bignum tags, last-wins for duplicate keys).
- `node.items` holds array children; `node.entries` holds map entries preserving order **and** duplicate keys; `node.chunks` holds the pieces of an indefinite byte/text string.

`decodeAnnotated` is one-shot only: spans are offsets into a single contiguous buffer.

### EncodedCbor and byte-exact editing

Sometimes you already hold a piece of valid CBOR as raw bytes and just need to nest it inside a larger value. Decoding it only to re-encode it can change those bytes, and different bytes mean a different hash or a broken signature. `EncodedCbor` wraps such a buffer and the encoder splices it into the output as-is instead of re-encoding it.

The buffer can come from anywhere, a wallet or a slice of the annotation tree. Pairing `EncodedCbor` with `node.bytes` gives you byte-exact editing: decode a transaction, then rebuild it with one subtree replaced while every untouched subtree keeps its original bytes. Attaching a CIP-30 witness set is exactly that:

```js
import { decodeAnnotated, encode, EncodedCbor } from "@stricahq/cbors";

const tx = decodeAnnotated(txBytes);
const witnessSet = await api.signTx(txHex, true); // CIP-30, hex string

const signedTx = encode([
  new EncodedCbor(tx.at(0).bytes),           // body — spliced byte-for-byte, its hash unchanged
  new EncodedCbor(toBytes(witnessSet)),      // fresh witness set from the wallet
  true,                                      // isValid
  null,                                      // auxiliaryData
]);
```

cbors ships no hex helper of its own. Anything that produces a `Uint8Array` works: `Buffer.from(hex, "hex")` on Node, `Uint8Array.fromHex(hex)` on runtimes that have it, or whichever hex utility your project already uses.

## Streaming

`IncrementalDecoder` is a dependency-free push decoder. Feed it CBOR a chunk at a time, and each `push` returns the top-level items that completed in that chunk as `{ value, bytes }`. Call `end()` when the input is done; it throws if the stream ended mid-item.

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
const decode = new Transform({
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
  .pipe(decode)
  .on("data", ({ value, bytes }) => {
    // one entry per completed top-level item
  });
```

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
