import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import request from 'supertest';
import { createMcpServer } from '../src/mcp.js';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import {
  wynnventoryOperations,
  buildWynnventoryUrl,
  requestWynnventory,
} from '../src/wynnventory.js';

const price = wynnventoryOperations.find(
  (operation) => operation.name === 'wynnventory_getItemPrice',
)!;
async function connect(options: Parameters<typeof createMcpServer>[0]) {
  const server = createMcpServer(options);
  const client = new Client({ name: 'wynnventory-test', version: '1' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return {
    client,
    async close() {
      await client.close();
      await server.close();
    },
  };
}

test('Wynnventory stays absent without its own key and cannot be called by name', async () => {
  const connection = await connect({});
  try {
    assert.equal((await connection.client.listTools()).tools.length, 40);
    await assert.rejects(
      connection.client.callTool({ name: price.name, arguments: { item_name: 'Hero' } }),
      /Unknown tool/,
    );
  } finally {
    await connection.close();
  }
});

test('all 15 optional Wynnventory tools work through an MCP client with strict credentials and source attribution', async () => {
  let current = wynnventoryOperations[0]!;
  let args: Record<string, unknown> = {};
  let calls = 0;
  const connection = await connect({
    token: 'private-wynncraft-token',
    wynnventoryApiKey: 'private-wynnventory-key',
    fetch: async (url, init) => {
      calls++;
      const headers = new Headers(init?.headers);
      if (String(url).startsWith('https://api.wynncraft.com/')) {
        assert.equal(headers.get('authorization'), 'Bearer private-wynncraft-token');
        assert.equal(headers.get('x-api-key'), null);
        return Response.json({ mage: 'Mage' });
      }
      assert.equal(String(url), buildWynnventoryUrl(current, args).href);
      assert.equal(new URL(String(url)).origin, 'https://www.wynnventory.com');
      assert.equal(headers.get('x-api-key'), 'private-wynnventory-key');
      assert.equal(headers.get('authorization'), null);
      assert.equal(init?.method, 'GET');
      assert.equal(init?.redirect, 'error');
      assert.ok(init?.signal);
      return Response.json(
        {
          data: [{ name: 'Hero', average_price: 100, timestamp: '2026-10-27T00:00:00Z' }],
          pagination: { page: 1, total_pages: 2 },
        },
        { headers: { 'Cache-Control': 'max-age=30', 'Set-Cookie': 'never-expose-me' } },
      );
    },
  });
  try {
    const tools = await connection.client.listTools();
    assert.equal(tools.tools.length, 55);
    assert.ok(
      tools.tools
        .filter((tool) => tool.name.startsWith('wynnventory_'))
        .every(
          (tool) => tool.annotations?.readOnlyHint && tool.description?.includes('Third-party'),
        ),
    );
    for (const operation of wynnventoryOperations) {
      current = operation;
      args = Object.fromEntries(
        operation.parameters.map((parameter) => {
          const schema = parameter.schema as Record<string, unknown>;
          const value =
            schema.type === 'boolean'
              ? false
              : schema.type === 'integer'
                ? (schema.minimum ?? 1)
                : schema.format === 'date'
                  ? '2026-10-01'
                  : Array.isArray(schema.enum)
                    ? schema.enum[0]
                    : 'Hero';
          return [parameter.name, value];
        }),
      );
      const result = await connection.client.callTool({ name: operation.name, arguments: args });
      assert.equal(result.isError, undefined, JSON.stringify(result.content));
      const structured = result.structuredContent as {
        source: { name: string; notice: string };
        data: { pagination: unknown };
        metadata: Record<string, string>;
      };
      assert.equal(structured.source.name, 'Wynnventory');
      assert.ok(structured.source.notice.includes('incomplete'));
      assert.ok(structured.data.pagination);
      assert.equal(structured.metadata['set-cookie'], undefined);
      assert.ok(!JSON.stringify(result).includes('private-wynnventory-key'));
      assert.ok(!JSON.stringify(result).includes('private-wynncraft-token'));
    }
    await connection.client.callTool({ name: 'wynncraft_classes_listClasses', arguments: {} });
    assert.equal(calls, 16);
  } finally {
    await connection.close();
  }
});

test('Wynnventory filters encode booleans and item names without accepting path traversal', () => {
  const url = buildWynnventoryUrl(price, { item_name: "Bob's Mythic", shiny: false, tier: 3 });
  assert.equal(url.pathname, "/api/v2/market/items/Bob's%20Mythic/price");
  assert.equal(url.searchParams.get('shiny'), 'false');
  assert.equal(url.searchParams.get('tier'), '3');
  for (const item_name of ['..', '.', 'a/b', 'a\\b', 'a?b', 'a#b', '\n', '\ud800'])
    assert.throws(() => buildWynnventoryUrl(price, { item_name }));
});

test('invalid dates, inverted ranges, excessive pages and unsupported arguments never reach Wynnventory', async () => {
  let calls = 0;
  const connection = await connect({
    wynnventoryApiKey: 'test-key',
    fetch: async () => {
      calls++;
      return Response.json({ data: [] });
    },
  });
  try {
    const cases = [
      { name: price.name, arguments: { item_name: '\ud800' } },
      {
        name: 'wynnventory_getItemHistory',
        arguments: { item_name: 'Hero', start_date: '2026-02-30' },
      },
      {
        name: 'wynnventory_getItemHistory',
        arguments: { item_name: 'Hero', start_date: '2026-10-20', end_date: '2026-10-01' },
      },
      { name: 'wynnventory_listMarketListings', arguments: { page_size: 201 } },
      { name: 'wynnventory_listLootpools', arguments: { page_size: 9 } },
      {
        name: price.name,
        arguments: { item_name: 'Hero', url: 'https://evil.example', api_key: 'smuggle' },
      },
    ];
    for (const call of cases) assert.equal((await connection.client.callTool(call)).isError, true);
    assert.equal(calls, 0);
  } finally {
    await connection.close();
  }
});

test('Wynnventory 401/429, local projection and network failures remain actionable and secret-safe', async () => {
  const limited = await requestWynnventory(
    price,
    { item_name: 'Hero' },
    {
      apiKey: 'hidden-key',
      fetch: async () =>
        Response.json(
          { error: { code: 'rate_limited', message: 'Try later' } },
          { status: 429, headers: { 'Retry-After': '30' } },
        ),
    },
  );
  assert.equal(limited.ok, false);
  assert.equal(limited.metadata['retry-after'], '30');
  const connection = await connect({
    wynnventoryApiKey: 'hidden-key',
    fetch: async () => {
      throw new Error('Network failure with hidden-key');
    },
  });
  try {
    const result = await connection.client.callTool({
      name: price.name,
      arguments: { item_name: 'Hero' },
    });
    assert.equal(result.isError, true);
    assert.ok(!JSON.stringify(result).includes('hidden-key'));
    assert.ok(JSON.stringify(result).includes('Wynnventory'));
  } finally {
    await connection.close();
  }
  const projected = await connect({
    wynnventoryApiKey: 'test-key',
    fetch: async () => Response.json({ data: [1, 2, 3], pagination: { page: 1 } }),
  });
  try {
    const result = await projected.client.callTool({
      name: price.name,
      arguments: { item_name: 'Hero', view: { pointer: '/data', offset: 1, limit: 1 } },
    });
    assert.deepEqual((result.structuredContent as { data: unknown }).data, [2]);
    assert.equal(
      (result.structuredContent as { source: { name: string } }).source.name,
      'Wynnventory',
    );
  } finally {
    await projected.close();
  }
});

test('runtime Wynnventory key is wired into HTTP tool discovery without exposing it', async () => {
  const config = loadConfig({
    PUBLIC_URL: 'https://mcp.example',
    MCP_API_KEY: 'a'.repeat(32),
    WYNNVENTORY_API_KEY: 'server-only-key',
  });
  const app = createApp(config);
  const result = await request(app)
    .post('/mcp')
    .set({ Host: 'mcp.example', Accept: 'application/json, text/event-stream' })
    .set('Authorization', `Bearer ${'a'.repeat(32)}`)
    .send({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
  assert.equal(result.status, 200);
  assert.equal(result.body.result.tools.length, 55);
  assert.ok(!JSON.stringify(result.body).includes('server-only-key'));
  assert.equal(result.headers['cache-control'], 'no-store');
});

test('Wynnventory authentication errors preserve source/status and never become successful price results', async () => {
  const connection = await connect({
    wynnventoryApiKey: 'private-key',
    fetch: async () =>
      Response.json(
        { error: { code: 'invalid_api_key', message: 'Invalid API key' } },
        { status: 401 },
      ),
  });
  try {
    const result = await connection.client.callTool({
      name: price.name,
      arguments: { item_name: 'Hero' },
    });
    assert.equal(result.isError, true);
    const structured = result.structuredContent as {
      status: number;
      ok: boolean;
      source: { name: string };
      data: { error: { code: string } };
    };
    assert.equal(structured.status, 401);
    assert.equal(structured.ok, false);
    assert.equal(structured.source.name, 'Wynnventory');
    assert.equal(structured.data.error.code, 'invalid_api_key');
    assert.ok(!JSON.stringify(result).includes('private-key'));
  } finally {
    await connection.close();
  }
});

test('a configured Wynnventory application key requires authenticated MCP access', () => {
  assert.throws(
    () => loadConfig({ WYNNVENTORY_API_KEY: 'test-key' }),
    /requires hosted OAuth or MCP_API_KEY/,
  );
});

test('an upstream credential echo is withheld, including JSON-escaped key values', async () => {
  for (const key of ['very-private-test-key', 'test-key-with"quotes']) {
    const connection = await connect({
      wynnventoryApiKey: key,
      fetch: async () =>
        Response.json({ error: { message: `Invalid key: ${key}` } }, { status: 401 }),
    });
    try {
      const result = await connection.client.callTool({
        name: price.name,
        arguments: { item_name: 'Hero' },
      });
      assert.equal(result.isError, true);
      assert.equal(result.structuredContent, undefined);
      assert.ok(!JSON.stringify(result).includes(key));
      assert.ok(JSON.stringify(result).includes('withheld'));
    } finally {
      await connection.close();
    }
  }
});
