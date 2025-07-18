import { ANNOTATION_GCP_PROJECT_ID, ANNOTATION_GCP_SERVICE_ACCOUNT } from "../constants";
import { GcpEntityProviderBase } from "./GcpEntityProviderBase";
import * as gsm from '@google-cloud/secret-manager';
import {
  DeferredEntity
} from '@backstage/plugin-catalog-node';
import {
  ANNOTATION_LOCATION,
  ANNOTATION_ORIGIN_LOCATION,
} from '@backstage/catalog-model';

export class GcpSecretEntityProvider extends GcpEntityProviderBase<gsm.SecretManagerServiceClient> {
  getProviderName(): string {
    return 'gcp-secret-manager';
  }

  getProviderConfigKey(): string {
    return 'secretmanager';
  }

  getClient(): gsm.SecretManagerServiceClient {
    return new gsm.SecretManagerServiceClient({ credentials: this.credentials });
  }

  private async secretToResource(secret: gsm.protos.google.cloud.secretmanager.v1.ISecret, projectId: string): Promise<DeferredEntity | undefined> {
    if (!secret.name) {
      return undefined;
    }
    const location = `${this.getProviderName()}:${secret.name}`;
    const [ iamPolicyResponse ] = await this.client.getIamPolicy({ resource: secret.name });
    const annotations: Record<string, string> = {
      [ANNOTATION_LOCATION]: location,
      [ANNOTATION_ORIGIN_LOCATION]: location,
      [ANNOTATION_GCP_PROJECT_ID]: projectId,
    };
    if (iamPolicyResponse.bindings) {
      annotations[ANNOTATION_GCP_SERVICE_ACCOUNT] = iamPolicyResponse.bindings.map(binding => binding.members?.join(',')).join(',') || '';
    }
    return {
      entity: {
        apiVersion: 'backstage.io/v1alpha1',
        kind: 'Resource',
        metadata: {
          name: secret.name.split('/').pop()!,
          annotations: {
            [ANNOTATION_LOCATION]: location,
            [ANNOTATION_ORIGIN_LOCATION]: location,
            [ANNOTATION_GCP_PROJECT_ID]: projectId,
          },
          namespace: 'secrets',
        },
        spec: {
          type: 'secret',
          owner: this.getOwnerReference(secret),
        },
      },
    };
  }

  public async getResources(): Promise<DeferredEntity[]> {
    const resources = await Promise.all(
      this.config.getStringArray("projects").map(async project => {
        this.logger.info(`Discovering secrets in project: ${project}`);
        const [secrets] = await this.client.listSecrets({
          parent: `projects/${project}`,
        });
        this.logger.info(`Found ${secrets.length} secrets in project: ${project}`);
        return await Promise.all(secrets
          .filter(secret => secret !== undefined)
          .map(secret => this.secretToResource(secret, project))) ?? [];
      }),
    );
    return resources.flat().filter(secret => secret !== undefined).flat();
  }
}
