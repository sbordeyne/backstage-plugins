import { DeferredEntity } from '@backstage/plugin-catalog-node';
import { cloudbuild_v1, google } from 'googleapis';
import { GcpRestEntityProvider } from './GcpRestEntityProvider';
import { LINK_TYPE_WEBSITE } from '../links';
import { apiSelfLink } from '../utils';

/**
 * Cloud Build triggers.
 *
 * A trigger is the join between a repository and whatever it deploys, so its entity carries a link
 * to the repository and a relation to the service account the build runs as — which is usually the
 * account that then holds the deploy permissions.
 */
export class GcpCloudBuildEntityProvider extends GcpRestEntityProvider<cloudbuild_v1.Cloudbuild> {
  getProviderName(): string {
    return 'gcp-cloudbuild';
  }

  getProviderConfigKey(): string {
    return 'cloudbuild';
  }

  getClient(): cloudbuild_v1.Cloudbuild {
    return google.cloudbuild({ version: 'v1', auth: this.googleAuth });
  }

  /** Where the trigger's source lives, as a phrase and, where possible, a URL. */
  private static sourceOf(trigger: cloudbuild_v1.Schema$BuildTrigger): { described: string; url?: string } {
    if (trigger.github?.owner && trigger.github.name) {
      return {
        described: `${trigger.github.owner}/${trigger.github.name}`,
        url: `https://github.com/${trigger.github.owner}/${trigger.github.name}`,
      };
    }
    const repo = trigger.triggerTemplate?.repoName;
    if (repo) {
      return { described: repo };
    }
    return { described: 'an unreported repository' };
  }

  private triggerToResource(trigger: cloudbuild_v1.Schema$BuildTrigger, project: string): DeferredEntity | undefined {
    if (!trigger.name) {
      return undefined;
    }
    const source = GcpCloudBuildEntityProvider.sourceOf(trigger);
    const branch = trigger.github?.push?.branch ?? trigger.triggerTemplate?.branchName;

    return this.toEntity(
      {
        name: trigger.name,
        projectId: project,
        type: 'build-trigger',
        selfLink: apiSelfLink('cloudbuild.googleapis.com', 'v1', `projects/${project}/triggers/${trigger.id ?? ''}`),
        description: trigger.description,
        summary: `${trigger.disabled ? 'Disabled trigger' : 'Trigger'} building ${source.described}${
          branch ? ` on ${branch}` : ''
        }${trigger.filename ? ` from ${trigger.filename}` : ''}`,
        consolePath: `cloud-build/triggers/edit/${trigger.id ?? ''}`,
        logFilter: `resource.type="build" resource.labels.build_trigger_id="${trigger.id ?? ''}"`,
        tagValues: [...(trigger.tags ?? []), trigger.disabled ? 'disabled' : 'enabled'],
        links: source.url ? [{ url: source.url, title: 'Repository', icon: 'github', type: LINK_TYPE_WEBSITE }] : [],
        annotations: {
          ...(trigger.filename ? { 'cloud.google.com/build-config': trigger.filename } : {}),
        },
      },
      { dependsOn: trigger.serviceAccount ? [this.serviceAccountRef(trigger.serviceAccount, project)] : [] },
    );
  }

  public async getResources(): Promise<DeferredEntity[]> {
    return this.forEachProject(async project => {
      const triggers = await this.listAll<cloudbuild_v1.Schema$BuildTrigger>(async pageToken => {
        const { data } = await this.client.projects.triggers.list({ projectId: project, pageToken });
        return { items: data.triggers, nextPageToken: data.nextPageToken };
      });
      return triggers.map(trigger => this.triggerToResource(trigger, project)).filter(entity => entity !== undefined);
    });
  }
}
