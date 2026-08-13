import { mockServices } from '@backstage/backend-test-utils';
import { cloudasset_v1 } from 'googleapis';
import { GcpAssetIndex } from './GcpAssetIndex';

const OPTIONS = { cacheTtlMs: 60_000, maxBindings: 1000 };

/** A policy sweep client returning the given pages, and counting how often it was called. */
function clientOf(...pages: cloudasset_v1.Schema$SearchAllIamPoliciesResponse[]) {
  const searchAllIamPolicies = jest.fn();
  pages.forEach(page => searchAllIamPolicies.mockResolvedValueOnce({ data: page }));
  return { client: { v1: { searchAllIamPolicies } } as unknown as cloudasset_v1.Cloudasset, searchAllIamPolicies };
}

function indexOf(client: cloudasset_v1.Cloudasset, options = OPTIONS): GcpAssetIndex {
  return new GcpAssetIndex(client, mockServices.logger.mock(), options);
}

const BUCKET_POLICY = {
  resource: '//storage.googleapis.com/projects/_/buckets/reports',
  assetType: 'storage.googleapis.com/Bucket',
  policy: {
    bindings: [
      { role: 'roles/storage.objectViewer', members: ['serviceAccount:auth-sa@prod.iam.gserviceaccount.com'] },
    ],
  },
};

const WORKLOAD_IDENTITY_POLICY = {
  resource: '//iam.googleapis.com/projects/prod/serviceAccounts/auth-sa@prod.iam.gserviceaccount.com',
  assetType: 'iam.googleapis.com/ServiceAccount',
  policy: {
    bindings: [{ role: 'roles/iam.workloadIdentityUser', members: ['serviceAccount:prod.svc.id.goog[auth/auth-sa]'] }],
  },
};

const PROJECT_POLICY = {
  resource: '//cloudresourcemanager.googleapis.com/projects/123456',
  assetType: 'cloudresourcemanager.googleapis.com/Project',
  policy: {
    bindings: [{ role: 'roles/editor', members: ['serviceAccount:legacy@prod.iam.gserviceaccount.com'] }],
  },
};

describe('GcpAssetIndex', () => {
  it('indexes a resource grant by the member holding it', async () => {
    const { client } = clientOf({ results: [BUCKET_POLICY] });
    const policies = await indexOf(client).policiesOf('prod');

    expect(policies.grantsByMember.get('serviceAccount:auth-sa@prod.iam.gserviceaccount.com')).toEqual([
      {
        assetName: '//storage.googleapis.com/projects/_/buckets/reports',
        assetType: 'storage.googleapis.com/Bucket',
        role: 'roles/storage.objectViewer',
      },
    ]);
    expect(policies.membersByAsset.get('//storage.googleapis.com/projects/_/buckets/reports')).toEqual([
      { role: 'roles/storage.objectViewer', members: ['serviceAccount:auth-sa@prod.iam.gserviceaccount.com'] },
    ]);
  });

  it('reads the Kubernetes side of a Workload Identity binding', async () => {
    const { client } = clientOf({ results: [WORKLOAD_IDENTITY_POLICY] });
    const policies = await indexOf(client).policiesOf('prod');

    expect(policies.workloadIdentity).toEqual([
      {
        pool: 'prod.svc.id.goog',
        poolProject: 'prod',
        namespace: 'auth',
        ksa: 'auth-sa',
        gsaEmail: 'auth-sa@prod.iam.gserviceaccount.com',
        gsaProject: 'prod',
      },
    ]);
  });

  it('keeps project-level roles apart from resource grants', async () => {
    const { client } = clientOf({ results: [PROJECT_POLICY] });
    const policies = await indexOf(client).policiesOf('prod');

    // A project-level grant names no resource, so it cannot become an edge.
    expect(policies.grantsByMember.size).toBe(0);
    expect(policies.projectRolesByMember.get('serviceAccount:legacy@prod.iam.gserviceaccount.com')).toEqual([
      'roles/editor',
    ]);
  });

  it('follows pagination', async () => {
    const { client, searchAllIamPolicies } = clientOf(
      { results: [BUCKET_POLICY], nextPageToken: 'next' },
      { results: [WORKLOAD_IDENTITY_POLICY] },
    );
    const policies = await indexOf(client).policiesOf('prod');

    expect(searchAllIamPolicies).toHaveBeenCalledTimes(2);
    expect(policies.workloadIdentity).toHaveLength(1);
    // Both the bucket grant and the workloadIdentityUser grant on the service account itself.
    expect(policies.grantsByMember.size).toBe(2);
  });

  it('sweeps once for concurrent callers and again after the ttl', async () => {
    jest.useFakeTimers();
    try {
      const { client, searchAllIamPolicies } = clientOf({ results: [BUCKET_POLICY] }, { results: [BUCKET_POLICY] });
      const index = indexOf(client, { ...OPTIONS, cacheTtlMs: 60_000 });

      await Promise.all([index.policiesOf('prod'), index.policiesOf('prod')]);
      expect(searchAllIamPolicies).toHaveBeenCalledTimes(1);

      jest.advanceTimersByTime(60_001);
      await index.policiesOf('prod');
      expect(searchAllIamPolicies).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
  });

  it('stops at the configured cap rather than reading an unbounded estate', async () => {
    const results = Array.from({ length: 5 }, (_, index) => ({
      ...BUCKET_POLICY,
      resource: `//storage.googleapis.com/projects/_/buckets/bucket-${index}`,
    }));
    const { client } = clientOf({ results });
    const policies = await indexOf(client, { ...OPTIONS, maxBindings: 2 }).policiesOf('prod');

    expect(policies.truncated).toBe(true);
    expect(policies.membersByAsset.size).toBe(2);
  });

  it('degrades to no policies when the project cannot be read', async () => {
    const searchAllIamPolicies = jest.fn().mockRejectedValue(Object.assign(new Error('disabled'), { code: 403 }));
    const client = { v1: { searchAllIamPolicies } } as unknown as cloudasset_v1.Cloudasset;

    const policies = await indexOf(client).policiesOf('prod');
    expect(policies.grantsByMember.size).toBe(0);
    expect(policies.workloadIdentity).toEqual([]);
  });
});
