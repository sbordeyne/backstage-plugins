import { DeferredEntity } from '@backstage/plugin-catalog-node';
import { compute_v1, google } from 'googleapis';
import { GcpRestEntityProvider } from './GcpRestEntityProvider';
import { ANNOTATION_GCP_PEERINGS } from '../constants';

/**
 * VPC networks.
 *
 * Networks carry no GCP labels — the API has no field for them — so ownership and system always
 * come from configuration rather than from the resource.
 */
export class GcpVpcEntityProvider extends GcpRestEntityProvider<compute_v1.Compute> {
  getProviderName(): string {
    return 'gcp-vpc';
  }

  getProviderConfigKey(): string {
    return 'vpc';
  }

  getClient(): compute_v1.Compute {
    return google.compute({ version: 'v1', auth: this.googleAuth });
  }

  private networkToResource(network: compute_v1.Schema$Network, project: string): DeferredEntity | undefined {
    if (!network.name) {
      return undefined;
    }
    // Peerings are a field on the network rather than a resource of their own, so they become
    // relations to the peer network plus an annotation naming them.
    const peerings = (network.peerings ?? []).filter(peering => peering.network);
    const mode = network.autoCreateSubnetworks ? 'auto mode' : 'custom mode';

    return this.toEntity(
      {
        name: network.name,
        projectId: project,
        type: 'vpc-network',
        selfLink: network.selfLink,
        description: network.description,
        summary: `${mode} VPC network with ${network.subnetworks?.length ?? 0} subnet(s)`,
        consolePath: `networking/networks/details/${network.name}`,
        logFilter: `resource.type="gce_network" resource.labels.network_id="${network.id ?? network.name}"`,
        tagValues: [network.autoCreateSubnetworks ? 'auto-mode' : 'custom-mode', network.routingConfig?.routingMode],
        annotations: {
          ...(peerings.length > 0
            ? { [ANNOTATION_GCP_PEERINGS]: peerings.map(peering => peering.name ?? '').join(',') }
            : {}),
        },
      },
      { dependsOn: peerings.map(peering => this.vpcRef(peering.network, project)) },
    );
  }

  public async getResources(): Promise<DeferredEntity[]> {
    return this.forEachProject(async project => {
      const networks = await this.listAll<compute_v1.Schema$Network>(
        async pageToken => (await this.client.networks.list({ project, pageToken })).data,
      );
      return networks.map(network => this.networkToResource(network, project)).filter(entity => entity !== undefined);
    });
  }
}
