import '@testing-library/jest-dom';
import 'fake-indexeddb/auto';
// eslint-disable-next-line no-restricted-imports -- test environment shim, never bundled
import { webcrypto } from 'crypto';

// jsdom provides a `crypto` global without `subtle`, so every WebCrypto call this plugin
// makes would fail. Node exposes the same API, which is what the browser will run.
if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
}
