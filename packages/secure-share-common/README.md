# @sbordeyne/secure-share-common

Shared code for the `secure-share` plugin pair (`plugins/secure-share` and
`plugins/secure-share-backend`).

Holds the things that both sides must agree on exactly:

- **Wire types** — request and response shapes of the `secure-share` backend API.
- **Config reader** — `readSecureShareSharedConfig`, the frontend visible part of the
  `secureShare:` config block (card limit, expiration bounds, size limits). Both sides
  read it from the same code so the browser's pre-flight checks match what the backend
  enforces.
- **Key fingerprints** — `canonicalizePublicKeyForThumbprint` builds the RFC 7638
  canonical JWK string. The browser hashes it with WebCrypto and the backend with
  `node:crypto`, so a fingerprint shown to a sender is comparable to the one stored
  server side. Duplicating this canonicalization would silently break key pinning.

No crypto is performed here, and nothing in this package touches plaintext.
