import type { KubespecResourceRef } from './resources';
import type { KubespecScope } from './schema';

export type KubespecSearchScope = 'all' | 'kinds' | 'properties';

export interface KubespecResourceHit extends KubespecResourceRef {
  sourceSlug: string;
  sourceName: string;
  sourceVersion: string;
  category: string;
  scope: KubespecScope;
  description: string;
}

export interface KubespecPropertyHit extends KubespecResourceRef {
  sourceSlug: string;
  sourceVersion: string;
  /** Dotted, with a leading dot: `.spec.template.spec.containers`. */
  path: string;
  type: string;
  isArray: boolean;
  required: boolean;
  description: string;
}

export interface KubespecSearchResponse {
  resources: KubespecResourceHit[];
  properties: KubespecPropertyHit[];
  /**
   * The version property hits actually came from, set when it is not the version
   * that was asked for. Only the newest version of a source is indexed by default,
   * so answering from it beats returning nothing — but the UI has to say so.
   */
  propertiesFromVersion?: string;
  nextCursor?: string;
}
