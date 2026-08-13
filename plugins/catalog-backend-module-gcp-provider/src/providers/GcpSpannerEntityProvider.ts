import { DeferredEntity } from '@backstage/plugin-catalog-node';
import { google, spanner_v1 } from 'googleapis';
import { GcpRestEntityProvider } from './GcpRestEntityProvider';
import { ANNOTATION_GCP_STATUS } from '../constants';
import { apiSelfLink, lastSegment } from '../utils';

/**
 * Spanner instances and the databases on them.
 *
 * Both come from one provider because a database is only reachable through its instance's name,
 * so listing them separately would mean listing the instances twice.
 */
export class GcpSpannerEntityProvider extends GcpRestEntityProvider<spanner_v1.Spanner> {
  getProviderName(): string {
    return 'gcp-spanner';
  }

  getProviderConfigKey(): string {
    return 'spanner';
  }

  getClient(): spanner_v1.Spanner {
    return google.spanner({ version: 'v1', auth: this.googleAuth });
  }

  private databaseToResource(
    database: spanner_v1.Schema$Database,
    instanceId: string,
    region: string | undefined,
    project: string,
    instanceRef: string,
  ): DeferredEntity | undefined {
    const databaseId = lastSegment(database.name);
    if (!databaseId) {
      return undefined;
    }

    return this.toEntity(
      {
        // Database names are unique per instance, not per project.
        name: `${instanceId}-${databaseId}`,
        projectId: project,
        type: 'spanner-database',
        region,
        selfLink: apiSelfLink('spanner.googleapis.com', 'v1', database.name),
        title: databaseId,
        summary: `Spanner ${(database.databaseDialect ?? 'GOOGLE_STANDARD_SQL')
          .toLocaleLowerCase()
          .replace(/_/g, ' ')} database on instance ${instanceId}`,
        consolePath: `spanner/instances/${instanceId}/databases/${databaseId}/details/tables`,
        logFilter: `resource.type="spanner_instance" resource.labels.instance_id="${instanceId}"`,
        tagValues: [database.databaseDialect, database.state],
        annotations: {
          ...(database.state ? { [ANNOTATION_GCP_STATUS]: database.state } : {}),
        },
      },
      { partOf: [instanceRef] },
    );
  }

  private async instanceToResources(instance: spanner_v1.Schema$Instance, project: string): Promise<DeferredEntity[]> {
    const instanceId = lastSegment(instance.name);
    if (!instanceId) {
      return [];
    }
    // The instance config names the region it runs in: `projects/p/instanceConfigs/regional-europe-west1`.
    const region = lastSegment(instance.config).replace(/^regional-/, '') || undefined;
    const capacity = instance.nodeCount
      ? `${instance.nodeCount} node(s)`
      : `${instance.processingUnits ?? 0} processing unit(s)`;

    const instanceRef = this.ownRef({
      projectId: project,
      type: 'spanner-instance',
      provider: this.getProviderName(),
      region,
      name: instanceId,
    });

    const instanceEntity = this.toEntity({
      name: instanceId,
      projectId: project,
      type: 'spanner-instance',
      region,
      selfLink: apiSelfLink('spanner.googleapis.com', 'v1', instance.name),
      labels: instance.labels,
      title: instance.displayName,
      summary: `Spanner instance with ${capacity} in ${region ?? 'an unreported region'}`,
      consolePath: `spanner/instances/${instanceId}/details/databases`,
      logFilter: `resource.type="spanner_instance" resource.labels.instance_id="${instanceId}"`,
      tagValues: [instance.state, lastSegment(instance.config)],
      annotations: {
        ...(instance.state ? { [ANNOTATION_GCP_STATUS]: instance.state } : {}),
      },
    });

    const databases = await this.listAll<spanner_v1.Schema$Database>(async pageToken => {
      const { data } = await this.client.projects.instances.databases.list({ parent: instance.name!, pageToken });
      return { items: data.databases, nextPageToken: data.nextPageToken };
    });

    return [
      instanceEntity,
      ...databases
        .map(database => this.databaseToResource(database, instanceId, region, project, instanceRef))
        .filter(entity => entity !== undefined),
    ];
  }

  public async getResources(): Promise<DeferredEntity[]> {
    return this.forEachProject(async project => {
      const instances = await this.listAll<spanner_v1.Schema$Instance>(async pageToken => {
        const { data } = await this.client.projects.instances.list({ parent: `projects/${project}`, pageToken });
        return { items: data.instances, nextPageToken: data.nextPageToken };
      });
      const entities = await Promise.all(
        instances.filter(instance => instance.name).map(instance => this.instanceToResources(instance, project)),
      );
      return entities.flat();
    });
  }
}
