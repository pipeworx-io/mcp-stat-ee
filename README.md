# mcp-stat-ee

Statistics Estonia (andmed.stat.ee) PxWeb MCP. Keyless.

Part of [Pipeworx](https://pipeworx.io) — an MCP gateway connecting AI agents to 965+ live data sources.

## Tools

| Tool | Description |
|------|-------------|
| `subjects` | Navigate the subject tree. Items are type "l" (folder) or "t" (table, id ends in .px). |
| `table_meta` | Table definition (dimensions, valid values). Use these to build a filtered query_table call. |
| `query_table` | Pull data from a table. body is a PxWeb query object. Filter selections to stay under the ~100k-cell limit. |

## Quick Start

Add to your MCP client (Claude Desktop, Cursor, Windsurf, etc.):

```json
{
  "mcpServers": {
    "stat-ee": {
      "url": "https://gateway.pipeworx.io/stat-ee/mcp"
    }
  }
}
```

Or connect to the full Pipeworx gateway for access to all 965+ data sources:

```json
{
  "mcpServers": {
    "pipeworx": {
      "url": "https://gateway.pipeworx.io/mcp"
    }
  }
}
```

## Using with ask_pipeworx

Instead of calling tools directly, you can ask questions in plain English:

```
ask_pipeworx({ question: "your question about Stat Ee data" })
```

The gateway picks the right tool and fills the arguments automatically.

## More

- [All tools and guides](https://github.com/pipeworx-io/examples)
- [pipeworx.io](https://pipeworx.io)

## License

MIT
