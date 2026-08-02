import AdmZip from 'adm-zip';
import type { Octokit } from '@octokit/rest';

import { GithubArtifactSource, type GithubSourceOptions } from './GithubArtifactSource';

interface FakeArtifact {
  id: number;
  name: string;
  size_in_bytes: number;
  created_at?: string;
  expired?: boolean;
  workflow_run?: { head_branch?: string };
}

function zipOf(entries: Record<string, string>): Buffer {
  const archive = new AdmZip();
  for (const [name, content] of Object.entries(entries)) {
    archive.addFile(name, Buffer.from(content));
  }
  return archive.toBuffer();
}

function fakeOctokit(artifacts: FakeArtifact[], archive: Buffer = zipOf({ 'users.json': '{"report":true}' })) {
  const downloadArtifact = jest.fn(async () => ({
    data: archive.buffer.slice(archive.byteOffset, archive.byteOffset + archive.byteLength),
  }));
  // One short page, which is how the source knows the listing is over.
  const listArtifactsForRepo = jest.fn(async () => ({ data: { artifacts } }));

  return {
    downloadArtifact,
    listArtifactsForRepo,
    octokit: {
      rest: { actions: { listArtifactsForRepo, downloadArtifact } },
    } as unknown as Octokit,
  };
}

function options(overrides: Partial<GithubSourceOptions> = {}): GithubSourceOptions {
  return {
    owner: 'my-org',
    repo: 'my-repo',
    namePrefix: '',
    branch: '',
    maxEntryBytes: 1024 * 1024,
    ...overrides,
  };
}

function artifact(overrides: Partial<FakeArtifact> = {}): FakeArtifact {
  return {
    id: 42,
    name: 'users.json',
    size_in_bytes: 512,
    created_at: '2026-07-01T12:00:00Z',
    workflow_run: { head_branch: 'main' },
    ...overrides,
  };
}

describe('GithubArtifactSource', () => {
  it('maps an artifact onto a ref keyed by its id', async () => {
    const { octokit } = fakeOctokit([artifact()]);
    const source = new GithubArtifactSource(options(), octokit);

    const refs = [];
    for await (const ref of source.list()) {
      refs.push(ref);
    }

    expect(refs).toEqual([
      {
        source: 'github://my-org/my-repo',
        name: 'users.json',
        version: '42',
        createdAt: new Date('2026-07-01T12:00:00Z'),
        sizeBytes: 512,
      },
    ]);
  });

  it('skips expired artifacts, whose bytes GitHub has already deleted', async () => {
    const { octokit } = fakeOctokit([artifact({ id: 1, expired: true }), artifact({ id: 2 })]);
    const source = new GithubArtifactSource(options(), octokit);

    const versions = [];
    for await (const ref of source.list()) {
      versions.push(ref.version);
    }

    expect(versions).toEqual(['2']);
  });

  it('filters by branch and strips the configured name prefix', async () => {
    const { octokit } = fakeOctokit([
      artifact({ id: 1, name: 'bruno-users.json' }),
      artifact({ id: 2, name: 'coverage.xml' }),
      artifact({ id: 3, name: 'bruno-orders.json', workflow_run: { head_branch: 'topic' } }),
    ]);
    const source = new GithubArtifactSource(options({ namePrefix: 'bruno-', branch: 'main' }), octokit);

    const names = [];
    for await (const ref of source.list()) {
      names.push(ref.name);
    }

    expect(names).toEqual(['users.json']);
  });

  it('unwraps the single json entry of the archive', async () => {
    const { octokit, downloadArtifact } = fakeOctokit([artifact()]);
    const source = new GithubArtifactSource(options(), octokit);

    const body = await source.download({
      source: 'github://my-org/my-repo',
      name: 'users.json',
      version: '42',
      createdAt: new Date(),
    });

    expect(body.toString()).toBe('{"report":true}');
    expect(downloadArtifact).toHaveBeenCalledWith(
      expect.objectContaining({ owner: 'my-org', repo: 'my-repo', artifact_id: 42, archive_format: 'zip' }),
    );
  });

  it('picks the entry named after the artifact when the archive holds several', async () => {
    const { octokit } = fakeOctokit(
      [artifact()],
      zipOf({ 'orders.json': '{"other":true}', 'reports/users.json': '{"report":true}' }),
    );
    const source = new GithubArtifactSource(options(), octokit);

    const body = await source.download({
      source: 'github://my-org/my-repo',
      name: 'users.json',
      version: '42',
      createdAt: new Date(),
    });

    expect(body.toString()).toBe('{"report":true}');
  });

  it('refuses an archive whose json entries none match the artifact name', async () => {
    const { octokit } = fakeOctokit([artifact()], zipOf({ 'a.json': '{}', 'b.json': '{}' }));
    const source = new GithubArtifactSource(options(), octokit);

    await expect(
      source.download({
        source: 'github://my-org/my-repo',
        name: 'users.json',
        version: '42',
        createdAt: new Date(),
      }),
    ).rejects.toThrow(/holds 2 .json entries and none is named after it/);
  });

  it('refuses an entry that unpacks past the size limit', async () => {
    const { octokit } = fakeOctokit([artifact()], zipOf({ 'users.json': 'x'.repeat(2048) }));
    const source = new GithubArtifactSource(options({ maxEntryBytes: 1024 }), octokit);

    await expect(
      source.download({
        source: 'github://my-org/my-repo',
        name: 'users.json',
        version: '42',
        createdAt: new Date(),
      }),
    ).rejects.toThrow(/unpacks to 2048 bytes, over the 1024 byte limit/);
  });

  it('reports an archive with no json at all', async () => {
    const { octokit } = fakeOctokit([artifact()], zipOf({ 'report.xml': '<xml />' }));
    const source = new GithubArtifactSource(options(), octokit);

    await expect(
      source.download({
        source: 'github://my-org/my-repo',
        name: 'users.json',
        version: '42',
        createdAt: new Date(),
      }),
    ).rejects.toThrow(/holds no .json entry/);
  });
});
