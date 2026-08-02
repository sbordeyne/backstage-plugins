import { createBackend } from '@backstage/backend-defaults';
import { mockServices } from '@backstage/backend-test-utils';
import { catalogServiceMock } from '@backstage/plugin-catalog-node/testUtils';

// Development setup for the Bruno backend plugin. Start it with `yarn start` in
// this package directory, then:
//
//   curl 'http://localhost:7007/api/bruno/v1/runs?entityRef=component:default/sample'
//   curl 'http://localhost:7007/api/bruno/v1/runs/<runId>/results?limit=50'
//   curl 'http://localhost:7007/api/bruno/v1/results/<resultId>'
//   curl -X POST 'http://localhost:7007/api/bruno/v1/sync'
//
// The GCS sync is disabled below because it needs real Application Default
// Credentials. Flip `sync.enabled` to true once you have them.

const backend = createBackend();

// Mocking auth and httpAuth lets the API be called without signing in.
backend.add(mockServices.auth.factory());
backend.add(mockServices.httpAuth.factory());

backend.add(
  mockServices.rootConfig.factory({
    data: {
      bruno: {
        bucket: '1e42-exchange',
        objectPrefix: 'ui_tests/reports/bruno/',
        retention: { runsPerEntity: 20 },
        sync: { enabled: false },
      },
    },
  }),
);

backend.add(
  catalogServiceMock.factory({
    entities: [
      {
        apiVersion: 'backstage.io/v1alpha1',
        kind: 'Component',
        metadata: {
          name: 'sample',
          title: 'Sample Component',
          annotations: { 'usebruno.com/report-path': 'sample.json' },
        },
        spec: {
          type: 'service',
        },
      },
    ],
  }),
);

backend.add(import('../src'));

backend.start();
