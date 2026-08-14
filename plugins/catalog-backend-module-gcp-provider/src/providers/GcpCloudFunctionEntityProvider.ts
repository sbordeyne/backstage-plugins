import { DeferredEntity } from '@backstage/plugin-catalog-node';
import { cloudfunctions_v2, google } from 'googleapis';
import { GcpRestEntityProvider } from './GcpRestEntityProvider';
import { ANNOTATION_GCP_STATUS } from '../constants';
import { LINK_TYPE_WEBSITE } from '../links';
import { apiSelfLink, lastSegment, segmentAfter } from '../utils';

/**
 * Cloud Functions.
 *
 * The v2 API covers both generations, reporting first-generation functions with
 * `environment: GEN_1`, so one listing is enough.
 */
export class GcpCloudFunctionEntityProvider extends GcpRestEntityProvider<cloudfunctions_v2.Cloudfunctions> {
  getProviderName(): string {
    return 'gcp-functions';
  }

  getProviderConfigKey(): string {
    return 'functions';
  }

  getClient(): cloudfunctions_v2.Cloudfunctions {
    return google.cloudfunctions({ version: 'v2', auth: this.googleAuth });
  }

  private functionToResource(fn: cloudfunctions_v2.Schema$Function, project: string): DeferredEntity | undefined {
    const functionId = lastSegment(fn.name);
    if (!functionId) {
      return undefined;
    }
    const region = segmentAfter(fn.name, 'locations');
    if (!this.includesLocation(region)) {
      return undefined;
    }
    const generation = fn.environment === 'GEN_1' ? '1st gen' : '2nd gen';
    const runtime = fn.buildConfig?.runtime;
    const topic = fn.eventTrigger?.pubsubTopic;
    const serviceAccount = fn.serviceConfig?.serviceAccountEmail;

    return this.toEntity(
      {
        name: functionId,
        projectId: project,
        type: 'cloud-function',
        region,
        selfLink: apiSelfLink('cloudfunctions.googleapis.com', 'v2', fn.name),
        labels: fn.labels,
        description: fn.description,
        summary: `${generation} Cloud Function${runtime ? ` on ${runtime}` : ''}, triggered by ${
          fn.eventTrigger?.eventType ?? 'HTTP'
        }`,
        consolePath: `functions/details/${region}/${functionId}`,
        logFilter: `resource.type="cloud_function" resource.labels.function_name="${functionId}"`,
        tagValues: [runtime, generation.replace(/\s/g, '-'), fn.state],
        links: fn.serviceConfig?.uri
          ? [{ url: fn.serviceConfig.uri, title: 'Function URL', icon: 'web', type: LINK_TYPE_WEBSITE }]
          : [],
        annotations: {
          ...(fn.state ? { [ANNOTATION_GCP_STATUS]: fn.state } : {}),
          ...(fn.eventTrigger?.eventType ? { 'cloud.google.com/event-type': fn.eventTrigger.eventType } : {}),
        },
      },
      {
        dependsOn: [
          ...(topic ? [this.pubsubTopicRef(topic, project)] : []),
          ...(serviceAccount ? [this.serviceAccountRef(serviceAccount, project)] : []),
          // Egress to anything private goes through a connector, which is an entity of its own.
          ...(fn.serviceConfig?.vpcConnector
            ? [
                this.resourceRef('vpcconnectors', {
                  projectId: segmentAfter(fn.serviceConfig.vpcConnector, 'projects') ?? project,
                  type: 'vpc-connector',
                  provider: 'gcp-vpcconnectors',
                  region: segmentAfter(fn.serviceConfig.vpcConnector, 'locations') ?? region,
                  name: lastSegment(fn.serviceConfig.vpcConnector),
                }),
              ]
            : []),
        ],
      },
    );
  }

  public async getResources(): Promise<DeferredEntity[]> {
    return this.forEachProject(async project => {
      const functions = await this.listAll<cloudfunctions_v2.Schema$Function>(async pageToken => {
        const { data } = await this.client.projects.locations.functions.list({
          parent: `projects/${project}/locations/-`,
          pageToken,
        });
        return { items: data.functions, nextPageToken: data.nextPageToken };
      });
      return functions.map(fn => this.functionToResource(fn, project)).filter(entity => entity !== undefined);
    });
  }
}
