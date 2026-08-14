import { DeferredEntity } from '@backstage/plugin-catalog-node';
import { google, secretmanager_v1 } from 'googleapis';
import { GcpRestEntityProvider } from './GcpRestEntityProvider';
import { apiSelfLink, lastSegment } from '../utils';

/** Secret Manager secrets. */
export class GcpSecretEntityProvider extends GcpRestEntityProvider<secretmanager_v1.Secretmanager> {
  getProviderName(): string {
    return 'gcp-secret-manager';
  }

  getProviderConfigKey(): string {
    return 'secretmanager';
  }

  getClient(): secretmanager_v1.Secretmanager {
    return google.secretmanager({ version: 'v1', auth: this.googleAuth });
  }

  private secretToResource(secret: secretmanager_v1.Schema$Secret, project: string): DeferredEntity | undefined {
    if (!secret.name) {
      return undefined;
    }
    const secretId = lastSegment(secret.name);

    return this.toEntity({
      name: secretId,
      projectId: project,
      type: 'secret',
      labels: secret.labels,
      // Secret Manager reports no self link, so the canonical REST URL of the resource stands in
      // for one — it is the same thing the API would have returned.
      selfLink: apiSelfLink('secretmanager.googleapis.com', 'v1', secret.name),
      summary: `Secret Manager secret, ${
        secret.replication?.automatic ? 'automatically replicated' : 'replicated to selected regions'
      }`,
      consolePath: `security/secret-manager/secret/${secretId}/versions`,
      logFilter: `resource.type="secretmanager.googleapis.com/Secret" resource.labels.secret_id="${secretId}"`,
      // Who can read the secret comes from the shared IAM index rather than a getIamPolicy call per
      // secret: the same information, without one round trip per resource.
      assetName: `//secretmanager.googleapis.com/projects/${project}/secrets/${secretId}`,
    });
  }

  public async getResources(): Promise<DeferredEntity[]> {
    return this.forEachProject(async project => {
      const secrets = await this.listAll<secretmanager_v1.Schema$Secret>(async pageToken => {
        const { data } = await this.client.projects.secrets.list({
          parent: `projects/${project}`,
          pageToken,
        });
        return { items: data.secrets, nextPageToken: data.nextPageToken };
      });
      return secrets.map(secret => this.secretToResource(secret, project)).filter(entity => entity !== undefined);
    });
  }
}
