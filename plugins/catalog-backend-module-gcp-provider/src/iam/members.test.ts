import { parseMember } from './members';

describe('parseMember', () => {
  it('reads a Google service account and the project it belongs to', () => {
    expect(parseMember('serviceAccount:auth-sa@prod.iam.gserviceaccount.com')).toEqual({
      kind: 'serviceAccount',
      email: 'auth-sa@prod.iam.gserviceaccount.com',
      projectId: 'prod',
    });
  });

  it('reads the GKE Workload Identity spelling of a Kubernetes account', () => {
    expect(parseMember('serviceAccount:prod.svc.id.goog[auth/auth-sa]')).toEqual({
      kind: 'workloadIdentity',
      pool: 'prod.svc.id.goog',
      poolProject: 'prod',
      namespace: 'auth',
      ksa: 'auth-sa',
    });
  });

  it('reads the workload identity principal spelling of the same thing', () => {
    const member =
      'principal://iam.googleapis.com/projects/123/locations/global/workloadIdentityPools/' +
      'prod.svc.id.goog/subject/ns/auth/sa/auth-sa';
    expect(parseMember(member)).toEqual({
      kind: 'workloadIdentity',
      pool: 'prod.svc.id.goog',
      poolProject: 'prod',
      namespace: 'auth',
      ksa: 'auth-sa',
    });
  });

  it('reads human principals', () => {
    expect(parseMember('user:alice@corp.com')).toEqual({ kind: 'user', identity: 'alice@corp.com' });
    expect(parseMember('group:platform@corp.com')).toEqual({ kind: 'group', identity: 'platform@corp.com' });
    expect(parseMember('domain:corp.com')).toEqual({ kind: 'domain', identity: 'corp.com' });
  });

  it('reads the unauthenticated principals', () => {
    expect(parseMember('allUsers')).toEqual({ kind: 'public', identity: 'allUsers' });
    expect(parseMember('allAuthenticatedUsers')).toEqual({ kind: 'public', identity: 'allAuthenticatedUsers' });
  });

  it('refuses to resolve a deleted member, whose identity no longer exists', () => {
    const member = 'deleted:serviceAccount:gone@prod.iam.gserviceaccount.com?uid=123';
    expect(parseMember(member)).toEqual({ kind: 'other', identity: member });
  });

  it('falls back to other for principal sets it cannot place', () => {
    const member = 'principalSet://iam.googleapis.com/projects/1/locations/global/workloadIdentityPools/p/*';
    expect(parseMember(member).kind).toBe('other');
  });
});
