import { DeferredEntity, EntityProvider, EntityProviderConnection } from '@backstage/plugin-catalog-node';
import { Config } from '@backstage/config';
import {
  LoggerService,
  SchedulerService,
  SchedulerServiceTaskRunner,
  readSchedulerServiceTaskScheduleDefinitionFromConfig,
} from '@backstage/backend-plugin-api';
import { JWTInput } from 'google-auth-library';
import fs from 'fs';
import { DEFAULT_OWNER_LABEL } from '../constants';
import { GcpLabels, parseOwnerRef, readLabel } from '../utils';

/**
 * Catalog provider to ingest GKE clusters
 *
 * @public
 */
export abstract class GcpEntityProviderBase<TClient> implements EntityProvider {
  protected readonly logger: LoggerService;
  private readonly scheduleFn: () => Promise<void>;
  protected readonly config: Config;
  /** `catalog.providers.gcp`, holding the defaults shared by every provider. */
  protected readonly gcpConfig: Config;
  protected readonly client: TClient;
  private connection?: EntityProviderConnection;
  protected credentials?: JWTInput;

  public constructor(logger: LoggerService, scheduler: SchedulerService, config: Config) {
    const gcpConfig = config.getConfig('catalog.providers.gcp');
    const providerConfig = gcpConfig.getConfig(this.getProviderConfigKey());
    const schedule = readSchedulerServiceTaskScheduleDefinitionFromConfig(providerConfig.getConfig('schedule'));

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
    this.gcpConfig = gcpConfig;
    this.client = this.getClient();
  }

  /**
   * Owner used for a resource that names none of its own.
   *
   * Read first from this provider's `owner`, then from the shared
   * `catalog.providers.gcp.defaultOwner`. The `unknown` fallback is a valid group ref, so the
   * catalog still accepts the entity, and an obviously wrong one, so unconfigured installations are
   * visible rather than silently misfiled.
   */
  protected get defaultOwner(): string {
    return this.config.getOptionalString('owner') ?? this.gcpConfig.getOptionalString('defaultOwner') ?? 'unknown';
  }

  /**
   * Label carrying the entity ref of a resource's owner, from this provider's `ownerLabel`, then
   * the shared `catalog.providers.gcp.ownerLabel`, then {@link DEFAULT_OWNER_LABEL}.
   */
  protected get ownerLabel(): string {
    return (
      this.config.getOptionalString('ownerLabel') ??
      this.gcpConfig.getOptionalString('ownerLabel') ??
      DEFAULT_OWNER_LABEL
    );
  }

  /**
   * Owner of a single resource, taken from its labels when they name one and falling back to
   * {@link defaultOwner} when they do not.
   *
   * Ownership is claimed on the GCP side rather than configured here, so a team that relabels a
   * resource moves it in the catalog without anyone touching Backstage config. A label that is not
   * a usable entity ref is logged and ignored, because a rejected entity would take the whole
   * project's mutation down with it.
   */
  protected ownerOf(labels: GcpLabels): string {
    const value = readLabel(labels, this.ownerLabel);
    if (!value) {
      return this.defaultOwner;
    }
    try {
      return parseOwnerRef(value);
    } catch (error) {
      this.logger.warn(
        `Ignoring ${this.ownerLabel}='${value}', not a valid entity ref, using ${this.defaultOwner} instead`,
        error as Error,
      );
      return this.defaultOwner;
    }
  }

  /**
   * Region recorded when the GCP API reports none for a resource.
   *
   * Undefined means the region annotation is left off entirely — an absent region is honest, a
   * guessed one silently misplaces the resource.
   */
  protected get defaultRegion(): string | undefined {
    return this.config.getOptionalString('region') ?? this.gcpConfig.getOptionalString('defaultRegion');
  }

  abstract getProviderName(): string;

  abstract getProviderConfigKey(): string;

  abstract getClient(): TClient;

  async connect(connection: EntityProviderConnection): Promise<void> {
    this.connection = connection;
    await this.scheduleFn();
  }

  private createScheduleFn(taskRunner: SchedulerServiceTaskRunner): () => Promise<void> {
    return async () => {
      const taskId = `${this.getProviderName()}:refresh`;
      return taskRunner.run({
        id: taskId,
        fn: async () => {
          try {
            await this.refresh();
          } catch (error) {
            this.logger.error('Error:', error as Error);
          }
        },
      });
    };
  }

  abstract getResources(): Promise<DeferredEntity[]>;

  async refresh() {
    if (!this.connection) {
      throw new Error('Not initialized');
    }

    this.logger.info('Discovering GCP resources');

    let resources: DeferredEntity[];

    try {
      resources = await this.getResources();
    } catch (e) {
      this.logger.error('error fetching GCP resources', e as Error);
      return;
    }

    this.logger.info(`Ingesting GCP resources [${resources.map(r => r.entity.metadata.name).join(', ')}]`);

    await this.connection.applyMutation({
      type: 'full',
      entities: resources,
    });
  }
}
