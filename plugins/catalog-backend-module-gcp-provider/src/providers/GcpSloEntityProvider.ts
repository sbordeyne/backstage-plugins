import { DeferredEntity } from '@backstage/plugin-catalog-node';
import { google, monitoring_v3 } from 'googleapis';
import { GcpRestEntityProvider } from './GcpRestEntityProvider';
import { apiSelfLink, formatResourceName, lastSegment } from '../utils';

/**
 * Monitoring services and the SLOs defined on them.
 *
 * A Monitoring service is often the same thing as a catalog Component — GKE services and Cloud Run
 * services are detected automatically by Monitoring — so its SLOs are the reliability targets that
 * belong beside the resources the workload depends on.
 */
export class GcpSloEntityProvider extends GcpRestEntityProvider<monitoring_v3.Monitoring> {
  getProviderName(): string {
    return 'gcp-slos';
  }

  getProviderConfigKey(): string {
    return 'slos';
  }

  getClient(): monitoring_v3.Monitoring {
    return google.monitoring({ version: 'v3', auth: this.googleAuth });
  }

  private sloToResource(
    slo: monitoring_v3.Schema$ServiceLevelObjective,
    serviceId: string,
    project: string,
    serviceRef: string,
  ): DeferredEntity | undefined {
    const sloId = lastSegment(slo.name);
    if (!sloId) {
      return undefined;
    }
    const goal = slo.goal ? `${(slo.goal * 100).toFixed(2)}%` : 'an unreported goal';
    const window = slo.rollingPeriod ?? slo.calendarPeriod ?? 'an unreported period';

    return this.toEntity(
      {
        // SLO ids are unique per service, not per project.
        name: `${serviceId}-${formatResourceName(slo.displayName ?? sloId)}`,
        projectId: project,
        type: 'slo',
        title: slo.displayName ?? sloId,
        summary: `${goal} over ${window} on service ${serviceId}`,
        selfLink: apiSelfLink('monitoring.googleapis.com', 'v3', slo.name),
        consolePath: `monitoring/services/${serviceId}/slo/${sloId}`,
        tagValues: [slo.calendarPeriod ? 'calendar-period' : 'rolling-period'],
        annotations: {
          ...(slo.goal ? { 'cloud.google.com/slo-goal': goal } : {}),
        },
      },
      { partOf: [serviceRef] },
    );
  }

  private async serviceToResources(service: monitoring_v3.Schema$Service, project: string): Promise<DeferredEntity[]> {
    const serviceId = lastSegment(service.name);
    if (!serviceId) {
      return [];
    }
    const serviceRef = this.ownRef({
      projectId: project,
      type: 'monitoring-service',
      provider: this.getProviderName(),
      name: serviceId,
    });

    const slos = await this.listAll<monitoring_v3.Schema$ServiceLevelObjective>(async pageToken => {
      const { data } = await this.client.services.serviceLevelObjectives.list({ parent: service.name!, pageToken });
      return { items: data.serviceLevelObjectives, nextPageToken: data.nextPageToken };
    });

    // Monitoring detects the underlying workload, which is how an SLO reaches the rest of the graph.
    const cloudRunService = service.cloudRun?.serviceName;
    const kind = cloudRunService ? 'cloud-run' : (service.gkeService?.serviceName && 'gke') || 'custom';

    const serviceEntity = this.toEntity(
      {
        name: serviceId,
        projectId: project,
        type: 'monitoring-service',
        title: service.displayName ?? serviceId,
        summary: `Monitoring service with ${slos.length} SLO(s)`,
        selfLink: apiSelfLink('monitoring.googleapis.com', 'v3', service.name),
        consolePath: `monitoring/services/${serviceId}`,
        tagValues: [kind],
      },
      {
        dependsOn: cloudRunService
          ? [this.cloudRunServiceRef(cloudRunService, service.cloudRun?.location ?? undefined, project)]
          : [],
      },
    );

    return [
      serviceEntity,
      ...slos
        .map(slo => this.sloToResource(slo, serviceId, project, serviceRef))
        .filter(entity => entity !== undefined),
    ];
  }

  public async getResources(): Promise<DeferredEntity[]> {
    return this.forEachProject(async project => {
      const services = await this.listAll<monitoring_v3.Schema$Service>(async pageToken => {
        const { data } = await this.client.services.list({ parent: `projects/${project}`, pageToken });
        return { items: data.services, nextPageToken: data.nextPageToken };
      });
      const entities = await Promise.all(
        services.filter(service => service.name).map(service => this.serviceToResources(service, project)),
      );
      return entities.flat();
    });
  }
}
