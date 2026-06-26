interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

interface McpToolExport {
  tools: McpToolDefinition[];
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  meter?: { credits: number };
  cost?: Record<string, unknown>;
  provider?: string;
}

/**
 * Statistics Estonia (andmed.stat.ee) PxWeb MCP. Keyless.
 *
 * PxWeb API: navigate the subject tree (items are type "l" = folder or "t" = table),
 * fetch table metadata, then POST a query to pull data.
 *
 * Table codes carry a ".px" suffix (the API serves them uppercase, e.g. "RV021.PX",
 * but the suffix is case-insensitive). The table id returned by the tree already
 * includes the suffix, so a full table path looks like
 *   rahvastik/rahvastikunaitajad-ja-koosseis/rahvaarv-ja-rahvastiku-koosseis/RV021.PX
 *
 * PxWeb enforces a per-query cell limit (~100k cells). Large tables (many years ×
 * age groups × counties) will be rejected unless you filter — use table_meta to read
 * the variables and pass a narrow {filter:"item", values:[...]} selection per dimension.
 */


const BASE = 'https://andmed.stat.ee/api/v1/en/stat';
const UA = 'pipeworx-mcp-stat-ee/1.0 (+https://pipeworx.io)';

const tools: McpToolExport['tools'] = [
  {
    name: 'subjects',
    description: 'Navigate the subject tree. Items are type "l" (folder) or "t" (table, id ends in .px).',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Sub-path under /stat/ (default empty = root). e.g. "rahvastik/rahvastikunaitajad-ja-koosseis"' } },
    },
  },
  {
    name: 'table_meta',
    description: 'Table definition (dimensions, valid values). Use these to build a filtered query_table call.',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string', description: 'e.g. "rahvastik/rahvastikunaitajad-ja-koosseis/rahvaarv-ja-rahvastiku-koosseis/RV021.PX"' } },
      required: ['path'],
    },
  },
  {
    name: 'query_table',
    description: 'Pull data from a table. body is a PxWeb query object. Filter selections to stay under the ~100k-cell limit.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Table path ending in .px, e.g. ".../RV021.PX"' },
        body: { type: 'object', description: '{query: [{code, selection: {filter, values}}], response: {format: "json-stat2"}}' },
      },
      required: ['path', 'body'],
    },
  },
];

async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case 'subjects': {
      const path = (args.path as string | undefined)?.replace(/^\/+|\/+$/g, '') ?? '';
      return statGet(path ? `/${path}` : '');
    }
    case 'table_meta':
      return statGet(`/${reqStr(args, 'path', '"rahvastik/rahvastikunaitajad-ja-koosseis/rahvaarv-ja-rahvastiku-koosseis/RV021.PX"').replace(/^\/+|\/+$/g, '')}`);
    case 'query_table': {
      const path = reqStr(args, 'path', '"rahvastik/rahvastikunaitajad-ja-koosseis/rahvaarv-ja-rahvastiku-koosseis/RV021.PX"').replace(/^\/+|\/+$/g, '');
      const body = args.body;
      if (!body || typeof body !== 'object') throw new Error('body must be a PxWeb query object.');
      const res = await fetch(`${BASE}/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': UA },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`Statistics Estonia: ${res.status} ${await res.text().then((t) => t.slice(0, 200))}`);
      return res.json();
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

async function statGet(path: string): Promise<unknown> {
  // No trailing slash on the bare base — andmed.stat.ee 302-redirects "/stat/" to "/stat".
  const res = await fetch(`${BASE}${path}`, { headers: { Accept: 'application/json', 'User-Agent': UA } });
  if (!res.ok) throw new Error(`Statistics Estonia: ${res.status} ${await res.text().then((t) => t.slice(0, 200))}`);
  return res.json();
}

function reqStr(args: Record<string, unknown>, key: string, example: string): string {
  const v = args[key];
  if (typeof v !== 'string' || !v.trim()) throw new Error(`Required argument "${key}" is missing. Pass a string like ${example}.`);
  return v;
}

export default { tools, callTool, meter: { credits: 1 } } satisfies McpToolExport;
