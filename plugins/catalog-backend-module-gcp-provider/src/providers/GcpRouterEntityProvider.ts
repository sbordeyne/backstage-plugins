import { DeferredEntity } from '@backstage/plugin-catalog-node';
import { compute_v1, google } from 'googleapis';
import { GcpRestEntityProvider } from './GcpRestEntityProvider';

/**
 * Cloud Routers, and the NAT gateways configured on them.
 *
 * Cloud NAT has no API of its own — a gateway is an entry in `router.nats[]` — so both resource
 * types come from the same listing, with each gateway depending on the router that carries it.
 */
export class GcpRouterEntityProvider extends GcpRestEntityProvider<compute_v1.Compute> {
  getProviderName(): string {
    return 'gcp-routers';
  }

  getProviderConfigKey(): string {
    return 'routers';
  }

  getClient(): compute_v1.Compute {
    return google.compute({ version: 'v1', auth: this.googleAuth });
  }

  private natToResource(
    nat: compute_v1.Schema$RouterNat,
    router: compute_v1.Schema$Router,
    region: string,
    project: string,
    routerRef: string | undefined,
  ): DeferredEntity | undefined {
    if (!nat.name || !router.name) {
      return undefined;
    }
    const ranges =
      nat.sourceSubnetworkIpRangesToNat === 'ALL_SUBNETWORKS_ALL_IP_RANGES'
        ? 'every subnet'
        : `${nat.subnetworks?.length ?? 0} subnet(s)`;

    return this.toEntity(
      {
        // Gateway names are unique per router, not per project.
        name: `${router.name}-${nat.name}`,
        projectId: project,
        type: 'cloud-nat',
        region,
        selfLink: `${router.selfLink}/nats/${nat.name}`,
        title: nat.name,
        summary: `Cloud NAT for ${ranges} in ${region}, ${
          nat.natIpAllocateOption === 'AUTO_ONLY' ? 'automatically allocated addresses' : 'manually allocated addresses'
        }`,
        consolePath: `net-services/nat/details/${region}/${router.name}/${nat.name}`,
        logFilter: `resource.type="nat_gateway" resource.labels.gateway_name="${nat.name}"`,
        tagValues: [nat.natIpAllocateOption, nat.sourceSubnetworkIpRangesToNat],
      },
      { partOf: [routerRef] },
    );
  }

  private routerToResources(router: compute_v1.Schema$Router, region: string, project: string): DeferredEntity[] {
    if (!router.name) {
      return [];
    }
    const routerRef = this.ownRef({
      projectId: project,
      type: 'cloud-router',
      provider: this.getProviderName(),
      region,
      name: router.name,
    });

    const routerEntity = this.toEntity(
      {
        name: router.name,
        projectId: project,
        type: 'cloud-router',
        region,
        selfLink: router.selfLink,
        description: router.description,
        summary: `Cloud Router in ${region} with ${router.nats?.length ?? 0} NAT gateway(s)${
          router.bgp?.asn ? ` and BGP ASN ${router.bgp.asn}` : ''
        }`,
        consolePath: `hybrid/routers/details/${region}/${router.name}`,
        tagValues: [router.bgp?.asn ? `asn-${router.bgp.asn}` : undefined],
      },
      { dependsOn: [this.vpcRef(router.network, project)] },
    );

    const nats = (router.nats ?? [])
      .map(nat => this.natToResource(nat, router, region, project, routerRef))
      .filter(entity => entity !== undefined);

    return routerEntity ? [routerEntity, ...nats] : [];
  }

  public async getResources(): Promise<DeferredEntity[]> {
    return this.forEachProject(async project => {
      const routers = await this.listAggregated<compute_v1.Schema$Router, compute_v1.Schema$RoutersScopedList>(
        async pageToken => (await this.client.routers.aggregatedList({ project, pageToken })).data,
        scoped => scoped.routers,
      );
      return routers.flatMap(({ item, scope }) => this.routerToResources(item, scope, project));
    });
  }
}
