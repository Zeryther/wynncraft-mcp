# Wynncraft MCP

A TypeScript MCP server exposing **40 Wynncraft v3 data operations** over **stateless Streamable HTTP**. Runs locally or as a Node 22 Function on Gigadrive Network. Unofficial; not affiliated with Wynncraft.

Player profiles and characters, guilds and territories, item and ingredient searches, recipes, ability trees, aspects, classes, map data, leaderboards, search, and news are covered. The [generated catalogue](docs/api-coverage.md) maps each tool to its API route.

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

No production deployment has been made by creating this repository. Live hosted OAuth needs a registered Wynncraft application and operator-supplied secrets.

## Development

```sh
npm run check       # strict TypeScript, HTTP/OAuth regression tests, build
npm run api:update  # refresh generated tool schemas and coverage table
npm audit
npm run test:browser # install Chromium first with npx playwright install chromium
```

The generated schemas resolve request types from Wynncraft's official OpenAPI spec. The spec's token request content type differs from the endpoint's prose; the OAuth implementation follows the endpoint documentation and sends URL-encoded form data. Token exchange is never exposed as an MCP tool.

The repository contains no private hosting source or production credentials. It has no GitHub remote and is marked `private` in package.json to prevent accidental npm publishing; that does not prevent making the GitHub repository public.

The adversarial review used Claude Opus 5.5 via CLI. See [review and validation notes](docs/review.md).

## Repository maintenance

CI runs TypeScript/build checks on Node 22 and 24, real Redis tests, browser OAuth tests, and a dependency audit. Dependabot updates npm dependencies and pinned GitHub Actions weekly. CodeQL runs automatically once the repository is public. See [GitHub configuration](docs/github.md) for applied settings and the one-command public-repository setup.

## Sources

- [Wynncraft API docs](https://docs.wynncraft.com/welcome)
- [Wynncraft OpenAPI](https://docs.wynncraft.com/openapi.json)
- [Wynncraft application setup](https://docs.wynncraft.com/oauth2/creating-an-application)
- [Wynncraft OAuth authorization](https://docs.wynncraft.com/oauth2/authorizing-an-application)
- [Wynncraft OAuth token exchange](https://docs.wynncraft.com/modules/o-auth-2/exchange-oauth-token)
- [MCP Streamable HTTP](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports)
- Gigadrive Network Express, runtimes, routes, and containers documentation, inspected during implementation. The supplied `docs.gigadrive.network` hostname did not resolve in the development environment.

Review [API terms and retention responsibilities](docs/api-terms.md) before operating a public instance or enabling private-data access.

MIT licensed. See [LICENSE](LICENSE).
