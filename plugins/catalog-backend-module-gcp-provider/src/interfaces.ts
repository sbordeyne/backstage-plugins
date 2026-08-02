import { DeferredEntity } from '@backstage/plugin-catalog-node';

export interface GcpCatalogClient {
  getResources: () => Promise<DeferredEntity[]>;
}
