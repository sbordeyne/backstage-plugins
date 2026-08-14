import { DeferredEntity } from '@backstage/plugin-catalog-node';
import { google, workflows_v1 } from 'googleapis';
import { GcpRestEntityProvider } from './GcpRestEntityProvider';
import { ANNOTATION_GCP_STATUS } from '../constants';
import { apiSelfLink, lastSegment, segmentAfter } from '../utils';

/**
 * Workflows.
 *
 * A workflow is frequently the destination of an Eventarc trigger and runs as a service account of
 * its own, so it sits between the two halves of the graph the Eventarc provider already builds.
 */
export class GcpWorkflowEntityProvider extends GcpRestEntityProvider<workflows_v1.Workflows> {
  getProviderName(): string {
    return 'gcp-workflows';
  }

  getProviderConfigKey(): string {
    return 'workflows';
  }

  getClient(): workflows_v1.Workflows {
    return google.workflows({ version: 'v1', auth: this.googleAuth });
  }

  private workflowToResource(workflow: workflows_v1.Schema$Workflow, project: string): DeferredEntity | undefined {
    const workflowId = lastSegment(workflow.name);
    if (!workflowId) {
      return undefined;
    }
    const region = segmentAfter(workflow.name, 'locations');
    if (!this.includesLocation(region)) {
      return undefined;
    }

    return this.toEntity(
      {
        name: workflowId,
        projectId: project,
        type: 'workflow',
        region,
        selfLink: apiSelfLink('workflows.googleapis.com', 'v1', workflow.name),
        labels: workflow.labels,
        description: workflow.description,
        summary: `Workflow in ${region ?? 'an unreported region'}, revision ${workflow.revisionId ?? 'unknown'}, ${(
          workflow.state ?? 'unknown state'
        ).toLocaleLowerCase()}`,
        consolePath: `workflows/workflow/${region}/${workflowId}/executions`,
        logFilter: `resource.type="workflows.googleapis.com/Workflow" resource.labels.workflow_id="${workflowId}"`,
        tagValues: [workflow.state, workflow.callLogLevel],
        annotations: {
          ...(workflow.state ? { [ANNOTATION_GCP_STATUS]: workflow.state } : {}),
          ...(workflow.revisionId ? { 'cloud.google.com/workflow-revision': workflow.revisionId } : {}),
        },
      },
      { dependsOn: workflow.serviceAccount ? [this.serviceAccountRef(workflow.serviceAccount, project)] : [] },
    );
  }

  public async getResources(): Promise<DeferredEntity[]> {
    return this.forEachProject(async project => {
      const workflows = await this.listAll<workflows_v1.Schema$Workflow>(async pageToken => {
        const { data } = await this.client.projects.locations.workflows.list({
          parent: `projects/${project}/locations/-`,
          pageToken,
        });
        return { items: data.workflows, nextPageToken: data.nextPageToken };
      });
      return workflows
        .map(workflow => this.workflowToResource(workflow, project))
        .filter(entity => entity !== undefined);
    });
  }
}
