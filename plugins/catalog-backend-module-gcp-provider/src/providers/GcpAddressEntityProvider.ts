import { DeferredEntity } from '@backstage/plugin-catalog-node';
import { compute_v1, google } from 'googleapis';
import { GcpRestEntityProvider } from './GcpRestEntityProvider';
import { ANNOTATION_GCP_STATUS } from '../constants';
import { lastSegment } from '../utils';

/**
 * Reserved IP addresses, regional and global.
 *
 * The address is often the thing a human knows about a service — a DNS record points at it, a
 * firewall rule allows it — so it is worth having an entity even though it holds no configuration
 * of its own.
 */
export class GcpAddressEntityProvider extends GcpRestEntityProvider<compute_v1.Compute> {
  getProviderName(): string {
    return 'gcp-addresses';
  }

  getProviderConfigKey(): string {
    return 'addresses';
  }

  getClient(): compute_v1.Compute {
    return google.compute({ version: 'v1', auth: this.googleAuth });
  }

  private addressToResource(
    address: compute_v1.Schema$Address,
    scope: string,
    project: string,
  ): DeferredEntity | undefined {
    if (!address.name) {
      return undefined;
    }
    const global = scope === 'global';
    const users = address.users ?? [];

    return this.toEntity(
      {
        name: global ? address.name : `${address.name}-${scope}`,
        projectId: project,
        type: 'ip-address',
        region: global ? undefined : scope,
        selfLink: address.selfLink,
        labels: address.labels,
        title: address.address ?? address.name,
        description: address.description,
        summary: `${address.addressType === 'INTERNAL' ? 'Internal' : 'External'} ${address.address ?? 'address'}, ${(
          address.status ?? 'unknown'
        ).toLocaleLowerCase()}${users.length ? `, used by ${lastSegment(users[0])}` : ''}`,
        consolePath: `networking/addresses/list`,
        tagValues: [address.addressType, address.status, address.purpose],
        annotations: {
          ...(address.address ? { 'cloud.google.com/ip-address': address.address } : {}),
          ...(address.status ? { [ANNOTATION_GCP_STATUS]: address.status } : {}),
        },
      },
      {
        dependsOn: [
          ...(address.subnetwork ? [this.subnetRef(address.subnetwork, project)] : []),
          ...(address.network ? [this.vpcRef(address.network, project)] : []),
        ],
      },
    );
  }

  public async getResources(): Promise<DeferredEntity[]> {
    return this.forEachProject(async project => {
      const [regional, global] = await Promise.all([
        this.listAggregated<compute_v1.Schema$Address, compute_v1.Schema$AddressesScopedList>(
          async pageToken => (await this.client.addresses.aggregatedList({ project, pageToken })).data,
          scoped => scoped.addresses,
        ),
        this.listAll<compute_v1.Schema$Address>(
          async pageToken => (await this.client.globalAddresses.list({ project, pageToken })).data,
        ),
      ]);

      return [
        ...regional.map(({ item, scope }) => this.addressToResource(item, scope, project)),
        ...global.map(address => this.addressToResource(address, 'global', project)),
      ].filter(entity => entity !== undefined);
    });
  }
}
