<p align="center">
  <a href="https://strica.io/" target="_blank">
    <img src="https://docs.strica.io/images/logo.png" width="200">
  </a>
</p>

# @stricahq/cbors
CBOR ([RFC 7049](http://tools.ietf.org/html/rfc7049)) encoder and decoder for javascript data types, with streaming support. Built with Cardano in mind, where you often need the exact original bytes of a decoded item rather than a re-encoding of it.

## Installation

### yarn/npm

```sh
yarn add @stricahq/cbors
```

### Browser

```html
<script src="https://cdn.jsdelivr.net/npm/@stricahq/cbors/dist/index.min.js"></script>

// access cbors global variable
```

## Usage

```js
import { Encoder, Decoder } from "@stricahq/cbors";

const encoded = Encoder.encode(new Map().set(0, [1, 2]));
const { value } = Decoder.decode(encoded);
```

The examples in this readme are kept short, the [tests](https://github.com/StricaHQ/cbors/tree/master/tests) cover all supported data types and are the best place to look for more.

## Cardano

Everything on Cardano is hashed and signed over exact CBOR bytes. Decode a transaction and encode it again and there is no guarantee you get the same bytes back, and different bytes mean a different hash. cbors deals with this in two ways: byte spans on decoded values, and `EncodedCbor` on the encoding side.

### Byte spans

Decoded maps, arrays, tags, byte strings, bignums and simple values remember where they came from in the original buffer. `getCborBytes` uses that to hand you the exact original bytes of any nested item. So to compute a transaction id, decode the transaction, grab the body bytes and hash them:

```js
import { Decoder, getCborBytes } from "@stricahq/cbors";

const tx = Decoder.decode(txBytes).value;
const bodyBytes = getCborBytes(txBytes, tx[0]);
const txId = blake2b256(bodyBytes);
```

These are the same bytes as in `txBytes`, so the hash matches the on-chain transaction id. Same idea for datum hashes, script integrity hashes and anything else hashed over original bytes.

Values that decode to plain JS primitives (numbers, text strings, booleans, null) can't carry a span, use the `hasByteSpan` guard to check. Spans are non-enumerable, they won't show up when you iterate or serialize decoded values.

### EncodedCbor and CIP-30

A CIP-30 wallet hands you pre-encoded CBOR, `api.signTx` returns a witness set as cbor hex. Those bytes have to go into the final transaction untouched, decoding and re-encoding the witness set can change the bytes and break the signatures. Wrap an already encoded item in `EncodedCbor` and the encoder writes it to the output as is:

```js
import { Encoder, EncodedCbor } from "@stricahq/cbors";

const witnessSet = Buffer.from(await api.signTx(txHex, true), "hex");
const signedTx = Encoder.encode([
  new EncodedCbor(bodyBytes),
  new EncodedCbor(witnessSet),
  true,
  null,
]);
```

## Streaming

`Decoder` is a Node.js Transform stream. Write CBOR in whatever chunks you have and it emits `{ bytes, value }` for every complete top-level item. `bytes` is an array of buffers making up the item's original encoding, you can pass it straight to `getCborBytes`.

```js
import { Decoder } from "@stricahq/cbors";

const decoder = new Decoder();
decoder.on("data", ({ bytes, value }) => {
  // one event per decoded item
});
socket.pipe(decoder);
```

## API Doc
Find the API documentation [here](https://docs.strica.io/lib/cbors)

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
