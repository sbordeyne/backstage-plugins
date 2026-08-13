import { DeferredEntity } from '@backstage/plugin-catalog-node';
import { compute_v1, google } from 'googleapis';
import { GcpRestEntityProvider } from './GcpRestEntityProvider';
import { lastSegment } from '../utils';

/**
 * Managed instance groups.
 *
 * The group is the stable thing an autoscaled fleet is known by, which is why it is worth
 * cataloguing even where the instances themselves are too short-lived to be.
 */
export class GcpInstanceGroupEntityProvider extends GcpRestEntityProvider<compute_v1.Compute> {
  getProviderName(): string {
    return 'gcp-instance-groups';
  }

  getProviderConfigKey(): string {
    return 'instance-groups';
  }

  getClient(): compute_v1.Compute {
    return google.compute({ version: 'v1', auth: this.googleAuth });
  }

  private groupToResource(
    group: compute_v1.Schema$InstanceGroupManager,
    scope: string,
    project: string,
  ): DeferredEntity | undefined {
    if (!group.name) {
      return undefined;
    }
    const template = lastSegment(group.instanceTemplate);

    return this.toEntity({
      name: group.name,
      projectId: project,
      type: 'instance-group',
      region: scope,
      selfLink: group.selfLink,
      description: group.description,
      summary: `Managed instance group of ${group.targetSize ?? 0} instance(s) in ${scope}${
        template ? `, from template ${template}` : ''
      }`,
      consolePath: `compute/instanceGroups/details/${scope}/${group.name}`,
      tagValues: [template, group.status?.isStable ? 'stable' : 'updating'],
      annotations: {
        ...(template ? { 'cloud.google.com/instance-template': template } : {}),
        'cloud.google.com/target-size': String(group.targetSize ?? 0),
      },
    });
  }

  public async getResources(): Promise<DeferredEntity[]> {
    return this.forEachProject(async project => {
      const groups = await this.listAggregated<
        compute_v1.Schema$InstanceGroupManager,
        compute_v1.Schema$InstanceGroupManagersScopedList
      >(
        async pageToken => (await this.client.instanceGroupManagers.aggregatedList({ project, pageToken })).data,
        scoped => scoped.instanceGroupManagers,
      );
      return groups
        .map(({ item, scope }) => this.groupToResource(item, scope, project))
        .filter(entity => entity !== undefined);
    });
  }
}
