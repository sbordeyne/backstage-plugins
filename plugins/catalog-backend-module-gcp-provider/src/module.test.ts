import { mockServices, startTestBackend } from '@backstage/backend-test-utils';
import { catalogProcessingExtensionPoint } from '@backstage/plugin-catalog-node';
import { catalogModuleGcpProvider } from './module';

const schedule = { frequency: { hours: 1 }, timeout: { minutes: 10 } };

/** Provider names registered for the given `catalog.providers.gcp` block. */
async function registeredProviders(gcp: unknown): Promise<string[]> {
  const addEntityProvider = jest.fn();
  // The module also registers the relation processor, which the stub has to accept.
  const addProcessor = jest.fn();
  await startTestBackend({
    extensionPoints: [[catalogProcessingExtensionPoint, { addEntityProvider, addProcessor }]],
    features: [
      catalogModuleGcpProvider,
      mockServices.rootConfig.factory({ data: gcp ? { catalog: { providers: { gcp } } } : {} }),
    ],
  });
  return addEntityProvider.mock.calls.map(([provider]) => provider.getProviderName());
}

describe('catalogModuleGcpProvider', () => {
  it('registers nothing when there is no gcp configuration', async () => {
    await expect(registeredProviders(undefined)).resolves.toEqual([]);
  });

  it('registers a provider whose block is present', async () => {
    await expect(registeredProviders({ bigquery: { projects: ['p'], schedule } })).resolves.toEqual(['gcp-bigquery']);
  });

  it('leaves out a provider disabled by enabled: false', async () => {
    const gcp = {
      bigquery: { projects: ['p'], schedule },
      storage: { enabled: false, projects: ['p'], schedule },
    };
    await expect(registeredProviders(gcp)).resolves.toEqual(['gcp-bigquery']);
  });

  it('treats enabled: true and an absent enabled the same', async () => {
    const gcp = {
      bigquery: { enabled: true, projects: ['p'], schedule },
      storage: { projects: ['p'], schedule },
    };
    await expect(registeredProviders(gcp)).resolves.toEqual(['gcp-bigquery', 'gcp-bucket']);
  });

  it('registers a provider for every config key it documents', async () => {
    // One block per key, so a provider added to PROVIDERS without a config key — or the reverse —
    // shows up here rather than in a silently missing resource type.
    const keys = [
      'service-account',
      'bigquery',
      'pubsub',
      'cloudsql',
      'storage',
      'secretmanager',
      'clusters',
      'workload-identity',
      'iam-roles',
      'vpc',
      'subnets',
      'firewall',
      'routers',
      'dns',
      'instances',
      'instance-groups',
      'images',
      'spanner',
      'redis',
      'alloydb',
      'bigtable',
      'firestore',
      'managedkafka',
      'eventarc',
      'cloudtasks',
      'scheduler',
      'run',
      'functions',
      'artifactregistry',
      'loadbalancers',
      'sslcertificates',
      'armor',
      'addresses',
      'vpn',
      'cloudbuild',
      'clouddeploy',
      'workflows',
      'composer',
      'dataproc',
      'kms',
      'certificatemanager',
      'binaryauthorization',
      'alerts',
      'slos',
      'logsinks',
      'filestore',
      'vpcconnectors',
      'memcache',
      'appengine',
      'disks',
      'bqtransfers',
      'bqreservations',
      'analyticshub',
      'datastream',
      'dataplex',
      'dataflow',
      'vertex',
      'workbench',
    ];
    const gcp = Object.fromEntries(keys.map(key => [key, { projects: ['p'], schedule }]));

    await expect(registeredProviders(gcp)).resolves.toHaveLength(keys.length);
  });
});
