/**
 * An IAM member, parsed into the thing it actually identifies.
 *
 * `serviceAccount:` covers two entirely different identities — a real service account and a
 * Kubernetes one borrowing it through Workload Identity — so the prefix alone is not enough to know
 * what a member is.
 */
export type GcpIamMember =
  | { kind: 'serviceAccount'; email: string; projectId: string }
  | { kind: 'workloadIdentity'; poolProject: string; pool: string; namespace: string; ksa: string }
  | { kind: 'user' | 'group' | 'domain'; identity: string }
  | { kind: 'public'; identity: string }
  | { kind: 'other'; identity: string };

/** `prod.svc.id.goog[auth/auth-sa]` — the Workload Identity spelling of a Kubernetes account. */
const GKE_WORKLOAD_IDENTITY = /^([^[\]]+\.svc\.id\.goog)\[([^/\]]+)\/([^/\]]+)\]$/;

/**
 * The same identity written as a workload identity principal, which is what the newer APIs and the
 * fleet workload identity docs emit:
 * `principal://iam.googleapis.com/projects/N/locations/global/workloadIdentityPools/POOL/subject/ns/NS/sa/KSA`.
 */
const WORKLOAD_IDENTITY_PRINCIPAL = /workloadIdentityPools\/([^/]+)\/subject\/ns\/([^/]+)\/sa\/([^/]+)$/;

/** The project a pool belongs to: `prod.svc.id.goog` is the pool of project `prod`. */
function poolProjectOf(pool: string): string {
  return pool.replace(/\.svc\.id\.goog$/, '');
}

/**
 * What an IAM member string identifies.
 *
 * Deleted members (`deleted:serviceAccount:…?uid=…`) are reported as `other`: the binding still
 * exists in the policy, but the identity behind it does not, so it should never become an edge.
 */
export function parseMember(member: string): GcpIamMember {
  if (member.startsWith('deleted:')) {
    return { kind: 'other', identity: member };
  }

  const principal = WORKLOAD_IDENTITY_PRINCIPAL.exec(member);
  if (principal) {
    const [, pool, namespace, ksa] = principal;
    return { kind: 'workloadIdentity', pool, poolProject: poolProjectOf(pool), namespace, ksa };
  }

  const separator = member.indexOf(':');
  if (separator < 0) {
    // `allUsers` and `allAuthenticatedUsers` carry no prefix at all.
    return { kind: 'public', identity: member };
  }

  const prefix = member.slice(0, separator);
  const value = member.slice(separator + 1);

  if (prefix === 'serviceAccount') {
    const workloadIdentity = GKE_WORKLOAD_IDENTITY.exec(value);
    if (workloadIdentity) {
      const [, pool, namespace, ksa] = workloadIdentity;
      return { kind: 'workloadIdentity', pool, poolProject: poolProjectOf(pool), namespace, ksa };
    }
    // `auth-sa@my-project.iam.gserviceaccount.com`, or `my-project.svc.id.goog` style domains for
    // the identities that are not accounts at all.
    const domain = value.split('@')[1] ?? '';
    return { kind: 'serviceAccount', email: value, projectId: domain.split('.')[0] ?? '' };
  }

  if (prefix === 'user' || prefix === 'group' || prefix === 'domain') {
    return { kind: prefix, identity: value };
  }

  return { kind: 'other', identity: member };
}

/** Whether a member is of a kind the configured `memberTypes` asked for. */
export function memberMatchesTypes(member: GcpIamMember, memberTypes: string[]): boolean {
  return memberTypes.includes(member.kind);
}
