// Spawns the MCP server over stdio with the official client and calls every tool.
// Needs a justi API: JUSTI_API_URL (default http://localhost:8151). Never sends a transaction.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { toRaw, fromRaw } from "../src/api.js";

const API = process.env.JUSTI_API_URL || "http://localhost:8151";
const WALLET = process.env.WALLET || "BRV3sXDm7bae36qRNCMVSx2y1znGAz1UqoiS52TProzj";

test("toRaw / fromRaw", () => {
  assert.equal(toRaw("0.5", 9), "500000000");
  assert.equal(toRaw(0.1, 9), "100000000");
  assert.equal(toRaw("250000", 6), "250000000000");
  assert.equal(fromRaw("1500000000", 9), "1.5");
  assert.throws(() => toRaw("-1", 9));
});

const reachable = await fetch(`${API}/health`).then((r) => r.ok).catch(() => false);

test("every tool over stdio", { skip: !reachable && `no API at ${API}` }, async () => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["--import", "tsx", new URL("../src/index.ts", import.meta.url).pathname],
    env: { ...process.env, JUSTI_API_URL: API } as Record<string, string>,
    stderr: "pipe",
  });
  const client = new Client({ name: "justi-mcp-test", version: "0.0.0" });
  await client.connect(transport);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const r = (await client.callTool({ name, arguments: args })) as { isError?: boolean; content: { type: string; text: string }[] };
    return { isError: !!r.isError, data: JSON.parse(r.content[0].text) };
  };
  try {
    const info = client.getServerVersion();
    assert.equal(info?.name, "justi");
    assert.match(client.getInstructions() ?? "", /Never ask a user for a private key/);
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    assert.deepEqual(names, ["justi_build_launch", "justi_build_swap", "justi_get_coin", "justi_list_coins", "justi_platform_stats", "justi_protocol_info", "justi_quote", "justi_recent_trades", "justi_tx_status"]);
    for (const t of tools) assert.ok(t.description && t.description.length > 40, `${t.name} has a description`);

    const list = await call("justi_list_coins", { sort: "volume24h", limit: 5 });
    assert.equal(list.isError, false);
    assert.ok(list.data.coins.length > 0);
    const coin = list.data.coins.find((c: { status: string }) => c.status === "curve") ?? list.data.coins[0];
    assert.match(coin.url, /^https:\/\/justi\.fun\/coin\//);
    console.log("list", list.data.total, coin.ticker, coin.mint);

    const search = await call("justi_list_coins", { q: coin.mint });
    assert.equal(search.data.coins[0].mint, coin.mint);

    const detail = await call("justi_get_coin", { mint: coin.mint });
    assert.equal(detail.data.mint, coin.mint);

    const proto = await call("justi_protocol_info");
    assert.equal(proto.data.protocol.dbcProgram, "dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN");
    assert.equal(proto.data.feeTiers.length, 20);

    const q = await call("justi_quote", { mint: coin.mint, side: "buy", amountSol: 0.05 });
    assert.equal(q.isError, false, JSON.stringify(q.data));
    assert.ok(BigInt(q.data.expectedOut) > 0n);
    console.log("quote", q.data.readable);

    const qs = await call("justi_quote", { mint: coin.mint, side: "sell" });
    assert.equal(qs.isError, true);
    assert.equal(qs.data.error.code, "invalid_params");

    const sw = await call("justi_build_swap", { mint: coin.mint, wallet: WALLET, side: "buy", amountSol: "0.01" });
    assert.equal(sw.isError, false, JSON.stringify(sw.data));
    assert.ok(sw.data.transaction.length > 100 && sw.data.swapId);
    console.log("swap", sw.data.route, sw.data.bytes, "bytes", sw.data.computeUnitsConsumed, "CU");

    const trades = await call("justi_recent_trades", { mint: coin.mint, limit: 3 });
    assert.ok(Array.isArray(trades.data.trades));
    if (trades.data.trades[0]) {
      const st = await call("justi_tx_status", { signature: trades.data.trades[0].signature });
      assert.equal(st.isError, false, JSON.stringify(st.data));
      console.log("tx", st.data.status);
    }

    const stats = await call("justi_platform_stats");
    assert.equal(stats.isError, false);

    const bad = await call("justi_get_coin", { mint: "So11111111111111111111111111111111111111112" });
    assert.equal(bad.isError, true);
    assert.equal(bad.data.error.code, "not_found");

    if (process.env.MCP_TEST_LAUNCH === "1") {
      const l = await call("justi_build_launch", { wallet: WALLET, name: "Bunnett Desk", ticker: "BNDK", image: process.env.IMAGE_URL || "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png", mode: "holders" });
      assert.equal(l.isError, false, JSON.stringify(l.data));
      assert.ok(l.data.launchId && l.data.transaction);
      console.log("launch", l.data.mint, l.data.tier, l.data.bytes, "bytes", l.data.computeUnits, "CU");
    }
  } finally {
    await client.close();
  }
});
