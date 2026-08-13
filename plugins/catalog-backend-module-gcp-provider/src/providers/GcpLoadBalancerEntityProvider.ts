import { DeferredEntity } from '@backstage/plugin-catalog-node';
import { compute_v1, google } from 'googleapis';
import { GcpRestEntityProvider } from './GcpRestEntityProvider';
import { lastSegment, parseResourceUrl } from '../utils';

/**
 * Cloud Load Balancing, as the three resources that make it legible: the forwarding rule an address
 * points at, the URL map that routes, and the backend services traffic ends up in.
 *
 * They are one provider because they are one thing — a load balancer split across three APIs — and
 * ingesting any of them alone leaves a relation dangling.
 */
export class GcpLoadBalancerEntityProvider extends GcpRestEntityProvider<compute_v1.Compute> {
  getProviderName(): string {
    return 'gcp-loadbalancers';
  }

  getProviderConfigKey(): string {
    return 'loadbalancers';
  }

  getClient(): compute_v1.Compute {
    return google.compute({ version: 'v1', auth: this.googleAuth });
  }

  /** Ref of another entity this same provider emits, for the LB → URL map → backend chain. */
  private siblingRef(url: string | null | undefined, type: string, project: string): string | undefined {
    const parsed = parseResourceUrl(url);
    if (!parsed.name) {
      return undefined;
    }
    return this.ownRef({
      projectId: parsed.projectId ?? project,
      type,
      provider: this.getProviderName(),
      region: parsed.region,
      name: parsed.name,
    });
  }

  private forwardingRuleToResource(
    rule: compute_v1.Schema$ForwardingRule,
    scope: string,
    project: string,
  ): DeferredEntity | undefined {
    if (!rule.name) {
      return undefined;
    }
    const global = scope === 'global';
    // The target is a proxy rather than the URL map itself, but the proxy names the map, so the
    // useful relation is to whatever the proxy is called — resolved as a URL map when it is one.
    const target = lastSegment(rule.target);
    const ports = rule.portRange ?? rule.ports?.join(',') ?? '';

    return this.toEntity(
      {
        name: global ? rule.name : `${rule.name}-${scope}`,
        projectId: project,
        type: 'load-balancer',
        region: global ? undefined : scope,
        selfLink: rule.selfLink,
        labels: rule.labels,
        title: rule.name,
        description: rule.description,
        summary: `${global ? 'Global' : scope} ${rule.loadBalancingScheme ?? 'EXTERNAL'} load balancer on ${
          rule.IPAddress ?? 'an unreported address'
        }${ports ? `:${ports}` : ''}`,
        consolePath: `net-services/loadbalancing/details/${global ? 'http' : 'tcp'}/${rule.name}`,
        assetName: `//compute.googleapis.com/${(rule.selfLink ?? '').split('/v1/')[1] ?? ''}`,
        tagValues: [rule.loadBalancingScheme, rule.IPProtocol],
        annotations: {
          ...(rule.IPAddress ? { 'cloud.google.com/ip-address': rule.IPAddress } : {}),
          ...(target ? { 'cloud.google.com/lb-target': target } : {}),
        },
      },
      {
        dependsOn: [
          ...(rule.network ? [this.vpcRef(rule.network, project)] : []),
          ...(rule.subnetwork ? [this.subnetRef(rule.subnetwork, project)] : []),
        ],
      },
    );
  }

  private urlMapToResource(urlMap: compute_v1.Schema$UrlMap, project: string): DeferredEntity | undefined {
    if (!urlMap.name) {
      return undefined;
    }
    // Every backend a request can reach: the default, plus each path matcher's own services.
    const backends = new Set(
      [
        urlMap.defaultService,
        ...(urlMap.pathMatchers ?? []).flatMap(matcher => [
          matcher.defaultService,
          ...(matcher.pathRules ?? []).map(rule => rule.service),
        ]),
      ].filter((service): service is string => Boolean(service)),
    );
    const hosts = (urlMap.hostRules ?? []).flatMap(rule => rule.hosts ?? []);

    return this.toEntity(
      {
        name: urlMap.name,
        projectId: project,
        type: 'url-map',
        selfLink: urlMap.selfLink,
        description: urlMap.description,
        summary: `Routes ${hosts.length ? hosts.join(', ') : 'traffic'} across ${backends.size} backend service(s)`,
        consolePath: `net-services/loadbalancing/details/http/${urlMap.name}`,
        tagValues: hosts,
        annotations: {
          ...(hosts.length ? { 'cloud.google.com/lb-hosts': hosts.join(',') } : {}),
        },
      },
      {
        dependsOn: [...backends]
          .map(backend => this.siblingRef(backend, 'backend-service', project))
          .filter((ref): ref is string => Boolean(ref)),
      },
    );
  }

  private backendServiceToResource(
    backend: compute_v1.Schema$BackendService,
    scope: string,
    project: string,
  ): DeferredEntity | undefined {
    if (!backend.name) {
      return undefined;
    }
    const global = scope === 'global';
    // Backends are instance groups or network endpoint groups; the groups are entities, the NEGs
    // are not, so only the former become relations.
    const instanceGroups = (backend.backends ?? [])
      .map(entry => entry.group)
      .filter((group): group is string => typeof group === 'string' && group.includes('/instanceGroups/'));

    return this.toEntity(
      {
        name: global ? backend.name : `${backend.name}-${scope}`,
        projectId: project,
        type: 'backend-service',
        region: global ? undefined : scope,
        selfLink: backend.selfLink,
        title: backend.name,
        description: backend.description,
        summary: `${backend.protocol ?? 'HTTP'} backend service over ${backend.backends?.length ?? 0} backend(s), ${
          backend.enableCDN ? 'CDN enabled' : 'no CDN'
        }`,
        consolePath: `net-services/loadbalancing/details/backendService/${backend.name}`,
        tagValues: [backend.protocol, backend.loadBalancingScheme, backend.enableCDN ? 'cdn' : undefined],
        annotations: {
          ...(backend.securityPolicy
            ? { 'cloud.google.com/security-policy': lastSegment(backend.securityPolicy) }
            : {}),
        },
      },
      {
        dependsOn: instanceGroups.map(group => {
          const parsed = parseResourceUrl(group);
          return this.resourceRef('instance-groups', {
            projectId: parsed.projectId ?? project,
            type: 'instance-group',
            provider: 'gcp-instance-groups',
            region: parsed.zone ?? parsed.region,
            name: parsed.name,
          });
        }),
      },
    );
  }

  public async getResources(): Promise<DeferredEntity[]> {
    return this.forEachProject(async project => {
      // The aggregated listings carry a `global` scope of their own, and global forwarding rules
      // are additionally their own collection, so the rules are deduplicated by self link.
      const [rules, globalRules, urlMaps, backends] = await Promise.all([
        this.listAggregated<compute_v1.Schema$ForwardingRule, compute_v1.Schema$ForwardingRulesScopedList>(
          async pageToken => (await this.client.forwardingRules.aggregatedList({ project, pageToken })).data,
          scoped => scoped.forwardingRules,
        ),
        this.listAll<compute_v1.Schema$ForwardingRule>(
          async pageToken => (await this.client.globalForwardingRules.list({ project, pageToken })).data,
        ),
        this.listAll<compute_v1.Schema$UrlMap>(
          async pageToken => (await this.client.urlMaps.list({ project, pageToken })).data,
        ),
        this.listAggregated<compute_v1.Schema$BackendService, compute_v1.Schema$BackendServicesScopedList>(
          async pageToken => (await this.client.backendServices.aggregatedList({ project, pageToken })).data,
          scoped => scoped.backendServices,
        ),
      ]);

      const rulesBySelfLink = new Map<string, { item: compute_v1.Schema$ForwardingRule; scope: string }>();
      for (const { item, scope } of rules) {
        rulesBySelfLink.set(item.selfLink ?? `${scope}/${item.name}`, { item, scope });
      }
      for (const item of globalRules) {
        rulesBySelfLink.set(item.selfLink ?? `global/${item.name}`, { item, scope: 'global' });
      }

      return [
        ...[...rulesBySelfLink.values()].map(({ item, scope }) => this.forwardingRuleToResource(item, scope, project)),
        ...urlMaps.map(urlMap => this.urlMapToResource(urlMap, project)),
        ...backends.map(({ item, scope }) => this.backendServiceToResource(item, scope, project)),
      ].filter(entity => entity !== undefined);
    });
  }
}
