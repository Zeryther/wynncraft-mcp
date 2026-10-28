import { test, expect } from '@playwright/test';
import { createServer as httpsServer } from 'node:https';
import { createServer as httpServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { WynncraftOAuthProvider } from '../../src/oauth.js';
import { digest, opaque, type Store } from '../../src/store.js';

const values = new Map<string, unknown>();
const store: Store = {
  async get<T>(key: string) {
    return values.get(key) as T | undefined;
  },
  async take<T>(key: string) {
    const value = values.get(key);
    values.delete(key);
    return value as T | undefined;
  },
  async put(key, value) {
    values.set(key, JSON.parse(JSON.stringify(value)));
  },
  async delete(key) {
    values.delete(key);
  },
};

test('a real browser completes consent and follows a cross-origin callback', async ({
  page,
  context,
}) => {
  const dir = mkdtempSync(join(tmpdir(), 'wynncraft-mcp-browser-'));
  execFileSync(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-keyout',
      join(dir, 'key.pem'),
      '-out',
      join(dir, 'cert.pem'),
      '-days',
      '1',
      '-subj',
      '/CN=localhost',
      '-addext',
      'subjectAltName=DNS:localhost',
    ],
    { stdio: 'ignore' },
  );
  const target = httpServer((_req, res) => {
    res.setHeader('Content-Type', 'text/plain');
    res.end('MCP client received callback');
  });
  await new Promise<void>((resolve) => target.listen(0, '127.0.0.1', resolve));
  const targetPort = (target.address() as { port: number }).port;
  const redirect = `http://127.0.0.1:${targetPort}/callback`;
  const server = httpsServer({
    key: readFileSync(join(dir, 'key.pem')),
    cert: readFileSync(join(dir, 'cert.pem')),
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  const origin = `https://localhost:${port}`;
  const provider = new WynncraftOAuthProvider(
    {
      publicUrl: origin,
      clientId: 'wynn-browser-app',
      authorizationUrl: 'https://wynncraft.com/oauth/authorize',
      scopes: ['identify'],
    },
    store,
    async () => Response.json({ access_token: 'private-token', scope: 'identify' }),
  );
  server.on(
    'request',
    createApp(loadConfig({ PUBLIC_URL: origin, PORT: String(port) }), { oauthProvider: provider }),
  );
  try {
    await page.route('https://wynncraft.com/**', async (route) => {
      const authorization = new URL(route.request().url());
      const callback = new URL('/oauth/callback', origin);
      callback.searchParams.set('state', authorization.searchParams.get('state')!);
      callback.searchParams.set('code', 'browser-code');
      await route.fulfill({ status: 302, headers: { Location: callback.href } });
    });
    const registration = await context.request.post(`${origin}/register`, {
      data: {
        client_name: 'Browser test client',
        redirect_uris: [redirect],
        token_endpoint_auth_method: 'none',
      },
    });
    expect(registration.status()).toBe(201);
    const client = await registration.json();
    const verifier = opaque();
    const authorization = new URL('/authorize', origin);
    authorization.search = new URLSearchParams({
      client_id: client.client_id,
      redirect_uri: redirect,
      resource: `${origin}/mcp`,
      response_type: 'code',
      code_challenge: digest(verifier),
      code_challenge_method: 'S256',
      scope: 'wynncraft:read',
    }).toString();
    const started = await context.request.get(authorization.href, { maxRedirects: 0 });
    expect(started.status()).toBe(302);
    await page.goto(started.headers().location!);
    await expect(
      page.getByRole('heading', { name: 'Connect your Wynncraft account' }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Allow connection' }).click();
    await expect(page).toHaveURL(
      new RegExp(`^http://127\\.0\\.0\\.1:${targetPort}/callback\\?code=`),
    );
    const code = new URL(page.url()).searchParams.get('code');
    expect(code).toBeTruthy();
    const token = await context.request.post(`${origin}/token`, {
      form: {
        grant_type: 'authorization_code',
        client_id: client.client_id,
        redirect_uri: redirect,
        resource: `${origin}/mcp`,
        code: code!,
        code_verifier: verifier,
      },
    });
    expect(token.status()).toBe(200);
    expect(JSON.stringify(await token.json())).not.toContain('private-token');
  } finally {
    server.closeAllConnections();
    target.closeAllConnections();
    await Promise.all([
      new Promise<void>((resolve) => server.close(() => resolve())),
      new Promise<void>((resolve) => target.close(() => resolve())),
    ]);
    rmSync(dir, { recursive: true, force: true });
  }
});
