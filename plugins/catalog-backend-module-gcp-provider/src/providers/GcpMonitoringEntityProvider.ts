import { DeferredEntity } from '@backstage/plugin-catalog-node';
import { google, monitoring_v3 } from 'googleapis';
import { GcpRestEntityProvider } from './GcpRestEntityProvider';
import { apiSelfLink, formatResourceName, lastSegment } from '../utils';

/**
 * Alert policies and uptime checks.
 *
 * These are the entities that say who has agreed to be woken up for what, which is exactly the kind
 * of ownership a catalog is for. The alerting resources are named by opaque ids, so the display
 * name becomes the entity name and the id is kept as the title.
 */
export class GcpMonitoringEntityProvider extends GcpRestEntityProvider<monitoring_v3.Monitoring> {
  getProviderName(): string {
    return 'gcp-alerts';
  }

  getProviderConfigKey(): string {
    return 'alerts';
  }

  getClient(): monitoring_v3.Monitoring {
    return google.monitoring({ version: 'v3', auth: this.googleAuth });
  }

  /** Whether uptime checks are ingested alongside the alert policies. Defaults to true. */
  private get includeUptimeChecks(): boolean {
    return this.config.getOptionalBoolean('includeUptimeChecks') ?? true;
  }

  private alertToResource(policy: monitoring_v3.Schema$AlertPolicy, project: string): DeferredEntity | undefined {
    const policyId = lastSegment(policy.name);
    if (!policyId || !policy.displayName) {
      return undefined;
    }
    const conditions = policy.conditions?.length ?? 0;
    const channels = (policy.notificationChannels ?? []).map(channel => lastSegment(channel));

    return this.toEntity({
      // Policy ids are numeric, so the display name is what makes a usable entity name.
      name: formatResourceName(policy.displayName),
      projectId: project,
      type: 'alert-policy',
      title: policy.displayName,
      description: policy.documentation?.content,
      summary: `${policy.enabled === false ? 'Disabled alert' : 'Alert'} on ${conditions} condition(s), notifying ${
        channels.length
      } channel(s)`,
      selfLink: apiSelfLink('monitoring.googleapis.com', 'v3', policy.name),
      consolePath: `monitoring/alerting/policies/${policyId}`,
      tagValues: [policy.enabled === false ? 'disabled' : 'enabled', policy.combiner],
      annotations: {
        ...(channels.length ? { 'cloud.google.com/notification-channels': channels.join(',') } : {}),
      },
    });
  }

  private uptimeToResource(check: monitoring_v3.Schema$UptimeCheckConfig, project: string): DeferredEntity | undefined {
    const checkId = lastSegment(check.name);
    if (!checkId || !check.displayName) {
      return undefined;
    }
    const host = check.monitoredResource?.labels?.host ?? check.httpCheck?.path ?? 'an unreported target';

    return this.toEntity({
      name: formatResourceName(check.displayName),
      projectId: project,
      type: 'uptime-check',
      title: check.displayName,
      summary: `Uptime check against ${host} every ${check.period ?? 'unreported interval'}`,
      selfLink: apiSelfLink('monitoring.googleapis.com', 'v3', check.name),
      consolePath: `monitoring/uptime/${checkId}`,
      tagValues: [check.selectedRegions?.length ? 'regional' : 'global'],
      annotations: {
        'cloud.google.com/uptime-target': String(host),
      },
    });
  }

  public async getResources(): Promise<DeferredEntity[]> {
    return this.forEachProject(async project => {
      const name = `projects/${project}`;
      const policies = await this.listAll<monitoring_v3.Schema$AlertPolicy>(async pageToken => {
        const { data } = await this.client.projects.alertPolicies.list({ name, pageToken });
        return { items: data.alertPolicies, nextPageToken: data.nextPageToken };
      });
      const checks = this.includeUptimeChecks
        ? await this.listAll<monitoring_v3.Schema$UptimeCheckConfig>(async pageToken => {
            const { data } = await this.client.projects.uptimeCheckConfigs.list({ parent: name, pageToken });
            return { items: data.uptimeCheckConfigs, nextPageToken: data.nextPageToken };
          })
        : [];

      return [
        ...policies.map(policy => this.alertToResource(policy, project)),
        ...checks.map(check => this.uptimeToResource(check, project)),
      ].filter(entity => entity !== undefined);
    });
  }
}
