import { createApiRef, DiscoveryApi, FetchApi } from '@backstage/core-plugin-api';
import { ResponseError } from '@backstage/errors';
import {
  CreatePasteRequest,
  CreatePasteResponse,
  DeviceKeySummary,
  EnrollDeviceKeyRequest,
  PasteReadEntry,
  PasteReadResponse,
  PasteSummary,
  ResolveRecipientsRequest,
  ResolveRecipientsResponse,
  SharedPaste,
} from '@sbordeyne/secure-share-common';

const LINK_TOKEN_HEADER = 'x-secure-share-link-token';

/**
 * Client for the `secure-share` backend.
 *
 * Every method here deals in ciphertext, public keys and wrapped keys only. No plaintext
 * and no private key material is ever passed to the backend.
 *
 * @public
 */
export interface SecureShareApi {
  enrollDeviceKey(request: EnrollDeviceKeyRequest): Promise<DeviceKeySummary>;
  listDeviceKeys(): Promise<DeviceKeySummary[]>;
  revokeDeviceKey(deviceKeyId: string): Promise<void>;
  resolveRecipients(request: ResolveRecipientsRequest): Promise<ResolveRecipientsResponse>;

  createPaste(request: CreatePasteRequest): Promise<CreatePasteResponse>;
  uploadChunk(options: { pasteId: string; index: number; data: Uint8Array }): Promise<void>;
  finalizePaste(pasteId: string): Promise<void>;
  listSharedWithMe(options: { deviceKeyId: string; limit?: number }): Promise<SharedPaste[]>;
  listMyPastes(): Promise<PasteSummary[]>;
  readPaste(options: { pasteId: string; deviceKeyId: string }): Promise<PasteReadResponse>;
  fetchChunk(options: { pasteId: string; index: number; deviceKeyId: string }): Promise<Uint8Array>;
  readLinkedPaste(options: { pasteId: string; linkToken: string }): Promise<PasteReadResponse>;
  fetchLinkedChunk(options: { pasteId: string; index: number; linkToken: string }): Promise<Uint8Array>;
  listPasteReads(pasteId: string): Promise<PasteReadEntry[]>;
  deletePaste(pasteId: string): Promise<void>;
}

/** @public */
export const secureShareApiRef = createApiRef<SecureShareApi>({
  id: 'plugin.secure-share.service',
});

interface RequestOptions {
  method: string;
  body?: unknown;
  chunk?: Uint8Array;
  headers?: Record<string, string>;
}

/** @public */
export class SecureShareClient implements SecureShareApi {
  readonly #discoveryApi: DiscoveryApi;
  readonly #fetchApi: FetchApi;

  constructor(options: { discoveryApi: DiscoveryApi; fetchApi: FetchApi }) {
    this.#discoveryApi = options.discoveryApi;
    this.#fetchApi = options.fetchApi;
  }

  async enrollDeviceKey(request: EnrollDeviceKeyRequest): Promise<DeviceKeySummary> {
    return await this.#requestJson<DeviceKeySummary>('/device-keys', { method: 'POST', body: request });
  }

  async listDeviceKeys(): Promise<DeviceKeySummary[]> {
    return await this.#requestJson<DeviceKeySummary[]>('/device-keys', { method: 'GET' });
  }

  async revokeDeviceKey(deviceKeyId: string): Promise<void> {
    await this.#request(`/device-keys/${encodeURIComponent(deviceKeyId)}`, { method: 'DELETE' });
  }

  async resolveRecipients(request: ResolveRecipientsRequest): Promise<ResolveRecipientsResponse> {
    return await this.#requestJson<ResolveRecipientsResponse>('/device-keys/resolve', {
      method: 'POST',
      body: request,
    });
  }

  async createPaste(request: CreatePasteRequest): Promise<CreatePasteResponse> {
    return await this.#requestJson<CreatePasteResponse>('/pastes', { method: 'POST', body: request });
  }

  async uploadChunk(options: { pasteId: string; index: number; data: Uint8Array }): Promise<void> {
    await this.#request(`/pastes/${encodeURIComponent(options.pasteId)}/chunks/${options.index}`, {
      method: 'PUT',
      chunk: options.data,
    });
  }

  async finalizePaste(pasteId: string): Promise<void> {
    await this.#request(`/pastes/${encodeURIComponent(pasteId)}/finalize`, { method: 'POST' });
  }

  async listSharedWithMe(options: { deviceKeyId: string; limit?: number }): Promise<SharedPaste[]> {
    const query = new URLSearchParams({ deviceKeyId: options.deviceKeyId });
    if (options.limit !== undefined) {
      query.set('limit', String(options.limit));
    }
    return await this.#requestJson<SharedPaste[]>(`/pastes/shared-with-me?${query}`, { method: 'GET' });
  }

  async listMyPastes(): Promise<PasteSummary[]> {
    return await this.#requestJson<PasteSummary[]>('/pastes/mine', { method: 'GET' });
  }

  async readPaste(options: { pasteId: string; deviceKeyId: string }): Promise<PasteReadResponse> {
    const query = new URLSearchParams({ deviceKeyId: options.deviceKeyId });
    return await this.#requestJson<PasteReadResponse>(`/pastes/${encodeURIComponent(options.pasteId)}?${query}`, {
      method: 'GET',
    });
  }

  async fetchChunk(options: { pasteId: string; index: number; deviceKeyId: string }): Promise<Uint8Array> {
    const query = new URLSearchParams({ deviceKeyId: options.deviceKeyId });
    return await this.#requestBytes(`/pastes/${encodeURIComponent(options.pasteId)}/chunks/${options.index}?${query}`, {
      method: 'GET',
    });
  }

  async readLinkedPaste(options: { pasteId: string; linkToken: string }): Promise<PasteReadResponse> {
    return await this.#requestJson<PasteReadResponse>(`/link/${encodeURIComponent(options.pasteId)}`, {
      method: 'GET',
      headers: { [LINK_TOKEN_HEADER]: options.linkToken },
    });
  }

  async fetchLinkedChunk(options: { pasteId: string; index: number; linkToken: string }): Promise<Uint8Array> {
    return await this.#requestBytes(`/link/${encodeURIComponent(options.pasteId)}/chunks/${options.index}`, {
      method: 'GET',
      headers: { [LINK_TOKEN_HEADER]: options.linkToken },
    });
  }

  async listPasteReads(pasteId: string): Promise<PasteReadEntry[]> {
    return await this.#requestJson<PasteReadEntry[]>(`/pastes/${encodeURIComponent(pasteId)}/reads`, {
      method: 'GET',
    });
  }

  async deletePaste(pasteId: string): Promise<void> {
    await this.#request(`/pastes/${encodeURIComponent(pasteId)}`, { method: 'DELETE' });
  }

  async #requestJson<T>(path: string, options: RequestOptions): Promise<T> {
    const response = await this.#request(path, options);
    return (await response.json()) as T;
  }

  async #requestBytes(path: string, options: RequestOptions): Promise<Uint8Array> {
    const response = await this.#request(path, options);
    return new Uint8Array(await response.arrayBuffer());
  }

  async #request(path: string, options: RequestOptions): Promise<Response> {
    const baseUrl = await this.#discoveryApi.getBaseUrl('secure-share');
    const response = await this.#fetchApi.fetch(`${baseUrl}${path}`, {
      method: options.method,
      headers: { ...contentTypeHeader(options), ...options.headers },
      body: requestBody(options),
    });
    if (!response.ok) {
      throw await ResponseError.fromResponse(response);
    }
    return response;
  }
}

function contentTypeHeader(options: RequestOptions): Record<string, string> {
  if (options.chunk) {
    return { 'Content-Type': 'application/octet-stream' };
  }
  return options.body ? { 'Content-Type': 'application/json' } : {};
}

function requestBody(options: RequestOptions): BodyInit | undefined {
  if (options.chunk) {
    // Copied into a standalone buffer: a Uint8Array view over a larger buffer would
    // otherwise be sent in full.
    return options.chunk.slice().buffer;
  }
  return options.body ? JSON.stringify(options.body) : undefined;
}
