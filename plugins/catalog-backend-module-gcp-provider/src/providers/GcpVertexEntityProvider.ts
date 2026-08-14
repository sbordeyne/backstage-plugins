import { DeferredEntity } from '@backstage/plugin-catalog-node';
import { aiplatform_v1, google, notebooks_v2 } from 'googleapis';
import { GcpRestEntityProvider } from './GcpRestEntityProvider';
import { ANNOTATION_GCP_STATUS } from '../constants';
import { apiSelfLink, lastSegment, segmentAfter } from '../utils';

/**
 * Vertex AI endpoints and models.
 *
 * Vertex is served from regional hosts — `europe-west1-aiplatform.googleapis.com` — with no
 * wildcard location, so this provider builds one client per configured location instead of one
 * client with a `locations/-` parent. That makes `locations` effectively required: without it there
 * is no region to ask.
 */
export class GcpVertexEntityProvider extends GcpRestEntityProvider<aiplatform_v1.Aiplatform> {
  getProviderName(): string {
    return 'gcp-vertex';
  }

  getProviderConfigKey(): string {
    return 'vertex';
  }

  getClient(): aiplatform_v1.Aiplatform {
    // The global client is only a template; each region gets its own below.
    return google.aiplatform({ version: 'v1', auth: this.googleAuth });
  }

  /** A client bound to one region's host, which is the only way Vertex can be listed. */
  private clientFor(region: string): aiplatform_v1.Aiplatform {
    return google.aiplatform({
      version: 'v1',
      auth: this.googleAuth,
      rootUrl: `https://${region}-aiplatform.googleapis.com/`,
    });
  }

  private endpointToResource(
    endpoint: aiplatform_v1.Schema$GoogleCloudAiplatformV1Endpoint,
    region: string,
    project: string,
  ): DeferredEntity | undefined {
    const endpointId = lastSegment(endpoint.name);
    if (!endpointId) {
      return undefined;
    }
    const models = (endpoint.deployedModels ?? [])
      .map(deployed => deployed.displayName ?? lastSegment(deployed.model))
      .filter(Boolean);

    return this.toEntity({
      name: `${endpoint.displayName ?? endpointId}-${region}`,
      projectId: project,
      type: 'vertex-endpoint',
      region,
      title: endpoint.displayName ?? endpointId,
      description: endpoint.description,
      selfLink: apiSelfLink(`${region}-aiplatform.googleapis.com`, 'v1', endpoint.name),
      labels: endpoint.labels,
      summary: `Vertex endpoint serving ${models.length ? models.join(', ') : 'no models'} in ${region}`,
      consolePath: `vertex-ai/online-prediction/locations/${region}/endpoints/${endpointId}`,
      tagValues: models,
      annotations: {
        ...(models.length ? { 'cloud.google.com/deployed-models': models.join(',') } : {}),
      },
    });
  }

  private modelToResource(
    model: aiplatform_v1.Schema$GoogleCloudAiplatformV1Model,
    region: string,
    project: string,
  ): DeferredEntity | undefined {
    const modelId = lastSegment(model.name);
    if (!modelId) {
      return undefined;
    }

    return this.toEntity({
      name: `${model.displayName ?? modelId}-${region}`,
      projectId: project,
      type: 'vertex-model',
      region,
      title: model.displayName ?? modelId,
      description: model.description,
      selfLink: apiSelfLink(`${region}-aiplatform.googleapis.com`, 'v1', model.name),
      labels: model.labels,
      summary: `Vertex model${model.versionId ? ` version ${model.versionId}` : ''} in ${region}`,
      consolePath: `vertex-ai/models/locations/${region}/models/${modelId}`,
      tagValues: [model.versionId ? `v${model.versionId}` : undefined],
    });
  }

  public async getResources(): Promise<DeferredEntity[]> {
    const regions = this.locations;
    if (!regions) {
      this.logger.warn('The vertex provider needs `locations`: the Vertex API has no cross-region listing');
      return [];
    }

    return this.forEachProject(async project => {
      const perRegion = await Promise.all(
        regions.map(async region => {
          const client = this.clientFor(region);
          const parent = `projects/${project}/locations/${region}`;
          const [endpoints, models] = await Promise.all([
            this.listAll<aiplatform_v1.Schema$GoogleCloudAiplatformV1Endpoint>(async pageToken => {
              const { data } = await client.projects.locations.endpoints.list({ parent, pageToken });
              return { items: data.endpoints, nextPageToken: data.nextPageToken };
            }),
            this.listAll<aiplatform_v1.Schema$GoogleCloudAiplatformV1Model>(async pageToken => {
              const { data } = await client.projects.locations.models.list({ parent, pageToken });
              return { items: data.models, nextPageToken: data.nextPageToken };
            }),
          ]);

          return [
            ...endpoints.map(endpoint => this.endpointToResource(endpoint, region, project)),
            ...models.map(model => this.modelToResource(model, region, project)),
          ];
        }),
      );

      return perRegion.flat().filter(entity => entity !== undefined);
    });
  }
}

/** Vertex AI Workbench instances — the notebooks people actually leave running. */
export class GcpWorkbenchEntityProvider extends GcpRestEntityProvider<notebooks_v2.Notebooks> {
  getProviderName(): string {
    return 'gcp-workbench';
  }

  getProviderConfigKey(): string {
    return 'workbench';
  }

  getClient(): notebooks_v2.Notebooks {
    return google.notebooks({ version: 'v2', auth: this.googleAuth });
  }

  private instanceToResource(instance: notebooks_v2.Schema$Instance, project: string): DeferredEntity | undefined {
    const instanceId = lastSegment(instance.name);
    if (!instanceId) {
      return undefined;
    }
    const region = segmentAfter(instance.name, 'locations');
    if (!this.includesLocation(region)) {
      return undefined;
    }
    const machine = lastSegment(instance.gceSetup?.machineType);

    return this.toEntity(
      {
        name: instanceId,
        projectId: project,
        type: 'workbench-instance',
        region,
        selfLink: apiSelfLink('notebooks.googleapis.com', 'v2', instance.name),
        labels: instance.labels,
        summary: `Workbench instance${machine ? ` on ${machine}` : ''} in ${region ?? 'an unreported zone'}, ${(
          instance.state ?? 'unknown state'
        ).toLocaleLowerCase()}`,
        consolePath: `vertex-ai/workbench/instances`,
        tagValues: [instance.state, machine],
        annotations: {
          ...(instance.state ? { [ANNOTATION_GCP_STATUS]: instance.state } : {}),
          ...(instance.creator ? { 'cloud.google.com/notebook-creator': instance.creator } : {}),
        },
      },
      {
        dependsOn: (instance.gceSetup?.serviceAccounts ?? [])
          .map(account => account.email)
          .filter((email): email is string => Boolean(email))
          .map(email => this.serviceAccountRef(email, project)),
      },
    );
  }

  public async getResources(): Promise<DeferredEntity[]> {
    return this.forEachProject(async project => {
      const instances = await this.listAll<notebooks_v2.Schema$Instance>(async pageToken => {
        const { data } = await this.client.projects.locations.instances.list({
          parent: `projects/${project}/locations/-`,
          pageToken,
        });
        return { items: data.instances, nextPageToken: data.nextPageToken };
      });
      return instances
        .map(instance => this.instanceToResource(instance, project))
        .filter(entity => entity !== undefined);
    });
  }
}
