import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto';
import { createClient } from 'redis';
import { readJson, type Fetch } from './api.js';

/** Shared, TTL-bound OAuth storage. All values are encrypted before storage. */
export interface Store {
  get<T>(key: string): Promise<T | undefined>;
  take<T>(key: string): Promise<T | undefined>;
  put(key: string, value: unknown, ttlSeconds: number): Promise<void>;
  delete(key: string): Promise<void>;
  close?(): void;
}
export const opaque = () => randomBytes(32).toString('base64url');
export const digest = (value: string) => createHash('sha256').update(value).digest('base64url');
type Command = (args: (string | number)[]) => Promise<unknown>;

/** Upstash REST uses ordinary HTTPS; no TCP connection or local Redis service. */
export function upstashStore(
  restUrl: string,
  token: string,
  encryptionKey: string,
  fetcher: Fetch = fetch,
): Store {
  const url = new URL(restUrl);
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/'
  )
    throw new Error('UPSTASH_REDIS_REST_URL must be an HTTPS origin');
  const command: Command = async (args) => {
    const response = await fetcher(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
      signal: AbortSignal.timeout(3000),
      redirect: 'error',
    });
    if (!response.ok) throw new Error('OAuth storage unavailable');
    const value = (await readJson(response)) as { result?: unknown; error?: unknown };
    if (!value || typeof value !== 'object' || !Object.hasOwn(value, 'result') || value.error)
      throw new Error('OAuth storage command failed');
    return value.result;
  };
  return encryptCommands(command, encryptionKey);
}

/** Optional direct Redis backend, also used in integration tests. Requires Redis 6.2+. */
export function encryptedStore(redisUrl: string, encryptionKey: string): Store {
  const client = createClient({
    url: redisUrl,
    disableOfflineQueue: true,
    socket: { reconnectStrategy: false, connectTimeout: 3000 },
  });
  client.on('error', () => undefined); // Errors can contain connection credentials; never log them.
  let connecting: Promise<unknown> | undefined;
  const command: Command = async (args) => {
    if (!client.isOpen)
      connecting ??= client.connect().finally(() => {
        connecting = undefined;
      });
    await connecting;
    return client.sendCommand(args.map(String), { abortSignal: AbortSignal.timeout(2000) });
  };
  const store = encryptCommands(command, encryptionKey);
  return {
    ...store,
    close() {
      if (client.isOpen) client.destroy();
    },
  };
}

function encryptCommands(command: Command, encryptionKey: string): Store {
  const key = Buffer.from(encryptionKey, 'base64');
  if (key.length !== 32) throw new Error('OAUTH_ENCRYPTION_KEY must be 32 random bytes in base64');
  function seal(value: unknown, id: string) {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: 16 });
    cipher.setAAD(Buffer.from(id));
    const encrypted = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64');
  }
  function open<T>(value: unknown, id: string): T | undefined {
    if (value === null) return undefined;
    if (typeof value !== 'string') throw new Error('Invalid OAuth storage response');
    const buffer = Buffer.from(value, 'base64');
    if (buffer.length < 29) throw new Error('Invalid encrypted OAuth record');
    const decipher = createDecipheriv('aes-256-gcm', key, buffer.subarray(0, 12), {
      authTagLength: 16,
    });
    decipher.setAAD(Buffer.from(id));
    decipher.setAuthTag(buffer.subarray(12, 28));
    return JSON.parse(
      Buffer.concat([decipher.update(buffer.subarray(28)), decipher.final()]).toString('utf8'),
    ) as T;
  }
  const prefix = 'wynncraft-mcp:v1:';
  return {
    async get<T>(id: string) {
      return open<T>(await command(['GET', prefix + id]), id);
    },
    async take<T>(id: string) {
      return open<T>(await command(['GETDEL', prefix + id]), id);
    },
    async put(id, value, ttl) {
      await command(['SET', prefix + id, seal(value, id), 'EX', ttl]);
    },
    async delete(id) {
      await command(['DEL', prefix + id]);
    },
  };
}
