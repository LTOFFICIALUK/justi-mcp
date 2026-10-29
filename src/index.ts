#!/usr/bin/env node
// justi.fun MCP server (stdio). Env: JUSTI_API_URL (default production), JUSTI_API_KEY (optional).
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { API_URL } from "./api.js";
import { registerTools } from "./tools.js";

const server = new McpServer(
  { name: "justi", title: "justi.fun", version: "0.1.1" },
  {
    instructions:
      "justi.fun is a fair Solana launchpad on Meteora. Use these tools to find coins, read coin detail, explain fees and rules (justi_protocol_info), quote trades, and build unsigned swap or launch transactions for a user's wallet to sign. Never ask a user for a private key or seed phrase; build tools return unsigned transactions only. Amounts in tool output marked Lamports are 1e-9 SOL; token raw units have 6 decimals.",
  },
);
registerTools(server);

await server.connect(new StdioServerTransport());
process.stderr.write(`justi mcp ready (api ${API_URL})\n`);
