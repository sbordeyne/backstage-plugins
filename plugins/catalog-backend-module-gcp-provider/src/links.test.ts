import { buildLinks, consoleUrl, DEFAULT_LINK_OPTIONS, DOCS_URLS, logsUrl } from './links';

describe('consoleUrl', () => {
  it('appends the project as a query parameter', () => {
    expect(consoleUrl('sql/instances/my-db/overview', 'my-project')).toBe(
      'https://console.cloud.google.com/sql/instances/my-db/overview?project=my-project',
    );
  });

  it('keeps a path that carries query parameters of its own', () => {
    expect(consoleUrl('bigquery?d=sales&page=dataset', 'my-project')).toBe(
      'https://console.cloud.google.com/bigquery?d=sales&page=dataset&project=my-project',
    );
  });

  it('does not double the separating slash', () => {
    expect(consoleUrl('/storage/browser/my-bucket', 'my-project')).toBe(
      'https://console.cloud.google.com/storage/browser/my-bucket?project=my-project',
    );
  });
});

describe('logsUrl', () => {
  it('encodes the filter into the query path segment', () => {
    expect(logsUrl('resource.type="gcs_bucket"', 'my-project')).toBe(
      'https://console.cloud.google.com/logs/query;query=resource.type%3D%22gcs_bucket%22?project=my-project',
    );
  });
});

describe('buildLinks', () => {
  const base = { links: DEFAULT_LINK_OPTIONS, projectId: 'my-project', type: 'bucket' };

  it('writes the console and documentation links by default', () => {
    const links = buildLinks({ ...base, consolePath: 'storage/browser/my-bucket' });
    expect(links).toEqual([
      {
        url: 'https://console.cloud.google.com/storage/browser/my-bucket?project=my-project',
        title: 'Open in GCP console',
        icon: 'dashboard',
        type: 'console',
      },
      { url: DOCS_URLS.bucket, title: 'Documentation', icon: 'docs', type: 'documentation' },
    ]);
  });

  it('leaves the logs link out until it is turned on', () => {
    const logFilter = 'resource.type="gcs_bucket"';
    expect(buildLinks({ ...base, logFilter }).some(link => link.type === 'logs')).toBe(false);
    expect(
      buildLinks({ ...base, links: { ...DEFAULT_LINK_OPTIONS, logs: true }, logFilter }).some(
        link => link.type === 'logs',
      ),
    ).toBe(true);
  });

  it('omits a family it has nothing to build from', () => {
    expect(buildLinks({ ...base, type: 'unknown-type' })).toEqual([]);
  });

  it('prefers an explicit docs url over the one for the type', () => {
    const links = buildLinks({ ...base, docsUrl: 'https://wiki/buckets' });
    expect(links).toEqual([
      { url: 'https://wiki/buckets', title: 'Documentation', icon: 'docs', type: 'documentation' },
    ]);
  });

  it('keeps resource links between the console and the documentation', () => {
    const extra = [{ url: 'https://my-service.run.app', title: 'Service URL', type: 'website' }];
    const links = buildLinks({ ...base, consolePath: 'run/detail/europe-west1/svc', extra });
    expect(links.map(link => link.type)).toEqual(['console', 'website', 'documentation']);
  });

  it('drops a duplicated url rather than listing it twice', () => {
    const extra = [{ url: DOCS_URLS.bucket, title: 'Bucket docs' }];
    expect(buildLinks({ ...base, extra }).filter(link => link.url === DOCS_URLS.bucket)).toHaveLength(1);
  });
});
