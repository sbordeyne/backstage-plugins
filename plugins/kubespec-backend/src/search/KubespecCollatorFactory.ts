import type { LoggerService } from '@backstage/backend-plugin-api';
import type { DocumentCollatorFactory, IndexableDocument } from '@backstage/plugin-search-common';
import { Readable } from 'stream';

import type { KubespecStore } from '../database/KubespecStore';
import { resourceLocation } from './location';

/** One kind, as the portal's global search sees it. */
export interface KubespecIndexableDocument extends IndexableDocument {
  sourceSlug: string;
  sourceName: string;
  sourceVersion: string;
  apiVersionFull: string;
  kind: string;
  category: string;
  scope: string;
}

export interface KubespecCollatorFactoryOptions {
  store: KubespecStore;
  logger: LoggerService;
}

/**
 * Feeds kinds into the portal's global search.
 *
 * Only the newest version of each source is indexed, and only kinds — never
 * property paths. Property paths would be roughly two hundred thousand documents
 * per Kubernetes version, multiplied by every version stored, to answer a
 * question the plugin's own filter box already answers instantly from a schema
 * that is in the browser anyway.
 */
export class KubespecCollatorFactory implements DocumentCollatorFactory {
  readonly type = 'kubespec';

  private constructor(private readonly options: KubespecCollatorFactoryOptions) {}

  static fromConfig(options: KubespecCollatorFactoryOptions): KubespecCollatorFactory {
    return new KubespecCollatorFactory(options);
  }

  async getCollator(): Promise<Readable> {
    return Readable.from(this.execute());
  }

  private async *execute(): AsyncGenerator<KubespecIndexableDocument> {
    const { store, logger } = this.options;
    let indexed = 0;

    for (const source of await store.listSources()) {
      const latest = await store.resolveVersion(source.slug);
      if (!latest) {
        continue;
      }

      for (const resource of await store.listResources(latest.id)) {
        indexed += 1;
        yield {
          title: `${resource.kind} (${resource.apiVersionFull})`,
          text: resource.description,
          location: resourceLocation({
            sourceSlug: source.slug,
            group: resource.group,
            apiVersion: resource.apiVersion,
            kind: resource.kind,
          }),
          sourceSlug: source.slug,
          sourceName: source.name,
          sourceVersion: latest.version,
          apiVersionFull: resource.apiVersionFull,
          kind: resource.kind,
          category: resource.category,
          scope: resource.scope,
        };
      }
    }

    logger.info(`Kubespec indexed ${indexed} kind(s) for search`);
  }
}
