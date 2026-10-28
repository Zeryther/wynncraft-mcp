# Wynncraft API terms and operator responsibilities

Brief implementation review on 2026-10-28 against the [Wynncraft Terms of Service](https://wynncraft.com/tos) and [API Terms](https://wynncraft.com/api-terms). This is an engineering assessment, not a guarantee of legal compliance or approval from Wynncraft.

The API Terms govern API integrations, including OAuth. No explicit prohibition on an MCP wrapper was identified. Use must remain within documented API access, privacy settings and user authorizations.

The server separates users' credentials, never rotates through other users' tokens to increase request capacity, performs no bulk harvesting, and does not cache or retain game-data responses. Each request is made for the connecting user's use, and upstream errors and rate limits are returned to that client.

Operators must describe the integration accurately in the Wynncraft application settings and explain its data access and disclosure to the user's MCP client or AI service. Request only needed scopes. Keep credentials confidential, revoke compromised tokens, respect rate limits, and do not use API output to harm players or undermine gameplay.

Privacy changes also affect previously obtained API data. The server has no game-data cache to purge, but client-side chat histories, exports, logs and other retained copies are outside its control. Operators and users must consider those downstream retention and deletion obligations before enabling private-data access. Do not claim this wrapper can revoke copies already sent to an MCP client.

Publishing the MIT-licensed wrapper does not relicense Wynncraft data, grant trademark rights or imply endorsement. If future features retain game data, add a privacy-change/deletion design before shipping them. Recheck the live terms before public launch or material changes.

Wynnventory is a separate optional provider with its own API access and data-provenance considerations. See [market sources and access findings](market-data-sources.md); authorization to use Wynncraft does not by itself grant rights to third-party API data.
