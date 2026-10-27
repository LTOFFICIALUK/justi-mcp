# @justifun/mcp

An [MCP](https://modelcontextprotocol.io) server for [justi.fun](https://justi.fun), a fair Solana launchpad on Meteora.
It lets AI assistants (Claude, Cursor, any MCP client) find coins, read coin detail, explain the rules and fees,
quote trades, and build unsigned swap and launch transactions for a user's wallet to sign.

It never holds keys and never sends a transaction. Build tools return unsigned transactions only.

> Package name: `@justifun/mcp` needs the `justifun` npm org. Until it exists the same code is published as `justi-mcp`; use that name in the configs below.

## Tools

| Tool | What it does |
|---|---|
| `justi_list_coins` | List or search coins (q = ticker, name or mint), sort by new, marketcap, volume24h, lastTrade, progress, trades |
| `justi_get_coin` | One coin: metadata, socials, fee split, safety facts, curve progress, graduation, sniper window |
| `justi_protocol_info` | Program, the 20 fee-tier configs, fee claimer, lookup table, every fee split, sniper window, dev buy cap, copy rule |
| `justi_quote` | Quote a buy (amountSol) or sell (amountTokens): expected and minimum out, impact, fee and where it goes |
| `justi_build_swap` | Unsigned v0 swap transaction for a wallet, plus how to submit it |
| `justi_build_launch` | Unsigned create transaction for a new coin, same rules as the site |
| `justi_recent_trades` | Recent trades of a coin, newest first |
| `justi_platform_stats` | Platform totals |
| `justi_tx_status` | Status of any signature and the swap or launch it belongs to |

## Setup

Node 18 or newer. No API key needed. Optional env: `JUSTI_API_KEY` (higher limits), `JUSTI_API_URL` (default: the production API).

### Claude Desktop

`claude_desktop_config.json` (Settings, Developer, Edit Config):

```json
{
  "mcpServers": {
    "justi": {
      "command": "npx",
      "args": ["-y", "@justifun/mcp"]
    }
  }
}
```

### Claude Code

```sh
claude mcp add justi -- npx -y @justifun/mcp
```

### Cursor

`.cursor/mcp.json` in your project (or `~/.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "justi": {
      "command": "npx",
      "args": ["-y", "@justifun/mcp"],
      "env": { "JUSTI_API_KEY": "" }
    }
  }
}
```

### VS Code

`.vscode/mcp.json`:

```json
{
  "servers": {
    "justi": { "type": "stdio", "command": "npx", "args": ["-y", "@justifun/mcp"] }
  }
}
```

### From source

```sh
git clone <this repo> && cd mcp && npm install && npm run build
# then use "command": "node", "args": ["/path/to/mcp/dist/index.js"]
```

## Things to ask

- "What are the newest coins on justi.fun with the most volume today?"
- "How are fees split on justi.fun if I pick holder rewards?"
- "Quote 0.5 SOL of $SWORDOPE on justi.fun."
- "Build a launch for my wallet <address>: name Cattleaxe, ticker CAXE, holder rewards, image <url>."

An agent can build the transaction, but the user signs it in their own wallet. To do the full flow in code
(build, sign, submit, confirm) use the SDK: [`@justifun/sdk`](https://justi.fun/developers/quickstart).

## Build a launchpad feature on Solana

If you are adding token launches or trading to an app, the pieces are:

- REST API with an OpenAPI 3.1 spec: https://server-production-cc13.up.railway.app/v1/openapi.json
- TypeScript SDK: `@justifun/sdk` (launch, quote, buy, sell, subscribe, verifyWebhook)
- Webhooks and a WebSocket for live trades, launches and graduations
- Docs: https://justi.fun/developers and https://justi.fun/llms.txt

## Development

```sh
npm install
npm run dev          # stdio server from source
npm test             # spawns the server with the official MCP client and calls every tool (JUSTI_API_URL=...)
npx @modelcontextprotocol/inspector --cli node dist/index.js --method tools/list
```

## License

MIT
