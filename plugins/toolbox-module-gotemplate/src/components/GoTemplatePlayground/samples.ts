import type { DataFormat, FunctionSet } from '../../engine';

export interface Sample {
  template: string;
  data: string;
  dataFormat: DataFormat;
}

/**
 * Each sample is written to exercise what makes that function set different,
 * so switching sets shows the divergence rather than the same output four
 * times over.
 */
export const SAMPLES: Record<FunctionSet, Sample> = {
  sprig: {
    template: `{{/* Masterminds/sprig on plain text/template */}}
name:     {{ .app.name | upper }}
slug:     {{ .app.name | kebabcase }}
replicas: {{ .app.replicas | default 3 }}
secret:   {{ "hunter2" | b64enc }}
joined:   {{ .tags | join ", " }}
{{ range $i, $t := .tags }}
  tag {{ $i }}: {{ $t | trunc 6 }}
{{- end }}

{{- if gt (len .tags) 2 }}
note: more than two tags
{{- end }}`,
    data: `app:
  name: Payments API
  replicas: 5
tags:
  - production
  - critical
  - eu-west-1`,
    dataFormat: 'yaml',
  },

  sprout: {
    template: `{{/* go-sprout/sprout v1 renames most sprig functions. */}}
{{/* upper -> toUpper, b64enc -> base64Encode, kebabcase -> toKebabCase */}}
name:    {{ .app.name | toUpper }}
slug:    {{ .app.name | toKebabCase }}
camel:   {{ .app.name | toCamelCase }}
secret:  {{ "hunter2" | base64Encode }}
sha256:  {{ .app.name | sha256Sum | trunc 16 }}

{{/* sprout also ships a network registry sprig never had */}}
cidr:    {{ cidrSize "10.0.0.0/24" }} addresses
first:   {{ cidrFirst "10.0.0.0/24" }}`,
    data: `app:
  name: Payments API`,
    dataFormat: 'yaml',
  },

  helm: {
    template: `{{/* Rendered by helm's own engine: .Values, .Release and .Chart
     are all populated, and include/tpl/required work as in a real chart. */}}
{{- define "app.labels" -}}
app.kubernetes.io/name: {{ .Chart.Name }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

apiVersion: apps/v1
kind: Deployment
metadata:
  name: {{ .Release.Name }}-{{ .Values.name }}
  namespace: {{ .Release.Namespace }}
  labels:
    {{- include "app.labels" . | nindent 4 }}
spec:
  replicas: {{ .Values.replicas | default 1 }}
  template:
    spec:
      containers:
        - name: {{ .Values.name }}
          image: {{ required "an image is required" .Values.image | quote }}
          env:
            {{- toYaml .Values.env | nindent 12 }}

# kube version comes from .Capabilities
# running on {{ .Capabilities.KubeVersion.Version }}`,
    data: `name: api
image: ghcr.io/acme/api:1.4.0
replicas: 3
env:
  - name: LOG_LEVEL
    value: debug`,
    dataFormat: 'yaml',
  },

  eso: {
    template: `{{/* external-secrets-operator templating.

     The context is the *flat* map of keys fetched from the secret store, so
     values are addressed as .keyname — there is no .Values nesting here.
     missingkey=error is forced on, matching the operator. */}}
username: {{ .username }}
password: {{ .password | b64enc }}

connection-string: {{ printf "postgres://%s:%s@%s/%s" .username .password .host .database | quote }}

{{/* ESO-specific helpers, e.g. pulling a single block out of a PEM bundle */}}
ca.crt: |
{{ .ca_bundle | filterPEM "CERTIFICATE" | indent 2 }}`,
    data: `username: svc_payments
password: s3cr3t-value
host: db.internal:5432
database: payments
ca_bundle: |
  -----BEGIN CERTIFICATE-----
  MIIBhTCCASugAwIBAgIQIRi6zePL6mKjOipn+dNuaTAKBggqhkjOPQQDAjASMRAw
  DgYDVQQKEwdBY21lIENvMB4XDTE3MTAyMDE5NDMwNloXDTE4MTAyMDE5NDMwNlow
  EjEQMA4GA1UEChMHQWNtZSBDbzBZMBMGByqGSM49AgEGCCqGSM49AwEHA0IABD0d
  7VNhbWvZLWPuj/RtHFjvtJBEwOkhbN/BnnE8rnZR8+sbwnc/KhCk3FhnpHZnQz7B
  5aETbbIgmuvewdjvSBSjYzBhMA4GA1UdDwEB/wQEAwICpDATBgNVHSUEDDAKBggr
  BgEFBQcDATAPBgNVHRMBAf8EBTADAQH/MCkGA1UdEQQiMCCCDmxvY2FsaG9zdDo1
  NDUzgg4xMjcuMC4wLjE6NTQ1MzAKBggqhkjOPQQDAgNIADBFAiEA2zpJEPQyz6/l
  Wf86aX6PepsntZv2GYlA5UpabfT2EZICICpJ5h/iI+i341gBmLiAFQOyTDT+/wQc
  6MF9+Yw1Yy0t
  -----END CERTIFICATE-----`,
    dataFormat: 'yaml',
  },
};
