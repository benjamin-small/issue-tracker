# Release guidance

The repository currently builds a web app, server and CLI bundles, a browser
demo, and a Docker image. See [development.md](development.md) and
[deployment.md](deployment.md) for their build and deployment commands.

For a proposed release, record the source commit, user-visible changes,
compatibility changes to the API or CLI, configuration changes, database
migration steps, and rollback considerations in its release notes. Validate
the relevant artifacts using the checks documented in the development guide
and `.github/workflows/ci.yml`.

No release cadence, semantic-versioning commitment, or supported-version
window is established by this document. The maintainer must decide those
before publishing versioned releases.
