import { DeferredEntity } from '@backstage/plugin-catalog-node';
import { google, iam_v1 } from 'googleapis';
import { GcpRestEntityProvider } from './GcpRestEntityProvider';
import { ANNOTATION_GCP_IAM_PERMISSIONS, ANNOTATION_GCP_STATUS } from '../constants';
import { lastSegment, truncateAnnotation } from '../utils';

/**
 * Custom IAM roles.
 *
 * Only custom roles are ingested. The ~1,900 predefined roles are identical in every GCP
 * installation and belong to Google rather than to anyone's catalog, and permissions — ~10,000
 * strings with no owner and no lifecycle — are recorded on the role that includes them rather than
 * becoming entities of their own.
 */
export class GcpIamRoleEntityProvider extends GcpRestEntityProvider<iam_v1.Iam> {
  getProviderName(): string {
    return 'gcp-iam-roles';
  }

  getProviderConfigKey(): string {
    return 'iam-roles';
  }

  getClient(): iam_v1.Iam {
    return google.iam({ version: 'v1', auth: this.googleAuth });
  }

  /** Organization whose roles are ingested alongside the per-project ones, e.g. `organizations/1`. */
  private get organization(): string | undefined {
    return this.config.getOptionalString('organization');
  }

  private roleToResource(role: iam_v1.Schema$Role, project: string): DeferredEntity | undefined {
    const roleId = lastSegment(role.name);
    if (!roleId) {
      return undefined;
    }
    const permissions = role.includedPermissions ?? [];
    // `storage.buckets.get` → `storage`: the services a role reaches into are the useful thing to
    // search on, where the individual permissions are not.
    const services = [...new Set(permissions.map(permission => permission.split('.')[0]))];

    return this.toEntity({
      name: roleId,
      projectId: project,
      type: 'iam-role',
      title: role.title,
      description: role.description,
      summary: `Custom role granting ${permissions.length} permission(s) across ${services.length} service(s)`,
      selfLink: `https://iam.googleapis.com/v1/${role.name}`,
      consolePath: `iam-admin/roles/details/${encodeURIComponent(role.name ?? '')}`,
      tagValues: [...services, role.stage],
      annotations: {
        ...(permissions.length ? { [ANNOTATION_GCP_IAM_PERMISSIONS]: truncateAnnotation(permissions.join(',')) } : {}),
        ...(role.stage ? { [ANNOTATION_GCP_STATUS]: role.stage } : {}),
      },
    });
  }

  public async getResources(): Promise<DeferredEntity[]> {
    const organization = this.organization;
    const organizationRoles = organization
      ? await this.listAll<iam_v1.Schema$Role>(async pageToken => {
          const { data } = await this.client.organizations.roles.list({
            parent: organization,
            view: 'FULL',
            pageToken,
          });
          return { items: data.roles, nextPageToken: data.nextPageToken };
        })
      : [];

    const projectRoles = await this.forEachProject(async project => {
      const roles = await this.listAll<iam_v1.Schema$Role>(async pageToken => {
        const { data } = await this.client.projects.roles.list({
          parent: `projects/${project}`,
          view: 'FULL',
          pageToken,
        });
        return { items: data.roles, nextPageToken: data.nextPageToken };
      });
      return roles.map(role => this.roleToResource(role, project)).filter(entity => entity !== undefined);
    });

    return [
      ...projectRoles,
      ...organizationRoles
        .map(role => this.roleToResource(role, this.projects[0] ?? ''))
        .filter(entity => entity !== undefined),
    ];
  }
}
