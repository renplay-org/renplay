# Running Renplay

Files to copy and run, one for each way of running Renplay. The docs explain each of them, and they
show these same files.

| File | What it runs | Docs |
|---|---|---|
| [`compose.yaml`](compose.yaml) | Renplay with Docker Compose, on port 8080 | [Docker and Docker Compose](https://docs.renplay.org/install/docker/) |
| [`caddy/`](caddy) | Renplay behind Caddy, with HTTPS for your own domain | [Reverse proxy and HTTPS](https://docs.renplay.org/install/reverse-proxy/) |
| [`nginx/renplay.conf`](nginx/renplay.conf) | An nginx site in front of Renplay | [Reverse proxy and HTTPS](https://docs.renplay.org/install/reverse-proxy/) |
| [`kubernetes/values.yaml`](kubernetes/values.yaml) | The Renplay Helm chart, with NFS for games and an ingress | [Kubernetes](https://docs.renplay.org/install/kubernetes/) |
| [`kubernetes/app-template.yaml`](kubernetes/app-template.yaml) | bjw-s app-template, for clusters that already use it | [Kubernetes](https://docs.renplay.org/install/kubernetes/#already-using-app-template) |

Each file pins the newest release. Keep the version you run pinned, and change it when you want to
upgrade ([Upgrading](https://docs.renplay.org/upgrading/)).

Renplay runs as user and group 1000, so its folders must be writable by them. **Back up `data`**:
it holds the saves.

NAS systems (Synology, QNAP, Unraid, TrueNAS, UGREEN) have their own pages in the
[docs](https://docs.renplay.org/install/docker/).
