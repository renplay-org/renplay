# renplay

Play downloaded Ren'Py visual novels in your browser with server saves

**Homepage:** <https://renplay.org>

## Usage

```sh
helm install renplay oci://ghcr.io/renplay-org/charts/renplay
kubectl port-forward service/renplay 8080:8080
```

Open http://localhost:8080 and create the owner account. A default StorageClass
is required unless you supply existing claims or NFS storage for games.
Kubernetes must be 1.25 or newer. Gateway API routes also require the Gateway API CRDs.

Run one writer with `strategy.type: Recreate`. A rolling update is refused.
The image runs as UID/GID 1000 with a read-only root filesystem, no capabilities
and a writable `/tmp` emptyDir. Change `podSecurityContext` to match your volume
permissions. NFS export permissions must be prepared by the operator. The chart
never runs a root ownership-changing init container.

## Storage

- `/data`: a 5 GiB PVC on local disk for SQLite, accounts and saves. Back it up.
  Never use a network filesystem for this volume.
- `/games`: a 50 GiB PVC by default for games, engines and installation scratch.
  Allow about twice the download size free during installs.
- `/downloads`: optional separate PVC, existing claim or NFS share. Without it,
  downloads stay in `/games/_archives`. Nothing is moved automatically.

Each PVC created by the chart is retained on uninstall through
`helm.sh/resource-policy: keep`. Reuse retained claims via `existingClaim` when
reinstalling the chart. Delete claims manually only when you intend to discard
their data. Deleting `/data` loses saves. Deleting `/games` also loses downloads
unless you mounted them separately. Installed games can be rebuilt only while
the original downloads are available. The optional downloads mount works with
older images too because the chart sets `ARCHIVES_DIR=/downloads` explicitly.

```yaml
persistence:
  data:
    existingClaim: renplay-data
  games:
    nfs:
      server: nas.example.com
      path: /exports/renplay/games
  downloads:
    enabled: true
    existingClaim: renplay-downloads
```

## Networking and sign-in

Use `ingress` or `httpRoute` to expose the Service. Renplay must be served from
the root of its origin. Configure your controller to allow large uploads and
long requests. Use HTTPS outside a trusted local network. Set
`RENPLAY_PUBLIC_URL` to your public URL when using external sign-in.

```yaml
config:
  extraEnv:
    - name: RENPLAY_PUBLIC_URL
      value: https://renplay.example.com
    - name: RENPLAY_OIDC_ISSUER
      value: https://login.example.com
    - name: RENPLAY_OIDC_CLIENT_ID
      value: renplay
  envFrom:
    - configMapRef:
        name: renplay-settings
secret:
  oidcClientSecret:
    existingSecret: renplay-oidc
    key: client-secret
```

OIDC and LDAP secrets are mounted read-only and passed through
`RENPLAY_OIDC_CLIENT_SECRET_FILE` and `RENPLAY_LDAP_BIND_PASSWORD_FILE`.
Do not set the corresponding plain environment variable at the same time.
No secret values are stored in Helm values by the chart. Use
`deploymentAnnotations` for a secret reloader if you need automatic restarts.

Use `image.repository: docker.io/renplay/renplay` for the Docker Hub mirror.
`image.tag` defaults to the chart appVersion. `image.digest` wins over the tag.
The release workflow pins the published image digest in the packaged chart.
`helm test renplay` checks `/api/health` through the Service using the app image's curl.

See [application configuration](https://docs.renplay.org/configuration/) and
[Kubernetes installation](https://docs.renplay.org/install/kubernetes/).

## Maintainers

| Name | Email | Url |
| ---- | ------ | --- |
| renplay-org |  | <https://github.com/renplay-org> |

## Source Code

* <https://github.com/renplay-org/renplay>

## Requirements

Kubernetes: `>=1.25.0-0`

## Values

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| affinity | object | `{}` | Affinity. |
| config.envFrom | list | `[]` | Environment sources, such as secretRef or configMapRef. |
| config.extraEnv | list | `[]` | Extra environment entries, including valueFrom references. See the application configuration reference. |
| deploymentAnnotations | object | `{}` | Deployment annotations. |
| fullnameOverride | string | `""` | Override the full release name. |
| httpRoute.annotations | object | `{}` | HTTPRoute annotations. |
| httpRoute.enabled | bool | `false` | Create a Gateway API v1 HTTPRoute. Requires Gateway API CRDs. |
| httpRoute.filters | list | `[]` | Filters applied to the route. |
| httpRoute.hostnames | list | `[]` | Public hostnames. |
| httpRoute.labels | object | `{}` | HTTPRoute labels. |
| httpRoute.matches | list | `[{"path":{"type":"PathPrefix","value":"/"}}]` | Request matches. Serve Renplay from the origin root. |
| httpRoute.parentRefs | list | `[]` | Parent Gateways and listeners. |
| image.digest | string | `""` | Immutable sha256 digest. Takes precedence over tag. |
| image.pullPolicy | string | `"IfNotPresent"` | Image pull policy. |
| image.repository | string | `"ghcr.io/renplay-org/renplay"` | Image repository. Docker Hub alternative: docker.io/renplay/renplay. |
| image.tag | string | `""` | Image tag. Empty uses Chart.appVersion. |
| imagePullSecrets | list | `[]` | Image pull secrets. |
| ingress.annotations | object | `{}` | Ingress annotations. Allow large uploads and long requests on your controller. |
| ingress.className | string | `""` | IngressClass name. |
| ingress.enabled | bool | `false` | Create an Ingress. |
| ingress.hosts | list | `[{"host":"renplay.example.com","paths":[{"path":"/","pathType":"Prefix"}]}]` | Hosts and paths. Renplay must be served at the origin root. |
| ingress.tls | list | `[]` | TLS configuration. |
| livenessProbe | object | `{"httpGet":{"path":"/api/health","port":"http"},"periodSeconds":20,"timeoutSeconds":5}` | Liveness probe through nginx and Node. |
| nameOverride | string | `""` | Override the chart name. |
| nodeSelector | object | `{}` | Node selector. |
| persistence.data.accessModes | list | `["ReadWriteOnce"]` | Data PVC access modes. |
| persistence.data.annotations | object | `{"helm.sh/resource-policy":"keep"}` | Data PVC annotations. Claims are retained on uninstall by default. |
| persistence.data.existingClaim | string | `""` | Existing local-disk PVC. Empty creates a claim. Never use NFS for SQLite. |
| persistence.data.size | string | `"5Gi"` | Data PVC size. Back up this volume. |
| persistence.data.storageClass | string | `""` | StorageClass. Empty uses the default. A literal dash disables dynamic provisioning. |
| persistence.downloads.accessModes | list | `["ReadWriteOnce"]` | Downloads PVC access modes. |
| persistence.downloads.annotations | object | `{"helm.sh/resource-policy":"keep"}` | Downloads PVC annotations. |
| persistence.downloads.enabled | bool | `false` | Mount /downloads separately. Off keeps using /games/_archives. |
| persistence.downloads.existingClaim | string | `""` | Existing downloads PVC. Mutually exclusive with nfs.server. |
| persistence.downloads.nfs.path | string | `""` | Export path on the NFS server. |
| persistence.downloads.nfs.server | string | `""` | NFS server. Empty uses a PVC. |
| persistence.downloads.size | string | `"50Gi"` | Downloads PVC size. |
| persistence.downloads.storageClass | string | `""` | Downloads StorageClass. Empty uses the default. Dash means no StorageClass. |
| persistence.games.accessModes | list | `["ReadWriteOnce"]` | Games PVC access modes. |
| persistence.games.annotations | object | `{"helm.sh/resource-policy":"keep"}` | Games PVC annotations. |
| persistence.games.existingClaim | string | `""` | Existing games PVC. Mutually exclusive with nfs.server. |
| persistence.games.nfs.path | string | `""` | Export path on the NFS server. |
| persistence.games.nfs.server | string | `""` | NFS server. Empty uses a PVC. |
| persistence.games.size | string | `"50Gi"` | Games PVC size. Allow space for installed games, engines and scratch space. |
| persistence.games.storageClass | string | `""` | Games StorageClass. Empty uses the default. Dash means no StorageClass. |
| podAnnotations | object | `{}` | Pod annotations. |
| podLabels | object | `{}` | Additional pod labels. |
| podSecurityContext | object | `{"fsGroup":1000,"fsGroupChangePolicy":"OnRootMismatch","runAsGroup":1000,"runAsNonRoot":true,"runAsUser":1000,"seccompProfile":{"type":"RuntimeDefault"}}` | Pod security. Change runAsUser, runAsGroup and fsGroup to match your storage owner. NFS permissions must be prepared by the operator. |
| readinessProbe | object | `{"httpGet":{"path":"/api/health","port":"http"},"periodSeconds":10,"timeoutSeconds":5}` | Readiness probe. |
| replicaCount | int | `1` | Single writer. Only 0 (paused) or 1 is supported. |
| resources | object | `{"limits":{"memory":"4Gi"},"requests":{"cpu":"100m","memory":"256Mi"}}` | Resources. Image conversion can need several GiB. No CPU limit by default. |
| secret.ldapBindPassword.existingSecret | string | `""` | Existing Secret for RENPLAY_LDAP_BIND_PASSWORD_FILE. Empty disables the mount. |
| secret.ldapBindPassword.key | string | `"bind-password"` | Key in the LDAP Secret. |
| secret.oidcClientSecret.existingSecret | string | `""` | Existing Secret for RENPLAY_OIDC_CLIENT_SECRET_FILE. Empty disables the mount. |
| secret.oidcClientSecret.key | string | `"client-secret"` | Key in the OIDC Secret. |
| securityContext | object | `{"allowPrivilegeEscalation":false,"capabilities":{"drop":["ALL"]},"readOnlyRootFilesystem":true}` | Container security. No root, writable root filesystem or capabilities are needed. |
| service.annotations | object | `{}` | Service annotations. |
| service.enabled | bool | `true` | Create the Service. Required for Ingress, HTTPRoute and helm test. |
| service.port | int | `8080` | HTTP port. The container always listens on 8080. |
| service.type | string | `"ClusterIP"` | Service type. |
| serviceAccount.annotations | object | `{}` | ServiceAccount annotations. |
| serviceAccount.automount | bool | `false` | Mount a Kubernetes API token. Renplay does not need one. |
| serviceAccount.create | bool | `true` | Create a ServiceAccount. |
| serviceAccount.name | string | `""` | ServiceAccount name. Empty uses the release name. |
| startupProbe | object | `{"failureThreshold":60,"httpGet":{"path":"/api/health","port":"http"},"periodSeconds":5}` | Startup probe allows migrations to finish before liveness checks begin. |
| strategy | object | `{"type":"Recreate"}` | SQLite requires Recreate. RollingUpdate is unsupported. |
| terminationGracePeriodSeconds | int | `30` | Grace period for shutdown. |
| tests.enabled | bool | `true` | Enable the helm test connection hook. Requires service.enabled. |
| tests.image.pullPolicy | string | `"IfNotPresent"` | Test image pull policy. |
| tests.image.repository | string | `""` | Connection test image. Uses the same Renplay image by default, which includes curl. |
| tests.image.tag | string | `""` | Test image tag. Empty uses Chart.appVersion. |
| tolerations | list | `[]` | Tolerations. |

---

This README is generated with helm-docs from `Chart.yaml`, `values.yaml` and
`README.md.gotmpl`. Run `helm-docs --chart-search-root charts/renplay` after changes.
