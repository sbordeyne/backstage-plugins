import { createApiRef } from '@backstage/core-plugin-api';
import type {
  KubespecChange,
  KubespecChangeSummary,
  KubespecChangeType,
  KubespecMetadata,
  KubespecPaginated,
  KubespecResourceDefinition,
  KubespecResourceEnvelope,
  KubespecResourceListResponse,
  KubespecSearchResponse,
  KubespecSearchScope,
  KubespecSourceSummary,
  KubespecVersionSummary,
} from '@sbordeyne/kubespec-common';

import type { ResourceRef } from '../lib/paths';

export interface SignalOption {
  signal?: AbortSignal;
}

export interface ListResourcesRequest extends SignalOption {
  sourceId: string;
  /** May be the literal `latest`. */
  sourceVersion: string;
}

export interface ResourceRequest extends SignalOption {
  ref: ResourceRef;
}

export interface ListChangesRequest extends ResourceRequest {
  changeType?: KubespecChangeType;
  limit?: number;
  cursor?: string;
}

export interface SearchRequest extends SignalOption {
  query: string;
  sourceId?: string;
  sourceVersion?: string;
  scope?: KubespecSearchScope;
  limit?: number;
  cursor?: string;
}

export interface MetadataRequest extends SignalOption {
  sourceId: string;
  apiVersionFull: string;
  kind: string;
}

export interface KubespecApi {
  listSources(options?: SignalOption): Promise<KubespecSourceSummary[]>;

  listVersions(
    request: { sourceId: string; limit?: number; cursor?: string } & SignalOption,
  ): Promise<KubespecPaginated<KubespecVersionSummary>>;

  listResources(request: ListResourcesRequest): Promise<KubespecResourceListResponse>;

  /** Everything about a kind except its schema. */
  getResource(request: ResourceRequest): Promise<KubespecResourceEnvelope>;

  /**
   * The expanded schema.
   *
   * A request of its own so the backend can serve the gzip it stored without
   * decompressing it, and so the page can paint the envelope while this is still
   * in flight.
   */
  getSchema(request: ResourceRequest): Promise<KubespecResourceDefinition>;

  listChangeSummaries(request: ResourceRequest): Promise<KubespecChangeSummary[]>;

  listChanges(request: ListChangesRequest): Promise<KubespecPaginated<KubespecChange>>;

  search(request: SearchRequest): Promise<KubespecSearchResponse>;

  getMetadata(request: MetadataRequest): Promise<KubespecMetadata>;

  /**
   * Asks the backend to run a sync now.
   *
   * Returns as soon as the task is queued, not when it finishes: a full ingest
   * takes minutes, and the page has nothing to wait for. `alreadyRunning` means
   * the scheduler declined because a sync is in flight, which satisfies the
   * request rather than failing it.
   */
  triggerSync(options?: SignalOption & { force?: boolean }): Promise<{ triggered: boolean; alreadyRunning?: boolean }>;
}

export const kubespecApiRef = createApiRef<KubespecApi>({
  id: 'plugin.kubespec.service',
});
