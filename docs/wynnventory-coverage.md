# Wynnventory tool coverage

Generated from the [official v2 specification](https://raw.githubusercontent.com/Wynnventory/WynnVentory_Web/main/docs/openapi_v2.yaml) using `npm run wynnventory:update`. All 15 optional operations are read-only GET requests; duplicate official-Wynncraft item/aspect proxy routes are omitted.

| Tool | Route |
| --- | --- |
| `wynnventory_getStatus` | `/status` |
| `wynnventory_listMarketListings` | `/market/listings` |
| `wynnventory_getItemPrice` | `/market/items/{item_name}/price` |
| `wynnventory_getItemHistory` | `/market/items/{item_name}/history` |
| `wynnventory_getItemHistoryLatest` | `/market/items/{item_name}/history/latest` |
| `wynnventory_listMarketRankings` | `/market/rankings` |
| `wynnventory_listLootpools` | `/lootpools` |
| `wynnventory_getCurrentLootpool` | `/lootpools/current` |
| `wynnventory_getCurrentLootpoolItems` | `/lootpools/current/items` |
| `wynnventory_getLootpoolWeek` | `/lootpools/{year}/{week}` |
| `wynnventory_listRaidpools` | `/raidpools` |
| `wynnventory_getCurrentRaidpool` | `/raidpools/current` |
| `wynnventory_getCurrentRaidpoolItems` | `/raidpools/current/items` |
| `wynnventory_getRaidpoolWeek` | `/raidpools/{year}/{week}` |
| `wynnventory_getCurrentGambits` | `/gambits/current` |
