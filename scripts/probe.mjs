import assert from 'node:assert/strict';
const origin = new URL(process.argv[2] ?? 'https://wynncraft-mcp.gigadrive.app').origin;
const report = [];
async function probe(name, path, init, validate) {
  try {
    const response = await fetch(new URL(path, origin), {
      ...init,
      redirect: 'manual',
      signal: AbortSignal.timeout(15000),
    });
    const text = await response.text();
    const body = response.headers.get('content-type')?.includes('application/json')
      ? JSON.parse(text)
      : text;
    validate(response, body);
    report.push({ name, pass: true, status: response.status });
  } catch (e) {
    report.push({ name, pass: false, error: e.message });
  }
}
await probe('resource metadata', '/.well-known/oauth-protected-resource/mcp', {}, (r, b) => {
  assert.equal(r.status, 200);
  assert.equal(b.resource, origin + '/mcp');
});
await probe('authorization metadata', '/.well-known/oauth-authorization-server', {}, (r, b) => {
  assert.equal(r.status, 200);
  assert.ok(b.code_challenge_methods_supported.includes('S256'));
  assert.deepEqual(b.grant_types_supported, ['authorization_code']);
  assert.equal(b.authorization_response_iss_parameter_supported, true);
});
await probe(
  'initialize authentication challenge',
  '/mcp',
  {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-11-25',
        capabilities: {},
        clientInfo: { name: 'probe', version: '1' },
      },
    }),
  },
  (r) => {
    assert.equal(r.status, 401);
    assert.match(r.headers.get('www-authenticate'), /resource_metadata/);
    assert.equal(r.headers.get('mcp-session-id'), null);
  },
);
await probe(
  'invalid bearer rejected',
  '/mcp',
  {
    method: 'POST',
    headers: {
      Authorization: 'Bearer deliberately-invalid-probe-token',
      'Content-Type': 'application/json',
    },
    body: '{}',
  },
  (r) => assert.equal(r.status, 401),
);
await probe(
  'untrusted Origin rejected',
  '/mcp',
  {
    method: 'POST',
    headers: { Origin: 'https://untrusted.example', 'Content-Type': 'application/json' },
    body: '{}',
  },
  (r) => assert.equal(r.status, 403),
);
await probe(
  'opaque Origin rejected',
  '/mcp',
  { method: 'POST', headers: { Origin: 'null', 'Content-Type': 'application/json' }, body: '{}' },
  (r) => assert.equal(r.status, 403),
);
await probe(
  'valid CORS preflight',
  '/mcp',
  {
    method: 'OPTIONS',
    headers: {
      Origin: origin,
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'authorization,content-type,mcp-protocol-version',
    },
  },
  (r) => {
    assert.equal(r.status, 204);
    assert.equal(r.headers.get('access-control-allow-origin'), origin);
  },
);
await probe(
  'untrusted CORS preflight',
  '/mcp',
  {
    method: 'OPTIONS',
    headers: { Origin: 'https://untrusted.example', 'Access-Control-Request-Method': 'POST' },
  },
  (r) => assert.equal(r.status, 403),
);
await probe(
  'unknown callback state rejected',
  '/oauth/callback?state=invalid-probe-state&code=invalid-probe-code',
  {},
  (r) => assert.equal(r.status, 400),
);
await probe(
  'consent CSRF rejected',
  '/oauth/consent',
  {
    method: 'POST',
    headers: {
      Origin: 'https://untrusted.example',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'consent=invalid&decision=allow',
  },
  (r) => assert.equal(r.status, 403),
);
await probe(
  'unsafe client registration rejected',
  '/register',
  {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_name: 'Rejected probe',
      redirect_uris: ['http://untrusted.example/callback'],
      token_endpoint_auth_method: 'none',
    }),
  },
  (r) => assert.equal(r.status, 400),
);
await probe('public metadata cache policy', '/.well-known/oauth-authorization-server', {}, (r) =>
  assert.match(r.headers.get('cache-control'), /public.*s-maxage=300/),
);
console.log(
  JSON.stringify(
    {
      endpoint: origin + '/mcp',
      checkedAt: new Date().toISOString(),
      results: report,
      authenticatedTesting: 'Skipped at user request',
      pass: report.every((r) => r.pass),
    },
    null,
    2,
  ),
);
if (report.some((r) => !r.pass)) process.exitCode = 1;
