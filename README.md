# Wynncraft MCP

A TypeScript MCP server exposing **40 Wynncraft v3 data operations** over **stateless Streamable HTTP**. Runs locally or as a Node 22 Function on [Gigadrive Network](https://docs.gigadrive.de). Unofficial; not affiliated with Wynncraft.

Player profiles and characters, guilds and territories, item and ingredient searches, recipes, ability trees, aspects, classes, map data, leaderboards, search, and news are covered. The [generated catalogue](docs/api-coverage.md) maps each tool to its API route.

## Connect to the hosted server

**MCP endpoint: `https://wynncraft-mcp.gigadrive.app/mcp`**

Transport: **Streamable HTTP** · Authentication: **Wynncraft OAuth**

No clone, Node.js installation, API key, Upstash account or Wynncraft application setup is needed to use this hosted instance. Your MCP client opens a browser to sign in with Wynncraft, then asks you to approve the connection.

### Codex

```sh
codex mcp add wynncraft --url https://wynncraft-mcp.gigadrive.app/mcp
codex mcp login wynncraft
codex mcp list
```

Alternatively, add this to your Codex `config.toml`, then run `codex mcp login wynncraft`:

```toml
[mcp_servers.wynncraft]
url = "https://wynncraft-mcp.gigadrive.app/mcp"
```

See the [official Codex MCP guide](https://developers.openai.com/codex/mcp).

### Claude Code

```sh
claude mcp add --transport http --scope user wynncraft https://wynncraft-mcp.gigadrive.app/mcp
claude mcp login wynncraft
```

You can also run `/mcp` inside Claude Code and choose the server's authentication option. See the [official Claude Code MCP guide](https://code.claude.com/docs/en/mcp).

### Other MCP clients

Add a remote Streamable HTTP server using the endpoint above and complete OAuth when prompted. The client must support OAuth discovery, public dynamic client registration, PKCE S256 and resource indicators. Do not paste your Wynncraft application secret or account token into the client.

Try asking: “Look up my linked Wynncraft profiles”, “Show the combat leaderboard”, or “Find legendary mage weapons around level 80”. Use a new chat or reconnect if your client has not refreshed its tools list. Access tokens last 24 hours; sign in again when the client requests it.

The hosted instance is a community service with no uptime guarantee. Data returned to your MCP client can enter its chat history and AI processing; review your client's privacy/retention settings before authorizing private character data. Hosting your own instance is covered below.

## Run locally

Requires Node.js 22.14 or newer.

```sh
npm ci
cp .env.example .env.local
npm run dev
```

Connect an MCP client to `http://localhost:3000/mcp` using Streamable HTTP. No database or account is needed in anonymous mode. `GET /healthz` checks process health.

For a compiled build:

```sh
npm run build
npm start
```

Example Claude Code configuration for anonymous mode:

```sh
claude mcp add --transport http wynncraft http://localhost:3000/mcp
```

## Authentication modes

| Mode                    | Configuration                                                                                        | Storage                 |
| ----------------------- | ---------------------------------------------------------------------------------------------------- | ----------------------- |
| Anonymous               | Default                                                                                              | None                    |
| Public guest token      | `WYNNCRAFT_API_TOKEN` and `WYNNCRAFT_TOKEN_PUBLIC_MODE=true` after enabling Public Mode in Wynncraft | None                    |
| Personal/private server | `WYNNCRAFT_API_TOKEN` and a random `MCP_API_KEY` of at least 32 characters                           | None                    |
| Hosted per-user OAuth   | Wynncraft application, HTTPS public URL, encryption key, Upstash Redis over HTTPS                    | Encrypted OAuth records |

A public-mode flag is an operator assertion: this server cannot verify that the Wynncraft token's Public Mode is enabled. Keep private tokens behind authentication. In API-key mode clients send `Authorization: Bearer <MCP_API_KEY>`; the key is not the Wynncraft token.

**Hosted OAuth lets anyone connect their own Wynncraft account.** The client discovers OAuth metadata, registers using PKCE, signs in with Wynncraft, and approves the named MCP client on this server's consent screen. MCP clients receive a separate opaque access token; Wynncraft access tokens stay encrypted in the shared store. See [OAuth setup and design](docs/oauth.md).

## Caching and client safety

OAuth discovery documents use `Cache-Control: public, max-age=60, s-maxage=300, stale-while-revalidate=60`, so browsers and the Gigadrive CDN can reuse user-independent metadata. Root and path-specific protected-resource discovery are both available. MCP traffic, authentication failures, cookies, consent, registration, token exchange, revocation and errors use `no-store`; unauthorized responses are never shared by the CDN.

The server publishes a friendly title, description, icon and source URL, validated tool input/output schemas, explicit read-only annotations and correct OAuth capabilities. Unknown tools return a protocol error; input and upstream failures return tool errors. It uses issuer identification on authorization responses, audience-bound tokens, PKCE, browser-bound state, explicit client consent and bounded upstream requests/responses.

MCP HTTP traffic has a per-process limit of 180 requests per minute per IP, in addition to Wynncraft's own buckets and OAuth endpoint limits. Configure `TRUST_PROXY_HOPS` only for the verified proxy chain so forwarded client addresses cannot be spoofed. For deployments requiring global quotas, enforce them at the hosting edge; per-process limits are not distributed quotas.

## Stateless behavior

Each MCP POST creates a new server and transport. Responses are JSON, no session IDs are issued, and no sticky sessions or in-process game caches are used. GET subscriptions and DELETE sessions return 405. This is Streamable HTTP using its JSON response mode, not the legacy SSE transport.

Anonymous and shared-token modes have no application storage. Hosted OAuth needs shared records to enforce one-time codes, consent and token revocation; every application instance remains disposable. A Gigadrive Redis sidecar is local to each Function copy and loses data with that copy, so it cannot provide the shared OAuth store for autoscaling.

## Working with tools

Use `wynncraft_player_getPlayer` with `{ "username": "Salted", "fullResult": true }` or `wynncraft_item_searchItems` with `{ "body": { "query": "Wand", "tier": "legendary" }, "page": 1 }`. Filter enums are validated from Wynncraft's spec; use `wynncraft_item_getItemMetadata` to discover supported filters.

The booleans `fullResult`, `full_result` and `static` produce Wynncraft's required bare query flags, not `=true`. Paths accept names with spaces and Unicode while rejecting traversal and path separators.

Tools return `{status, ok, metadata, data}` with read-only hints, structured content, and safe cache/rate-limit headers. API errors include the original JSON and status with `isError: true`, including ambiguous matches (300), privacy failures (403), and throttling (429). Requests time out after 20 seconds and do not retry automatically. Respect `retry-after` or `ratelimit-reset` in tool results. Wynncraft currently documents separate 50 RPM guest / 120 RPM authenticated buckets; limits may change.

Large results are bounded to 8 MiB upstream and 128 KiB per tool response. Use the API's `page` parameter first. The optional `view` argument selects and slices a response locally:

```json
{ "view": { "pointer": "/someSubtree", "offset": 0, "limit": 20 } }
```

`pointer` follows RFC 6901 (`~1` for `/`, `~0` for `~`). Slicing objects preserves their keys; `projection.nextOffset` indicates more entries. Projection doesn't reduce the upstream download, change upstream pagination, or silently truncate results. Remote game/player text and HTML are untrusted content.

## Deploy to Gigadrive Network

`gigadrive.yaml` selects `dist/index.js`, Node 22, 512 MB, a 30-second invocation limit, and a catch-all route. Gigadrive detects Express, runs `npm run build`, imports the compiled entrypoint, and captures `app.listen()`.

1. Run `npm ci && npm run check`.
2. `PUBLIC_URL` is optional: it overrides Gigadrive's system `GIGADRIVE_URL`, which otherwise supplies the HTTPS origin. Outside Gigadrive the fallback is `http://localhost:PORT`. Set `PUBLIC_URL` explicitly for a stable custom domain, for example `https://wynncraft.example.com`. The server checks the incoming Host header against the resolved origin; use the same canonical hostname for OAuth. `GIGADRIVE_URL` is unique to each deployment, so its callback must be registered in Wynncraft again when that URL changes. A stable `PUBLIC_URL` avoids this.
3. Set runtime secrets through the Gigadrive console, CLI, or API. Do not put secrets in `gigadrive.yaml` or commit `.env.local`.
4. Set `ALLOWED_ORIGINS` to a comma-separated list of browser client origins if needed; otherwise only `PUBLIC_URL` is allowed. Native clients without Origin are accepted. OAuth token/registration endpoints use the SDK's OAuth CORS handling.
5. Run `gigadrive login`, then `gigadrive deploy` from this repository.
6. For hosted OAuth, follow [OAuth setup](docs/oauth.md), including Upstash REST credentials.
7. Connect clients to `https://your-host/mcp`; verify `/healthz` and OAuth discovery if enabled.

A production instance is already deployed on Gigadrive Network at [the hosted MCP endpoint](https://wynncraft-mcp.gigadrive.app/mcp). The steps above are for hosting your own instance, which needs its own Wynncraft application and runtime secrets. See the [Gigadrive Network documentation](https://docs.gigadrive.de) for platform setup and configuration.

## Development

```sh
npm run check       # strict TypeScript, HTTP/OAuth regression tests, build
npm run api:update  # refresh generated tool schemas and coverage table
npm run probe       # check the hosted endpoint without user credentials
npm audit
npm run test:browser # install Chromium first with npx playwright install chromium
```

The generated schemas resolve request types from Wynncraft's official OpenAPI spec. The spec's token request content type differs from the endpoint's prose; the OAuth implementation follows the endpoint documentation and sends URL-encoded form data. Token exchange is never exposed as an MCP tool.

The repository contains no private hosting source or production credentials. The source repository is public and MIT licensed. `package.json` remains marked `private` to prevent accidental npm publishing.

The adversarial review used Claude Opus 5.5 via CLI. See [review and validation notes](docs/review.md).

## Repository maintenance

CI runs TypeScript/build checks on Node 22 and 24, real Redis tests, browser OAuth tests, and a dependency audit. Dependabot updates npm dependencies and pinned GitHub Actions weekly. CodeQL scans main, pull requests and the weekly schedule. Main is protected by an active ruleset requiring PRs, CI and CodeQL results. See [GitHub configuration](docs/github.md) for applied settings and the one-command public-repository setup.

## Sources

- [Wynncraft API docs](https://docs.wynncraft.com/welcome)
- [Wynncraft OpenAPI](https://docs.wynncraft.com/openapi.json)
- [Wynncraft application setup](https://docs.wynncraft.com/oauth2/creating-an-application)
- [Wynncraft OAuth authorization](https://docs.wynncraft.com/oauth2/authorizing-an-application)
- [Wynncraft OAuth token exchange](https://docs.wynncraft.com/modules/o-auth-2/exchange-oauth-token)
- [MCP Streamable HTTP](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports)
- [Gigadrive Network documentation](https://docs.gigadrive.de)

Review [API terms and retention responsibilities](docs/api-terms.md) before operating a public instance or enabling private-data access.

MIT licensed. See [LICENSE](LICENSE).
