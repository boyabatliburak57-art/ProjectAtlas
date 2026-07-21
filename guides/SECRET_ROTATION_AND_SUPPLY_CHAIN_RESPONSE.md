# Secret Rotation and Supply-Chain Response

## Secret rotation

1. Declare an incident without copying the secret into tickets, chat, logs or traces.
2. Revoke the affected credential at its authoritative provider before issuing a replacement.
3. Store the replacement in the deployment secret manager; never commit it or place it in a ConfigMap.
4. Roll API and worker roles gradually, verify readiness and drain old jobs/sessions.
5. Rotate dependent session/signing material by incrementing the server-side session version or revoking session families.
6. Verify redaction, authentication, queue processing and provider access with synthetic checks.
7. Search repository history, images, SBOM artifacts and telemetry for exposure; document the time window and affected principals.
8. Close only after old material is unusable and evidence is attached to the immutable operational audit/incident record.

## Malicious or vulnerable dependency

Freeze releases, identify the package through the lockfile and SBOM, isolate affected images by immutable digest, and revoke any credentials reachable by installation or runtime scripts. Replace or pin the dependency through normal review, run unit/integration/security/container scans, rebuild every affected image, and deploy only with manual approval. A Critical or High finding has no silent exception: an exception must have an owner, expiry, compensating control and explicit approval.

The machine-readable allowlist is `security/license-policy.json`. Unknown and prohibited license expressions fail `pnpm license:check`.
