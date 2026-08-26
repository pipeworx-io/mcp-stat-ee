# mcp-stat-ee

Statistics Estonia (andmed.stat.ee) PxWeb MCP. Keyless.

Part of [Pipeworx](https://pipeworx.io) — an MCP gateway connecting AI agents to 1476+ live data sources.

## Tools

| Tool | Description |
|------|-------------|
| `stat_ee_find_table` | Search Statistics Estonia (Statistikaamet) for ESTONIA official statistics tables by plain-English keyword — "average monthly wage", "population", "GDP", "unemployment", "consumer price index", "births", "exports". Returns each matching table with its full ready-to-use path, its English label chain (e.g. "Economy > Wages and salaries and labour costs > Wages and salaries"), and whether it is a folder or a table. START HERE for any question about Estonian data. Set fetch_latest:true to also return the most recent figures from the top-matching table in one call — useful for "what is the current X in Estonia" questions. Otherwise hand the returned path to table_meta, then query_table, to get the figures. Searches English labels, so English words find the table even though the path ids themselves are Estonian slugs. |
| `estonia_average_wage` | Estonia's average and MEDIAN monthly gross wage in ONE call, from Statistics Estonia (Statistikaamet, table PA111), keyless, with the recent quarterly trend. PREFER for "what is the average wage in Estonia", "Estonian salary", "average monthly wage in Estonia according to official statistics", "are Estonian wages rising". GROSS (before income tax and the employee's share of contributions) and per EMPLOYEE POSITION, so somebody holding two jobs is counted twice. Use subjects/table_meta/query_table for breakdowns by economic activity or county. |
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

### What this endpoint actually serves

`tools/list` at `https://gateway.pipeworx.io/stat-ee/mcp` returns the tools in the table
above **plus the shared Pipeworx meta-tools** — `ask_pipeworx`,
`discover_tools`, `search_within`, `remember`/`recall` and the rest of the
gateway-wide set. So the tool count you see is larger than this table: a
single-pack endpoint currently lists roughly 30 shared tools alongside the
pack's own. The connection's `initialize` response states its exact scope, and
is the authoritative answer for a given day.

This is deliberate, not multiplexing by accident. The meta-tools are what let a
scoped connection answer a question this pack does not cover — via
`ask_pipeworx`, which routes across the whole catalog — without you adding a
second MCP server. There is currently no way to mount a pack endpoint without
them; if the extra schemas cost you more context than the routing is worth,
connect to the full gateway once rather than to several pack endpoints.

Or connect to the full Pipeworx gateway to get every pack's tools listed
directly, instead of just this one's:

```json
{
  "mcpServers": {
    "pipeworx": {
      "url": "https://gateway.pipeworx.io/mcp"
    }
  }
}
```

Both URLs reach the same gateway and the same 1476+ data sources. The
only difference is which pack's tools are listed **directly**; `ask_pipeworx`
reaches all of them from either one.

## Using with ask_pipeworx

Instead of calling tools directly, you can ask questions in plain English —
this works on the pack endpoint above as well as on the full gateway:

```
ask_pipeworx({ question: "your question about Stat Ee data" })
```

The gateway picks the right tool and fills the arguments automatically.

## More

- [Docs and guides](https://pipeworx.io/docs)
- [pipeworx.io](https://pipeworx.io)

## License

MIT
