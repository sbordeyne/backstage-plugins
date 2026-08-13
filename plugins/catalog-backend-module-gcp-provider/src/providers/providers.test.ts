import { ConfigReader, JsonObject } from '@backstage/config';
import { mockServices } from '@backstage/backend-test-utils';
import { Entity } from '@backstage/catalog-model';
import { google } from 'googleapis';
import { GcpRouterEntityProvider } from './GcpRouterEntityProvider';
import { GcpSpannerEntityProvider } from './GcpSpannerEntityProvider';
import { GcpEventarcEntityProvider } from './GcpEventarcEntityProvider';
import { GcpVpcEntityProvider } from './GcpVpcEntityProvider';
import { GcpServiceAccountEntityProvider } from './GcpServiceAccountEntityProvider';
import { GcpWorkloadIdentityEntityProvider } from './GcpWorkloadIdentityEntityProvider';
import { resetAssetIndex } from '../iam';

// Every provider builds its client through `googleapis`, so the API surfaces are stubbed rather
// than the HTTP layer: the thing under test is the mapping from API response to entity.
jest.mock('googleapis', () => ({
  google: {
    auth: { GoogleAuth: jest.fn() },
    compute: jest.fn(),
    spanner: jest.fn(),
    eventarc: jest.fn(),
    iam: jest.fn(),
    container: jest.fn(),
    cloudasset: jest.fn(),
  },
}));

const schedule = { frequency: { hours: 1 }, timeout: { minutes: 10 } };

function configOf(gcp: JsonObject): ConfigReader {
  return new ConfigReader({ catalog: { providers: { gcp } } });
}

function entitiesOf(deferred: { entity: Entity }[]): Entity[] {
  return deferred.map(({ entity }) => entity);
}

function providerOf<T>(Provider: new (...args: never[]) => T, gcp: JsonObject): T {
  return new (Provider as new (
    logger: ReturnType<typeof mockServices.logger.mock>,
    scheduler: ReturnType<typeof mockServices.scheduler.mock>,
    config: ConfigReader,
  ) => T)(mockServices.logger.mock(), mockServices.scheduler.mock(), configOf(gcp));
}

beforeEach(() => {
  jest.clearAllMocks();
  // The IAM index is shared across providers by design, so it has to be dropped between tests.
  resetAssetIndex();
});

describe('networking providers', () => {
  it('emits a router and the NAT gateways nested inside it', async () => {
    (google.compute as unknown as jest.Mock).mockReturnValue({
      routers: {
        aggregatedList: jest.fn().mockResolvedValue({
          data: {
            items: {
              'regions/europe-west1': {
                routers: [
                  {
                    name: 'edge-router',
                    network: 'https://www.googleapis.com/compute/v1/projects/my-project/global/networks/prod',
                    selfLink:
                      'https://www.googleapis.com/compute/v1/projects/my-project/regions/europe-west1/routers/edge-router',
                    bgp: { asn: 64512 },
                    nats: [{ name: 'egress', natIpAllocateOption: 'AUTO_ONLY' }],
                  },
                ],
              },
              // A region with nothing in it answers with a warning and no resources.
              'regions/us-east1': { warning: { code: 'NO_RESULTS_ON_PAGE' } },
            },
          },
        }),
      },
    });

    const provider = providerOf(GcpRouterEntityProvider, {
      defaultNamespace: 'gcp-${projectId}',
      routers: { projects: ['my-project'], schedule },
    });
    const entities = entitiesOf(await provider.getResources());

    expect(entities.map(entity => entity.metadata.name)).toEqual(['edge-router', 'edge-router-egress']);
    expect(entities[0].spec).toMatchObject({
      type: 'cloud-router',
      dependsOn: ['resource:gcp-my-project/prod'],
    });
    expect(entities[0].metadata.namespace).toBe('gcp-my-project');
    // The gateway hangs off its router, and carries the region the router was found in.
    expect(entities[1].spec).toMatchObject({
      type: 'cloud-nat',
      dependsOn: ['resource:gcp-my-project/edge-router'],
    });
    expect(entities[1].metadata.annotations?.['cloud.google.com/region']).toBe('europe-west1');
  });

  it('narrows an aggregated listing to the configured locations', async () => {
    (google.compute as unknown as jest.Mock).mockReturnValue({
      routers: {
        aggregatedList: jest.fn().mockResolvedValue({
          data: {
            items: {
              'regions/europe-west1': { routers: [{ name: 'kept' }] },
              'regions/us-east1': { routers: [{ name: 'dropped' }] },
            },
          },
        }),
      },
    });

    const provider = providerOf(GcpRouterEntityProvider, {
      routers: { projects: ['my-project'], schedule, locations: ['europe-west1'] },
    });
    expect(entitiesOf(await provider.getResources()).map(entity => entity.metadata.name)).toEqual(['kept']);
  });

  it('turns VPC peerings into relations rather than entities', async () => {
    (google.compute as unknown as jest.Mock).mockReturnValue({
      networks: {
        list: jest.fn().mockResolvedValue({
          data: {
            items: [
              {
                name: 'prod',
                peerings: [
                  {
                    name: 'to-shared',
                    network: 'https://www.googleapis.com/compute/v1/projects/host-project/global/networks/shared',
                  },
                ],
              },
            ],
          },
        }),
      },
    });

    const provider = providerOf(GcpVpcEntityProvider, {
      defaultNamespace: 'gcp-${projectId}',
      vpc: { projects: ['my-project'], schedule },
    });
    const [network] = entitiesOf(await provider.getResources());

    expect(network.metadata.annotations?.['cloud.google.com/vpc-peerings']).toBe('to-shared');
    // The peer lives in another project, so the ref lands in that project's namespace.
    expect(network.spec).toMatchObject({ dependsOn: ['resource:gcp-host-project/shared'] });
  });
});

describe('database providers', () => {
  it('emits the databases nested under each Spanner instance', async () => {
    (google.spanner as unknown as jest.Mock).mockReturnValue({
      projects: {
        instances: {
          list: jest.fn().mockResolvedValue({
            data: {
              instances: [
                {
                  name: 'projects/my-project/instances/orders',
                  config: 'projects/my-project/instanceConfigs/regional-europe-west1',
                  displayName: 'Orders',
                  nodeCount: 3,
                  state: 'READY',
                  labels: { env: 'prod' },
                },
              ],
            },
          }),
          databases: {
            list: jest.fn().mockResolvedValue({
              data: {
                databases: [{ name: 'projects/my-project/instances/orders/databases/ledger', state: 'READY' }],
              },
            }),
          },
        },
      },
    });

    const provider = providerOf(GcpSpannerEntityProvider, { spanner: { projects: ['my-project'], schedule } });
    const entities = entitiesOf(await provider.getResources());

    expect(entities.map(entity => entity.metadata.name)).toEqual(['orders', 'orders-ledger']);
    expect(entities[0].metadata).toMatchObject({
      title: 'Orders',
      description: 'Spanner instance with 3 node(s) in europe-west1',
      labels: { env: 'prod' },
    });
    // The database name is prefixed with its instance, since it is only unique there.
    expect(entities[1].spec).toMatchObject({ dependsOn: ['resource:default/orders'] });
    expect(entities[1].metadata.links?.[0].url).toBe(
      'https://console.cloud.google.com/spanner/instances/orders/databases/ledger/details/tables?project=my-project',
    );
  });
});

describe('eventarc provider', () => {
  it('ties the topic it reads to the service it delivers to', async () => {
    (google.eventarc as unknown as jest.Mock).mockReturnValue({
      projects: {
        locations: {
          triggers: {
            list: jest.fn().mockResolvedValue({
              data: {
                triggers: [
                  {
                    name: 'projects/my-project/locations/europe-west1/triggers/on-order',
                    eventFilters: [{ attribute: 'type', value: 'google.cloud.pubsub.topic.v1.messagePublished' }],
                    transport: { pubsub: { topic: 'projects/my-project/topics/myorg-orders' } },
                    destination: { cloudRun: { service: 'orders-api', region: 'europe-west1' } },
                    serviceAccount: 'projects/my-project/serviceAccounts/eventarc@my-project.iam.gserviceaccount.com',
                  },
                ],
              },
            }),
          },
        },
      },
    });

    const provider = providerOf(GcpEventarcEntityProvider, {
      // The Pub/Sub provider strips this prefix, so refs to its entities must strip it too.
      pubsub: { projects: ['my-project'], schedule, stripPrefixes: ['myorg-'] },
      eventarc: { projects: ['my-project'], schedule },
    });
    const [trigger] = entitiesOf(await provider.getResources());

    expect(trigger.metadata.description).toBe(
      'Delivers google.cloud.pubsub.topic.v1.messagePublished to Cloud Run service orders-api',
    );
    expect(trigger.spec).toMatchObject({
      dependsOn: ['resource:default/orders', 'resource:default/eventarc'],
      dependencyOf: ['resource:default/orders-api'],
    });
  });
});

describe('the IAM access graph', () => {
  /** The auth service's policies: three resource grants, plus its Workload Identity binding. */
  function authPolicies() {
    return {
      results: [
        {
          resource: '//cloudsql.googleapis.com/projects/prod/instances/auth-db',
          assetType: 'sqladmin.googleapis.com/Instance',
          policy: {
            bindings: [
              { role: 'roles/cloudsql.client', members: ['serviceAccount:auth-sa@prod.iam.gserviceaccount.com'] },
            ],
          },
        },
        {
          resource: '//secretmanager.googleapis.com/projects/prod/secrets/auth-jwks',
          assetType: 'secretmanager.googleapis.com/Secret',
          policy: {
            bindings: [
              {
                role: 'roles/secretmanager.secretAccessor',
                members: ['serviceAccount:auth-sa@prod.iam.gserviceaccount.com'],
              },
            ],
          },
        },
        {
          resource: '//pubsub.googleapis.com/projects/prod/topics/myorg-auth-events',
          assetType: 'pubsub.googleapis.com/Topic',
          policy: {
            bindings: [
              { role: 'roles/pubsub.publisher', members: ['serviceAccount:auth-sa@prod.iam.gserviceaccount.com'] },
              { role: 'roles/pubsub.subscriber', members: ['serviceAccount:audit-sa@prod.iam.gserviceaccount.com'] },
            ],
          },
        },
        {
          resource: '//cloudresourcemanager.googleapis.com/projects/123456',
          assetType: 'cloudresourcemanager.googleapis.com/Project',
          policy: {
            bindings: [
              { role: 'roles/logging.logWriter', members: ['serviceAccount:auth-sa@prod.iam.gserviceaccount.com'] },
            ],
          },
        },
        {
          resource: '//iam.googleapis.com/projects/prod/serviceAccounts/auth-sa@prod.iam.gserviceaccount.com',
          assetType: 'iam.googleapis.com/ServiceAccount',
          policy: {
            bindings: [
              {
                role: 'roles/iam.workloadIdentityUser',
                members: ['serviceAccount:prod.svc.id.goog[auth/auth-sa]'],
              },
            ],
          },
        },
      ],
    };
  }

  function mockAssetInventory() {
    (google.cloudasset as unknown as jest.Mock).mockReturnValue({
      v1: { searchAllIamPolicies: jest.fn().mockResolvedValue({ data: authPolicies() }) },
    });
  }

  const gcp = {
    defaultNamespace: 'gcp-${projectId}',
    // The Pub/Sub provider strips this prefix, so IAM refs to topics must strip it too.
    pubsub: { projects: ['prod'], schedule, stripPrefixes: ['myorg-'] },
    'service-account': { projects: ['prod'], schedule },
    'workload-identity': { projects: ['prod'], schedule },
    clusters: { projects: ['prod'], schedule },
    cloudsql: { projects: ['prod'], schedule },
    secretmanager: { projects: ['prod'], schedule },
  };

  it('turns a service account into edges to everything it can reach', async () => {
    mockAssetInventory();
    (google.iam as unknown as jest.Mock).mockReturnValue({
      projects: {
        serviceAccounts: {
          list: jest.fn().mockResolvedValue({
            data: {
              accounts: [
                {
                  name: 'projects/prod/serviceAccounts/auth-sa@prod.iam.gserviceaccount.com',
                  email: 'auth-sa@prod.iam.gserviceaccount.com',
                  projectId: 'prod',
                  displayName: 'Auth service',
                  uniqueId: '10293847',
                },
              ],
            },
          }),
        },
      },
    });

    const provider = providerOf(GcpServiceAccountEntityProvider, gcp);
    const [account] = entitiesOf(await provider.getResources());

    expect(account.spec?.dependsOn).toEqual([
      'resource:gcp-prod/auth-db',
      'resource:gcp-prod/auth-jwks',
      // The topic's ingested name has the configured prefix stripped, and the ref must match it.
      'resource:gcp-prod/auth-events',
    ]);
    expect(account.metadata.annotations).toMatchObject({
      'cloud.google.com/iam-roles': 'roles/cloudsql.client,roles/secretmanager.secretAccessor,roles/pubsub.publisher',
      'cloud.google.com/iam-access':
        'auth-db=roles/cloudsql.client;auth-jwks=roles/secretmanager.secretAccessor;' +
        'myorg-auth-events=roles/pubsub.publisher',
      // A project-level grant reaches everything and names nothing, so it is recorded, not related.
      'cloud.google.com/iam-project-roles': 'roles/logging.logWriter',
    });
  });

  it('honours the role denylist', async () => {
    mockAssetInventory();
    (google.iam as unknown as jest.Mock).mockReturnValue({
      projects: {
        serviceAccounts: {
          list: jest.fn().mockResolvedValue({
            data: {
              accounts: [
                {
                  name: 'projects/prod/serviceAccounts/auth-sa@prod.iam.gserviceaccount.com',
                  email: 'auth-sa@prod.iam.gserviceaccount.com',
                  projectId: 'prod',
                },
              ],
            },
          }),
        },
      },
    });

    const provider = providerOf(GcpServiceAccountEntityProvider, {
      ...gcp,
      iam: { excludeRoles: ['roles/pubsub.publisher'] },
    });
    const [account] = entitiesOf(await provider.getResources());

    expect(account.spec?.dependsOn).toEqual(['resource:gcp-prod/auth-db', 'resource:gcp-prod/auth-jwks']);
  });

  it('bridges Kubernetes to GCP through the Workload Identity binding', async () => {
    mockAssetInventory();
    (google.container as unknown as jest.Mock).mockReturnValue({
      projects: {
        locations: {
          clusters: {
            list: jest.fn().mockResolvedValue({
              data: {
                clusters: [
                  {
                    name: 'prod-cluster',
                    location: 'europe-west1',
                    workloadIdentityConfig: { workloadPool: 'prod.svc.id.goog' },
                  },
                  // A cluster without Workload Identity cannot be running this account.
                  { name: 'legacy-cluster', location: 'europe-west1' },
                ],
              },
            }),
          },
        },
      },
    });

    const provider = providerOf(GcpWorkloadIdentityEntityProvider, gcp);
    const [ksa] = entitiesOf(await provider.getResources());

    expect(ksa.metadata.name).toBe('prod-auth-auth-sa');
    expect(ksa.metadata.title).toBe('auth/auth-sa');
    expect(ksa.spec).toMatchObject({
      type: 'kubernetes-service-account',
      dependsOn: ['resource:gcp-prod/auth-sa', 'resource:gcp-prod/prod-cluster'],
    });
    expect(ksa.metadata.annotations).toMatchObject({
      'cloud.google.com/workload-identity-pool': 'prod.svc.id.goog',
      'cloud.google.com/ksa-namespace': 'auth',
    });
  });

  it('emits no edges when the Cloud Asset API is unavailable', async () => {
    (google.cloudasset as unknown as jest.Mock).mockReturnValue({
      v1: {
        searchAllIamPolicies: jest.fn().mockRejectedValue(Object.assign(new Error('disabled'), { code: 403 })),
      },
    });
    (google.iam as unknown as jest.Mock).mockReturnValue({
      projects: {
        serviceAccounts: {
          list: jest.fn().mockResolvedValue({
            data: {
              accounts: [
                {
                  name: 'projects/prod/serviceAccounts/auth-sa@prod.iam.gserviceaccount.com',
                  email: 'auth-sa@prod.iam.gserviceaccount.com',
                  projectId: 'prod',
                },
              ],
            },
          }),
        },
      },
    });

    const provider = providerOf(GcpServiceAccountEntityProvider, gcp);
    const [account] = entitiesOf(await provider.getResources());

    // The account is still ingested; only the graph is poorer.
    expect(account.metadata.name).toBe('auth-sa');
    expect(account.spec?.dependsOn).toBeUndefined();
  });
});

describe('failure handling', () => {
  it('treats a project it cannot read as empty and keeps the others', async () => {
    (google.compute as unknown as jest.Mock).mockReturnValue({
      networks: {
        list: jest.fn().mockImplementation(async ({ project }: { project: string }) => {
          if (project === 'locked-down') {
            throw Object.assign(new Error('Compute Engine API has not been used in project'), { code: 403 });
          }
          return { data: { items: [{ name: 'prod' }] } };
        }),
      },
    });

    const provider = providerOf(GcpVpcEntityProvider, {
      vpc: { projects: ['locked-down', 'my-project'], schedule },
    });
    expect(entitiesOf(await provider.getResources()).map(entity => entity.metadata.name)).toEqual(['prod']);
  });

  it('lets a transient failure abort the refresh rather than emptying the catalog', async () => {
    (google.compute as unknown as jest.Mock).mockReturnValue({
      networks: {
        list: jest.fn().mockRejectedValue(Object.assign(new Error('backend error'), { code: 500 })),
      },
    });

    const provider = providerOf(GcpVpcEntityProvider, { vpc: { projects: ['my-project'], schedule } });
    await expect(provider.getResources()).rejects.toThrow('backend error');
  });
});
