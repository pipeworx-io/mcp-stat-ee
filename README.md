# mcp-stat-ee

Statistics Estonia (andmed.stat.ee) PxWeb MCP. Keyless.

Part of [Pipeworx](https://pipeworx.io) — an MCP gateway connecting AI agents to 1394+ live data sources.

## Tools

| Tool | Description |
|------|-------------|
| `stat_ee_find_table` | Search Statistics Estonia (Statistikaamet) for ESTONIA official statistics tables by plain-English keyword — "average monthly wage", "population", "GDP", "unemployment", "consumer price index", "births", "exports". Returns each matching table with its full ready-to-use path, its English label chain (e.g. "Economy > Wages and salaries and labour costs > Wages and salaries"), and whether it is a folder or a table. START HERE for any question about Estonian data: hand the returned path straight to table_meta, then query_table, to get the figures. Searches English labels, so English words find the table even though the path ids themselves are Estonian slugs. |
| `subjects` | Browse Statistics Estonia (Statistikaamet) official ESTONIA national statistics — the subject tree of available tables, one level at a time. Items are type "l" (folder) or "t" (table, id ends in .px). Handy for listing everything under a path you already know; to go straight from an English question ("average monthly wage in Estonia") to a table path in one call, use stat_ee_find_table. Follow either with table_meta + query_table to pull the actual figures. |
| `table_meta` | Table definition (dimensions, valid values) for a Statistics Estonia table. Use these to build a filtered query_table call. |
| `query_table` | Pull ESTONIA official statistics figures from a Statistics Estonia (Statistikaamet) table — wages, population, GDP, prices, unemployment. body is a PxWeb query object; get valid dimension values from table_meta first. Filter selections to stay under the ~100k-cell limit. |

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

Or connect to the full Pipeworx gateway for access to all 1394+ data sources:

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

- [Docs and guides](https://pipeworx.io/docs)
- [pipeworx.io](https://pipeworx.io)

## License

MIT
