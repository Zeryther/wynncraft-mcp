# Market data sources and API access

Research date: 2026-10-28. This is an integration assessment, not a legal opinion or a guarantee of third-party service availability.

## Selection

Wynnventory is the default optional market provider. Its current [v2 reference](https://github.com/Wynnventory/WynnVentory_Web/blob/main/docs/API_V2.md) documents read-only endpoints, pagination, errors and API-key scopes, with an [OpenAPI specification](https://github.com/Wynnventory/WynnVentory_Web/blob/main/docs/openapi_v2.yaml). Its [self-service key page](https://www.wynnventory.com/developer/api-key) explicitly asks for the consuming application and intended use and grants read-only access to market data and reward pools.

| Candidate      | Relevant data and access                                                                                                                                                                                   | Assessment for this MCP                                                                                                                                                                                                                                                                    |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Wynnventory    | Observed listings, price statistics, daily history/rankings, reward pools; documented v2 and application API keys                                                                                          | Most direct documented source found for listing observations and historical aggregates. Coverage depends on mod users.                                                                                                                                                                     |
| Nori           | [Price API](https://github.com/RawFish69/Nori/blob/main/src/web/docs/api.md#get-apiitemprice) includes presets and Marketplace-community contributed sales, with an explicit warning about stale estimates | Potential complementary evidence, but not a drop-in replacement for listing coverage. Its [website license](https://nori.fish/license/) restricts republication; API-specific reuse permission needs clarification. The repository's code license does not itself license hosted API data. |
| Wynnpool       | Its [credits](https://www.wynnpool.com/project/credit) identify Wynnventory as a price-data source                                                                                                         | Adds another hop for this use. Its [terms](https://www.wynnpool.com/legal/terms) also restrict scaled API mirroring and commercial redistribution without permission.                                                                                                                      |
| wynn.tools     | Its [credits](https://wynn.tools/credits) identify Wynnventory as powering prices, history and build-cost estimates                                                                                        | Another consumer of the same upstream, not independently better price coverage established by these sources.                                                                                                                                                                               |
| Salt Road      | [Independent mod/API project forked from Wynnventory](https://github.com/ShyHungAlpha/Salt-Road), with its own crowdsourced database                                                                       | Its README warns about incomplete pricing. The repository's latest push was October 2024 when checked; a comparable maintained integration contract and service-data usage grant were not established.                                                                                     |
| wynnmarket.com | A market-oriented site                                                                                                                                                                                     | Could not retrieve usable service/API documentation during this check; no independent coverage or permissions were established.                                                                                                                                                            |

No provider comparison establishes complete coverage or a verified feed of every completed in-game sale. Wynnventory observations are asking prices. Nori's community-contributed sales are a different evidence category; their completeness and authenticity were not independently verified. We do not silently mix them or present estimated/observed values as confirmed transaction prices.

## Terms and permission findings

The Wynnventory website's home and API-key pages and the web repository's docs/tree were checked. No separate published API Terms of Service or explicit blanket redistribution grant was found. That absence is not permission to republish or mirror data without limits. The documented application API and self-service keys indicate that third-party read-only integrations are intended; they do not settle every public-proxy, commercial-use or retention question.

For this integration, use your own application key and accurately describe the public read-only MCP in the key application's intended-use field. Keep the key secret, preserve attribution, request data only when a tool is called, and do not harvest or mirror the complete dataset. If your use goes beyond ordinary API consumption or needs a definitive grant for broad redistribution/commercial use, obtain clarification from Wynnventory's maintainers. No maintainer approval has been claimed or obtained by this project.

The historical organization README's development-key guidance is not used to justify production access. The current self-service page and v2 documentation are the relevant technical access path. We never extract or reuse the game mod's embedded/shared key, copy the backend's implementation, submit data, scrape the website as a substitute for authorized API access, or fall back to another provider to bypass a limit.

## Configuration and behavior

Set `WYNNVENTORY_API_KEY` in your host's runtime secrets and deploy. It is optional: without it, the original 40 official-Wynncraft tools remain available; with it, 15 unique Wynnventory read tools are added, for 55 total. Clients may need to reconnect to refresh their tool catalogue.

See [the generated tool list](wynnventory-coverage.md). Duplicate official item/aspect proxy routes are omitted. Wynncraft OAuth credentials are never sent to Wynnventory, and the Wynnventory key is never sent to Wynncraft or returned to MCP clients. A user's character/profile data is not forwarded to Wynnventory.

Examples:

```json
{ "name": "wynnventory_getItemPrice", "arguments": { "item_name": "Hero", "shiny": false } }
```

```json
{
  "name": "wynnventory_listMarketListings",
  "arguments": { "item_name": "Hero", "sort": "listing_price_asc", "page": 1, "page_size": 20 }
}
```

```json
{
  "name": "wynnventory_getItemHistory",
  "arguments": {
    "item_name": "Hero",
    "start_date": "2026-10-01",
    "end_date": "2026-10-28",
    "page_size": 30
  }
}
```

Tools retain the raw v2 envelope under `data` (including upstream `data` and `pagination`) and add a `source` object with provider, retrieval time and data-quality caveats. Upstream observation timestamps remain in the payload; retrieval time is not the time a listing was observed. To project the inner upstream data, use `view.pointer: "/data"`.

Prices are emeralds, not euros or dollars. Preserve sample counts, observation timestamps and incomplete/stale-data caveats when presenting estimates. An unavailable price or a 404 is not a zero-valued item. For a robust estimate, inspect Wynnventory's documented median, trimmed-mean or EMA fields rather than assuming the lowest asking price is fair value.

Requests are read-only, bounded and cancelable, do not follow redirects with credentials, and do not retry automatically or fetch every page. Upstream 401/403/404/429 errors and safe retry/rate-limit headers are returned as tool errors. Fix/revoke the application key when appropriate; never rotate across users' credentials to evade a quota. MCP responses remain `no-store`, and this integration adds no retained game-data cache or database copy.
