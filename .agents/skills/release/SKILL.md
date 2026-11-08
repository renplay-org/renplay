---
name: release
description: Cut a Renplay release. Picks the version, moves the changelog's Unreleased section into a dated release, bumps the package versions, opens the release-X.Y.Z pull request into main, and after the maintainer merges it, checks the tag, GitHub release and image, and prepares the deployment change. Use when asked to release, ship or tag a version.
---

# Release Renplay

A release is a squash merge of a `release-X.Y.Z` branch into `main`. CI refuses release PRs whose
versions or changelog do not match; `release.yml` does the tagging and publishing.

## 1. Check that dev is ready

- The last pull requests into `dev` were green in CI, and what changed has been tried on a running
  instance (for the reference deployment: run the **Edge image** workflow on `dev` and pin the
  `edge@sha256:…` digest it prints).
- `CHANGELOG.md` has entries under `## [Unreleased]` for every user-visible change since the last
  release (`git log vLAST..origin/dev --oneline`). Write missing ones for users, not developers.

## 2. Pick the version

SemVer from the last tag (`git tag --sort=-v:refname | head -1`):

- patch (`X.Y.Z+1`): only fixes
- minor (`X.Y+1.0`): new features or behavior changes
- major (`X+1.0.0`): upgrading needs the operator to do something; the changelog must say what

## 3. Prepare the branch

```sh
git fetch origin
git checkout -b release-X.Y.Z origin/dev
# main only holds squashed releases, whose content dev already has. Record it as merged without
# taking anything from it, or the release PR conflicts:
git merge -s ours origin/main -m "Merge main (PREVIOUS) into release-X.Y.Z"
# The versions (server, selector, lockfiles, Chart.yaml, deploy/), the dated changelog section
# and its compare links. It refuses when something is not where it expects it.
mise run release X.Y.Z
git diff                       # read the X.Y.Z section of CHANGELOG.md: it is the release notes
git commit -am "chore: release X.Y.Z"
```

CI's release-check runs `node scripts/release.mjs check X.Y.Z`, so a release PR with a version
left behind fails.

Push the branch and open a pull request into `main` titled `Release X.Y.Z`, with the changelog
section as the body (`awk` it out of CHANGELOG.md as `release.yml` does). Release branches require
signed commits.

## 4. Merge (maintainer)

The maintainer squash-merges with the subject `Release X.Y.Z (#N)`. Agents do not merge releases.

## 5. Check what was published

```sh
gh run list --repo renplay-org/renplay --branch main --workflow release.yml --limit 1  # passed: image, chart, release, docs, demo
gh release view vX.Y.Z --repo renplay-org/renplay                        # notes = changelog section
docker buildx imagetools inspect ghcr.io/renplay-org/renplay:X.Y.Z       # image exists; note the digest
helm show chart oci://ghcr.io/renplay-org/charts/renplay --version X.Y.Z # chart version matches
cosign verify ghcr.io/renplay-org/charts/renplay:X.Y.Z \
  --certificate-identity https://github.com/renplay-org/renplay/.github/workflows/release.yml@refs/heads/main \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
```

Then fast-forward `dev` to the release branch, so `dev` has the version bump and the dated
changelog: `git push origin release-X.Y.Z:dev` (a fast-forward; `dev` only accepts it from an
admin). Never leave release-only changes outside `dev`: the next release's `-s ours` merge would
drop them.

## 6. Deployment

Prepare the change that pins `ghcr.io/renplay-org/renplay:X.Y.Z@sha256:<digest>` in the deployment
(for the reference deployment: the HelmRelease in the home-ops repository; Renovate usually opens
this PR by itself). Applying it is the maintainer's decision. After it rolls out, check
`/api/system` reports version `X.Y.Z` and a game starts.
