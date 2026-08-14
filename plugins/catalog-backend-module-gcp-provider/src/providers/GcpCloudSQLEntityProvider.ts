import { DeferredEntity } from '@backstage/plugin-catalog-node';
import { google, sqladmin_v1beta4 } from 'googleapis';
import { GcpRestEntityProvider } from './GcpRestEntityProvider';

/** Cloud SQL instances. */
export class GcpCloudSQLEntityProvider extends GcpRestEntityProvider<sqladmin_v1beta4.Sqladmin> {
  getProviderName(): string {
    return 'gcp-cloudsql';
  }

  getProviderConfigKey(): string {
    return 'cloudsql';
  }

  getClient(): sqladmin_v1beta4.Sqladmin {
    return google.sqladmin({ version: 'v1beta4', auth: this.googleAuth });
  }

  private sqlInstanceToResource(
    instance: sqladmin_v1beta4.Schema$DatabaseInstance,
    project: string,
  ): DeferredEntity | undefined {
    if (!instance.name) {
      return undefined;
    }
    const region = instance.region;
    if (!this.includesLocation(region)) {
      return undefined;
    }
    const projectId = instance.project ?? project;
    const labels = instance.settings?.userLabels;

    return this.toEntity(
      {
        name: instance.name,
        projectId,
        type: 'cloudsql-instance',
        region,
        selfLink: instance.selfLink,
        labels,
        summary: `${instance.databaseVersion ?? 'Cloud SQL'} instance in ${region ?? 'an unreported region'}`,
        consolePath: `sql/instances/${instance.name}/overview`,
        logFilter: `resource.type="cloudsql_database" resource.labels.database_id="${projectId}:${instance.name}"`,
        tagValues: [instance.databaseVersion, instance.settings?.tier, instance.state],
        assetName: `//cloudsql.googleapis.com/projects/${projectId}/instances/${instance.name}`,
      },
      {
        // A private-IP instance is only reachable from the network it is peered with.
        dependsOn: instance.settings?.ipConfiguration?.privateNetwork
          ? [this.vpcRef(instance.settings.ipConfiguration.privateNetwork, projectId)]
          : [],
      },
    );
  }

  public async getResources(): Promise<DeferredEntity[]> {
    return this.forEachProject(async project => {
      const instances = await this.listAll<sqladmin_v1beta4.Schema$DatabaseInstance>(async pageToken => {
        const { data } = await this.client.instances.list({ project, pageToken });
        return { items: data.items, nextPageToken: data.nextPageToken };
      });
      return instances
        .map(instance => this.sqlInstanceToResource(instance, project))
        .filter(entity => entity !== undefined);
    });
  }
}
