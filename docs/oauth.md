# Hosted Wynncraft OAuth

## Setup

Create a Wynncraft OAuth application in the [account dashboard](https://wynncraft.com/account/dashboard?section=applications). Register this exact callback:

```text
https://your-canonical-host/oauth/callback
```

Set these runtime variables on Gigadrive:

| Variable                        | Value                                                                           |
| ------------------------------- | ------------------------------------------------------------------------------- |
| `PUBLIC_URL`                    | Optional canonical HTTPS origin override; otherwise uses system `GIGADRIVE_URL` |
| `WYNNCRAFT_OAUTH_CLIENT_ID`     | Wynncraft application ID                                                        |
| `WYNNCRAFT_OAUTH_CLIENT_SECRET` | Required for a private Wynncraft application; omit for a public application     |
| `WYNNCRAFT_OAUTH_SCOPES`        | Space-separated upstream scopes; must include `identify`                        |
| `UPSTASH_REDIS_REST_URL`        | HTTPS REST endpoint from your Upstash database dashboard                        |
| `UPSTASH_REDIS_REST_TOKEN`      | Full-access REST token from the same database, not the read-only token          |
| `OAUTH_ENCRYPTION_KEY`          | 32 random bytes encoded as base64; keep identical across all copies/deployments |

When `PUBLIC_URL` is unset, the server uses Gigadrive's system `GIGADRIVE_URL`. This is an immutable deployment URL: register its exact `/oauth/callback` URI in Wynncraft. For a callback that survives deployments, configure a stable custom domain through `PUBLIC_URL`. Never use `GIGADRIVE_CLIENT_ID` or `GIGADRIVE_CLIENT_SECRET` as Wynncraft credentials; those identify the workload to Gigadrive.

Create an Upstash Redis database manually and copy its REST URL and full-access REST token into runtime secrets. The server uses HTTPS POST commands with short timeouts, no persistent TCP connections, and no automatic retries of single-use operations. No Upstash database is created by this repository.

Generate an encryption key privately with `openssl rand -base64 32`. Store the result as a secret, not in Git. Rotating it invalidates all stored OAuth records. The server generates the authorization URL at `https://wynncraft.com/authorize` from the application ID, resolved callback, configured scopes, random state and PKCE. No copied authorization URL is needed. The current Wynncraft web authorization page requires the `code_challenge_type=S256` alias; the server sends it alongside the documented `code_challenge_method=S256`. The endpoint and alias were verified against Wynncraft's publicly served authorization page on 2026-10-28.

Default upstream scopes: `identify main_access character_list_access character_data_access character_build_access online_status`. Choose only the scopes your application needs and enable them in the Wynncraft editor. Optional documented scopes include `hunted_characters_access`, `guild_history_access`, and `guild_high_ranked_access`.

Do not configure a shared `WYNNCRAFT_API_TOKEN` or `MCP_API_KEY` together with hosted OAuth. Client tokens are per user. Use an HTTPS tunnel for local OAuth testing; the browser binding cookie is always Secure and HttpOnly.

## Discovery and client support

- `/.well-known/oauth-authorization-server`
- `/.well-known/oauth-protected-resource/mcp`
- `/register`, `/authorize`, `/token`, `/revoke`
- `/oauth/callback`, `/oauth/consent`

Clients must support OAuth discovery, dynamic registration with `token_endpoint_auth_method=none`, authorization-code PKCE with S256, and the MCP resource indicator. The resource must be the exact canonical URL `PUBLIC_URL/mcp`, in both authorization and token exchange. HTTPS callbacks and HTTP loopback callbacks are supported. Native applications using custom URI schemes should use a loopback callback instead.

## Flow and security boundaries

1. The MCP client registers its callback URI and starts authorization with an S256 challenge and resource URL.
2. This server stores a short-lived, browser-bound transaction and redirects to Wynncraft with a separate state and PKCE verifier.
3. The callback validates state and the Secure HttpOnly SameSite cookie, consumes the transaction atomically, and exchanges the code directly with Wynncraft.
4. The user approves the specific MCP client ID, return address and granted scopes on this server. This explicit consent is required even if Wynncraft previously approved the shared upstream application.
5. A new one-time MCP code is issued. The token endpoint validates PKCE, client, redirect URI and resource before atomically consuming that code.
6. The client receives an opaque MCP token. The server resolves it to encrypted Wynncraft credentials for each request. A client never receives the Wynncraft token.

AES-256-GCM encrypts every Redis value, authenticating the storage key as associated data. Random codes and tokens are stored by SHA-256 digest. Redis `GETDEL` provides atomic consumption across instances. No private credentials are shared between users or cached in process memory across requests.

## Persistence and expiration

| Record                      | Retention             |
| --------------------------- | --------------------- |
| Browser login transaction   | 5 minutes             |
| Pending consent             | 5 minutes             |
| MCP authorization code      | 2 minutes, single use |
| MCP access token            | 24 hours, revocable   |
| Dynamic client registration | 30 days               |

Use the same Upstash database across all copies of this deployment. Losing data is safe for confidentiality, but invalidates logins, registrations and active MCP tokens. A Redis sidecar on Gigadrive is ephemeral and per Function copy: it cannot reliably complete a flow spanning multiple copies. An optional `REDIS_URL` backend supports a shared Redis 6.2+ service instead of Upstash REST (never configure both). You can also implement the small `Store` interface against a database with TTLs and atomic consume semantics.

MCP access tokens do not refresh: clients reauthorize after 24 hours. Wynncraft itself only documents the authorization-code grant; upstream tokens can be invalidated by revocation, client-secret rotation, or more than 15 days of inactivity. API authentication errors are returned to the client; reconnect when Wynncraft authorization is revoked. Revoking an MCP token deletes its local bridge credential, not the user's authorization in Wynncraft; users can revoke that from their Wynncraft account.

The SDK applies per-process rate limits on authorization, registration and token endpoints. These are not distributed quotas. If the deployment is behind a trusted forwarding proxy, configure `TRUST_PROXY_HOPS` to its exact hop count so the SDK can distinguish client IP addresses; leave it unset for direct connections. Do not enable this without verifying that the edge sanitizes forwarded headers. Set traffic limits at your hosting edge for the expected scale. Changing PUBLIC_URL or the encryption key requires reconnecting clients.

## Cache policy and issuer identification

Public discovery JSON is cached for 60 seconds in browsers and 300 seconds at shared caches, with a 60-second stale-while-revalidate window. The documents are independent of credentials and user state. No authentication, MCP payload, consent, token or error response is publicly cacheable. The bridge never stores game-data responses in Redis.

Authorization metadata declares RFC 9207 issuer identification. Success and error redirects carry `iss` with exactly the same value as metadata `issuer`. Metadata advertises only the authorization-code grant and public-client token/revocation authentication; refresh tokens and confidential downstream clients are not advertised.

## Verification limits

A real Chromium browser test verifies consent submission, Secure cookies, Origin checks and the cross-origin client redirect. Real Redis integration tests verify encryption, associated-data binding, atomic consumption and reconnection. Upstash REST protocol tests verify encrypted commands and failures without requiring hosted credentials.

Automated tests exercise discovery, registration, browser binding, consent, PKCE, audience/redirect/client binding, one-time codes, revocation and two-user isolation with mocked Wynncraft responses. A real Wynncraft browser login and deployment cannot be verified until application credentials, an HTTPS deployment, and shared storage are configured.
