import {
  ANNOTATION_GCP_IAM_ACCESS,
  ANNOTATION_GCP_IAM_PROJECT_ROLES,
  ANNOTATION_GCP_IAM_ROLES,
  ANNOTATION_GCP_SERVICE_ACCOUNT,
} from '../constants';
import { GcpRestEntityProvider } from './GcpRestEntityProvider';
import { google, iam_v1 } from 'googleapis';
import { DeferredEntity } from '@backstage/plugin-catalog-node';
import { GcpIamGrant, GcpProjectPolicies } from '../iam';
import { apiSelfLink, lastSegment, truncateAnnotation } from '../utils';

/**
 * IAM service accounts, and the resources they can reach.
 *
 * This provider is where the catalog stops being an inventory and becomes a graph. A service
 * account's grants are turned into `dependsOn` relations, and because the catalog derives the
 * reverse relation automatically, the database, secret and topic behind a service account each gain
 * their `dependencyOf` edge without their own providers doing anything.
 */
export class GcpServiceAccountEntityProvider extends GcpRestEntityProvider<iam_v1.Iam> {
  getProviderName(): string {
    return 'gcp-service-account';
  }

  getProviderConfigKey(): string {
    return 'service-account';
  }

  getClient(): iam_v1.Iam {
    // `googleAuth` already resolves the key file, ADC, Workload Identity or the metadata server,
    // so there is no separate branch for running with and without configured credentials.
    return google.iam({ version: 'v1', auth: this.googleAuth });
  }

  /** Every grant this account holds, across every configured project's policies. */
  private grantsOf(email: string, policies: Map<string, GcpProjectPolicies>): GcpIamGrant[] {
    const member = `serviceAccount:${email}`;
    // `memberTypes` decides which kinds of principal produce edges at all. An account is only ever
    // this one kind, so narrowing the list past it is what switches these relations off.
    if (!this.iamMemberWanted(member)) {
      return [];
    }
    const grants: GcpIamGrant[] = [];
    for (const projectPolicies of policies.values()) {
      grants.push(...(projectPolicies.grantsByMember.get(member) ?? []));
    }
    return grants.filter(grant => this.iamRoleWanted(grant.role));
  }

  /** Roles this account holds at project level, which grant access without naming a resource. */
  private projectRolesOf(email: string, policies: Map<string, GcpProjectPolicies>): string[] {
    const member = `serviceAccount:${email}`;
    const roles = new Set<string>();
    for (const projectPolicies of policies.values()) {
      for (const role of projectPolicies.projectRolesByMember.get(member) ?? []) {
        roles.add(role);
      }
    }
    return [...roles];
  }

  private serviceAccountToResource(
    account: iam_v1.Schema$ServiceAccount,
    project: string,
    policies: Map<string, GcpProjectPolicies>,
  ): DeferredEntity | undefined {
    if (!account.email || !account.name) {
      return undefined;
    }
    const projectId = account.projectId ?? project;
    const grants = this.grantsOf(account.email, policies);
    const projectRoles = this.projectRolesOf(account.email, policies);

    // One relation per resource, however many roles are held on it, capped so a broadly-granted
    // account cannot bury its own entity page.
    const refs = new Map<string, string[]>();
    for (const grant of grants) {
      // The grant's own project, not the account's: the resource a role is held on frequently lives
      // in another project, and its entity is named after that one.
      const ref = this.refForAsset(grant.assetName, grant.assetType, grant.project ?? projectId);
      if (!ref) {
        continue;
      }
      // The cap bounds how many *resources* are related, so a role on a resource already related
      // still counts: dropping it would silently weaken the verb chosen for that resource, which
      // is decided from the full set of roles held on it.
      if (!refs.has(ref) && refs.size >= this.iamOptions.maxEdges) {
        continue;
      }
      refs.set(ref, [...(refs.get(ref) ?? []), grant.role]);
    }

    const roles = [...new Set(grants.map(grant => grant.role))];
    const access = grants
      .map(grant => `${lastSegment(grant.assetName)}=${grant.role}`)
      .filter((entry, index, all) => all.indexOf(entry) === index)
      .join(';');

    const name = account.name.split('/').pop()!.split('@')[0];

    return this.toEntity(
      {
        name,
        projectId,
        type: 'google-service-account',
        title: account.displayName || account.name,
        description: account.description,
        summary: grants.length
          ? `IAM service account ${account.email}, with access to ${refs.size} catalogued resource(s)`
          : `IAM service account ${account.email}`,
        // The IAM API reports no self link, so the canonical REST URL of the account stands in.
        selfLink: apiSelfLink('iam.googleapis.com', 'v1', account.name),
        assetName: `//iam.googleapis.com/projects/${projectId}/serviceAccounts/${account.email}`,
        // The console addresses accounts by their numeric id, not their email.
        consolePath: account.uniqueId
          ? `iam-admin/serviceaccounts/details/${account.uniqueId}`
          : 'iam-admin/serviceaccounts',
        logFilter: `protoPayload.authenticationInfo.principalEmail="${account.email}"`,
        tagValues: [account.disabled ? 'disabled' : 'enabled'],
        annotations: {
          [ANNOTATION_GCP_SERVICE_ACCOUNT]: account.email,
          ...(roles.length ? { [ANNOTATION_GCP_IAM_ROLES]: truncateAnnotation(roles.join(',')) } : {}),
          ...(access ? { [ANNOTATION_GCP_IAM_ACCESS]: truncateAnnotation(access) } : {}),
          // Project-level roles grant access to everything in the project without naming a
          // resource, so they cannot become edges. Recording them keeps that access visible.
          ...(projectRoles.length
            ? { [ANNOTATION_GCP_IAM_PROJECT_ROLES]: truncateAnnotation(projectRoles.join(',')) }
            : {}),
        },
      },
      // In `gcp` relation mode the typed edges (`accessorOf`, `publisherTo`, …) are emitted by
      // GcpRelationProcessor instead, from the same grants — declaring `dependsOn` as well would
      // duplicate every one of them.
      { dependsOn: this.relationMode === 'builtin' ? [...refs.keys()] : [] },
    );
  }

  public async getResources(): Promise<DeferredEntity[]> {
    // IAM service accounts carry no labels, so there is nothing to read an owner or system from and
    // these entities always fall back to the configured ones.
    const policies = await this.iamPolicies();

    return this.forEachProject(async project => {
      const accounts = await this.listAll<iam_v1.Schema$ServiceAccount>(async pageToken => {
        const { data } = await this.client.projects.serviceAccounts.list({
          name: `projects/${project}`,
          pageToken,
        });
        return { items: data.accounts, nextPageToken: data.nextPageToken };
      });
      return accounts
        .map(account => this.serviceAccountToResource(account, project, policies))
        .filter(entity => entity !== undefined);
    });
  }
}
