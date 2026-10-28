import { createApp } from './app.js';
import { loadConfig } from './config.js';
const config = loadConfig();
const app = createApp(config);
const server = app.listen(config.port, config.host, () =>
  console.log(`Wynncraft MCP listening on port ${config.port}`),
);
server.requestTimeout = 30_000;
server.headersTimeout = 10_000;
export default app;
