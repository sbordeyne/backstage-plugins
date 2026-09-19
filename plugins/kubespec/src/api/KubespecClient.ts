import type { DiscoveryApi, FetchApi } from '@backstage/core-plugin-api';
import { ResponseError } from '@backstage/errors';
import type {
  KubespecChange,
  KubespecChangeSummary,
  KubespecMetadata,
  KubespecPaginated,
  KubespecResourceDefinition,
  KubespecResourceEnvelope,
  KubespecResourceListResponse,
  KubespecSearchResponse,
  KubespecSourceSummary,
  KubespecVersionSummary,
} from '@sbordeyne/kubespec-common';

import { encodeGroupSegment } from '../lib/paths';
import type {
  KubespecApi,
  ListChangesRequest,
  ListResourcesRequest,
  MetadataRequest,
  ResourceRequest,
  SearchRequest,
  SignalOption,
} from './KubespecApi';

/**
 * Schemas are immutable for a given version, and a reader walks back and forth
 * between kinds, so a modest cache makes revisiting one free.
 */
const SCHEMA_CACHE_MAX_ENTRIES = 25;

type QueryParams = Record<string, string | number | undefined>;

export class KubespecClient implements KubespecApi {
  readonly #schemaCache = new Map<string, Promise<KubespecResourceDefinition>>();

  constructor(private readonly discoveryApi: DiscoveryApi, private readonly fetchApi: FetchApi) {}

  async listSources(options: SignalOption = {}): Promise<KubespecSourceSummary[]> {
    const response = await this.get<{ items: KubespecSourceSummary[] }>('/v1/sources', {}, options.signal);
    return response.items;
  }

  async listVersions(
    request: { sourceId: string; limit?: number; cursor?: string } & SignalOption,
  ): Promise<KubespecPaginated<KubespecVersionSummary>> {
    return this.get(
      '/v1/versions',
      {
        source: request.sourceId,
        limit: request.limit,
        cursor: request.cursor,
      },
      request.signal,
    );
  }

  async listResources(request: ListResourcesRequest): Promise<KubespecResourceListResponse> {
    return this.get('/v1/resources', { source: request.sourceId, version: request.sourceVersion }, request.signal);
  }

  async getResource(request: ResourceRequest): Promise<KubespecResourceEnvelope> {
    return this.get('/v1/resource', resourceParams(request), request.signal);
  }

  /**
   * Deliberately takes no AbortSignal: the promise is shared between every caller
   * for the same schema, so one of them aborting would break the others.
   */
  async getSchema(request: ResourceRequest): Promise<KubespecResourceDefinition> {
    const key = schemaKey(request);
    const cached = this.#schemaCache.get(key);
    if (cached) {
      return cached;
    }

    const pending = this.get<KubespecResourceDefinition>('/v1/resource/schema', resourceParams(request)).catch(
      error => {
        // Never cache a rejection — the reader has to be able to retry.
        this.#schemaCache.delete(key);
        throw error;
      },
    );

    if (this.#schemaCache.size >= SCHEMA_CACHE_MAX_ENTRIES) {
      const oldest = this.#schemaCache.keys().next().value;
      if (oldest !== undefined) {
        this.#schemaCache.delete(oldest);
      }
    }
    this.#schemaCache.set(key, pending);
    return pending;
  }

  async listChangeSummaries(request: ResourceRequest): Promise<KubespecChangeSummary[]> {
    const response = await this.get<{ items: KubespecChangeSummary[] }>(
      '/v1/changes/summary',
      resourceParams(request),
      request.signal,
    );
    return response.items;
  }

  async listChanges(request: ListChangesRequest): Promise<KubespecPaginated<KubespecChange>> {
    return this.get(
      '/v1/changes',
      { ...resourceParams(request), type: request.changeType, limit: request.limit, cursor: request.cursor },
      request.signal,
    );
  }

  async search(request: SearchRequest): Promise<KubespecSearchResponse> {
    return this.get(
      '/v1/search',
      {
        q: request.query,
        source: request.sourceId,
        version: request.sourceVersion,
        scope: request.scope,
        limit: request.limit,
        cursor: request.cursor,
      },
      request.signal,
    );
  }

  async getMetadata(request: MetadataRequest): Promise<KubespecMetadata> {
    return this.get(
      '/v1/metadata',
      { source: request.sourceId, apiVersion: request.apiVersionFull, kind: request.kind },
      request.signal,
    );
  }

  async triggerSync(
    options: SignalOption & { force?: boolean } = {},
  ): Promise<{ triggered: boolean; alreadyRunning?: boolean }> {
    return this.post(`/v1/sync${options.force ? '?force=true' : ''}`, options.signal);
  }

  private async post<T>(path: string, signal?: AbortSignal): Promise<T> {
    const baseUrl = await this.discoveryApi.getBaseUrl('kubespec');
    const response = await this.fetchApi.fetch(`${baseUrl}${path}`, { method: 'POST', signal });

    if (!response.ok) {
      throw await ResponseError.fromResponse(response);
    }

    return (await response.json()) as T;
  }

  private async get<T>(path: string, params: QueryParams, signal?: AbortSignal): Promise<T> {
    const baseUrl = await this.discoveryApi.getBaseUrl('kubespec');
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== '') {
        query.set(key, String(value));
      }
    }

    const queryString = query.toString();
    const response = await this.fetchApi.fetch(`${baseUrl}${path}${queryString ? `?${queryString}` : ''}`, {
      signal,
    });

    if (!response.ok) {
      // Carries the backend's name/message/stack through to ResponseErrorPanel.
      throw await ResponseError.fromResponse(response);
    }

    return (await response.json()) as T;
  }
}

/**
 * The group travels as `core` rather than as an empty parameter: an empty query
 * value is dropped by the serializer above, and the backend would then fall back
 * to its own default rather than being told the group is the core one.
 */
function resourceParams(request: ResourceRequest): QueryParams {
  return {
    source: request.ref.sourceId,
    version: request.ref.sourceVersion,
    group: encodeGroupSegment(request.ref.group),
    apiVersion: request.ref.apiVersion,
    kind: request.ref.kind,
  };
}

function schemaKey(request: ResourceRequest): string {
  const { sourceId, sourceVersion, group, apiVersion, kind } = request.ref;
  return [sourceId, sourceVersion, group, apiVersion, kind].join('|');
}
