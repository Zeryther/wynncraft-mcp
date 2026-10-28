import operations from './operations.json' with { type: 'json' };

export { operations };
export type Operation = (typeof operations)[number];
export type Fetch = typeof globalThis.fetch;
export const API_BASE = 'https://api.wynncraft.com/v3';
const MAX_BODY_BYTES = 8 * 1024 * 1024;

/** Reads a bounded body, including when Content-Length is absent or misleading. */
export async function readJson(response: Response): Promise<unknown> {
  if (!response.body) throw new Error('Empty upstream response');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES)
        throw new Error(
          'Upstream response exceeds 8 MiB. Use a paginated or more specific endpoint.',
        );
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
}

export function buildUrl(operation: Operation, args: Record<string, unknown>): URL {
  let path = operation.path;
  const query: string[] = [];
  for (const p of operation.parameters) {
    const value = args[p.name];
    if (value === undefined) continue;
    if (p.in === 'path') {
      const segment = String(value);
      if (!segment || segment === '.' || segment === '..' || /[/\\?#\u0000-\u001f]/u.test(segment))
        throw new Error('Invalid path segment');
      path = path.replace(`{${p.name}}`, encodeURIComponent(segment));
    } else if (['fullResult', 'full_result', 'static'].includes(p.name)) {
      if (value === true) query.push(p.name); // Wynncraft flags must be bare, never =true.
    } else query.push(`${encodeURIComponent(p.name)}=${encodeURIComponent(String(value))}`);
  }
  return new URL(`${API_BASE}${path}${query.length ? `?${query.join('&')}` : ''}`);
}

export async function requestApi(
  operation: Operation,
  args: Record<string, unknown>,
  options: { token?: string; fetch?: Fetch; signal?: AbortSignal } = {},
) {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'User-Agent': 'wynncraft-mcp/0.1.0',
  };
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  const body = args.body === undefined ? undefined : JSON.stringify(args.body);
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const timeout = AbortSignal.timeout(20_000);
  const response = await (options.fetch ?? fetch)(buildUrl(operation, args), {
    method: operation.method,
    headers,
    redirect: 'manual',
    signal: options.signal ? AbortSignal.any([timeout, options.signal]) : timeout,
    ...(body === undefined ? {} : { body }),
  });
  // Only safe metadata is surfaced, never upstream headers such as UserID or auth values.
  const metadata = Object.fromEntries(
    [
      'cache-control',
      'cache-source',
      'ratelimit-bucket',
      'ratelimit-limit',
      'ratelimit-remaining',
      'ratelimit-reset',
      'retry-after',
      'version',
    ].flatMap((k) => {
      const v = response.headers.get(k);
      return v === null ? [] : [[k, v]];
    }),
  );
  const data = await readJson(response);
  return { status: response.status, ok: response.ok, metadata, data };
}

export function project(
  data: unknown,
  view: { pointer?: string; offset?: number; limit?: number } = {},
) {
  let selected = data;
  if (view.pointer) {
    if (!view.pointer.startsWith('/') || /~(?![01])/u.test(view.pointer))
      throw new Error('Use a valid RFC 6901 JSON Pointer');
    for (const raw of view.pointer.slice(1).split('/')) {
      const key = raw.replace(/~1/g, '/').replace(/~0/g, '~');
      if (selected === null || typeof selected !== 'object' || !Object.hasOwn(selected, key))
        throw new Error('JSON Pointer does not exist');
      selected = (selected as Record<string, unknown>)[key];
    }
  }
  if (view.offset === undefined && view.limit === undefined) return { data: selected };
  if (selected === null || typeof selected !== 'object')
    throw new Error('Slicing requires an array or object');
  const offset = view.offset ?? 0;
  const limit = view.limit ?? 100;
  const entries = Array.isArray(selected) ? selected : Object.entries(selected);
  const slice = entries.slice(offset, offset + limit);
  return {
    data: Array.isArray(selected) ? slice : Object.fromEntries(slice as [string, unknown][]),
    projection: {
      total: entries.length,
      offset,
      limit,
      nextOffset: offset + limit < entries.length ? offset + limit : null,
    },
  };
}
