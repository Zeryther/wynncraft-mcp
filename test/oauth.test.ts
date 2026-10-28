import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { WynncraftOAuthProvider } from '../src/oauth.js';
import { opaque, digest, type Store } from '../src/store.js';

function memoryStore(): Store {
  const data = new Map<string, { value: unknown; expires: number }>();
  const get = async <T>(key: string) => {
    const item = data.get(key);
    return item && item.expires > Date.now()
      ? (JSON.parse(JSON.stringify(item.value)) as T)
      : undefined;
  };
  return {
    get,
    async take<T>(key: string) {
      const value = await get<T>(key);
      data.delete(key);
      return value;
    },
    async put(key, value, ttl) {
      data.set(key, { value: JSON.parse(JSON.stringify(value)), expires: Date.now() + ttl * 1000 });
    },
    async delete(key) {
      data.delete(key);
    },
  };
}
const host = { Host: 'mcp.example' };
const resource = 'https://mcp.example/mcp';
const redirect = 'https://client.example/callback';
function setup() {
  const store = memoryStore();
  const provider = new WynncraftOAuthProvider(
    {
      publicUrl: 'https://mcp.example',
      clientId: 'wynn-client',
      authorizationUrl: 'https://wynncraft.com/oauth/authorize',
      scopes: ['identify', 'main_access'],
    },
    store,
    async (_url, init) => {
      const params = init?.body as URLSearchParams;
      assert.equal(params.get('client_id'), 'wynn-client');
      assert.equal(params.get('redirect_uri'), 'https://mcp.example/oauth/callback');
      assert.equal(params.get('code_verifier')?.length, 43);
      return Response.json({
        access_token: `wynn-${params.get('code')}`,
        token_type: 'bearer',
        scope: 'identify main_access',
      });
    },
  );
  const seen: string[] = [];
  const app = createApp(loadConfig({ PUBLIC_URL: 'https://mcp.example' }), {
    oauthProvider: provider,
    fetch: async (_url, init) => {
      const authorization = new Headers(init?.headers).get('authorization')!;
      seen.push(authorization);
      return Response.json({ account: authorization });
    },
  });
  return { app, provider, store, seen };
}
async function register(app: ReturnType<typeof createApp>) {
  const result = await request(app)
    .post('/register')
    .set(host)
    .send({
      client_name: 'Test client <unsafe>',
      redirect_uris: [redirect],
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code'],
      response_types: ['code'],
    });
  assert.equal(result.status, 201, JSON.stringify(result.body));
  return result.body.client_id as string;
}
async function authorize(app: ReturnType<typeof createApp>, clientId: string, verifier = opaque()) {
  const result = await request(app)
    .get('/authorize')
    .set(host)
    .query({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: redirect,
      code_challenge: digest(verifier),
      code_challenge_method: 'S256',
      scope: 'wynncraft:read',
      state: 'client-state',
      resource,
    });
  assert.equal(result.status, 302);
  assert.ok(result.headers['set-cookie'], result.headers.location);
  const cookie = (result.headers['set-cookie'] as unknown as string[])[0]!.split(';')[0]!;
  const upstream = new URL(result.headers.location!);
  assert.equal(upstream.origin, 'https://wynncraft.com');
  assert.equal(upstream.searchParams.get('client_id'), 'wynn-client');
  return { state: upstream.searchParams.get('state')!, cookie, verifier };
}
async function callback(
  app: ReturnType<typeof createApp>,
  auth: Awaited<ReturnType<typeof authorize>>,
  upstreamCode: string,
) {
  const result = await request(app)
    .get('/oauth/callback')
    .set(host)
    .set('Cookie', auth.cookie)
    .query({ state: auth.state, code: upstreamCode });
  assert.equal(result.status, 200, result.text);
  assert.ok(result.text.includes('Test client &lt;unsafe&gt;'));
  assert.ok(!result.text.includes(`wynn-${upstreamCode}`));
  return result.text.match(/name="consent" value="([^"]+)"/)![1]!;
}
async function consent(
  app: ReturnType<typeof createApp>,
  auth: Awaited<ReturnType<typeof authorize>>,
  id: string,
) {
  const result = await request(app)
    .post('/oauth/consent')
    .set(host)
    .set('Origin', 'https://mcp.example')
    .set('Cookie', auth.cookie)
    .type('form')
    .send({ consent: id, decision: 'allow' });
  assert.equal(result.status, 303);
  const url = new URL(result.headers.location!);
  assert.equal(url.origin, 'https://client.example');
  assert.equal(url.searchParams.get('state'), 'client-state');
  return url.searchParams.get('code')!;
}
function exchange(
  app: ReturnType<typeof createApp>,
  client: string,
  code: string,
  verifier: string,
  resourceOverride = resource,
) {
  return request(app).post('/token').set(host).type('form').send({
    grant_type: 'authorization_code',
    client_id: client,
    code,
    code_verifier: verifier,
    redirect_uri: redirect,
    resource: resourceOverride,
  });
}

test('hosted OAuth complete login isolates accounts across stateless MCP requests', async () => {
  const { app, seen } = setup();
  const client = await register(app);
  const tokens: string[] = [];
  for (const upstream of ['alice', 'bob']) {
    const auth = await authorize(app, client);
    const consentId = await callback(app, auth, upstream);
    const code = await consent(app, auth, consentId);
    const token = await exchange(app, client, code, auth.verifier);
    assert.equal(token.status, 200, JSON.stringify(token.body));
    assert.ok(!JSON.stringify(token.body).includes(`wynn-${upstream}`));
    tokens.push(token.body.access_token);
  }
  for (const token of tokens) {
    const result = await request(app)
      .post('/mcp')
      .set(host)
      .set('Authorization', `Bearer ${token}`)
      .set('Accept', 'application/json, text/event-stream')
      .send({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'wynncraft_classes_listClasses', arguments: {} },
      });
    assert.equal(result.status, 200);
    assert.equal(result.headers['mcp-session-id'], undefined);
  }
  assert.deepEqual(seen, ['Bearer wynn-alice', 'Bearer wynn-bob']);
  const metadata = await request(app).get('/.well-known/oauth-protected-resource/mcp').set(host);
  assert.equal(metadata.body.resource, resource);
  const unauthorized = await request(app).post('/mcp').set(host).send({});
  assert.equal(unauthorized.status, 401);
  assert.match(unauthorized.headers['www-authenticate']!, /resource_metadata/);
});
test('state, browser binding, consent origin, PKCE, resource and one-time codes are enforced', async () => {
  const { app } = setup();
  const client = await register(app);
  const auth = await authorize(app, client);
  assert.equal(
    (
      await request(app)
        .get('/oauth/callback')
        .set(host)
        .query({ state: auth.state, code: 'alice' })
    ).status,
    400,
  );
  const consentId = await callback(app, auth, 'alice');
  assert.equal(
    (
      await request(app)
        .get('/oauth/callback')
        .set(host)
        .set('Cookie', auth.cookie)
        .query({ state: auth.state, code: 'alice' })
    ).status,
    400,
  );
  assert.equal(
    (
      await request(app)
        .post('/oauth/consent')
        .set(host)
        .set('Origin', 'https://evil.example')
        .set('Cookie', auth.cookie)
        .type('form')
        .send({ consent: consentId, decision: 'allow' })
    ).status,
    403,
  );
  const code = await consent(app, auth, consentId);
  assert.equal((await exchange(app, client, code, opaque())).status, 400);
  assert.equal(
    (await exchange(app, client, code, auth.verifier, 'https://other.example/mcp')).status,
    400,
  );
  const otherClient = await register(app);
  assert.equal((await exchange(app, otherClient, code, auth.verifier)).status, 400);
  assert.equal((await exchange(app, client, code, auth.verifier)).status, 200);
  assert.equal((await exchange(app, client, code, auth.verifier)).status, 400);
});
test('revocation belongs to the issuing MCP client and does not revoke another client token', async () => {
  const { app, provider } = setup();
  const client = await register(app),
    other = await register(app);
  const auth = await authorize(app, client);
  const code = await consent(app, auth, await callback(app, auth, 'alice'));
  const token = (await exchange(app, client, code, auth.verifier)).body.access_token as string;
  const owner = (await provider.clientsStore.getClient(client))!;
  await provider.revokeToken((await provider.clientsStore.getClient(other))!, { token });
  assert.equal((await provider.verifyAccessToken(token)).clientId, client);
  await provider.revokeToken(owner, { token });
  await assert.rejects(provider.verifyAccessToken(token));
});
test('registration rejects unsafe redirect URIs and authorization requires audience', async () => {
  const { app } = setup();
  for (const uri of [
    'http://evil.example/callback',
    'javascript:alert(1)',
    'https://example.com/#fragment',
  ]) {
    const result = await request(app)
      .post('/register')
      .set(host)
      .send({ redirect_uris: [uri], token_endpoint_auth_method: 'none' });
    assert.equal(result.status, 400);
  }
  const client = await register(app);
  const result = await request(app)
    .get('/authorize')
    .set(host)
    .query({
      response_type: 'code',
      client_id: client,
      redirect_uri: redirect,
      code_challenge: digest(opaque()),
      code_challenge_method: 'S256',
    });
  assert.equal(new URL(result.headers.location!).searchParams.get('error'), 'invalid_request');
});

test('consent denial returns client state without a code and cannot be replayed', async () => {
  const { app } = setup();
  const client = await register(app);
  const auth = await authorize(app, client);
  const id = await callback(app, auth, 'alice');
  const result = await request(app)
    .post('/oauth/consent')
    .set(host)
    .set('Origin', 'https://mcp.example')
    .set('Cookie', auth.cookie)
    .type('form')
    .send({ consent: id, decision: 'deny' });
  assert.equal(result.status, 303);
  const url = new URL(result.headers.location!);
  assert.equal(url.searchParams.get('error'), 'access_denied');
  assert.equal(url.searchParams.get('state'), 'client-state');
  assert.equal(url.searchParams.has('code'), false);
  const replay = await request(app)
    .post('/oauth/consent')
    .set(host)
    .set('Origin', 'https://mcp.example')
    .set('Cookie', auth.cookie)
    .type('form')
    .send({ consent: id, decision: 'allow' });
  assert.equal(replay.status, 400);
});
test('concurrent code exchanges issue only one MCP token', async () => {
  const { app } = setup();
  const client = await register(app);
  const auth = await authorize(app, client);
  const code = await consent(app, auth, await callback(app, auth, 'alice'));
  const results = await Promise.all([
    exchange(app, client, code, auth.verifier),
    exchange(app, client, code, auth.verifier),
  ]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 400]);
});

test('Wynncraft denial returns to the client with its state and no upstream details', async () => {
  const { app } = setup();
  const client = await register(app);
  const auth = await authorize(app, client);
  const result = await request(app)
    .get('/oauth/callback')
    .set(host)
    .set('Cookie', auth.cookie)
    .query({ state: auth.state, error: 'upstream-error', error_description: 'untrusted-text' });
  assert.equal(result.status, 302);
  const url = new URL(result.headers.location!);
  assert.equal(url.searchParams.get('state'), 'client-state');
  assert.equal(url.searchParams.get('error'), 'access_denied');
  assert.equal(url.href.includes('untrusted-text'), false);
});
