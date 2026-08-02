import * as storage from '@google-cloud/storage';

import { GcsArtifactSource } from './GcsArtifactSource';

interface FakeFile {
  name: string;
  metadata?: Record<string, unknown>;
}

function fakeStorage(files: FakeFile[], capture: { options?: Record<string, unknown> }) {
  return {
    bucket: () => ({
      getFilesStream: (options: Record<string, unknown>) => {
        capture.options = options;
        return (async function* generate() {
          for (const file of files) {
            yield file;
          }
        })();
      },
    }),
  } as unknown as storage.Storage;
}

function sourceOptions(prefix: string, requiredPathSegment = 'unit') {
  return { bucket: 'test-bucket', prefix, requiredPathSegment };
}

describe('GcsArtifactSource', () => {
  it('maps object metadata onto the artifact ref', async () => {
    const capture: { options?: Record<string, unknown> } = {};
    const client = fakeStorage(
      [
        {
          name: 'ui_tests/reports/bruno/run/unit/users.json',
          metadata: {
            generation: '1782910747095999',
            etag: 'abc',
            timeCreated: '2026-07-01T12:59:07.098Z',
            size: '495049',
          },
        },
      ],
      capture,
    );
    const source = new GcsArtifactSource(sourceOptions('ui_tests/reports/bruno/'), client);

    const refs = [];
    for await (const ref of source.list()) {
      refs.push(ref);
    }

    expect(refs).toEqual([
      {
        source: 'gs://test-bucket',
        name: 'ui_tests/reports/bruno/run/unit/users.json',
        version: '1782910747095999',
        etag: 'abc',
        createdAt: new Date('2026-07-01T12:59:07.098Z'),
        sizeBytes: 495049,
      },
    ]);
  });

  it('does not restrict the listing to a field projection', async () => {
    // A `fields` projection stops the client populating File#metadata entirely,
    // so every ref loses the generation the sync diffs on and listing throws.
    const capture: { options?: Record<string, unknown> } = {};
    const source = new GcsArtifactSource(sourceOptions('prefix/'), fakeStorage([], capture));

    for await (const _ of source.list()) {
      // drain
    }

    expect(capture.options).not.toHaveProperty('fields');
  });

  it('tolerates an object with no metadata', async () => {
    const capture: { options?: Record<string, unknown> } = {};
    const source = new GcsArtifactSource(
      sourceOptions('ui_tests/reports/bruno/'),
      fakeStorage([{ name: 'ui_tests/reports/bruno/run/unit/users.json' }], capture),
    );

    const refs = [];
    for await (const ref of source.list()) {
      refs.push(ref);
    }

    expect(refs).toHaveLength(1);
    expect(refs[0].version).toBe('');
  });
});
