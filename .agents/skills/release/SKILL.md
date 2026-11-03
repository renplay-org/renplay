---
name: release
description: Cut a Renplay release. Picks the version, moves the changelog's Unreleased section into a dated release, bumps the package versions, opens the release-X.Y.Z pull request into main, and after the maintainer merges it, checks the tag, GitHub release and image, and prepares the deployment change. Use when asked to release, ship or tag a version.
---

# Release Renplay

A release is a squash merge of a `release-X.Y.Z` branch into `main`. CI refuses release PRs whose
versions or changelog do not match; `release.yml` does the tagging and publishing.

## 1. Check that dev is ready

- `dev` is green in CI and its latest `edge` image has been tried on a running instance (ideally
  the reference deployment, pinned to the `edge@sha256:…` digest).
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
# server/package.json and selector/package.json: "version": "X.Y.Z"
# CHANGELOG.md: rename "## [Unreleased]" to "## [X.Y.Z] - YYYY-MM-DD" (today),
#   add a fresh empty "## [Unreleased]" above it,
#   and update the compare links at the bottom:
#   [Unreleased]: …/compare/vX.Y.Z...dev
#   [X.Y.Z]: …/compare/vPREVIOUS...vX.Y.Z
(cd server && npm install --package-lock-only) && (cd selector && npm install --package-lock-only)
git commit -am "chore: release X.Y.Z"
```

Push the branch and open a pull request into `main` titled `Release X.Y.Z`, with the changelog
section as the body. Release branches require signed commits; if `main` has commits that `dev`
lacks, merge them in on GitHub (`gh api repos/renplay-web/renplay/merges -f base=release-X.Y.Z -f head=main`).

## 4. Merge (maintainer)

The maintainer squash-merges with the subject `Release X.Y.Z (#N)`. Agents do not merge releases.

## 5. Check what was published

```sh
gh run list --repo renplay-web/renplay --branch main --limit 1          # Release workflow passed
gh release view vX.Y.Z --repo renplay-web/renplay                        # notes = changelog section
docker buildx imagetools inspect ghcr.io/renplay-web/renplay:X.Y.Z       # image exists; note the digest
```

Then bring `main` back into `dev` so the next release starts from a common base:
`gh api repos/renplay-web/renplay/merges -f base=dev -f head=main -f commit_message="Merge main (X.Y.Z) into dev"`.

## 6. Deployment

Prepare the change that pins `ghcr.io/renplay-web/renplay:X.Y.Z@sha256:<digest>` in the deployment
(for the reference deployment: the HelmRelease in the home-ops repository; Renovate usually opens
this PR by itself). Applying it is the maintainer's decision. After it rolls out, check
`/api/system` reports version `X.Y.Z` and a game starts.
