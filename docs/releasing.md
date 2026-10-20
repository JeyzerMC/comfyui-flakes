# Releasing

Releases are published to the Comfy registry (https://registry.comfy.org/nodes/comfyui-flakes)
by the "Publish to Comfy registry" GitHub Action (`.github/workflows/publish.yml`).
It runs `Comfy-Org/publish-node-action` on a push to `main` that changes
`pyproject.toml`, or on `workflow_dispatch`, using the `REGISTRY_ACCESS_TOKEN` secret.

## Steps

1. Pick the version (semver; pre-1.0: minor for features, patch for fixes).
2. Bump `version` in `pyproject.toml`.
3. In `CHANGELOG.md`, add an empty `## [Unreleased]` above and rename the old one to
   `## [X.Y.Z] - YYYY-MM-DD`. Update the compare links at the bottom.
4. Commit: `chore: release vX.Y.Z`.
5. Push `main`. This triggers the publish Action.
6. Tag and push the tag:
   ```
   git tag -a vX.Y.Z -m "vX.Y.Z"
   git push origin vX.Y.Z
   ```
7. Create the GitHub release, from the web UI or with the changelog section saved to a file:
   ```
   gh release create vX.Y.Z --notes-file <changelog-section.md>
   ```
8. Check the Action run in the repo's Actions tab and that the new version shows on the registry page.

## Manual publish

- Run the "Publish to Comfy registry" workflow from the Actions tab (`workflow_dispatch`), or
- Locally with comfy-cli and the registry token: `comfy node publish`.

## Troubleshooting

- A version can only be published once. If the run fails because the version exists, bump `version`.
- The Action only runs when `pyproject.toml` changes. Changing only other files (e.g. the icon) does
  not publish; bump the version or run the workflow manually.
- If authentication fails, check that the `REGISTRY_ACCESS_TOKEN` secret is valid. Create a new
  token on registry.comfy.org under the publisher `jeyzermc` and update the repo secret.
