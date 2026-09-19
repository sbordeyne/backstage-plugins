import { createBackend } from '@backstage/backend-defaults';
import { mockServices } from '@backstage/backend-test-utils';

/**
 * Standalone harness for the kubespec backend.
 *
 * Sync is off by default so the plugin starts without GitHub credentials; flip it
 * on and provide a token to exercise a real ingest:
 *
 *   yarn workspace @sbordeyne/backstage-plugin-kubespec-backend start
 *
 *   curl 'http://localhost:7007/api/kubespec/v1/sources'
 *   curl 'http://localhost:7007/api/kubespec/v1/resources?source=kubernetes'
 *   curl 'http://localhost:7007/api/kubespec/v1/resource?source=kubernetes&group=apps&apiVersion=v1&kind=Deployment'
 *   curl --compressed 'http://localhost:7007/api/kubespec/v1/resource/schema?source=kubernetes&group=apps&apiVersion=v1&kind=Deployment'
 *   curl -X POST 'http://localhost:7007/api/kubespec/v1/sync'
 */
const backend = createBackend();

backend.add(mockServices.auth.factory());
backend.add(mockServices.httpAuth.factory());
backend.add(
  mockServices.rootConfig.factory({
    data: {
      backend: { database: { client: 'better-sqlite3', connection: ':memory:' } },
      kubespec: {
        sync: { enabled: false },
        kubernetes: { minors: ['v1.33', 'v1.34'] },
        projects: [
          {
            slug: 'cert-manager',
            name: 'cert-manager',
            repo: 'cert-manager/cert-manager',
            releaseAsset: 'cert-manager.yaml',
            tags: { regex: '^v\\d+\\.\\d+\\.\\d+$', minVersion: 'v1.21.1', max: 3 },
          },
        ],
      },
    },
  }),
);

backend.add(import('../src'));

backend.start();
