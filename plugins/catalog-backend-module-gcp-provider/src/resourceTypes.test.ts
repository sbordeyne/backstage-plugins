import { readFileSync } from 'fs';
import { resolve } from 'path';
import { mockServices, startTestBackend } from '@backstage/backend-test-utils';
import { catalogProcessingExtensionPoint } from '@backstage/plugin-catalog-node';
import { catalogModuleGcpProvider } from './module';
import { RESOURCE_CONFIG_KEYS, RESOURCE_TYPES } from './resourceTypes';
import { DOCS_URLS } from './links';
import { ASSET_TYPES } from './iam/assetTypes';

const schedule = { frequency: { hours: 1 }, timeout: { minutes: 10 } };

/** The providers the module registers for one block per config key in the registry. */
async function registeredProviders(): Promise<string[]> {
  const addEntityProvider = jest.fn();
  await startTestBackend({
    extensionPoints: [[catalogProcessingExtensionPoint, { addEntityProvider, addProcessor: jest.fn() }]],
    features: [
      catalogModuleGcpProvider,
      mockServices.rootConfig.factory({
        data: {
          catalog: {
            providers: {
              gcp: Object.fromEntries(RESOURCE_CONFIG_KEYS.map(key => [key, { projects: ['p'], schedule }])),
            },
          },
        },
      }),
    ],
  });
  return addEntityProvider.mock.calls.map(([provider]) => provider.getProviderName());
}

describe('the resource type registry', () => {
  it('names each type once', () => {
    const types = RESOURCE_TYPES.map(resource => resource.type);
    expect(types).toEqual([...new Set(types)]);
  });

  it('maps each asset type to a single resource type', () => {
    const assetTypes = RESOURCE_TYPES.map(resource => resource.assetType).filter(Boolean);
    expect(assetTypes).toEqual([...new Set(assetTypes)]);
  });

  it('gives every resource type a documentation link', () => {
    // `links.docs` is on by default, so a type missing from here is an entity page that quietly
    // lacks the link every other entity has.
    for (const resource of RESOURCE_TYPES) {
      expect(DOCS_URLS[resource.type]).toMatch(/^https:\/\/cloud\.google\.com\//);
    }
  });

  it('exposes every asset type it declares to the IAM lookup', () => {
    for (const resource of RESOURCE_TYPES.filter(entry => entry.assetType)) {
      expect(ASSET_TYPES[resource.assetType as string]).toMatchObject({
        configKey: resource.configKey,
        provider: resource.provider,
        type: resource.type,
      });
    }
  });

  it('documents the same types in the README as it ingests', () => {
    // The README table is the fifth place a resource type used to be spelled out. It is still
    // written by hand, but it can no longer disagree with the code without failing here.
    const readme = readFileSync(resolve(__dirname, '../README.md'), 'utf8');
    const documented = new Map<string, string[]>();
    for (const row of readme.matchAll(/^\|\s*`([a-z0-9-]+)`\s*\|[^|]*\|\s*(`[^|]*`)\s*\|/gm)) {
      documented.set(row[1], [...row[2].matchAll(/`([a-z0-9-]+)`/g)].map(match => match[1]).sort());
    }

    const ingested = new Map<string, string[]>();
    for (const resource of RESOURCE_TYPES) {
      ingested.set(resource.configKey, [...(ingested.get(resource.configKey) ?? []), resource.type].sort());
    }

    expect(Object.fromEntries(documented)).toEqual(Object.fromEntries(ingested));
  });

  it('owns exactly the config keys the module registers a provider for', async () => {
    // The registry and `PROVIDERS` are written by hand in two places; this is what stops one from
    // gaining a resource type the other has never heard of.
    const providers = await registeredProviders();
    expect(providers).toHaveLength(RESOURCE_CONFIG_KEYS.length);
    expect([...providers].sort()).toEqual([...new Set(RESOURCE_TYPES.map(r => r.provider))].sort());
  });
});
