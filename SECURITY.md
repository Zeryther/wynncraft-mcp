# Security policy

Security fixes target the latest commit on `main`. Older snapshots are not maintained separately.

Report vulnerabilities through [GitHub private vulnerability reporting](https://github.com/Zeryther/wynncraft-mcp/security/advisories/new) once the repository is public and private reporting is enabled. If the form is unavailable, contact the maintainer through a private channel; do not open a public issue containing exploit details or secrets.

Include the affected commit, reproduction steps with fake credentials, impact, and a suggested fix if available. Never include live Wynncraft tokens, OAuth client secrets, cookies, Upstash tokens, encryption keys, or private player data. Revoke exposed credentials in their issuing service.

Authentication, consent, token isolation, one-time-code handling, and the storage encryption boundary are security-sensitive. The MCP transport is stateless; OAuth relies on shared encrypted storage. A hosted deployment must keep credentials in runtime secrets and use HTTPS.
