import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createClient } from 'redis';
import { encryptedStore, opaque } from '../src/store.js';

const url = process.env.TEST_REDIS_URL;
test(
  'real Redis: encrypted values, key binding, atomic consume, TTL and reconnect',
  { skip: !url },
  async () => {
    const key = randomBytes(32).toString('base64');
    const store = encryptedStore(url!, key);
    const other = encryptedStore(url!, key);
    const inspector = createClient({ url: url! });
    await inspector.connect();
    const id = opaque();
    const prefix = 'wynncraft-mcp:v1:';
    try {
      await store.put(id, { upstreamToken: 'private-upstream-credential' }, 30);
      const raw = await inspector.get(prefix + id);
      assert.ok(raw && !raw.includes('private-upstream-credential'));
      assert.ok((await inspector.ttl(prefix + id)) > 0);
      await inspector.set(prefix + id + '-copy', raw!);
      await assert.rejects(store.get(id + '-copy')); // AAD binds ciphertext to the record key.
      assert.deepEqual(await other.get(id), { upstreamToken: 'private-upstream-credential' });
      const results = await Promise.all([store.take(id), other.take(id)]);
      assert.equal(results.filter(Boolean).length, 1);
      // Every client uses the same prefix; kill storage connections, then reconnect from the same Store objects.
      await inspector.clientKill({ filter: 'SKIPME', skipMe: true });
      await new Promise((resolve) => setTimeout(resolve, 30));
      await store.put(id, { reconnected: true }, 30);
      assert.deepEqual(await store.get(id), { reconnected: true });
      await store.delete(id);
      assert.equal(await store.get(id), undefined);
    } finally {
      await inspector.del([prefix + id, prefix + id + '-copy']);
      store.close?.();
      other.close?.();
      inspector.destroy();
    }
  },
);

test('Upstash HTTPS contract encrypts records and consumes them atomically without TCP', async () => {
  const { upstashStore } = await import('../src/store.js');
  const values = new Map<string, string>();
  const commands: unknown[][] = [];
  const store = upstashStore(
    'https://redis.example',
    'rest-secret',
    randomBytes(32).toString('base64'),
    async (url, init) => {
      assert.equal(String(url), 'https://redis.example/');
      assert.equal(init?.redirect, 'error');
      assert.ok(init?.signal);
      assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer rest-secret');
      const args = JSON.parse(init?.body as string) as (string | number)[];
      commands.push(args);
      const [cmd, key, value] = args;
      if (cmd === 'SET') {
        assert.equal(args[3], 'EX');
        assert.equal(args[4], 300);
        assert.ok(!String(value).includes('upstream-private'));
        values.set(String(key), String(value));
        return Response.json({ result: 'OK' });
      }
      const result = values.get(String(key)) ?? null;
      if (cmd === 'GETDEL' || cmd === 'DEL') values.delete(String(key));
      return Response.json({ result });
    },
  );
  await store.put('state:test', { token: 'upstream-private' }, 300);
  assert.deepEqual(await store.get('state:test'), { token: 'upstream-private' });
  const results = await Promise.all([store.take('state:test'), store.take('state:test')]);
  assert.equal(results.filter(Boolean).length, 1);
  assert.equal(commands.filter((a) => a[0] === 'GETDEL').length, 2);
});
test('Upstash fails closed and does not expose storage errors', async () => {
  const { upstashStore } = await import('../src/store.js');
  const key = randomBytes(32).toString('base64');
  assert.throws(() => upstashStore('http://redis.example', 'secret', key), /HTTPS/);
  const store = upstashStore('https://redis.example', 'secret', key, async () =>
    Response.json({ error: 'secret-revealing error' }),
  );
  await assert.rejects(
    store.get('x'),
    (e) => e instanceof Error && !e.message.includes('secret-revealing'),
  );
});
