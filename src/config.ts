import type { OAuthConfig } from './oauth.js';
export type Config = {
  host: string;
  port: number;
  publicUrl: string;
  origins: string[];
  apiKey?: string;
  token?: string;
  wynnventoryApiKey?: string;
  oauth?: OAuthConfig & {
    redisUrl?: string;
    upstash?: { url: string; token: string };
    encryptionKey: string;
  };
  trustProxyHops?: number;
};
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const port = Number(env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be 1–65535');
  const publicUrl = env.PUBLIC_URL || env.GIGADRIVE_URL || `http://localhost:${port}`;
  const url = new URL(publicUrl);
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash)
    throw new Error('PUBLIC_URL must be an origin URL');
  if (
    url.protocol !== 'https:' &&
    !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
  )
    throw new Error('PUBLIC_URL must use HTTPS except on loopback');
  // Gigadrive normalizes X-Forwarded-For to one CDN-resolved client address.
  // Detect the deployment through its system environment, never through request headers.
  const trustProxySetting = env.TRUST_PROXY_HOPS ?? (env.GIGADRIVE_URL ? '1' : '0');
  if (!/^[0-5]$/.test(trustProxySetting)) throw new Error('TRUST_PROXY_HOPS must be 0–5');
  const trustProxyHops = Number(trustProxySetting);
  const apiKey = env.MCP_API_KEY;
  if (apiKey && apiKey.length < 32) throw new Error('MCP_API_KEY must be at least 32 characters');
  const token = env.WYNNCRAFT_API_TOKEN;
  const config: Config = {
    trustProxyHops,
    host: env.HOST ?? '127.0.0.1',
    port,
    publicUrl: url.origin,
    origins: (env.ALLOWED_ORIGINS ?? url.origin).split(',').map((s) => {
      const origin = new URL(s.trim());
      if (
        origin.username ||
        origin.password ||
        origin.pathname !== '/' ||
        origin.search ||
        origin.hash ||
        (origin.protocol !== 'https:' &&
          !(
            origin.protocol === 'http:' &&
            ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname)
          ))
      )
        throw new Error('ALLOWED_ORIGINS must contain HTTPS origins or HTTP loopback origins');
      return origin.origin;
    }),
    ...(apiKey ? { apiKey } : {}),
    ...(token ? { token } : {}),
    ...(env.WYNNVENTORY_API_KEY?.trim()
      ? { wynnventoryApiKey: env.WYNNVENTORY_API_KEY.trim() }
      : {}),
  };
  if (env.WYNNCRAFT_OAUTH_CLIENT_ID) {
    if (url.protocol !== 'https:')
      throw new Error(
        'Hosted OAuth requires HTTPS (including local testing through an HTTPS tunnel)',
      );
    if (token || apiKey)
      throw new Error(
        'Hosted OAuth cannot be combined with shared Wynncraft tokens or MCP_API_KEY',
      );
    for (const key of ['OAUTH_ENCRYPTION_KEY'])
      if (!env[key]) throw new Error(`${key} is required for hosted OAuth`);
    config.oauth = {
      publicUrl: url.origin,
      clientId: env.WYNNCRAFT_OAUTH_CLIENT_ID,
      ...(env.REDIS_URL ? { redisUrl: env.REDIS_URL } : {}),
      ...(env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN
        ? { upstash: { url: env.UPSTASH_REDIS_REST_URL, token: env.UPSTASH_REDIS_REST_TOKEN } }
        : {}),
      encryptionKey: env.OAUTH_ENCRYPTION_KEY!,
      scopes: (
        env.WYNNCRAFT_OAUTH_SCOPES ??
        'identify main_access character_list_access character_data_access character_build_access online_status'
      )
        .split(' ')
        .filter(Boolean),
      ...(env.WYNNCRAFT_OAUTH_CLIENT_SECRET
        ? { clientSecret: env.WYNNCRAFT_OAUTH_CLIENT_SECRET }
        : {}),
    };
    if (!config.oauth.upstash && !config.oauth.redisUrl)
      throw new Error(
        'Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN (or REDIS_URL) for hosted OAuth',
      );
    if (config.oauth.upstash && config.oauth.redisUrl)
      throw new Error('Choose Upstash REST or REDIS_URL, not both');
    if (!config.oauth.scopes.includes('identify'))
      throw new Error('OAuth scopes must include identify');
  } else if (token && !apiKey && env.WYNNCRAFT_TOKEN_PUBLIC_MODE !== 'true') {
    throw new Error(
      'A shared Wynncraft token requires MCP_API_KEY, or explicit WYNNCRAFT_TOKEN_PUBLIC_MODE=true after enabling Public Mode in Wynncraft',
    );
  }
  if (config.wynnventoryApiKey && !config.apiKey && !config.oauth)
    throw new Error(
      'WYNNVENTORY_API_KEY requires hosted OAuth or MCP_API_KEY to protect the application quota',
    );
  return config;
}
