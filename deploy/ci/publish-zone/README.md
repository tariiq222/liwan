# Publish zone workflow

`publish.yml` here is the source of truth of the workflow that builds and publishes the production images. It is not run from this repository. The host operator installs it as `.forgejo/workflows/publish.yml` of the admin-only repository `liwanos/liwan-publish`, whose only runner is the `publish-amd64` runner, so the registry write token exists as a secret of that repository alone.

Install or update (admin token, from a checkout of `liwanos/liwan` at the commit to install):

1. Copy `deploy/ci/publish-zone/publish.yml` to `.forgejo/workflows/publish.yml` in `liwanos/liwan-publish` and push it to its `main`.
2. Secrets of `liwan-publish`: `LIWAN_REGISTRY_USER`, `LIWAN_REGISTRY_TOKEN` (write:package), `LIWAN_SOURCE_READ_TOKEN` (read on `liwanos/liwan`), `LIWAN_STAGING_HOOK_URL`, `LIWAN_STAGING_HOOK_TOKEN`. `liwanos/liwan` holds only `LIWAN_PUBLISH_TRIGGER_TOKEN`, a bot with Actions write and code read on `liwan-publish`.
3. `.forgejo/workflows/publish.yml` in this repository is the trigger: on every push to `main` it dispatches the workflow above with no input.

Change this file through a normal pull request, then repeat step 1; the copy in `liwan-publish` is what runs.
