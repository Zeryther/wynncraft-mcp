import { writeFile } from 'node:fs/promises';
import { parse } from 'yaml';

const source =
  'https://raw.githubusercontent.com/Wynnventory/WynnVentory_Web/main/docs/openapi_v2.yaml';
const response = await fetch(source);
if (!response.ok) throw new Error(`Wynnventory specification download failed: ${response.status}`);
const spec = parse(await response.text());
function resolve(value) {
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(resolve);
  if (value.$ref) {
    if (!value.$ref.startsWith('#/components/'))
      throw new Error('External reference not supported');
    const target = value.$ref
      .slice(2)
      .split('/')
      .reduce((item, key) => item?.[key], spec);
    if (!target) throw new Error('Unresolved specification reference');
    const { $ref, ...rest } = value;
    return resolve({ ...target, ...rest });
  }
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, resolve(item)]));
}
const operations = [];
for (const [path, methods] of Object.entries(spec.paths)) {
  // Official Wynncraft tools already cover item/aspect proxies. Only add unique data.
  if (path.startsWith('/items') || path.startsWith('/aspects')) continue;
  const operation = methods.get;
  if (!operation)
    throw new Error(`Only documented read-only GET operations are supported: ${path}`);
  const parameters = (operation.parameters ?? []).map((parameter) => resolve(parameter));
  for (const parameter of parameters) {
    if (['shiny', 'unidentified'].includes(parameter.name)) parameter.schema = { type: 'boolean' };
    if (parameter.schema.type === 'string') parameter.schema.maxLength = 256;
    if (parameter.in === 'path' && parameter.schema.type === 'string')
      Object.assign(parameter.schema, {
        minLength: 1,
        pattern: '^(?!\\.{1,2}$)[^/\\\\?#\\u0000-\\u001f]+$',
      });
  }
  const properties = Object.fromEntries(
    parameters.map((parameter) => [
      parameter.name,
      {
        ...parameter.schema,
        ...(parameter.description ? { description: parameter.description } : {}),
      },
    ]),
  );
  properties.view = {
    type: 'object',
    additionalProperties: false,
    description:
      'Optional JSON Pointer projection and local array/object slicing. The raw v2 envelope is retained, so /data selects the upstream data. Use page/page_size for upstream pagination.',
    properties: {
      pointer: { type: 'string', maxLength: 1024 },
      offset: { type: 'integer', minimum: 0 },
      limit: { type: 'integer', minimum: 1, maximum: 1000 },
    },
  };
  operations.push({
    name: `wynnventory_${operation.operationId}`,
    path,
    method: 'GET',
    summary: operation.summary,
    parameters,
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties,
      required: parameters
        .filter((parameter) => parameter.required)
        .map((parameter) => parameter.name),
    },
  });
}
await writeFile(
  new URL('../src/wynnventory-operations.json', import.meta.url),
  JSON.stringify(operations, null, 2) + '\n',
);
await writeFile(
  new URL('../docs/wynnventory-coverage.md', import.meta.url),
  `# Wynnventory tool coverage\n\nGenerated from the [official v2 specification](${source}) using \`npm run wynnventory:update\`. All ${operations.length} optional operations are read-only GET requests; duplicate official-Wynncraft item/aspect proxy routes are omitted.\n\n| Tool | Route |\n| --- | --- |\n${operations.map((operation) => `| \`${operation.name}\` | \`${operation.path}\` |`).join('\n')}\n`,
);
console.log(`Generated ${operations.length} optional Wynnventory tools.`);
