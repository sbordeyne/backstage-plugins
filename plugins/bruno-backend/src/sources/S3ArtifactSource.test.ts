import { GetObjectCommand, ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3';

import { S3ArtifactSource } from './S3ArtifactSource';

interface S3Object {
  Key: string;
  ETag?: string;
  LastModified?: Date;
  Size?: number;
}

function fakeClient(pages: Array<{ Contents: S3Object[]; NextContinuationToken?: string }>, sent: any[] = []) {
  let pageIndex = 0;
  return {
    sent,
    client: {
      send: jest.fn(async (command: any) => {
        sent.push(command);
        if (command instanceof ListObjectsV2Command) {
          const page = pages[pageIndex++];
          return { ...page, IsTruncated: Boolean(page.NextContinuationToken) };
        }
        return {
          Body: { transformToByteArray: async () => new TextEncoder().encode('{"report":true}') },
        };
      }),
    } as unknown as S3Client,
  };
}

function options(requiredPathSegment = 'unit') {
  return { bucket: 'test-bucket', prefix: 'reports/', requiredPathSegment };
}

describe('S3ArtifactSource', () => {
  it('maps object metadata onto the artifact ref', async () => {
    const { client } = fakeClient([
      {
        Contents: [
          {
            Key: 'reports/run-1/unit/users.json',
            ETag: '"d41d8cd98f00b204e9800998ecf8427e"',
            LastModified: new Date('2026-07-01T12:00:00.000Z'),
            Size: 4096,
          },
        ],
      },
    ]);
    const source = new S3ArtifactSource(options(), client);

    const refs = [];
    for await (const ref of source.list()) {
      refs.push(ref);
    }

    expect(refs).toEqual([
      {
        source: 's3://test-bucket',
        name: 'reports/run-1/unit/users.json',
        // The ETag identifies the write, but the quotes belong to the header.
        version: 'd41d8cd98f00b204e9800998ecf8427e',
        etag: '"d41d8cd98f00b204e9800998ecf8427e"',
        createdAt: new Date('2026-07-01T12:00:00.000Z'),
        sizeBytes: 4096,
      },
    ]);
  });

  it('follows the continuation token to the end of the listing', async () => {
    const { client } = fakeClient([
      { Contents: [{ Key: 'reports/a/unit/one.json' }], NextContinuationToken: 'next' },
      { Contents: [{ Key: 'reports/b/unit/two.json' }] },
    ]);
    const source = new S3ArtifactSource(options(), client);

    const names = [];
    for await (const ref of source.list()) {
      names.push(ref.name);
    }

    expect(names).toEqual(['reports/a/unit/one.json', 'reports/b/unit/two.json']);
  });

  it('skips directory placeholders and objects outside the required segment', async () => {
    const { client } = fakeClient([
      {
        Contents: [
          { Key: 'reports/run-1/unit/' },
          { Key: 'reports/run-1/integration/users.json' },
          { Key: 'reports/run-1/unit/users.json' },
        ],
      },
    ]);
    const source = new S3ArtifactSource(options(), client);

    const names = [];
    for await (const ref of source.list()) {
      names.push(ref.name);
    }

    expect(names).toEqual(['reports/run-1/unit/users.json']);
  });

  it('asserts the listed ETag when downloading, so an overwrite cannot pass as the old version', async () => {
    const sent: any[] = [];
    const { client } = fakeClient([{ Contents: [] }], sent);
    const source = new S3ArtifactSource(options(), client);

    const body = await source.download({
      source: 's3://test-bucket',
      name: 'reports/run-1/unit/users.json',
      version: 'abc',
      etag: '"abc"',
      createdAt: new Date(),
    });

    expect(body.toString()).toBe('{"report":true}');
    const command = sent.find(candidate => candidate instanceof GetObjectCommand);
    expect(command?.input).toMatchObject({
      Bucket: 'test-bucket',
      Key: 'reports/run-1/unit/users.json',
      IfMatch: '"abc"',
    });
  });
});
