import { ConfigReader } from '@backstage/config';

import { readBrunoConfig } from './config';

function read(bruno: unknown) {
  return readBrunoConfig(new ConfigReader(bruno === undefined ? {} : { bruno }));
}

describe('readBrunoConfig source', () => {
  it('defaults to GCS with the historical bucket and prefix', () => {
    expect(read(undefined).source).toEqual({
      type: 'gcs',
      bucket: '1e42-exchange',
      prefix: 'ui_tests/reports/bruno/',
      requiredPathSegment: 'unit',
    });
  });

  it('still honours the pre-source bucket and objectPrefix keys', () => {
    expect(read({ bucket: 'legacy', objectPrefix: 'reports/' }).source).toEqual({
      type: 'gcs',
      bucket: 'legacy',
      prefix: 'reports/',
      requiredPathSegment: 'unit',
    });
  });

  it('refuses the old and the new form together rather than picking one', () => {
    expect(() => read({ bucket: 'legacy', source: { type: 'gcs', gcs: { bucket: 'new' } } })).toThrow(
      /cannot be combined/,
    );
  });

  it('reads a gcs source', () => {
    expect(read({ source: { type: 'gcs', gcs: { bucket: 'reports', prefix: 'bruno/' } } }).source).toEqual({
      type: 'gcs',
      bucket: 'reports',
      prefix: 'bruno/',
      requiredPathSegment: 'unit',
    });
  });

  it('reads an s3 source', () => {
    expect(
      read({
        source: {
          type: 's3',
          s3: { bucket: 'reports', prefix: 'bruno/', region: 'eu-west-1', forcePathStyle: true },
        },
      }).source,
    ).toEqual({
      type: 's3',
      bucket: 'reports',
      prefix: 'bruno/',
      requiredPathSegment: 'unit',
      region: 'eu-west-1',
      endpoint: undefined,
      forcePathStyle: true,
      accountId: undefined,
    });
  });

  it('lets requiredPathSegment: false accept every object under the prefix', () => {
    const source = read({ source: { type: 's3', s3: { bucket: 'reports', requiredPathSegment: false } } }).source;
    expect(source).toMatchObject({ requiredPathSegment: '' });
  });

  it('rejects a requiredPathSegment that is neither a name nor false', () => {
    expect(() => read({ source: { type: 'gcs', gcs: { bucket: 'reports', requiredPathSegment: 3 } } })).toThrow(
      /must be a directory name/,
    );
  });

  it('reads a github source and splits the repository', () => {
    expect(
      read({
        source: { type: 'github', github: { repository: 'my-org/my-repo', namePrefix: 'bruno-', branch: 'main' } },
      }).source,
    ).toEqual({
      type: 'github',
      host: 'github.com',
      owner: 'my-org',
      repo: 'my-repo',
      namePrefix: 'bruno-',
      branch: 'main',
    });
  });

  it('rejects a repository that is not owner/repo', () => {
    expect(() => read({ source: { type: 'github', github: { repository: 'my-repo' } } })).toThrow(
      /must be 'owner\/repo'/,
    );
  });

  it('rejects an unknown source type', () => {
    expect(() => read({ source: { type: 'ftp' } })).toThrow(/must be one of/);
  });
});
