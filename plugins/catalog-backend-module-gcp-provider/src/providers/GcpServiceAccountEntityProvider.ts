import { ANNOTATION_GCP_PROJECT_ID, ANNOTATION_GCP_SERVICE_ACCOUNT } from "../constants";
import { GcpEntityProviderBase } from "./GcpEntityProviderBase";
import { google, iam_v1 } from 'googleapis';
import {
  DeferredEntity
} from '@backstage/plugin-catalog-node';
import {
  ANNOTATION_LOCATION,
  ANNOTATION_ORIGIN_LOCATION,
} from '@backstage/catalog-model';

export class GcpServiceAccountEntityProvider extends GcpEntityProviderBase<iam_v1.Iam> {
  getProviderName(): string {
    return 'gcp-service-account';
  }

  getProviderConfigKey(): string {
    return 'service-account';
  }

  getClient(): iam_v1.Iam {
    if (!this.credentials) {
      return google.iam({version: 'v1'});
    }
    const jwtClient = new google.auth.JWT({
      ...this.credentials,
      scopes: ['https://www.googleapis.com/auth/cloud-platform'],
    });
    const iam = google.iam({auth: jwtClient, version: 'v1'});
    return iam;
  }

  private async serviceAccountToResource(account: iam_v1.Schema$ServiceAccount): Promise<DeferredEntity | undefined> {
    if (!account.email || !account.name) {
      return undefined;
    }
    const location = `${this.getProviderName()}:${account.name}`;
    const annotations: Record<string, string> = {
      [ANNOTATION_LOCATION]: location,
      [ANNOTATION_ORIGIN_LOCATION]: location,
      [ANNOTATION_GCP_PROJECT_ID]: account.projectId ?? '',
      [ANNOTATION_GCP_SERVICE_ACCOUNT]: account.email,
    };

    const name = account.name.split('/').pop()!.split('@')[0];

    return {
      entity: {
        apiVersion: 'backstage.io/v1alpha1',
        kind: 'Resource',
        metadata: {
          name,
          title: account.displayName || account.name,
          annotations,
          namespace: 'service-accounts',
        },
        spec: {
          type: 'google-service-account',
          owner: this.getOwnerReference(account),
        },
      },
    };
  }

  public async getResources(): Promise<DeferredEntity[]> {
    const secretAccounts = await Promise.all(
      this.config.getStringArray("projects").map(async project => {
        this.logger.info(`Discovering service accounts in project: ${project}`);
        const res = await this.client.projects.serviceAccounts.list({
          name: `projects/${project}`,
        });
        const serviceAccounts = res.data.accounts || [];
        return (await Promise.all(
          serviceAccounts
            .map(async account => this.serviceAccountToResource(account))
        )).filter(account => account !== undefined);
      }),
    );
    return secretAccounts.flat(2);
  }
}
