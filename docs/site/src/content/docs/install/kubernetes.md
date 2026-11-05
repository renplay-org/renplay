---
title: Kubernetes
description: Run Renplay on Kubernetes with two volumes.
---

Renplay is one stateless container plus two volumes, so it needs only a Deployment (one replica),
a Service and two persistent volume claims. A Helm chart is not published yet.

## Example

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: renplay
spec:
  replicas: 1
  strategy:
    type: Recreate
  selector:
    matchLabels: { app: renplay }
  template:
    metadata:
      labels: { app: renplay }
    spec:
      securityContext:
        runAsNonRoot: true
        runAsUser: 1000
        runAsGroup: 1000
        fsGroup: 1000
      containers:
        - name: renplay
          image: ghcr.io/renplay-org/renplay:__RENPLAY_VERSION__
          ports:
            - containerPort: 8080
          readinessProbe:
            httpGet: { path: /api/health, port: 8080 }
          securityContext:
            readOnlyRootFilesystem: true
            allowPrivilegeEscalation: false
          volumeMounts:
            - { name: games, mountPath: /games }
            - { name: data, mountPath: /data }
            - { name: tmp, mountPath: /tmp }
      volumes:
        - name: games
          persistentVolumeClaim: { claimName: renplay-games }
        - name: data
          persistentVolumeClaim: { claimName: renplay-data }
        - name: tmp
          emptyDir: {}
---
apiVersion: v1
kind: Service
metadata:
  name: renplay
spec:
  selector: { app: renplay }
  ports:
    - port: 8080
      targetPort: 8080
```

Create `renplay-games` (large; it holds every installed game) and `renplay-data` (small; saves and
the library) as PersistentVolumeClaims of your storage class.

## Notes

- **One replica.** The library is a SQLite database on `/data`, and builds are written to
  `/games`. Use the `Recreate` strategy so two pods never share them.
- **Pin the image by version** (and by digest if you like). A tool such as Renovate can propose new
  releases. See [Upgrading](/upgrading/).
- **Back up `/data`**, for example with volume snapshots. `/games` can be rebuilt from
  `/games/_archives` while the archives are kept (`RENPLAY_DELETE_ARCHIVES=false`).
- **Network storage** such as NFS works for `/games`, but is slow with many small files; see
  [Troubleshooting](/troubleshooting/#network-storage-is-slow).
- **Ingress.** Put sign-in in front of it. See [Reverse proxy and HTTPS](/install/reverse-proxy/).
- **Scale to zero.** If a proxy stops the pod when it is idle, set `RENPLAY_KEEPALIVE_URL` so it
  stays up during an install. See [Configuration](/configuration/).

The image names, ports, paths and upgrade promise are covered by the
[3.x stability contract](/stability/).
