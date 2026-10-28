import { writeFile } from 'node:fs/promises';
const source = 'https://docs.wynncraft.com/openapi.json';
const response = await fetch(source);
if (!response.ok) throw new Error(`Spec download failed: ${response.status}`);
const spec = await response.json();
function resolve(schema) {
  if (!schema || typeof schema !== 'object') return schema;
  if (Array.isArray(schema)) return schema.map(resolve);
  if (schema.$ref) {
    if (!schema.$ref.startsWith('#/components/schemas/'))
      throw new Error('External schema reference');
    const target = spec.components.schemas[schema.$ref.split('/').at(-1)];
    if (!target) throw new Error('Missing schema');
    const { $ref, ...rest } = schema;
    return resolve({ ...target, ...rest });
  }
  return Object.fromEntries(
    Object.entries(schema)
      .filter(([k]) => !['title', 'format'].includes(k))
      .map(([k, v]) => [k, resolve(v)]),
  );
}
const operations = [];
for (const [path, methods] of Object.entries(spec.paths)) {
  for (const [method, operation] of Object.entries(methods)) {
    if (path === '/oauth/token') continue; // Credentials never become model-visible tool arguments/results.
    if (!['get', 'post'].includes(method)) throw new Error(`Unexpected method: ${method}`);
    const parameters = (operation.parameters ?? []).map((p) => ({
      ...p,
      schema: resolve(p.schema),
    }));
    for (const p of parameters) {
      if (['fullResult', 'full_result', 'static'].includes(p.name)) p.schema = { type: 'boolean' };
      if (p.in === 'path')
        p.schema = {
          ...p.schema,
          minLength: 1,
          maxLength: 256,
          pattern: '^(?!\\.{1,2}$)[^/\\\\?#\\u0000-\\u001f]+$',
        };
    }
    const properties = Object.fromEntries(
      parameters.map((p) => [
        p.name,
        { ...p.schema, ...(p.description ? { description: p.description } : {}) },
      ]),
    );
    const body = operation.requestBody?.content?.['application/json']?.schema;
    if (body) properties.body = { ...resolve(body), additionalProperties: false };
    properties.view = {
      type: 'object',
      additionalProperties: false,
      description:
        'Optional response projection. JSON Pointer selects a subtree; offset/limit slice arrays or object entries. Use for large databases. Does not alter upstream pagination.',
      properties: {
        pointer: { type: 'string', maxLength: 1024 },
        offset: { type: 'integer', minimum: 0 },
        limit: { type: 'integer', minimum: 1, maximum: 1000 },
      },
    };
    operations.push({
      name: `wynncraft_${operation.operationId}`,
      path,
      method: method.toUpperCase(),
      summary: operation.summary,
      parameters,
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties,
        required: parameters.filter((p) => p.required).map((p) => p.name),
      },
    });
  }
}
await writeFile(
  new URL('../src/operations.json', import.meta.url),
  JSON.stringify(operations, null, 2) + '\n',
);
await writeFile(
  new URL('../docs/api-coverage.md', import.meta.url),
  `# API coverage\n\nGenerated from [Wynncraft OpenAPI](${source}). Run \`npm run api:update\` to refresh.\n\n${operations.length} data operations. OAuth token exchange is provided by the local PKCE helper instead of an MCP tool.\n\n| Tool | Method | Path |\n| --- | --- | --- |\n${operations.map((o) => `| \`${o.name}\` | ${o.method} | \`${o.path}\` |`).join('\n')}\n`,
);
console.log(`Generated ${operations.length} operations.`);
