import { DeferredEntity } from '@backstage/plugin-catalog-node';
import { compute_v1, google } from 'googleapis';
import { GcpRestEntityProvider } from './GcpRestEntityProvider';
import { ANNOTATION_GCP_STATUS } from '../constants';
import { lastSegment, parseResourceUrl } from '../utils';

/**
 * Cloud VPN gateways and the tunnels running over them.
 *
 * A tunnel is where hybrid connectivity actually breaks, so both are ingested: the gateway for the
 * topology, the tunnel for its status.
 */
export class GcpVpnEntityProvider extends GcpRestEntityProvider<compute_v1.Compute> {
  getProviderName(): string {
    return 'gcp-vpn';
  }

  getProviderConfigKey(): string {
    return 'vpn';
  }

  getClient(): compute_v1.Compute {
    return google.compute({ version: 'v1', auth: this.googleAuth });
  }

  private gatewayToResource(
    gateway: compute_v1.Schema$VpnGateway,
    region: string,
    project: string,
  ): DeferredEntity | undefined {
    if (!gateway.name) {
      return undefined;
    }
    return this.toEntity(
      {
        name: `${gateway.name}-${region}`,
        projectId: project,
        type: 'vpn-gateway',
        region,
        selfLink: gateway.selfLink,
        labels: gateway.labels,
        title: gateway.name,
        description: gateway.description,
        summary: `HA VPN gateway in ${region} with ${gateway.vpnInterfaces?.length ?? 0} interface(s)`,
        consolePath: `hybrid/vpn/list`,
        annotations: {
          'cloud.google.com/vpn-interfaces': (gateway.vpnInterfaces ?? [])
            .map(vpnInterface => vpnInterface.ipAddress ?? '')
            .filter(Boolean)
            .join(','),
        },
      },
      { dependsOn: gateway.network ? [this.vpcRef(gateway.network, project)] : [] },
    );
  }

  private tunnelToResource(
    tunnel: compute_v1.Schema$VpnTunnel,
    region: string,
    project: string,
  ): DeferredEntity | undefined {
    if (!tunnel.name) {
      return undefined;
    }
    const gateway = parseResourceUrl(tunnel.vpnGateway);
    const router = tunnel.router ? parseResourceUrl(tunnel.router) : undefined;

    return this.toEntity(
      {
        name: `${tunnel.name}-${region}`,
        projectId: project,
        type: 'vpn-tunnel',
        region,
        selfLink: tunnel.selfLink,
        labels: tunnel.labels,
        title: tunnel.name,
        description: tunnel.description,
        summary: `VPN tunnel to ${tunnel.peerIp ?? lastSegment(tunnel.peerGcpGateway) ?? 'an unreported peer'}, ${(
          tunnel.status ?? 'unknown'
        ).toLocaleLowerCase()}`,
        consolePath: `hybrid/vpn/list`,
        logFilter: `resource.type="vpn_gateway" resource.labels.gateway_id="${gateway.name}"`,
        tagValues: [tunnel.status],
        annotations: {
          ...(tunnel.status ? { [ANNOTATION_GCP_STATUS]: tunnel.status } : {}),
          ...(tunnel.peerIp ? { 'cloud.google.com/vpn-peer-ip': tunnel.peerIp } : {}),
        },
      },
      {
        dependsOn: [
          ...(gateway.name
            ? [
                this.ownRef({
                  projectId: gateway.projectId ?? project,
                  type: 'vpn-gateway',
                  provider: this.getProviderName(),
                  region: gateway.region ?? region,
                  name: `${gateway.name}-${gateway.region ?? region}`,
                }),
              ]
            : []),
          ...(router?.name
            ? [
                this.resourceRef('routers', {
                  projectId: router.projectId ?? project,
                  type: 'cloud-router',
                  provider: 'gcp-routers',
                  region: router.region ?? region,
                  name: router.name,
                }),
              ]
            : []),
        ],
      },
    );
  }

  public async getResources(): Promise<DeferredEntity[]> {
    return this.forEachProject(async project => {
      const [gateways, tunnels] = await Promise.all([
        this.listAggregated<compute_v1.Schema$VpnGateway, compute_v1.Schema$VpnGatewaysScopedList>(
          async pageToken => (await this.client.vpnGateways.aggregatedList({ project, pageToken })).data,
          scoped => scoped.vpnGateways,
        ),
        this.listAggregated<compute_v1.Schema$VpnTunnel, compute_v1.Schema$VpnTunnelsScopedList>(
          async pageToken => (await this.client.vpnTunnels.aggregatedList({ project, pageToken })).data,
          scoped => scoped.vpnTunnels,
        ),
      ]);

      return [
        ...gateways.map(({ item, scope }) => this.gatewayToResource(item, scope, project)),
        ...tunnels.map(({ item, scope }) => this.tunnelToResource(item, scope, project)),
      ].filter(entity => entity !== undefined);
    });
  }
}
