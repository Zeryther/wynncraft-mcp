import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';

const config = loadConfig({ PUBLIC_URL: 'https://mcp.example', PORT: '3000' });
const headers = { Host: 'mcp.example', Accept: 'application/json, text/event-stream' };
const rpc = (method: string, params: unknown = {}) => ({ jsonrpc: '2.0', id: 1, method, params });
test('MCP initialize, tools/list, validation and upstream errors over stateless HTTP', async () => {
  let calls = 0;
  const app = createApp(config, {
    fetch: async () => {
      calls++;
      return Response.json({ message: 'unavailable' }, { status: 503 });
    },
  });
  const initialized = await request(app)
    .post('/mcp')
    .set(headers)
    .send(
      rpc('initialize', {
        protocolVersion: '2025-11-25',
        capabilities: {},
        clientInfo: { name: 'test', version: '1' },
      }),
    );
  assert.equal(initialized.status, 200);
  assert.equal(initialized.headers['mcp-session-id'], undefined);
  assert.equal(initialized.body.result.serverInfo.name, 'wynncraft-mcp');
  const list = await request(app).post('/mcp').set(headers).send(rpc('tools/list'));
  assert.equal(list.body.result.tools.length, 40);
  const invalid = await request(app)
    .post('/mcp')
    .set(headers)
    .send(rpc('tools/call', { name: 'wynncraft_player_getPlayer', arguments: { username: '..' } }));
  assert.equal(invalid.body.result.isError, true);
  assert.equal(calls, 0);
  const failed = await request(app)
    .post('/mcp')
    .set(headers)
    .send(rpc('tools/call', { name: 'wynncraft_classes_listClasses', arguments: {} }));
  assert.equal(failed.body.result.isError, true);
  assert.equal(failed.body.result.structuredContent.status, 503);
  assert.equal(calls, 1);
  const notice = await request(app)
    .post('/mcp')
    .set(headers)
    .send({ jsonrpc: '2.0', method: 'notifications/initialized' });
  assert.equal(notice.status, 202);
});
test('Host, Origin, API key, request size and method protections', async () => {
  const app = createApp({ ...config, apiKey: 'a'.repeat(32) });
  assert.equal((await request(app).get('/healthz').set('Host', 'evil.example')).status, 403);
  assert.equal(
    (
      await request(app)
        .post('/mcp')
        .set(headers)
        .set('Origin', 'https://evil.example')
        .send(rpc('tools/list'))
    ).status,
    403,
  );
  assert.equal((await request(app).post('/mcp').set(headers).send(rpc('tools/list'))).status, 401);
  assert.equal(
    (
      await request(app)
        .get('/mcp')
        .set(headers)
        .set('Authorization', `Bearer ${'a'.repeat(32)}`)
    ).status,
    405,
  );
  const oversized = await request(app)
    .post('/mcp')
    .set(headers)
    .set('Authorization', `Bearer ${'a'.repeat(32)}`)
    .send({ huge: 'a'.repeat(70_000) });
  assert.equal(oversized.status, 413);
});
test('real SDK client can initialize and call a tool without sticky sessions', async () => {
  const app = createApp(loadConfig({ PORT: '3000' }), {
    fetch: async () => Response.json({ mage: { name: 'Mage' } }),
  });
  const listener = app.listen(3000, '127.0.0.1');
  const client = new Client({ name: 'integration', version: '1' });
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL('http://127.0.0.1:3000/mcp')));
    assert.equal((await client.listTools()).tools.length, 40);
    const result = await client.callTool({ name: 'wynncraft_classes_listClasses', arguments: {} });
    assert.equal(result.isError, undefined);
    assert.deepEqual((result.structuredContent as { data: unknown }).data, {
      mage: { name: 'Mage' },
    });
  } finally {
    await client.close();
    await new Promise<void>((resolve, reject) =>
      listener.close((e) => (e ? reject(e) : resolve())),
    );
  }
});

test('rate-limit errors stay private and readable by trusted browsers; preflights use no quota', async () => {
  const app = createApp({ ...config, apiKey: 'a'.repeat(32) });
  for (let i = 0; i < 185; i++) {
    const preflight = await request(app)
      .options('/mcp')
      .set(headers)
      .set('Origin', config.publicUrl);
    assert.equal(preflight.status, 204);
  }
  for (let i = 0; i < 180; i++) {
    const response = await request(app)
      .post('/mcp')
      .set(headers)
      .set('Origin', config.publicUrl)
      .send({});
    assert.equal(response.status, 401);
  }
  const limited = await request(app)
    .post('/mcp')
    .set(headers)
    .set('Origin', config.publicUrl)
    .send({});
  assert.equal(limited.status, 429);
  assert.equal(limited.headers['access-control-allow-origin'], config.publicUrl);
  assert.equal(limited.headers['cache-control'], 'no-store');
  assert.ok(limited.headers['retry-after']);
});

test('batched requests cannot multiply upstream calls under a single HTTP quota entry', async () => {
  let upstreamCalls = 0;
  const app = createApp(config, {
    fetch: async () => {
      upstreamCalls++;
      return Response.json({});
    },
  });
  const batch = Array.from({ length: 10 }, (_, id) => ({
    jsonrpc: '2.0',
    id,
    method: 'tools/call',
    params: { name: 'wynncraft_classes_listClasses', arguments: {} },
  }));
  const result = await request(app).post('/mcp').set(headers).send(batch);
  assert.equal(result.status, 400);
  assert.equal(result.body.error.code, -32600);
  assert.equal(result.headers['cache-control'], 'no-store');
  assert.equal(upstreamCalls, 0);
});
