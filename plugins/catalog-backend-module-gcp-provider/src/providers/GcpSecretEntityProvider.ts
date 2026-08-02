import { ANNOTATION_GCP_PROJECT_ID, ANNOTATION_GCP_SERVICE_ACCOUNT } from '../constants';
import { GcpEntityProviderBase } from './GcpEntityProviderBase';
import * as secretManager from '@google-cloud/secret-manager';
import { DeferredEntity } from '@backstage/plugin-catalog-node';
import { ANNOTATION_LOCATION, ANNOTATION_ORIGIN_LOCATION } from '@backstage/catalog-model';
import { formatResourceName } from '../utils';

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
    const [iamPolicyResponse] = await this.client.getIamPolicy({ resource: secret.name });
    const annotations: Record<string, string> = {
      [ANNOTATION_LOCATION]: location,
      [ANNOTATION_ORIGIN_LOCATION]: location,
      [ANNOTATION_GCP_PROJECT_ID]: projectId,
    };
    if (iamPolicyResponse.bindings) {
      annotations[ANNOTATION_GCP_SERVICE_ACCOUNT] =
        iamPolicyResponse.bindings.map(binding => binding.members?.join(',')).join(',') || '';
    }
    return {
      entity: {
        apiVersion: 'backstage.io/v1alpha1',
        kind: 'Resource',
        metadata: {
          name: formatResourceName(secret.name.split('/').pop()!),
          annotations: {
            [ANNOTATION_LOCATION]: location,
            [ANNOTATION_ORIGIN_LOCATION]: location,
            [ANNOTATION_GCP_PROJECT_ID]: projectId,
          },
          namespace: 'secrets',
        },
        spec: {
          type: 'secret',
          owner: this.defaultOwner,
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
