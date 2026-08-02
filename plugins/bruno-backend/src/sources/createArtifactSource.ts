import { S3Client } from '@aws-sdk/client-s3';
import type { LoggerService } from '@backstage/backend-plugin-api';
import type { Config } from '@backstage/config';
import { DefaultGithubCredentialsProvider, ScmIntegrations } from '@backstage/integration';
import { DefaultAwsCredentialsManager } from '@backstage/integration-aws-node';
import { Octokit } from '@octokit/rest';

import type { BrunoSourceConfig } from '../config';
import { GcsArtifactSource } from './GcsArtifactSource';
import { GithubArtifactSource } from './GithubArtifactSource';
import { S3ArtifactSource } from './S3ArtifactSource';
import type { BrunoArtifactSource } from './types';

export interface CreateArtifactSourceOptions {
  source: BrunoSourceConfig;
  /** Cap on a single artifact, so an archive cannot expand past what the sync would accept. */
  maxObjectSizeBytes: number;
  rootConfig: Config;
  logger: LoggerService;
}

/**
 * Builds the configured source, resolving credentials the way the rest of Backstage does: the AWS
 * credentials manager for S3 and the GitHub integration for artifacts, so neither needs a
 * credential of its own in the `bruno` block.
 */
export async function createArtifactSource(options: CreateArtifactSourceOptions): Promise<BrunoArtifactSource> {
  const { source, rootConfig, logger } = options;

  switch (source.type) {
    case 'gcs':
      logger.info(`Bruno reads artifacts from gs://${source.bucket}/${source.prefix}`);
      return new GcsArtifactSource(source);

    case 's3': {
      const credentialsManager = DefaultAwsCredentialsManager.fromConfig(rootConfig);
      const { sdkCredentialProvider, stsRegion } = await credentialsManager.getCredentialProvider({
        accountId: source.accountId,
      });

      const region = source.region ?? stsRegion ?? process.env.AWS_REGION;
      if (!region) {
        throw new Error(
          'No AWS region for the Bruno S3 source: set bruno.source.s3.region, an aws.accounts region, or AWS_REGION',
        );
      }

      logger.info(`Bruno reads artifacts from s3://${source.bucket}/${source.prefix} in ${region}`);
      return new S3ArtifactSource(
        source,
        new S3Client({
          region,
          credentials: sdkCredentialProvider,
          endpoint: source.endpoint,
          forcePathStyle: source.forcePathStyle,
        }),
      );
    }

    case 'github': {
      const integrations = ScmIntegrations.fromConfig(rootConfig);
      const integration = integrations.github.byHost(source.host);
      if (!integration) {
        throw new Error(`No integrations.github entry for host '${source.host}', required by the Bruno source`);
      }

      const credentialsProvider = DefaultGithubCredentialsProvider.fromIntegrations(integrations);
      const { token } = await credentialsProvider.getCredentials({
        url: `https://${source.host}/${source.owner}/${source.repo}`,
      });

      logger.info(`Bruno reads artifacts from GitHub Actions in ${source.owner}/${source.repo}`);
      return new GithubArtifactSource(
        { ...source, maxEntryBytes: options.maxObjectSizeBytes },
        new Octokit({ auth: token, baseUrl: integration.config.apiBaseUrl }),
      );
    }

    default: {
      // Exhaustive: a new source type has to be handled here to compile.
      const exhaustive: never = source;
      throw new Error(`Unsupported Bruno source ${JSON.stringify(exhaustive)}`);
    }
  }
}
