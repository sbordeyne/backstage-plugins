import { DeferredEntity } from '@backstage/plugin-catalog-node';
import { google, run_v2 } from 'googleapis';
import { GcpRestEntityProvider } from './GcpRestEntityProvider';
import { ANNOTATION_GCP_STATUS } from '../constants';
import { LINK_TYPE_WEBSITE } from '../links';
import { apiSelfLink, lastSegment, segmentAfter } from '../utils';

/** Cloud Run services and jobs. */
export class GcpCloudRunEntityProvider extends GcpRestEntityProvider<run_v2.Run> {
  getProviderName(): string {
    return 'gcp-run';
  }

  getProviderConfigKey(): string {
    return 'run';
  }

  getClient(): run_v2.Run {
    return google.run({ version: 'v2', auth: this.googleAuth });
  }

  private serviceToResource(
    service: run_v2.Schema$GoogleCloudRunV2Service,
    project: string,
  ): DeferredEntity | undefined {
    const serviceId = lastSegment(service.name);
    if (!serviceId) {
      return undefined;
    }
    const region = segmentAfter(service.name, 'locations');
    if (!this.includesLocation(region)) {
      return undefined;
    }
    const image = lastSegment(service.template?.containers?.[0]?.image);
    const serviceAccount = service.template?.serviceAccount;

    return this.toEntity(
      {
        name: serviceId,
        projectId: project,
        type: 'cloud-run-service',
        region,
        selfLink: apiSelfLink('run.googleapis.com', 'v2', service.name),
        labels: service.labels,
        description: service.description,
        summary: `Cloud Run service in ${region ?? 'an unreported region'}${image ? ` running ${image}` : ''}`,
        consolePath: `run/detail/${region}/${serviceId}/metrics`,
        logFilter: `resource.type="cloud_run_revision" resource.labels.service_name="${serviceId}"`,
        tagValues: [service.ingress, service.template?.executionEnvironment],
        // The URL the service answers on is the single most useful link on the entity.
        links: service.uri ? [{ url: service.uri, title: 'Service URL', icon: 'web', type: LINK_TYPE_WEBSITE }] : [],
        annotations: {
          ...(service.latestReadyRevision
            ? { 'cloud.google.com/latest-revision': lastSegment(service.latestReadyRevision) }
            : {}),
        },
      },
      {
        dependsOn: [
          ...(serviceAccount ? [this.serviceAccountRef(serviceAccount, project)] : []),
          // Anything with a private address is reached through a connector, which makes it the
          // hop between this service and the VPC entities.
          ...this.connectorRefs(service.template?.vpcAccess, region, project),
        ],
      },
    );
  }

  /** Refs of the Serverless VPC Access connectors a revision routes egress through. */
  private connectorRefs(
    vpcAccess: run_v2.Schema$GoogleCloudRunV2VpcAccess | undefined,
    region: string | undefined,
    project: string,
  ): (string | undefined)[] {
    const connector = vpcAccess?.connector;
    if (!connector) {
      return [];
    }
    return [
      this.resourceRef('vpcconnectors', {
        projectId: segmentAfter(connector, 'projects') ?? project,
        type: 'vpc-connector',
        provider: 'gcp-vpcconnectors',
        region: segmentAfter(connector, 'locations') ?? region,
        name: lastSegment(connector),
      }),
    ];
  }

  private jobToResource(job: run_v2.Schema$GoogleCloudRunV2Job, project: string): DeferredEntity | undefined {
    const jobId = lastSegment(job.name);
    if (!jobId) {
      return undefined;
    }
    const region = segmentAfter(job.name, 'locations');
    if (!this.includesLocation(region)) {
      return undefined;
    }
    const image = lastSegment(job.template?.template?.containers?.[0]?.image);
    const serviceAccount = job.template?.template?.serviceAccount;

    return this.toEntity(
      {
        name: jobId,
        projectId: project,
        type: 'cloud-run-job',
        region,
        selfLink: apiSelfLink('run.googleapis.com', 'v2', job.name),
        labels: job.labels,
        summary: `Cloud Run job in ${region ?? 'an unreported region'}${image ? ` running ${image}` : ''}`,
        consolePath: `run/jobs/details/${region}/${jobId}`,
        logFilter: `resource.type="cloud_run_job" resource.labels.job_name="${jobId}"`,
        tagValues: [job.executionCount ? 'executed' : 'never-executed'],
        annotations: {
          ...(job.latestCreatedExecution?.name
            ? { [ANNOTATION_GCP_STATUS]: lastSegment(job.latestCreatedExecution.name) }
            : {}),
        },
      },
      {
        dependsOn: [
          ...(serviceAccount ? [this.serviceAccountRef(serviceAccount, project)] : []),
          ...this.connectorRefs(job.template?.template?.vpcAccess, region, project),
        ],
      },
    );
  }

  public async getResources(): Promise<DeferredEntity[]> {
    return this.forEachProject(async project => {
      const parent = `projects/${project}/locations/-`;
      const services = await this.listAll<run_v2.Schema$GoogleCloudRunV2Service>(async pageToken => {
        const { data } = await this.client.projects.locations.services.list({ parent, pageToken });
        return { items: data.services, nextPageToken: data.nextPageToken };
      });
      const jobs = await this.listAll<run_v2.Schema$GoogleCloudRunV2Job>(async pageToken => {
        const { data } = await this.client.projects.locations.jobs.list({ parent, pageToken });
        return { items: data.jobs, nextPageToken: data.nextPageToken };
      });

      return [
        ...services.map(service => this.serviceToResource(service, project)),
        ...jobs.map(job => this.jobToResource(job, project)),
      ].filter(entity => entity !== undefined);
    });
  }
}
