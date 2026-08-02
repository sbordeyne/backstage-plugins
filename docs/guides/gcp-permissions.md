# GCP permissions

Three plugins here talk to Google Cloud: the
[GCP catalog provider](../plugins/gcp-catalog-provider.md) reads resource inventories,
[Bruno](../plugins/bruno.md) reads report artifacts from a bucket, and
[Secure Share](../plugins/secure-share.md) reads and writes encrypted chunks in a bucket. All
three authenticate the same way, through Application Default Credentials, so one service account
can serve all of them.

This guide covers the identity, the permissions each plugin actually uses, and the GKE-specific
setup that the Kubernetes plugin needs on top.

## Choosing an identity

| Where Backstage runs | Credential                                                    | Notes                                   |
| -------------------- | ------------------------------------------------------------- | --------------------------------------- |
| GKE                  | Workload Identity                                             | Preferred. No key material anywhere     |
| Cloud Run / GCE      | Attached service account                                      | Also keyless                            |
| Elsewhere            | Service account key file via `GOOGLE_APPLICATION_CREDENTIALS` | A long-lived secret to rotate           |
| Local development    | `gcloud auth application-default login`                       | Your own identity, so grants must match |

The catalog provider reads `GOOGLE_APPLICATION_CREDENTIALS` itself and parses the key file; when
the variable is unset every client falls back to ambient credentials. Nothing else needs to
change between the two.

```bash
export PROJECT_ID=my-project
gcloud iam service-accounts create backstage \
  --project="${PROJECT_ID}" \
  --display-name="Backstage catalog ingestion"
```

```hcl
resource "google_service_account" "backstage" {
  project      = var.project_id
  account_id   = "backstage"
  display_name = "Backstage catalog ingestion"
}
```

## Permissions per provider

Every provider fails independently, so a missing role degrades one resource type rather than
stopping ingestion. These are read-only permissions throughout — nothing in the catalog provider
mutates anything in GCP.

| Provider          | API calls made                                | Permissions                                                                                                                      | Predefined role equivalent       |
| ----------------- | --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| `bigquery`        | list datasets                                 | `bigquery.datasets.get`                                                                                                          | `roles/bigquery.metadataViewer`  |
| `storage`         | list buckets                                  | `storage.buckets.list`, `storage.buckets.get`                                                                                    | — (see below)                    |
| `cloudsql`        | list instances                                | `cloudsql.instances.list`, `cloudsql.instances.get`                                                                              | `roles/cloudsql.viewer`          |
| `pubsub`          | list topics and subscriptions, read topic IAM | `pubsub.topics.list`, `pubsub.topics.get`, `pubsub.topics.getIamPolicy`, `pubsub.subscriptions.list`, `pubsub.subscriptions.get` | `roles/pubsub.viewer`            |
| `secretmanager`   | list secrets, read secret IAM                 | `secretmanager.secrets.list`, `secretmanager.secrets.get`, `secretmanager.secrets.getIamPolicy`                                  | `roles/secretmanager.viewer`     |
| `service-account` | list service accounts                         | `iam.serviceAccounts.list`, `iam.serviceAccounts.get`                                                                            | `roles/iam.serviceAccountViewer` |
| `clusters`        | list clusters                                 | `container.clusters.list`, `container.clusters.get`                                                                              | `roles/container.clusterViewer`  |

Two things worth stating plainly:

- **Secret Manager metadata only.** `roles/secretmanager.viewer` does not include
  `secretmanager.versions.access`, so the plugin can enumerate secrets and never read their
  payloads. Do not substitute `roles/secretmanager.secretAccessor`.
- **Cloud Storage has no narrow predefined role for listing buckets.** `storage.buckets.list` at
  project level lives in broad roles such as `roles/viewer` and `roles/storage.admin`. Use a
  custom role instead of either.

### One custom role

The least-privilege option, and the one to prefer: a single custom role covering every provider
you enable.

```yaml
# backstage-catalog-reader.yaml
title: Backstage catalog reader
description: Read-only inventory access for Backstage GCP ingestion
stage: GA
includedPermissions:
  - bigquery.datasets.get
  - storage.buckets.get
  - storage.buckets.list
  - cloudsql.instances.get
  - cloudsql.instances.list
  - pubsub.topics.get
  - pubsub.topics.list
  - pubsub.topics.getIamPolicy
  - pubsub.subscriptions.get
  - pubsub.subscriptions.list
  - secretmanager.secrets.get
  - secretmanager.secrets.list
  - secretmanager.secrets.getIamPolicy
  - iam.serviceAccounts.get
  - iam.serviceAccounts.list
  - container.clusters.get
  - container.clusters.list
```

```bash
gcloud iam roles create backstageCatalogReader \
  --project="${PROJECT_ID}" \
  --file=backstage-catalog-reader.yaml

gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
  --member="serviceAccount:backstage@${PROJECT_ID}.iam.gserviceaccount.com" \
  --role="projects/${PROJECT_ID}/roles/backstageCatalogReader"
```

```hcl
resource "google_project_iam_custom_role" "backstage_catalog_reader" {
  project     = var.project_id
  role_id     = "backstageCatalogReader"
  title       = "Backstage catalog reader"
  description = "Read-only inventory access for Backstage GCP ingestion"

  permissions = [
    "bigquery.datasets.get",
    "storage.buckets.get",
    "storage.buckets.list",
    "cloudsql.instances.get",
    "cloudsql.instances.list",
    "pubsub.topics.get",
    "pubsub.topics.list",
    "pubsub.topics.getIamPolicy",
    "pubsub.subscriptions.get",
    "pubsub.subscriptions.list",
    "secretmanager.secrets.get",
    "secretmanager.secrets.list",
    "secretmanager.secrets.getIamPolicy",
    "iam.serviceAccounts.get",
    "iam.serviceAccounts.list",
    "container.clusters.get",
    "container.clusters.list",
  ]
}

# One binding per project the provider enumerates.
resource "google_project_iam_member" "backstage_catalog_reader" {
  for_each = toset(var.ingested_project_ids)

  project = each.value
  role    = google_project_iam_custom_role.backstage_catalog_reader.id
  member  = "serviceAccount:${google_service_account.backstage.email}"
}
```

The role is defined once, in the project that owns it, and bound in every project listed under a
provider's `projects`. A custom role defined at the organization level works the same way and
saves repeating the definition per project.

### Predefined roles instead

If custom roles are awkward in your organization, bind the predefined equivalents — accepting
that `storage` then needs something broader than it should:

```bash
for ROLE in \
  roles/bigquery.metadataViewer \
  roles/cloudsql.viewer \
  roles/pubsub.viewer \
  roles/secretmanager.viewer \
  roles/iam.serviceAccountViewer \
  roles/container.clusterViewer
do
  gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
    --member="serviceAccount:backstage@${PROJECT_ID}.iam.gserviceaccount.com" \
    --role="${ROLE}"
done
```

## Bucket access for Bruno and Secure Share

Both bucket-backed plugins are granted at the bucket, not the project, so they cannot reach any
other bucket the catalog provider can see.

| Plugin       | Needs                          | Role                         |
| ------------ | ------------------------------ | ---------------------------- |
| Bruno        | list and read report objects   | `roles/storage.objectViewer` |
| Secure Share | create, read and delete chunks | `roles/storage.objectAdmin`  |

```bash
gcloud storage buckets add-iam-policy-binding gs://my-ci-artifacts \
  --member="serviceAccount:backstage@${PROJECT_ID}.iam.gserviceaccount.com" \
  --role=roles/storage.objectViewer

gcloud storage buckets add-iam-policy-binding gs://example-secure-share \
  --member="serviceAccount:backstage@${PROJECT_ID}.iam.gserviceaccount.com" \
  --role=roles/storage.objectAdmin
```

```hcl
resource "google_storage_bucket_iam_member" "bruno_reports" {
  bucket = google_storage_bucket.ci_artifacts.name
  role   = "roles/storage.objectViewer"
  member = "serviceAccount:${google_service_account.backstage.email}"
}

resource "google_storage_bucket_iam_member" "secure_share_chunks" {
  bucket = google_storage_bucket.secure_share.name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.backstage.email}"
}
```

Secure Share genuinely needs delete: the purge task removes ciphertext for expired and consumed
pastes, and without it the bucket accumulates orphaned chunks whose database rows are long gone.

## GKE and the Kubernetes plugin

Ingesting GKE clusters and _reading what runs inside them_ are two different grants. The catalog
provider only does the first.

The `clusters` provider emits a `Resource` per cluster annotated with the API server URL, the
cluster CA certificate and `kubernetes.io/auth-provider: googleServiceAccount`. That is exactly
what the Kubernetes plugin's `catalog` cluster locator consumes:

```yaml
kubernetes:
  serviceLocatorMethod:
    type: multiTenant
  clusterLocatorMethods:
    - type: catalog
```

With that in place, cluster entities ingested from GCP become clusters the Kubernetes plugin can
query — no per-cluster block in `app-config.yaml`, and a new cluster appears on the next refresh.

### 1. Discovery

`container.clusters.list` and `container.clusters.get`, already covered by the custom role or by
`roles/container.clusterViewer`. This is enough for cluster entities to appear in the catalog.

### 2. Talking to the API server

Reading workloads needs authorization inside the cluster as well. Two ways, in order of
preference:

**In-cluster RBAC (least privilege).** Bind the service account's email as a Kubernetes user.
GKE maps a Google identity to a `User` subject named by its email:

```yaml
# backstage-reader.yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: backstage-reader
subjects:
  - kind: User
    name: backstage@my-project.iam.gserviceaccount.com
    apiGroup: rbac.authorization.k8s.io
roleRef:
  kind: ClusterRole
  name: view
  apiGroup: rbac.authorization.k8s.io
```

```bash
gcloud container clusters get-credentials my-cluster \
  --region=europe-west1 --project="${PROJECT_ID}"
kubectl apply -f backstage-reader.yaml
```

```hcl
resource "kubernetes_cluster_role_binding" "backstage_reader" {
  metadata {
    name = "backstage-reader"
  }

  subject {
    kind      = "User"
    name      = google_service_account.backstage.email
    api_group = "rbac.authorization.k8s.io"
  }

  role_ref {
    kind      = "ClusterRole"
    name      = "view"          # or a narrower custom ClusterRole
    api_group = "rbac.authorization.k8s.io"
  }
}
```

The built-in `view` ClusterRole excludes Secrets, which is the right default. Replace it with a
custom ClusterRole if you want to narrow it further — the Kubernetes plugin reads Deployments,
Pods, Services, Ingresses, HPAs, StatefulSets, CronJobs, Jobs, ReplicaSets and Events.

Bind it in every cluster you expect to browse. A cluster that is ingested but never bound shows
up in the catalog and returns authorization errors on its Kubernetes tab, which is a clearer
failure than being silently absent.

**Project-wide IAM (blunt).** `roles/container.viewer` grants read access to Kubernetes objects
across every cluster in the project, with no per-cluster step. Convenient, and it applies to
clusters you did not intend to expose — including their ConfigMaps.

### 3. Reachability

The provider prefers the cluster's DNS-based control plane endpoint over the IP endpoint when
one is configured. Either way the Backstage backend has to be able to reach it: a private
cluster whose control plane is not reachable from where Backstage runs ingests fine and fails on
every query. Authorized networks, Private Service Connect or running Backstage inside the same
VPC all resolve that; the catalog entity is not the problem.

## Workload Identity

The keyless option when Backstage itself runs on GKE. Bind the Kubernetes service account
Backstage runs under to the Google service account:

```bash
gcloud iam service-accounts add-iam-policy-binding \
  "backstage@${PROJECT_ID}.iam.gserviceaccount.com" \
  --role=roles/iam.workloadIdentityUser \
  --member="serviceAccount:${PROJECT_ID}.svc.id.goog[backstage/backstage]"

kubectl annotate serviceaccount backstage \
  --namespace backstage \
  "iam.gke.io/gcp-service-account=backstage@${PROJECT_ID}.iam.gserviceaccount.com"
```

```hcl
resource "google_service_account_iam_member" "backstage_workload_identity" {
  service_account_id = google_service_account.backstage.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "serviceAccount:${var.project_id}.svc.id.goog[backstage/backstage]"
}

resource "kubernetes_service_account" "backstage" {
  metadata {
    name      = "backstage"
    namespace = "backstage"

    annotations = {
      "iam.gke.io/gcp-service-account" = google_service_account.backstage.email
    }
  }
}
```

`[backstage/backstage]` is `[namespace/serviceaccount]` — both have to match the deployment.
Leave `GOOGLE_APPLICATION_CREDENTIALS` unset so the clients pick up the workload identity token.

## Key files, if you must

```bash
gcloud iam service-accounts keys create backstage-sa.json \
  --iam-account="backstage@${PROJECT_ID}.iam.gserviceaccount.com"
```

Mount it as a secret and point the environment variable at the path:

```yaml
env:
  - name: GOOGLE_APPLICATION_CREDENTIALS
    value: /var/secrets/gcp/backstage-sa.json
```

It is a long-lived credential granting read access to your whole inventory — rotate it, keep it
out of the image, and prefer Workload Identity wherever it is available.

## Verifying

Check the grants without deploying anything, by impersonating the service account. This needs
`roles/iam.serviceAccountTokenCreator` on it for your own user:

```bash
SA="backstage@${PROJECT_ID}.iam.gserviceaccount.com"

gcloud storage buckets list --project="${PROJECT_ID}" --impersonate-service-account="${SA}"
gcloud sql instances list --project="${PROJECT_ID}" --impersonate-service-account="${SA}"
gcloud pubsub topics list --project="${PROJECT_ID}" --impersonate-service-account="${SA}"
gcloud secrets list --project="${PROJECT_ID}" --impersonate-service-account="${SA}"
gcloud container clusters list --project="${PROJECT_ID}" --impersonate-service-account="${SA}"
gcloud iam service-accounts list --project="${PROJECT_ID}" --impersonate-service-account="${SA}"

# BigQuery has no gcloud surface for this; use bq with an impersonated token.
CLOUDSDK_AUTH_ACCESS_TOKEN="$(gcloud auth print-access-token --impersonate-service-account="${SA}")" \
  bq ls --project_id="${PROJECT_ID}"
```

Each command maps to one provider. Whichever fails is the provider that will log
`error fetching GCP resources` at the same point.

For the Kubernetes side, confirm the RBAC binding resolves:

```bash
kubectl auth can-i list pods \
  --as="backstage@${PROJECT_ID}.iam.gserviceaccount.com" \
  --all-namespaces
```
