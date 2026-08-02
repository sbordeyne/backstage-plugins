import {
  SchedulerServiceTaskScheduleDefinition,
  readSchedulerServiceTaskScheduleDefinitionFromConfig,
} from '@backstage/backend-plugin-api';
import type { Config } from '@backstage/config';

export const DEFAULT_REPORT_ANNOTATION = 'usebruno.com/report-path';

const DEFAULT_SCHEDULE: SchedulerServiceTaskScheduleDefinition = {
  initialDelay: { seconds: 30 },
  frequency: { minutes: 15 },
  timeout: { minutes: 10 },
};

export interface BrunoConfig {
  bucket: string;
  objectPrefix: string;
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
    bucket: config?.getOptionalString('bucket') ?? '1e42-exchange',
    objectPrefix: config?.getOptionalString('objectPrefix') ?? 'ui_tests/reports/bruno/',
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
