import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer } from '../src/mcp.js';
import { buildUrl, operations } from '../src/api.js';

function example(schema: Record<string, unknown>): unknown {
  if (Array.isArray(schema.enum)) return schema.enum[0];
  if (Array.isArray(schema.oneOf)) return example(schema.oneOf[0] as Record<string, unknown>);
  if (schema.type === 'integer' || schema.type === 'number') return schema.minimum ?? 1;
  if (schema.type === 'boolean') return true;
  return 'example';
}

test('a real MCP client invokes all 40 tools with validated schemas and exact upstream routing', async () => {
  let current = operations[0]!;
  let args: Record<string, unknown> = {};
  let calls = 0;
  const server = createMcpServer({
    token: 'test-token',
    fetch: async (url, init) => {
      calls++;
      assert.equal(String(url), buildUrl(current, args).href);
      assert.equal(init?.method, current.method);
      assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer test-token');
      if (current.method === 'POST') assert.deepEqual(JSON.parse(String(init?.body)), args.body);
      return Response.json({ operation: current.name });
    },
  });
  const client = new Client({ name: 'catalog-probe', version: '1' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  try {
    await client.connect(clientTransport);
    const catalog = await client.listTools();
    assert.equal(catalog.tools.length, operations.length);
    const info = client.getServerVersion()!;
    assert.equal(info.title, 'Wynncraft MCP');
    assert.ok(info.description);
    assert.ok(info.icons?.length);
    assert.ok(
      catalog.tools.every((tool) => tool.outputSchema && tool.annotations?.readOnlyHint === true),
    );
    await assert.rejects(
      client.callTool({ name: 'nonexistent_tool', arguments: {} }),
      (error) => error instanceof Error && error.message.includes('Unknown tool'),
    );
    for (const operation of operations) {
      current = operation;
      args = Object.fromEntries(
        operation.parameters.map((parameter) => [
          parameter.name,
          example(parameter.schema as Record<string, unknown>),
        ]),
      );
      if (operation.method === 'POST') args.body = { query: 'example' };
      const result = await client.callTool({ name: operation.name, arguments: args });
      assert.equal(
        result.isError,
        undefined,
        JSON.stringify({ name: operation.name, content: result.content }),
      );
      assert.deepEqual((result.structuredContent as { data: unknown }).data, {
        operation: operation.name,
      });
    }
    assert.equal(calls, 40);
  } finally {
    await client.close();
    await server.close();
  }
});
