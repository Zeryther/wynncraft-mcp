# Adversarial review and validation

Reviewed on 2026-10-28 using **Claude Opus 5.5** (`claude-opus-5-5`) through the Claude Code CLI. Two independent review passes received the implementation and tests via stdin, with tools disabled and no production credentials. The CLI reported the requested model for both passes.

The initial pass found three blockers, all corrected:

- The consent page's referrer policy could produce an unusable Origin on form POST. It now uses `same-origin`.
- CSP could block the form redirect back to an external MCP client. The consent document now allows the validated registered redirect origin.
- A warm Redis connection could fail permanently after disconnect. Connection attempts are cleared after completion, and commands have bounded timeouts.

The follow-up pass reported **no remaining blockers**, including the new Upstash REST path. Its low-severity observations were also addressed: AES-GCM explicitly requires a 16-byte authentication tag and rejects short records, Wynncraft login denial redirects to the client with its state, and the browser binding cookie is renewed when consent begins.

Verification includes:

- Strict source and test TypeScript checking and production compilation.
- HTTP transport tests and a real MCP SDK client, with no session IDs.
- OAuth discovery, client registration, state and browser binding, consent allow/deny, PKCE, audience/redirect/client binding, replay resistance, concurrent code exchange, revocation, and two-user credential isolation.
- A real Chromium browser completing consent with Secure cookies and following a cross-origin callback.
- A real Redis 7 container verifying encrypted records, key-bound ciphertext, TTLs, atomic consumption and recovery after connections are killed.
- Upstash REST command-format, encryption, timeout/redirect configuration, and failure tests with mocked HTTP responses.
- The test suite on Node 24 and the minimum supported Node 22.14.0.
- A live MCP request through the compiled server to Wynncraft's classes endpoint, which returned all five classes.
- Dependency audit with no reported vulnerabilities at the time of verification.

A real hosted Upstash connection and a real Wynncraft browser authorization remain unverified until the operator provisions the database, application credentials and HTTPS deployment. The Upstash adapter follows the [documented REST command format](https://upstash.com/docs/redis/features/restapi). The automated browser test mocks only the upstream Wynncraft authorization and token exchange; the bridge's consent page runs in a real browser.

## Repository setup follow-up

A further Opus 5.5 CLI review covered the GitHub workflows, setup script, URL fallback and ruleset. Its actionable findings were addressed by checking actual repository visibility via the API before CodeQL runs, rejecting visibility/private keys in repository-settings.json, verifying visibility after settings are applied, and rejecting opaque/insecure CORS origins. Encryption-key length was already validated when constructing storage before the server listens.

The review suggested requiring an explicit PUBLIC_URL for hosted OAuth. The requested Gigadrive system-variable fallback is retained instead, with the exact callback-registration and changing-deployment-URL implications documented. A stable custom-domain override remains available.

The copied upstream authorization URL setting was subsequently removed. The fixed /authorize route and the current web page's required code_challenge_type alias were verified against Wynncraft's publicly served authorization page and added to HTTP/browser regression assertions. This does not replace a real login with operator-provided application credentials.

## Hosted-readiness review and probe

A real MCP SDK client completed live discovery and dynamic registration against https://wynncraft-mcp.gigadrive.app/mcp. Eleven live HTTP probes verified discovery, authentication challenges, invalid-token rejection, CORS, callback state/consent CSRF rejection and unsafe-registration rejection. Live authenticated account testing was explicitly skipped at the user's request; no account token was obtained.

The full tool catalogue is now exercised through an MCP client against mocked upstream responses. Cache headers, OAuth capability metadata, issuer identification, unknown-tool protocol errors, typed structured output, and server metadata have regression coverage. Opus 5.5 reviewed these changes via CLI. Its concrete findings about returning OAuth errors to the client, CORS on throttled responses, preflight quota, and secret-expiry registration metadata were addressed. The SDK-version-dependent transport concern is covered by a real HTTP client assertion on returned tool data; the installed SDK uses the awaited web-standard transport. Forwarded-IP trust remains an explicit deployment configuration, with per-process rather than global quota semantics documented.

Gitleaks scanned the Git history before publication and reported no leaks.
