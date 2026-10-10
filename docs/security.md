# Security model

## Identity and authentication

- **Actors.** Every actor is a user: `human`, `agent` or the internal `system`. Roles are `admin` and `member` (see [api.md](api.md#authentication) for what each can do). Give every automated worker its own `agent` user, so history, events and webhooks attribute its changes.
- **API tokens** (`trk_…`, 40 random base62 characters) are shown once and stored only as SHA-256 hashes. They can expire (`expiresAt`) and be revoked (`DELETE /tokens/{id}`). `last_used_at` is updated with throttling.
- **Browser sessions** come from `POST /auth/token-login`: a random cookie, stored hashed, valid for 30 days, `HttpOnly`, `SameSite=Lax`, and `Secure` in production. `POST /auth/logout` deletes the session.
- **SSO sessions** (when `POIETIC_ISSUES_SSO_ISSUER` is set) come from `POST /auth/sso`, which verifies the issuer's JWT cookie (ES256, `iss`/`aud`/`exp`/`iat` claims) against the issuer's JWKS. The user's SSO role determines initial access: matching `POIETIC_ISSUES_SSO_ADMIN_ROLE` creates the user as an active admin; anyone else is created deactivated (answered with the `PENDING_APPROVAL` error) until an admin approves them. Signing out of the SSO provider does not end the tracker session (30 days).
- **CSRF.** Cookie-authenticated `POST`/`PATCH`/`PUT`/`DELETE` requests must come from the server's own origin or one listed in `POIETIC_ISSUES_ALLOWED_ORIGINS`. Bearer-token requests carry no ambient credentials and are exempt.
- **Dev login.** `POIETIC_ISSUES_AUTH_MODE=dev` lets anyone sign in as any user, for local development only. The server refuses it when `NODE_ENV=production`.
- **Trusted mode** is the CLI's local mode. It acts as a configured user without credentials, and only runs in-process: it can never be selected for a listening server. Anyone who can open the database file or connection can do this anyway.
- **First admin.** `poietic-issues db bootstrap` creates it, and works only while no human admin exists.

## Project access

See [ADR 0021](adr/0021-project-visibility-and-roles.md).

- **Public projects are readable by anyone**, including visitors who are not signed in. That covers issues, comments, activity, attachment downloads and the live event stream. Make a project public only if everything in it, history included, may be seen by the whole internet. Webhooks are not affected.
- **Private projects return 404** (the same response as an unknown project) to everyone except their members and global admins. Errors, search and filter-name resolution never confirm that a hidden project, issue or name exists.
- **Anonymous requests are `GET` and `HEAD` only.** Everything else needs sign-in and returns 401. `/me` answers `{ anonymous: true }`. `/users`, `/users/{user}` and the token endpoints need sign-in.
- **Emails** are visible only to admins and to the user themself, including in `user.*` events. Anonymous readers see handles and names only where they are embedded in public resources, such as authors and assignees. The issue input schema (`GET /projects/{project}/schema/issue`) lists assignable handles only to signed-in callers, and only the users who can write the project.
- **Links** into projects the viewer cannot read, and the events that create them, are hidden. Creating or removing a link needs write access to one of its issues and read access to the other.
- **Live streams keep the access they connected with.** A demoted admin or deactivated user keeps their access on an already open `GET /events/stream` until it reconnects.
- **Roles** (`viewer`, `editor`, `manager`) are per project. Global admins always have `manage`, and no guard stops the last manager from leaving.

## Attachments

Uploaded files are untrusted content served from the app's origin, so:

- **Type detection.** The media type comes from the file's bytes; the client's declared type is ignored. Markup (SVG, HTML) is stored as `text/plain`.
- **Inline display.** Only PNG, JPEG, GIF and WebP are served `inline`. Everything else downloads (`Content-Disposition: attachment`).
- **Response headers.** Every download carries `X-Content-Type-Options: nosniff` and `Content-Security-Policy: default-src 'none'; sandbox`.
- **Filenames** are sanitized. Storage keys are random, so the filename never becomes a path.
- **Size.** `POIETIC_ISSUES_MAX_UPLOAD_MB` limits uploads, and the body is rejected while streaming.
- **S3 presigned URLs** expire after 5 minutes and come from a different origin than the app.

## Webhooks

- **Admins only.** Only admins can create webhooks.
- **Signing.** Each delivery is signed with a per-webhook secret (Standard Webhooks, HMAC-SHA256). Receivers should verify the signature and reject old timestamps ([events.md](events.md#verifying-signatures)).
- **SSRF guard.** Outgoing requests are restricted:
  - `https` only;
  - every resolved address must be public, and the connection is pinned to it;
  - no redirects, a 10 s timeout, and a 64 KB response cap.

  `POIETIC_ISSUES_WEBHOOK_ALLOW_PRIVATE` lifts this for development and is refused in production.

## Data handling

- **Timestamps** are UTC and generated by the application.
- **Deletes.** Issue and comment deletes are soft (restorable) unless an admin deletes permanently. Attachment deletes remove the stored bytes.
- **Event log.** The log keeps full snapshots of changed resources, so deleted content remains in history. Plan retention accordingly.
- **Secrets at rest.** Webhook secrets are stored in plain text (they are needed to sign), so protect database backups. Token and session secrets are only stored hashed.

## Reporting

This is an internal project. Report suspected vulnerabilities privately to the maintainers rather than in a public issue.
