import operations from './wynnventory-operations.json' with { type: 'json' };
import { readJson, type Fetch } from './api.js';

export { operations as wynnventoryOperations };
export type WynnventoryOperation = (typeof operations)[number];
// Use the verified canonical API origin directly; never follow redirects with the API key.
export const WYNNVENTORY_BASE = 'https://www.wynnventory.com/api/v2';

export function buildWynnventoryUrl(
  operation: WynnventoryOperation,
  args: Record<string, unknown>,
) {
  let path = operation.path;
  const query = new URLSearchParams();
  for (const parameter of operation.parameters) {
    const value = args[parameter.name];
    if (value === undefined) continue;
    if (parameter.in === 'path') {
      const segment = String(value);
      if (/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(segment))
        throw new Error('Invalid path segment: use well-formed Unicode');
      if (!segment || segment === '.' || segment === '..' || /[/\\?#\u0000-\u001f]/u.test(segment))
        throw new Error('Invalid path segment');
      path = path.replace(`{${parameter.name}}`, encodeURIComponent(segment));
    } else if (parameter.in === 'query') query.set(parameter.name, String(value));
    else throw new Error('Unsupported Wynnventory parameter location');
  }
  const url = new URL(WYNNVENTORY_BASE + path);
  url.search = query.toString();
  return url;
}

export async function requestWynnventory(
  operation: WynnventoryOperation,
  args: Record<string, unknown>,
  options: { apiKey: string; fetch?: Fetch; signal?: AbortSignal },
) {
  const timeout = AbortSignal.timeout(20_000);
  const response = await (options.fetch ?? fetch)(buildWynnventoryUrl(operation, args), {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      'X-API-Key': options.apiKey,
      'User-Agent': 'wynncraft-mcp/0.1.0 (+https://github.com/Zeryther/wynncraft-mcp)',
    },
    redirect: 'error',
    signal: options.signal ? AbortSignal.any([timeout, options.signal]) : timeout,
  });
  const data = await readJson(response);
  const metadata = Object.fromEntries(
    [
      'cache-control',
      'last-modified',
      'retry-after',
      'ratelimit-limit',
      'ratelimit-remaining',
      'ratelimit-reset',
      'x-ratelimit-limit',
      'x-ratelimit-remaining',
      'x-ratelimit-reset',
    ].flatMap((name) => {
      const value = response.headers.get(name);
      return value === null ? [] : [[name, value]];
    }),
  );
  return {
    status: response.status,
    ok: response.ok,
    metadata,
    data,
    source: {
      name: 'Wynnventory',
      url: 'https://www.wynnventory.com',
      apiVersion: 'v2',
      retrievedAt: new Date().toISOString(),
      ...(operation.path.startsWith('/market')
        ? {
            currency: 'emeralds',
            notice:
              'Crowdsourced observations of asking prices, not confirmed completed sales. Coverage may be incomplete or stale; inspect upstream timestamps and sample counts.',
          }
        : {
            notice:
              'Third-party Wynnventory data; reward pools reflect community observations and may be incomplete or stale.',
          }),
    },
  };
}
