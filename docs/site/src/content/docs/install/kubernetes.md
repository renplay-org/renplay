---
title: Kubernetes
description: Install Renplay with the official Helm chart and persistent storage.
---

## Install with Helm

The official chart is published with each app release at
`oci://ghcr.io/renplay-org/charts/renplay`. It requires Kubernetes 1.25 or newer and a
default StorageClass, unless you provide existing claims or NFS for games.

```sh
helm install renplay oci://ghcr.io/renplay-org/charts/renplay \
  --version __RENPLAY_VERSION__ --namespace renplay --create-namespace
kubectl --namespace renplay port-forward service/renplay 8080:8080
```

Open `http://localhost:8080` and create the owner account. Run `helm test renplay -n renplay`
to check the Service and health endpoint.

The chart uses one replica, `Recreate` updates, non-root user and group 1000, a read-only root
filesystem and no Linux capabilities. `/tmp` is a writable emptyDir. It never changes volume
ownership as root. For another user, set `podSecurityContext.runAsUser`, `runAsGroup` and
`fsGroup` to match the storage permissions.

A complete example with NFS for games and an ingress with HTTPS is
[deploy/kubernetes/values.yaml](https://github.com/renplay-org/renplay/blob/main/deploy/kubernetes/values.yaml).
See the [chart values reference](https://github.com/renplay-org/renplay/tree/dev/charts/renplay).
The chart version and app version match. The tag defaults to the app version, and a digest takes
precedence. Release packages pin the app image digest. Use
`image.repository=docker.io/renplay/renplay` for the Docker Hub mirror.

## Storage

| Mount | Default | Purpose and cost of deleting it |
|---|---|---|
| `/data` | 5 GiB PVC | Saves, accounts and library. Use local disk, not NFS, and back it up. Deleting this loses saves. |
| `/games` | 50 GiB PVC | Installed games, engines and scratch space on the same filesystem. Deleting it also loses downloads inside `_archives` unless you mounted downloads separately. |
| `/downloads` | Not mounted | Optional downloads and drop folder. Keeping downloads lets you rebuild games. Deleting a download means reinstalling needs that download again. |

Allow about twice a game's download size free during an install. Downloads are kept by default.
**Keep downloads** in Settings controls cleanup of uploads after successful installs.
`RENPLAY_KEEP_DOWNLOADS` sets and locks the choice. Files copied in are never deleted automatically.
Renplay uses a writable `/downloads` when present, otherwise `/games/_archives`. Existing files
are never moved. Settings shows the folder in use.

For existing storage and NFS games:

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
    nfs:
      server: nas.example.com
      path: /exports/renplay/downloads
podSecurityContext:
  supplementalGroups: [3000]
```

Prepare NFS export permissions yourself. Do not use NFS for `/data`. Each storage entry accepts
`existingClaim`, `storageClass`, `accessModes`, `size` and `annotations`. Games and downloads also
accept `nfs.server` and `nfs.path`. Choose a claim or NFS, not both. The default StorageClass is used
when `storageClass` is empty. A literal `-` creates a claim without a StorageClass.

PVCs created by the chart are **retained on uninstall**. Reuse them via `existingClaim` when
reinstalling the chart. Delete retained claims manually only when you intend to discard their data.

## Expose the app

Use either Ingress or Gateway API HTTPRoute. Renplay must be served from the root of its origin.
Configure your controller for large uploads and long requests. Use HTTPS outside a trusted local
network and keep Renplay's sign-in enabled.

```yaml
ingress:
  enabled: true
  className: nginx
  hosts:
    - host: renplay.example.com
      paths:
        - path: /
          pathType: Prefix
  tls:
    - secretName: renplay-tls
      hosts: [renplay.example.com]
config:
  extraEnv:
    - name: RENPLAY_PUBLIC_URL
      value: https://renplay.example.com
```

For a Gateway, disable Ingress and use:

```yaml
httpRoute:
  enabled: true
  parentRefs:
    - name: gateway
      namespace: network
      sectionName: https
  hostnames: [renplay.example.com]
```

Gateway API CRDs and a compatible controller must already be installed.

## Sign-in secrets and configuration

Use `config.extraEnv` for environment entries and `config.envFrom` for ConfigMap or Secret sources.
Existing sign-in secrets can be mounted through the `_FILE` variables:

```yaml
secret:
  oidcClientSecret:
    existingSecret: renplay-oidc
    key: client-secret
  ldapBindPassword:
    existingSecret: renplay-ldap
    key: bind-password
```

Set the issuer, client ID and LDAP settings through `config.extraEnv` as needed. Do not also set
the corresponding plain secret variables. See [Accounts and sign-in](/accounts/) and
[Configuration](/configuration/).

## Already using app-template

You can keep using bjw-s app-template. These values run Renplay with app-template 5
([deploy/kubernetes/app-template.yaml](https://github.com/renplay-org/renplay/blob/main/deploy/kubernetes/app-template.yaml)):

```yaml file=deploy/kubernetes/app-template.yaml
```

Add a downloads mount only when you want it separate. Existing `/games/_archives` mounts and
`ARCHIVES_DIR` overrides keep working. No migration is required.

## Upgrades and verification

Back up `/data` before upgrading. Upgrade with the same values and the new chart version:

```sh
helm upgrade renplay oci://ghcr.io/renplay-org/charts/renplay \
  --namespace renplay --version __RENPLAY_VERSION__ -f values.yaml
```

Charts are signed with Cosign using GitHub OIDC. Verify a release before installing it:

```sh
cosign verify ghcr.io/renplay-org/charts/renplay:__RENPLAY_VERSION__ \
  --certificate-identity https://github.com/renplay-org/renplay/.github/workflows/release.yml@refs/heads/main \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
```

The image names, ports, paths and upgrade promise are covered by the
[3.x stability contract](/stability/). See [Upgrading and backups](/upgrading/) for recovery guidance.
