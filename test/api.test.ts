import test from 'node:test';
import assert from 'node:assert/strict';
import { operations, buildUrl, project, requestApi, readJson } from '../src/api.js';
import { loadConfig } from '../src/config.js';

const op = (path: string) => operations.find((o) => o.path === path)!;
test('every documented data route is present and credentials are excluded', () => {
  assert.equal(operations.length, 40);
  assert.equal(new Set(operations.map((o) => o.name)).size, 40);
  assert.ok(!operations.some((o) => o.path === '/oauth/token'));
  for (const operation of operations) {
    const args = Object.fromEntries(
      operation.parameters.filter((p) => p.in === 'path').map((p) => [p.name, 'example']),
    );
    const url = buildUrl(operation, args);
    assert.equal(url.origin, 'https://api.wynncraft.com');
    assert.ok(!url.pathname.includes('{'));
  }
});
test('Wynncraft presence flags remain bare and false flags are omitted', () => {
  assert.equal(
    buildUrl(op('/player/{username}'), { username: 'Salted', fullResult: true }).href,
    'https://api.wynncraft.com/v3/player/Salted?fullResult',
  );
  assert.equal(
    buildUrl(op('/item/recipe/database'), { full_result: true, page: 2 }).search,
    '?page=2&full_result',
  );
  assert.equal(buildUrl(op('/item/metadata'), { static: true }).search, '?static');
  assert.equal(buildUrl(op('/player/{username}'), { username: 'a', fullResult: false }).search, '');
});
test('path segments cannot change API origin or escape routes', () => {
  for (const username of ['..', '.', 'a/b', 'a\\b', 'x?y', 'x#y', '\n'])
    assert.throws(() => buildUrl(op('/player/{username}'), { username }));
  assert.equal(
    buildUrl(op('/guild/{query}'), { query: 'A B & C' }).pathname,
    '/v3/guild/A%20B%20%26%20C',
  );
});
test('safe JSON Pointer supports escaped keys, slicing, and no inherited properties', () => {
  assert.deepEqual(
    project({ 'a/b': { '~key': [1, 2, 3] } }, { pointer: '/a~1b/~0key', offset: 1, limit: 1 }),
    { data: [2], projection: { total: 3, offset: 1, limit: 1, nextOffset: 2 } },
  );
  assert.throws(() => project({}, { pointer: '/constructor' }));
  assert.throws(() => project({}, { pointer: '/~2' }));
  assert.deepEqual(project({ a: 1, b: 2 }, { limit: 1 }).data, { a: 1 });
});
test('read-only POST search forwards filters, auth and cancellation, and returns safe rate metadata', async () => {
  const result = await requestApi(
    op('/item/search'),
    { page: 2, body: { query: 'Wand' } },
    {
      token: 'secret',
      fetch: async (url, init) => {
        assert.equal(String(url), 'https://api.wynncraft.com/v3/item/search?page=2');
        assert.equal(init?.method, 'POST');
        assert.equal(init?.redirect, 'manual');
        assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer secret');
        assert.equal(init?.body, '{"query":"Wand"}');
        assert.ok(init?.signal);
        return Response.json(
          { error: 'TooManyRequests' },
          { status: 429, headers: { 'Retry-After': '5', UserID: 'private' } },
        );
      },
    },
  );
  assert.equal(result.ok, false);
  assert.deepEqual(result.metadata, { 'retry-after': '5' });
});
test('unbounded upstream response is stopped even without Content-Length', async () => {
  let cancelled = false;
  const response = new Response(
    new ReadableStream({
      pull(controller) {
        controller.enqueue(new Uint8Array(1024 * 1024));
      },
      cancel() {
        cancelled = true;
      },
    }),
  );
  await assert.rejects(readJson(response), /exceeds 8 MiB/);
  assert.ok(cancelled);
});
test('private shared tokens require an access gate and OAuth requires shared storage', () => {
  assert.throws(() => loadConfig({ WYNNCRAFT_API_TOKEN: 'secret' }), /requires MCP_API_KEY/);
  assert.throws(
    () => loadConfig({ PUBLIC_URL: 'https://mcp.example', WYNNCRAFT_OAUTH_CLIENT_ID: 'id' }),
    /AUTHORIZATION_URL/,
  );
  assert.throws(() => loadConfig({ PUBLIC_URL: 'http://remote.example' }), /HTTPS/);
  assert.throws(() => loadConfig({ MCP_API_KEY: 'short' }), /32 characters/);
});
