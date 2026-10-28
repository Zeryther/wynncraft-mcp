import { timingSafeEqual } from 'node:crypto';
import express, { type ErrorRequestHandler } from 'express';
import { rateLimit } from 'express-rate-limit';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpServer } from './mcp.js';
import { type Config } from './config.js';
import { encryptedStore, upstashStore } from './store.js';
import { installOAuth, WynncraftOAuthProvider } from './oauth.js';
import type { Fetch } from './api.js';

export function createApp(
  config: Config,
  dependencies: { fetch?: Fetch; oauthProvider?: WynncraftOAuthProvider } = {},
) {
  const app = express();
  app.disable('x-powered-by');
  app.set('query parser', 'simple');
  if (config.trustProxyHops) app.set('trust proxy', config.trustProxyHops);
  const hosts = new Set([
    new URL(config.publicUrl).host,
    `localhost:${config.port}`,
    `127.0.0.1:${config.port}`,
    `[::1]:${config.port}`,
  ]);
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store');
    if (!req.headers.host || !hosts.has(req.headers.host)) {
      res.status(403).json({ error: 'Invalid Host' });
      return;
    }
    next();
  });
  app.get('/healthz', (_req, res) => {
    res.json({ status: 'ok' });
  });
  const oauth =
    dependencies.oauthProvider ??
    (config.oauth
      ? new WynncraftOAuthProvider(
          config.oauth,
          config.oauth.upstash
            ? upstashStore(
                config.oauth.upstash.url,
                config.oauth.upstash.token,
                config.oauth.encryptionKey,
              )
            : encryptedStore(config.oauth.redisUrl!, config.oauth.encryptionKey),
          dependencies.fetch,
        )
      : undefined);
  const authorize = oauth ? installOAuth(app, oauth) : undefined;
  app.use('/mcp', (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    const origin = req.get('origin');
    if (origin && !config.origins.includes(origin)) {
      res.status(403).json({ error: 'Origin not allowed' });
      return;
    }
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.vary('Origin');
      res.setHeader('Access-Control-Allow-Methods', 'POST, GET, DELETE, OPTIONS');
      res.setHeader(
        'Access-Control-Allow-Headers',
        'Authorization, Content-Type, MCP-Protocol-Version, MCP-Session-Id, Accept',
      );
      res.setHeader(
        'Access-Control-Expose-Headers',
        'WWW-Authenticate, Retry-After, RateLimit, RateLimit-Policy',
      );
    }
    if (req.method === 'OPTIONS') {
      res.sendStatus(204);
      return;
    }
    next();
  });
  app.use(
    '/mcp',
    rateLimit({
      windowMs: 60_000,
      limit: 180,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      message: { error: 'Too many MCP requests; retry after the rate-limit window.' },
    }),
  );
  app.use('/mcp', (req, res, next) => {
    if (config.apiKey) {
      const supplied = Buffer.from(req.get('authorization') ?? '');
      const expected = Buffer.from(`Bearer ${config.apiKey}`);
      if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
        res.setHeader('WWW-Authenticate', 'Bearer realm="wynncraft-mcp"');
        res.sendStatus(401);
        return;
      }
    }
    if (authorize) {
      authorize(req, res, next);
      return;
    }
    next();
  });
  app.post('/mcp', express.json({ limit: '64kb' }), async (req, res) => {
    const token =
      oauth && req.auth ? (await oauth.credential(req.auth.token)).upstreamToken : config.token;
    const server = createMcpServer({
      ...(token ? { token } : {}),
      ...(dependencies.fetch ? { fetch: dependencies.fetch } : {}),
    });
    const transport = new StreamableHTTPServerTransport({ enableJsonResponse: true });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } finally {
      await transport.close();
      await server.close();
    }
  });
  app.all('/mcp', (_req, res) => {
    res.setHeader('Allow', 'POST, OPTIONS');
    res.status(405).json({
      jsonrpc: '2.0',
      error: {
        code: -32000,
        message: 'Stateless endpoint: use POST; no SSE subscription or session deletion.',
      },
      id: null,
    });
  });
  app.use((_req, res) => {
    res.sendStatus(404);
  });
  const errors: ErrorRequestHandler = (cause: unknown, _req, res, _next) => {
    if (res.headersSent) {
      res.end();
      return;
    }
    const status =
      typeof cause === 'object' &&
      cause !== null &&
      'status' in cause &&
      typeof cause.status === 'number' &&
      [400, 413, 415].includes(cause.status)
        ? cause.status
        : 500;
    res.status(status).json({
      error: status === 500 ? 'Internal server error' : 'Invalid or oversized request body',
    });
  };
  app.use(errors);
  return app;
}
