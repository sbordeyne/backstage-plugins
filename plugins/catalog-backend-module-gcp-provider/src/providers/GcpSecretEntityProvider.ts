import { GcpEntityProviderBase } from './GcpEntityProviderBase';
import * as secretManager from '@google-cloud/secret-manager';
import { DeferredEntity } from '@backstage/plugin-catalog-node';
import { ANNOTATION_LOCATION, ANNOTATION_ORIGIN_LOCATION } from '@backstage/catalog-model';
import { apiSelfLink, lastSegment } from '../utils';

export class GcpSecretEntityProvider extends GcpEntityProviderBase<secretManager.SecretManagerServiceClient> {
  getProviderName(): string {
    return 'gcp-secret-manager';
  }

  getProviderConfigKey(): string {
    return 'secretmanager';
  }

  getClient(): secretManager.SecretManagerServiceClient {
    return new secretManager.SecretManagerServiceClient({ credentials: this.credentials });
  }

  private async secretToResource(
    secret: secretManager.protos.google.cloud.secretmanager.v1.ISecret,
    projectId: string,
  ): Promise<DeferredEntity | undefined> {
    if (!secret.name) {
      return undefined;
    }
    const location = `${this.getProviderName()}:${secret.name}`;
    const secretId = lastSegment(secret.name);
    // Who can read the secret comes from the shared IAM index now, rather than a getIamPolicy call
    // per secret: it is the same information, without one round trip per resource.
    const annotations: Record<string, string> = {
      [ANNOTATION_LOCATION]: location,
      [ANNOTATION_ORIGIN_LOCATION]: location,
    };
    return {
      entity: {
        apiVersion: 'backstage.io/v1alpha1',
        kind: 'Resource',
        metadata: this.metadataOf({
          name: secretId,
          projectId,
          type: 'secret',
          // Secret Manager reports no self link, so the canonical REST URL of the resource stands
          // in for one — it is the same thing the API would have returned.
          selfLink: apiSelfLink('secretmanager.googleapis.com', 'v1', secret.name),
          labels: secret.labels,
          summary: `Secret Manager secret, ${
            secret.replication?.automatic ? 'automatically replicated' : 'replicated to selected regions'
          }`,
          consolePath: `security/secret-manager/secret/${secretId}/versions`,
          logFilter: `resource.type="secretmanager.googleapis.com/Secret" resource.labels.secret_id="${secretId}"`,
          annotations,
        }),
        spec: {
          type: 'secret',
          owner: this.ownerOf(secret.labels),
          ...this.systemOf(secret.labels),
        },
      },
    };
  }

  public async getResources(): Promise<DeferredEntity[]> {
    const secrets = await Promise.all(
      this.config.getStringArray('projects').map(async project => {
        this.logger.info(`Discovering secrets in project: ${project}`);
        const [projectSecrets] = await this.client.listSecrets({
          parent: `projects/${project}`,
        });
        this.logger.info(`Found ${projectSecrets.length} secrets in project: ${project}`);
        return (
          (await Promise.all(
            projectSecrets.filter(secret => secret !== undefined).map(secret => this.secretToResource(secret, project)),
          )) ?? []
        );
      }),
    );
    return secrets
      .flat()
      .filter(secret => secret !== undefined)
      .flat();
  }
}
