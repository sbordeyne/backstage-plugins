import { DeferredEntity } from '@backstage/plugin-catalog-node';
import { compute_v1, google } from 'googleapis';
import { GcpRestEntityProvider } from './GcpRestEntityProvider';

/** Subnetworks, listed across every region in one aggregated call. */
export class GcpSubnetEntityProvider extends GcpRestEntityProvider<compute_v1.Compute> {
  getProviderName(): string {
    return 'gcp-subnets';
  }

  getProviderConfigKey(): string {
    return 'subnets';
  }

  getClient(): compute_v1.Compute {
    return google.compute({ version: 'v1', auth: this.googleAuth });
  }

  private subnetToResource(
    subnet: compute_v1.Schema$Subnetwork,
    region: string,
    project: string,
  ): DeferredEntity | undefined {
    if (!subnet.name) {
      return undefined;
    }
    const ranges = [subnet.ipCidrRange, ...(subnet.secondaryIpRanges ?? []).map(range => range.ipCidrRange)].filter(
      Boolean,
    );

    return this.toEntity(
      {
        // Subnet names are only unique within a region, so the region is part of the entity name.
        name: `${subnet.name}-${region}`,
        projectId: project,
        type: 'subnetwork',
        region,
        selfLink: subnet.selfLink,
        title: subnet.name,
        description: subnet.description,
        summary: `Subnet ${ranges.join(', ')} in ${region}`,
        consolePath: `networking/subnetworks/details/${region}/${subnet.name}`,
        tagValues: [
          subnet.purpose,
          subnet.stackType,
          subnet.privateIpGoogleAccess ? 'private-google-access' : undefined,
        ],
        annotations: {
          'cloud.google.com/ip-cidr-range': subnet.ipCidrRange ?? '',
        },
      },
      { attachedTo: [this.vpcRef(subnet.network, project)] },
    );
  }

  public async getResources(): Promise<DeferredEntity[]> {
    return this.forEachProject(async project => {
      const subnets = await this.listAggregated<compute_v1.Schema$Subnetwork, compute_v1.Schema$SubnetworksScopedList>(
        async pageToken => (await this.client.subnetworks.aggregatedList({ project, pageToken })).data,
        scoped => scoped.subnetworks,
      );
      return subnets
        .map(({ item, scope }) => this.subnetToResource(item, scope, project))
        .filter(entity => entity !== undefined);
    });
  }
}
