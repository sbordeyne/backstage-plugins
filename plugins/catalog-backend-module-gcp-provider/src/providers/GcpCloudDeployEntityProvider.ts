import { DeferredEntity } from '@backstage/plugin-catalog-node';
import { clouddeploy_v1, google } from 'googleapis';
import { GcpRestEntityProvider } from './GcpRestEntityProvider';
import { apiSelfLink, lastSegment, parseResourceUrl, segmentAfter } from '../utils';

/** Where a deploy target sends a release, for the description. */
function describeDestination(cluster: string | undefined, runLocation: string | undefined): string {
  if (cluster) {
    return `GKE cluster ${cluster}`;
  }
  return runLocation ? `Cloud Run in ${runLocation}` : 'an unreported destination';
}

/**
 * Cloud Deploy delivery pipelines and the targets they promote through.
 *
 * This is the deployment topology in resource form: the pipeline names its stages in order, and
 * each target names the GKE cluster or Cloud Run region it deploys to — which are entities this
 * module already ingests, so the chain from a build to a running workload closes.
 */
export class GcpCloudDeployEntityProvider extends GcpRestEntityProvider<clouddeploy_v1.Clouddeploy> {
  getProviderName(): string {
    return 'gcp-clouddeploy';
  }

  getProviderConfigKey(): string {
    return 'clouddeploy';
  }

  getClient(): clouddeploy_v1.Clouddeploy {
    return google.clouddeploy({ version: 'v1', auth: this.googleAuth });
  }

  private targetToResource(target: clouddeploy_v1.Schema$Target, project: string): DeferredEntity | undefined {
    const targetId = target.targetId ?? lastSegment(target.name);
    if (!targetId) {
      return undefined;
    }
    const region = segmentAfter(target.name, 'locations');
    if (!this.includesLocation(region)) {
      return undefined;
    }

    // A target deploys to a GKE cluster or to a Cloud Run region; both are already in the catalog.
    const cluster = target.gke?.cluster ? parseResourceUrl(target.gke.cluster) : undefined;
    const runLocation = target.run?.location ? segmentAfter(target.run.location, 'locations') : undefined;
    const deploysTo = describeDestination(cluster?.name, runLocation);

    return this.toEntity(
      {
        name: targetId,
        projectId: project,
        type: 'deploy-target',
        region,
        selfLink: apiSelfLink('clouddeploy.googleapis.com', 'v1', target.name),
        labels: target.labels,
        description: target.description,
        summary: `Deploy target for ${deploysTo}${target.requireApproval ? ', requires approval' : ''}`,
        consolePath: `deploy/delivery-pipelines/${region}/targets/${targetId}`,
        tagValues: [target.requireApproval ? 'requires-approval' : 'automatic', cluster ? 'gke' : 'cloud-run'],
      },
      {
        dependsOn: cluster?.name
          ? [
              this.resourceRef('clusters', {
                projectId: cluster.projectId ?? project,
                type: 'kubernetes-cluster',
                provider: 'gcp-clusters',
                region: segmentAfter(target.gke?.cluster, 'locations'),
                name: cluster.name,
              }),
            ]
          : [],
      },
    );
  }

  private pipelineToResource(
    pipeline: clouddeploy_v1.Schema$DeliveryPipeline,
    project: string,
  ): DeferredEntity | undefined {
    const pipelineId = lastSegment(pipeline.name);
    if (!pipelineId) {
      return undefined;
    }
    const region = segmentAfter(pipeline.name, 'locations');
    if (!this.includesLocation(region)) {
      return undefined;
    }
    const stages = (pipeline.serialPipeline?.stages ?? [])
      .map(stage => stage.targetId)
      .filter((targetId): targetId is string => Boolean(targetId));

    return this.toEntity(
      {
        name: pipelineId,
        projectId: project,
        type: 'delivery-pipeline',
        region,
        selfLink: apiSelfLink('clouddeploy.googleapis.com', 'v1', pipeline.name),
        labels: pipeline.labels,
        description: pipeline.description,
        summary: `${pipeline.suspended ? 'Suspended delivery' : 'Delivery'} pipeline promoting through ${
          stages.length ? stages.join(' → ') : 'no targets'
        }`,
        consolePath: `deploy/delivery-pipelines/details/${region}/${pipelineId}`,
        tagValues: [pipeline.suspended ? 'suspended' : 'active'],
      },
      {
        dependsOn: stages.map(targetId =>
          this.ownRef({
            projectId: project,
            type: 'deploy-target',
            provider: this.getProviderName(),
            region,
            name: targetId,
          }),
        ),
      },
    );
  }

  public async getResources(): Promise<DeferredEntity[]> {
    return this.forEachProject(async project => {
      const parent = `projects/${project}/locations/-`;
      const [pipelines, targets] = await Promise.all([
        this.listAll<clouddeploy_v1.Schema$DeliveryPipeline>(async pageToken => {
          const { data } = await this.client.projects.locations.deliveryPipelines.list({ parent, pageToken });
          return { items: data.deliveryPipelines, nextPageToken: data.nextPageToken };
        }),
        this.listAll<clouddeploy_v1.Schema$Target>(async pageToken => {
          const { data } = await this.client.projects.locations.targets.list({ parent, pageToken });
          return { items: data.targets, nextPageToken: data.nextPageToken };
        }),
      ]);

      return [
        ...pipelines.map(pipeline => this.pipelineToResource(pipeline, project)),
        ...targets.map(target => this.targetToResource(target, project)),
      ].filter(entity => entity !== undefined);
    });
  }
}
