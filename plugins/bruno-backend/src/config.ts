import {
  SchedulerServiceTaskScheduleDefinition,
  readSchedulerServiceTaskScheduleDefinitionFromConfig,
} from '@backstage/backend-plugin-api';
import type { Config } from '@backstage/config';
import { InputError } from '@backstage/errors';

import type { BrunoSourceType } from './sources';

export const DEFAULT_REPORT_ANNOTATION = 'usebruno.com/report-path';
export const DEFAULT_OBJECT_PREFIX = 'ui_tests/reports/bruno/';
/** Keeps only objects sitting directly under a `unit/` segment, as the sync always has. */
export const DEFAULT_REQUIRED_PATH_SEGMENT = 'unit';

const DEFAULT_SCHEDULE: SchedulerServiceTaskScheduleDefinition = {
  initialDelay: { seconds: 30 },
  frequency: { minutes: 15 },
  timeout: { minutes: 10 },
};

/** Settings shared by the object store sources, which differ only in which store they talk to. */
export interface BrunoObjectStoreSourceConfig {
  bucket: string;
  prefix: string;
  requiredPathSegment: string;
}

export type BrunoSourceConfig =
  | ({ type: 'gcs' } & BrunoObjectStoreSourceConfig)
  | ({
      type: 's3';
      region?: string;
      endpoint?: string;
      forcePathStyle: boolean;
      accountId?: string;
    } & BrunoObjectStoreSourceConfig)
  | {
      type: 'github';
      host: string;
      owner: string;
      repo: string;
      namePrefix: string;
      branch: string;
    };

export interface BrunoConfig {
  source: BrunoSourceConfig;
  reportAnnotation: string;
  retention: {
    runsPerEntity: number;
  };
  sync: {
    enabled: boolean;
    concurrency: number;
    maxObjectSizeBytes: number;
    maxStoredBodyBytes: number;
    /** Milliseconds, or undefined to consider every artifact. */
    maxArtifactAgeMs?: number;
    schedule: SchedulerServiceTaskScheduleDefinition;
  };
}

export function readBrunoConfig(rootConfig: Config): BrunoConfig {
  const config = rootConfig.getOptionalConfig('bruno');

  return {
    source: readSourceConfig(config),
    reportAnnotation: config?.getOptionalString('reportAnnotation') ?? DEFAULT_REPORT_ANNOTATION,
    retention: {
      runsPerEntity: config?.getOptionalNumber('retention.runsPerEntity') ?? 20,
    },
    sync: {
      enabled: config?.getOptionalBoolean('sync.enabled') ?? true,
      concurrency: config?.getOptionalNumber('sync.concurrency') ?? 5,
      maxObjectSizeBytes: config?.getOptionalNumber('sync.maxObjectSizeBytes') ?? 25 * 1024 * 1024,
      maxStoredBodyBytes: config?.getOptionalNumber('sync.maxStoredBodyBytes') ?? 256 * 1024,
      maxArtifactAgeMs: readMaxArtifactAgeMs(config),
      schedule: readSchedule(config),
    },
  };
}

/**
 * Which store the reports are read from.
 *
 * `bruno.bucket` and `bruno.objectPrefix` predate the `source` block and still work on their own,
 * meaning GCS — an installation that has them keeps working untouched. Setting both forms is
 * refused rather than silently resolved, since only one of them can be the intended one.
 */
function readSourceConfig(config?: Config): BrunoSourceConfig {
  const legacyBucket = config?.getOptionalString('bucket');
  const legacyPrefix = config?.getOptionalString('objectPrefix');
  const source = config?.getOptionalConfig('source');

  if (source && (legacyBucket !== undefined || legacyPrefix !== undefined)) {
    throw new InputError(
      'bruno.source cannot be combined with the deprecated bruno.bucket / bruno.objectPrefix; ' +
        'move them under bruno.source.gcs',
    );
  }

  if (!source) {
    return {
      type: 'gcs',
      bucket: legacyBucket ?? '1e42-exchange',
      prefix: legacyPrefix ?? DEFAULT_OBJECT_PREFIX,
      requiredPathSegment: DEFAULT_REQUIRED_PATH_SEGMENT,
    };
  }

  const type = source.getOptionalString('type') ?? 'gcs';
  switch (type as BrunoSourceType) {
    case 'gcs':
      return { type: 'gcs', ...readObjectStoreConfig(source, 'gcs') };
    case 's3': {
      const s3 = source.getConfig('s3');
      return {
        type: 's3',
        ...readObjectStoreConfig(source, 's3'),
        region: s3.getOptionalString('region'),
        endpoint: s3.getOptionalString('endpoint'),
        forcePathStyle: s3.getOptionalBoolean('forcePathStyle') ?? false,
        accountId: s3.getOptionalString('accountId'),
      };
    }
    case 'github': {
      const github = source.getConfig('github');
      const repository = github.getString('repository');
      const [owner, repo] = repository.split('/');
      if (!owner || !repo || repository.split('/').length !== 2) {
        throw new InputError(`bruno.source.github.repository must be 'owner/repo', got '${repository}'`);
      }
      return {
        type: 'github',
        host: github.getOptionalString('host') ?? 'github.com',
        owner,
        repo,
        namePrefix: github.getOptionalString('namePrefix') ?? '',
        branch: github.getOptionalString('branch') ?? '',
      };
    }
    default:
      throw new InputError(`bruno.source.type must be one of 'gcs', 's3' or 'github', got '${type}'`);
  }
}

function readObjectStoreConfig(source: Config, key: 'gcs' | 's3'): BrunoObjectStoreSourceConfig {
  const store = source.getConfig(key);
  return {
    bucket: store.getString('bucket'),
    prefix: store.getOptionalString('prefix') ?? DEFAULT_OBJECT_PREFIX,
    requiredPathSegment: readRequiredPathSegment(store),
  };
}

/**
 * The directory an object has to sit directly under, or nothing at all.
 *
 * `false` is what a layout with no suite directory sets, because the typed readers reject an empty
 * string outright and a YAML `null` never reaches the reader — leaving no other way to say "no
 * requirement" once the default is a real segment.
 */
function readRequiredPathSegment(store: Config): string {
  const raw = store.getOptional('requiredPathSegment');
  if (raw === undefined) {
    return DEFAULT_REQUIRED_PATH_SEGMENT;
  }
  if (raw === false || raw === '') {
    return '';
  }
  if (typeof raw !== 'string') {
    throw new InputError(
      `requiredPathSegment must be a directory name, or false to accept every object under the prefix, got '${raw}'`,
    );
  }
  return raw;
}

function readSchedule(config?: Config): SchedulerServiceTaskScheduleDefinition {
  // readSchedulerServiceTaskScheduleDefinitionFromConfig throws on a missing
  // config object, so the presence check has to come first.
  if (!config?.has('sync.schedule')) {
    return DEFAULT_SCHEDULE;
  }
  return readSchedulerServiceTaskScheduleDefinitionFromConfig(config.getConfig('sync.schedule'));
}

function readMaxArtifactAgeMs(config?: Config): number | undefined {
  const age = config?.getOptionalConfig('sync.maxArtifactAge');
  if (!age) {
    return undefined;
  }
  const days = age.getOptionalNumber('days') ?? 0;
  const hours = age.getOptionalNumber('hours') ?? 0;
  const totalMs = (days * 24 + hours) * 60 * 60 * 1000;
  return totalMs > 0 ? totalMs : undefined;
}
