import {
  DeferredEntity,
  EntityProvider,
  EntityProviderConnection,
} from '@backstage/plugin-catalog-node';
import { Config } from '@backstage/config';
import {
  LoggerService,
  SchedulerService,
  SchedulerServiceTaskRunner,
  readSchedulerServiceTaskScheduleDefinitionFromConfig,
} from '@backstage/backend-plugin-api';
import { JWTInput } from 'google-auth-library';
import fs from 'fs';
import jmespath from 'jmespath';

/**
 * Catalog provider to ingest GKE clusters
 *
 * @public
 */
export abstract class GcpEntityProviderBase<TClient> implements EntityProvider {
  protected readonly logger: LoggerService;
  private readonly scheduleFn: () => Promise<void>;
  protected readonly config: Config;
  protected readonly client: TClient;
  private connection?: EntityProviderConnection;
  protected credentials?: JWTInput;

  public constructor(
    logger: LoggerService,
    scheduler: SchedulerService,
    config: Config,
  ) {
    const providerConfig = config.getConfig(`catalog.providers.gcp.${this.getProviderConfigKey()}`);
    const schedule = readSchedulerServiceTaskScheduleDefinitionFromConfig(
      providerConfig.getConfig('schedule'),
    );

    if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      logger.info(`Using GOOGLE_APPLICATION_CREDENTIALS: ${process.env.GOOGLE_APPLICATION_CREDENTIALS}`);
      const credentialsFile = fs.readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS, 'utf8');
      this.credentials = JSON.parse(credentialsFile);
    } else {
      this.credentials = undefined;
    }
    // Parse the credentials file and create a BigQuery client
    // This assumes the credentials file is in JSON format
    // and contains the necessary fields for authentication.
    this.logger = logger;
    this.scheduleFn = this.createScheduleFn(scheduler.createScheduledTaskRunner(schedule));
    this.config = providerConfig;
    this.client = this.getClient();
  }

  abstract getProviderName(): string;

  abstract getProviderConfigKey(): string;

  abstract getClient(): TClient;

  async connect(connection: EntityProviderConnection): Promise<void> {
    this.connection = connection;
    await this.scheduleFn();
  }

  private createScheduleFn(
    taskRunner: SchedulerServiceTaskRunner,
  ): () => Promise<void> {
    return async () => {
      const taskId = `${this.getProviderName()}:refresh`;
      return taskRunner.run({
        id: taskId,
        fn: async () => {
          try {
            await this.refresh();
          } catch (error) {
            this.logger.error("Error:", (error as Error));
          }
        },
      });
    };
  }

  abstract getResources(): Promise<DeferredEntity[]>;

  protected getOwnerReference<T>(resource: T): string {
    const jmesPath = this.config.getOptionalString('ownerPathExpression');
    if (!jmesPath) {
      return 'unknown';  // No owner path expression defined, default to 'unknown'
    }
    const owner = jmespath.search(resource, jmesPath);
    if (typeof owner === 'string' && owner.length > 0) {
      return owner;
    }
    this.logger.warn(`Owner path expression '${jmesPath}' did not return a valid owner reference for resource: ${JSON.stringify(resource)}`);
    return 'unknown';  // Return 'unknown' if no valid owner reference is found
  }

  async refresh() {
    if (!this.connection) {
      throw new Error('Not initialized');
    }

    this.logger.info('Discovering GCP resources');

    let resources: DeferredEntity[];

    try {
      resources = await this.getResources();
    } catch (e) {
      this.logger.error('error fetching GCP resources', (e as Error) );
      return;
    }

    this.logger.info(
      `Ingesting GCP resources [${resources
        .map(r => r.entity.metadata.name)
        .join(', ')}]`,
    );

    await this.connection.applyMutation({
      type: 'full',
      entities: resources,
    });
  }
}
