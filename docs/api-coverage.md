# API coverage

Generated from [Wynncraft OpenAPI](https://docs.wynncraft.com/openapi.json). Run `npm run api:update` to refresh.

40 data operations. OAuth token exchange is provided by the local PKCE helper instead of an MCP tool.

| Tool | Method | Path |
| --- | --- | --- |
| `wynncraft_player_listOnlinePlayers` | GET | `/player` |
| `wynncraft_player_getPlayerIdentity` | GET | `/player/whoami` |
| `wynncraft_player_getPlayer` | GET | `/player/{username}` |
| `wynncraft_player_listPlayerCharacters` | GET | `/player/{username}/characters` |
| `wynncraft_player_getPlayerCharacter` | GET | `/player/{username}/characters/{uuid}` |
| `wynncraft_player_getPlayerCharacterAbilities` | GET | `/player/{username}/characters/{uuid}/abilities` |
| `wynncraft_oAuth2_getOauthIdentity` | GET | `/oauth/me` |
| `wynncraft_guild_listGuilds` | GET | `/guild/list/guild` |
| `wynncraft_guild_listGuildTerritories` | GET | `/guild/list/territory` |
| `wynncraft_guild_listGuildSeasons` | GET | `/guild/seasons` |
| `wynncraft_guild_getGuildByPrefix` | GET | `/guild/prefix/{query}` |
| `wynncraft_guild_getGuildByUuid` | GET | `/guild/uuid/{query}` |
| `wynncraft_guild_getGuildByName` | GET | `/guild/{query}` |
| `wynncraft_item_listItems` | GET | `/item/database` |
| `wynncraft_item_searchItems` | POST | `/item/search` |
| `wynncraft_item_quickSearchItems` | GET | `/item/search/{query}` |
| `wynncraft_item_listRecipes` | GET | `/item/recipe/database` |
| `wynncraft_item_searchRecipes` | POST | `/item/recipe/search` |
| `wynncraft_item_getItemMetadata` | GET | `/item/metadata` |
| `wynncraft_item_listItemSets` | GET | `/item/sets` |
| `wynncraft_ability_getAbilityTree` | GET | `/ability/tree/{tree}` |
| `wynncraft_ability_getAbilityMap` | GET | `/ability/map/{tree}` |
| `wynncraft_ability_listAspects` | GET | `/aspects/{tree}` |
| `wynncraft_classes_listClasses` | GET | `/classes` |
| `wynncraft_classes_getClass` | GET | `/classes/{class_name}` |
| `wynncraft_map_listMapMarkers` | GET | `/map/locations/markers` |
| `wynncraft_map_listPlayerLocations` | GET | `/map/locations/player` |
| `wynncraft_map_listWorldEvents` | GET | `/map/world-events` |
| `wynncraft_map_listMapCamps` | GET | `/map/camps` |
| `wynncraft_map_listMapRaids` | GET | `/map/raids` |
| `wynncraft_map_listMapLootPools` | GET | `/map/loot-pools` |
| `wynncraft_map_listGatheringNodes` | GET | `/map/gathering-nodes` |
| `wynncraft_map_getQuestCount` | GET | `/map/quests` |
| `wynncraft_search_globalSearch` | GET | `/search/{query}` |
| `wynncraft_leaderboards_listLeaderboardTypes` | GET | `/leaderboards/types` |
| `wynncraft_leaderboards_getLeaderboard` | GET | `/leaderboards/{lb_type}` |
| `wynncraft_news_fetchPublisherArticle` | GET | `/publisher/articles/fetch/{article_type}/{pk}` |
| `wynncraft_news_listPublisherArticles` | GET | `/publisher/articles/list/{article_type}` |
| `wynncraft_news_listPublisherVideos` | GET | `/publisher/videos/list` |
| `wynncraft_news_listLatestNews` | GET | `/latest-news` |
