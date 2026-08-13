import { ConfigReader } from '@backstage/config';
import { mockServices } from '@backstage/backend-test-utils';
import { DeferredEntity } from '@backstage/plugin-catalog-node';
import { GcpEntityProviderBase, GcpResource } from './GcpEntityProviderBase';

const schedule = { frequency: { hours: 1 }, timeout: { minutes: 10 } };

/** Stand-in provider, so the shared metadata behaviour can be exercised without a GCP client. */
class TestProvider extends GcpEntityProviderBase<undefined> {
  getProviderName(): string {
    return 'gcp-bucket';
  }

  getProviderConfigKey(): string {
    return 'storage';
  }

  getClient(): undefined {
    return undefined;
  }

  async getResources(): Promise<DeferredEntity[]> {
    return [];
  }

  metadata(resource: GcpResource) {
    return this.metadataOf(resource);
  }

  system(labels: Record<string, string>) {
    return this.systemOf(labels);
  }

  namespaceOfOther(configKey: string) {
    return this.namespaceOfProvider(configKey, {
      projectId: 'my-project',
      type: 'google-service-account',
      provider: 'gcp-service-account',
    });
  }
}

/** A provider reading `catalog.providers.gcp`, with `storage` as its own block. */
function providerWith(gcp: Record<string, unknown>): TestProvider {
  const config = new ConfigReader({
    catalog: { providers: { gcp: { storage: { projects: ['my-project'], schedule }, ...gcp } } },
  });
  return new TestProvider(mockServices.logger.mock(), mockServices.scheduler.mock(), config);
}

const bucket: GcpResource = {
  name: 'My_Bucket',
  projectId: 'my-project',
  type: 'bucket',
  region: 'europe-west1',
  selfLink: 'https://storage.googleapis.com/storage/v1/b/my-bucket',
  labels: { env: 'prod', 'backstage_io_system-ref': 'payments' },
  summary: 'Standard storage bucket in europe-west1',
  consolePath: 'storage/browser/my-bucket',
  logFilter: 'resource.type="gcs_bucket"',
  tagValues: ['STANDARD'],
};

describe('namespaces', () => {
  it('uses the default namespace when nothing is configured', () => {
    expect(providerWith({}).metadata(bucket).namespace).toBe('default');
  });

  it('renders the shared template', () => {
    expect(providerWith({ defaultNamespace: 'gcp-${projectId}' }).metadata(bucket).namespace).toBe('gcp-my-project');
  });

  it('prefers the provider template over the shared one', () => {
    const provider = providerWith({
      defaultNamespace: 'gcp-${projectId}',
      storage: { projects: ['my-project'], schedule, namespace: '${type}-${region}' },
    });
    expect(provider.metadata(bucket).namespace).toBe('bucket-europe-west1');
  });

  it('normalizes the rendered namespace into something the catalog accepts', () => {
    expect(providerWith({ defaultNamespace: 'GCP_${projectId}' }).metadata(bucket).namespace).toBe('gcp-my-project');
  });

  it('falls back to the default namespace when the template names an unknown variable', () => {
    expect(providerWith({ defaultNamespace: 'gcp-${project}' }).metadata(bucket).namespace).toBe('default');
  });

  it('reads another provider config block for refs pointing at it', () => {
    const provider = providerWith({
      defaultNamespace: 'gcp-${projectId}',
      'service-account': { projects: ['my-project'], schedule, namespace: 'iam-${projectId}' },
    });
    expect(provider.namespaceOfOther('service-account')).toBe('iam-my-project');
  });

  it('falls back to the shared template for a provider that is not configured', () => {
    expect(providerWith({ defaultNamespace: 'gcp-${projectId}' }).namespaceOfOther('service-account')).toBe(
      'gcp-my-project',
    );
  });
});

describe('systems', () => {
  it('reads the system off the resource labels', () => {
    expect(providerWith({}).system({ 'backstage_io_system-ref': 'payments' })).toEqual({
      system: 'system:default/payments',
    });
  });

  it('reads the configured label instead when there is one', () => {
    const provider = providerWith({ systemLabel: 'system' });
    expect(provider.system({ system: 'payments' })).toEqual({ system: 'system:default/payments' });
  });

  it('leaves the system off when nothing names one', () => {
    expect(providerWith({}).system({ env: 'prod' })).toEqual({});
  });

  it('falls back to the configured system', () => {
    expect(providerWith({ defaultSystem: 'system:default/infra' }).system({ env: 'prod' })).toEqual({
      system: 'system:default/infra',
    });
  });

  it('prefers the provider system over the shared one', () => {
    const provider = providerWith({
      defaultSystem: 'system:default/infra',
      storage: { projects: ['my-project'], schedule, system: 'system:default/storage' },
    });
    expect(provider.system({ env: 'prod' })).toEqual({ system: 'system:default/storage' });
  });

  it('falls back when the label is not a usable ref, rather than emitting a rejected entity', () => {
    const provider = providerWith({ defaultSystem: 'system:default/infra' });
    expect(provider.system({ 'backstage_io_system-ref': 'system:' })).toEqual({ system: 'system:default/infra' });
  });
});

describe('metadata', () => {
  it('annotates the project, region and self link', () => {
    expect(providerWith({}).metadata(bucket).annotations).toEqual({
      'cloud.google.com/project-id': 'my-project',
      'cloud.google.com/region': 'europe-west1',
      'cloud.google.com/self-link': 'https://storage.googleapis.com/storage/v1/b/my-bucket',
    });
  });

  it('falls back to the configured region and omits an unknown one', () => {
    const withDefault = providerWith({ defaultRegion: 'europe-west9' });
    expect(withDefault.metadata({ ...bucket, region: undefined }).annotations['cloud.google.com/region']).toBe(
      'europe-west9',
    );
    expect(providerWith({}).metadata({ ...bucket, region: undefined }).annotations).not.toHaveProperty(
      'cloud.google.com/region',
    );
  });

  it('lets a provider annotation override a shared one', () => {
    const annotations = { 'cloud.google.com/region': 'somewhere-else' };
    expect(providerWith({}).metadata({ ...bucket, annotations }).annotations['cloud.google.com/region']).toBe(
      'somewhere-else',
    );
  });

  it('copies the GCP labels onto the entity', () => {
    expect(providerWith({}).metadata(bucket).labels).toEqual({
      env: 'prod',
      'backstage_io_system-ref': 'payments',
    });
  });

  it('normalizes the entity name', () => {
    expect(providerWith({}).metadata(bucket).name).toBe('my-bucket');
  });
});

describe('titles and descriptions', () => {
  it('keeps the GCP name as the title when normalization changed it', () => {
    expect(providerWith({}).metadata(bucket).title).toBe('My_Bucket');
  });

  it('leaves the title off when the name survived normalization', () => {
    expect(providerWith({}).metadata({ ...bucket, name: 'my-bucket' }).title).toBeUndefined();
  });

  it('prefers a title the API reported', () => {
    expect(providerWith({}).metadata({ ...bucket, title: 'Sales exports' }).title).toBe('Sales exports');
  });

  it('prefers the API description over the generated summary', () => {
    expect(providerWith({}).metadata({ ...bucket, description: 'Nightly exports' }).description).toBe(
      'Nightly exports',
    );
  });

  it('falls back to the generated summary', () => {
    expect(providerWith({}).metadata(bucket).description).toBe('Standard storage bucket in europe-west1');
  });

  it('leaves the description off when generation is turned off', () => {
    expect(providerWith({ descriptions: false }).metadata(bucket).description).toBeUndefined();
  });
});

describe('links', () => {
  it('writes the console and documentation links by default', () => {
    const links = providerWith({}).metadata(bucket).links ?? [];
    expect(links.map(link => link.type)).toEqual(['console', 'documentation']);
    expect(links[0].url).toBe('https://console.cloud.google.com/storage/browser/my-bucket?project=my-project');
  });

  it('honours a link family turned off per provider', () => {
    const provider = providerWith({
      storage: { projects: ['my-project'], schedule, links: { docs: false } },
    });
    expect((provider.metadata(bucket).links ?? []).map(link => link.type)).toEqual(['console']);
  });

  it('keeps the other families when one is enabled per provider', () => {
    const provider = providerWith({
      links: { console: false },
      storage: { projects: ['my-project'], schedule, links: { logs: true } },
    });
    expect((provider.metadata(bucket).links ?? []).map(link => link.type)).toEqual(['documentation', 'logs']);
  });

  it('renders configured extra links against the resource', () => {
    const provider = providerWith({
      storage: {
        projects: ['my-project'],
        schedule,
        extraLinks: [{ url: 'https://wiki/${projectId}/${name}', title: 'Runbook', icon: 'docs' }],
      },
    });
    expect(provider.metadata(bucket).links).toContainEqual({
      url: 'https://wiki/my-project/my-bucket',
      title: 'Runbook',
      icon: 'docs',
    });
  });

  it('skips an extra link whose template names an unknown variable', () => {
    const provider = providerWith({
      storage: {
        projects: ['my-project'],
        schedule,
        extraLinks: [{ url: 'https://wiki/${bucket}' }, { url: 'https://wiki/${name}' }],
      },
    });
    const urls = (provider.metadata(bucket).links ?? []).map(link => link.url);
    expect(urls).toContain('https://wiki/my-bucket');
    expect(urls).not.toContain('https://wiki/${bucket}');
  });
});

describe('tags', () => {
  it('writes no tags until a source is configured', () => {
    expect(providerWith({}).metadata(bucket).tags).toBeUndefined();
  });

  it('turns every label into a key-value tag', () => {
    const tags = providerWith({ tags: { fromLabels: true } }).metadata(bucket).tags;
    expect(tags).toEqual(['env-prod', 'backstage-io-system-ref-payments']);
  });

  it('takes bare values from an allowlist of label keys', () => {
    const tags = providerWith({ tags: { labelKeys: ['env'] } }).metadata(bucket).tags;
    expect(tags).toEqual(['prod']);
  });

  it('adds the type, region, project and resource attributes when asked', () => {
    const tags = providerWith({
      tags: { resourceType: true, region: true, project: true, attributes: true },
    }).metadata(bucket).tags;
    expect(tags).toEqual(['bucket', 'my-project', 'europe-west1', 'standard']);
  });
});
