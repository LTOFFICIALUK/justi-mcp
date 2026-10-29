import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { API_URL, ApiError, SITE_URL, api, fromRaw, toRaw } from "./api.js";

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const address = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/, "a base58 Solana address");
const decimal = z.union([z.string().regex(/^\d*\.?\d+$/), z.number().positive()]);

const ok = (data: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(data, null, 1) }] });
const fail = (e: unknown) => {
  const err = e instanceof ApiError ? e : new ApiError("error", e instanceof Error ? e.message : String(e), 0);
  return { isError: true, content: [{ type: "text" as const, text: JSON.stringify({ error: { code: err.code, message: err.message, ...(Object.keys(err.details).length ? { details: err.details } : {}) } }) }] };
};
const run =
  <A>(fn: (args: A) => Promise<unknown>) =>
  async (args: A) => {
    try {
      return ok(await fn(args));
    } catch (e) {
      return fail(e);
    }
  };

const lamportsToSol = (l: string | null | undefined) => (l == null ? null : Number(fromRaw(l, 9)));

/** A compact coin row, to keep agent context small. */
export const coinRow = (t: Json) => ({
  mint: t.mint,
  name: t.name,
  ticker: t.ticker,
  status: t.status,
  priceSol: t.priceSol,
  marketCapSol: round(t.marketCapSol, 3),
  curveProgressPct: round(t.curveProgressPct, 2),
  volume24hSol: lamportsToSol(t.volume24hLamports),
  holders: t.holderCount,
  trades: t.trades,
  createdAt: t.createdAt,
  lastTradeAt: t.lastTradeAt,
  creator: t.creator,
  fees: t.fees ? { mode: t.fees.mode, totalPct: t.fees.totalPct, creatorPct: t.fees.creatorPct, holdersPct: t.fees.holdersPct } : undefined,
  url: `${SITE_URL}/coin/${t.mint}`,
});

const round = (n: unknown, d: number) => (typeof n === "number" ? Math.round(n * 10 ** d) / 10 ** d : n);

const NEXT_SWAP = `Next: the wallet signs the base64 v0 transaction (e.g. VersionedTransaction.deserialize, wallet.signTransaction), then POST ${API_URL}/v1/submit {"swapId","transaction":"<signed base64>"} and poll GET ${API_URL}/v1/swaps/{swapId}. Or send it with any RPC. The blockhash expires in about 60 seconds.`;
const NEXT_LAUNCH = `Next: sign with the creator wallet (and the custom mint key if one was given), then POST ${API_URL}/v1/launches/{launchId}/submit {"transaction":"<signed base64>"} within about 60 seconds and poll GET ${API_URL}/v1/launches/{launchId}. The SDK does all of this in one call: new Justi().launch({...}).`;

export const registerTools = (server: McpServer) => {
  server.registerTool(
    "justi_list_coins",
    {
      title: "List or search justi.fun coins",
      description:
        "List coins launched on justi.fun (a Solana launchpad on Meteora), newest first by default. Search by ticker or name with q, or pass an exact mint. Sort by new, marketcap, volume24h, lastTrade, progress or trades. Returns compact rows and nextCursor for paging.",
      inputSchema: {
        q: z.string().max(64).optional().describe("Ticker or name contains, or an exact mint"),
        status: z.enum(["all", "curve", "graduating", "graduated"]).optional().describe("curve: on the bonding curve. graduated: trading on Meteora DAMM v2"),
        sort: z.enum(["new", "marketcap", "volume24h", "lastTrade", "progress", "trades"]).optional(),
        creator: address.optional().describe("Only coins created by this wallet"),
        limit: z.number().int().min(1).max(100).optional().describe("Default 20"),
        cursor: z.string().max(400).optional().describe("nextCursor from the previous call"),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    run(async (a: { q?: string; status?: string; sort?: string; creator?: string; limit?: number; cursor?: string }) => {
      const page = await api<Json>("GET", "/v1/tokens", { ...a, limit: a.limit ?? 20 });
      return { total: page.total, coins: page.tokens.map(coinRow), nextCursor: page.nextCursor };
    }),
  );

  server.registerTool(
    "justi_get_coin",
    {
      title: "Get one justi.fun coin",
      description:
        "Full detail of one coin by mint: name, ticker, description, socials, fee split, safety facts (mint and freeze authority, metadata, LP lock), bonding curve progress, graduation and DAMM v2 pool, launch block fee (sniperRule), totals.",
      inputSchema: { mint: address.describe("Coin mint address") },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    run(async ({ mint }: { mint: string }) => {
      const c = await api<Json>("GET", `/v1/tokens/${mint}`);
      return { ...c, url: `${SITE_URL}/coin/${mint}` };
    }),
  );

  server.registerTool(
    "justi_protocol_info",
    {
      title: "justi.fun protocol, rules and fees",
      description:
        "What justi.fun is and how it works on chain: Meteora DBC program, the 20 fee-tier configs, fee claimer, lookup table, how to tell a coin is from justi.fun, every fee split, the launch block fee, dev buy cap, copy rule, holder rewards and graduation. Use this before explaining fees or building a launch.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    run(async () => {
      const [protocol, pad] = await Promise.all([api<Json>("GET", "/v1/protocol"), api<Json>("GET", "/v1/pad")]);
      return {
        about:
          "justi.fun is a Solana launchpad on Meteora's Dynamic Bonding Curve. Launches are built by the server and sent privately through Jito. Every coin has a fixed 1B supply, no mint or freeze authority, locked metadata, and 100% of LP locked when it graduates to Meteora DAMM v2. Buys in a coin's launch block (the block of the create transaction) pay 99%; from the next block every buy pays the normal fee, and the dev buy in the create transaction pays the normal fee. What is paid above the normal fee goes 20% to buy back and burn the coin, 50% to buy back and burn $JUSTI, 30% to the platform. Coins launched before this rule keep a 5-second window with a 50/30/20 split. Creators pick creator rewards, holder rewards (paid in SOL every 10 minutes) or a split; the creator rate is tracked from every trade and paid to the creator wallet by justi.fun automatically.",
        docs: `${SITE_URL}/developers`,
        api: API_URL,
        protocol,
        rules: {
          devBuyMaxPctOfSupply: pad.devBuyMaxPctOfSupply,
          copyWindowHours: pad.copyWindowHours,
          holderRoundSec: pad.holderRoundSec,
          minPayoutLamports: pad.minPayoutLamports,
          graduationQuoteLamports: pad.graduationQuoteLamports,
          graduation: pad.graduation,
          sniperWindow: pad.sniperWindow,
          platformSplit: pad.platformSplit,
          meteoraSharePct: pad.meteoraSharePct,
          launchesEnabled: pad.launchesEnabled,
        },
        feeTiers: pad.tiers.map((t: Json) => ({ tier: t.tier, mode: t.mode, creatorBps: t.creatorBps, totalPct: t.totalPct, creatorPct: t.creatorPct, holdersPct: t.holdersPct, platformPct: t.platformPct, meteoraPct: t.meteoraPct, config: t.config, live: t.live })),
      };
    }),
  );

  server.registerTool(
    "justi_quote",
    {
      title: "Quote a buy or sell",
      description:
        "Quote a trade on a justi.fun coin (bonding curve before graduation, Meteora DAMM v2 after). For a buy give amountSol, for a sell give amountTokens (whole tokens) or amountRaw. Returns expected and minimum output, price impact, the fee and where it goes (creator, holders, burns, Meteora).",
      inputSchema: {
        mint: address,
        side: z.enum(["buy", "sell"]),
        amountSol: decimal.optional().describe("Buy: SOL to spend, e.g. 0.5"),
        amountTokens: decimal.optional().describe("Sell: whole tokens, e.g. 250000"),
        amountRaw: z.string().regex(/^\d{1,20}$/).optional().describe("Raw units instead: lamports for a buy, token base units (6 decimals) for a sell"),
        slippageBps: z.number().int().min(10).max(5000).optional().describe("Default 1000 (10%)"),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    run(async (a: { mint: string; side: "buy" | "sell"; amountSol?: string | number; amountTokens?: string | number; amountRaw?: string; slippageBps?: number }) => {
      const amount = rawAmount(a);
      const q = await api<Json>("GET", "/v1/quote", { mint: a.mint, side: a.side, amount, slippageBps: a.slippageBps });
      return {
        ...q,
        readable: {
          in: a.side === "buy" ? `${fromRaw(q.amountIn, 9)} SOL` : `${fromRaw(q.amountIn, 6)} tokens`,
          expectedOut: a.side === "buy" ? `${fromRaw(q.expectedOut, 6)} tokens` : `${fromRaw(q.expectedOut, 9)} SOL`,
          minOut: a.side === "buy" ? `${fromRaw(q.minOut, 6)} tokens` : `${fromRaw(q.minOut, 9)} SOL`,
          fee: `${q.fee.pct}%`,
        },
      };
    }),
  );

  server.registerTool(
    "justi_build_swap",
    {
      title: "Build an unsigned swap transaction",
      description:
        "Build an unsigned Solana v0 transaction that buys or sells a justi.fun coin for a wallet. Nothing is signed or sent: the user's wallet must sign it. The server quotes fresh, simulates, and sets the compute limit and priority fee. Returns swapId, the base64 transaction, the quote and how to submit.",
      inputSchema: {
        mint: address,
        wallet: address.describe("The wallet that pays and signs"),
        side: z.enum(["buy", "sell"]),
        amountSol: decimal.optional().describe("Buy: SOL to spend"),
        amountTokens: decimal.optional().describe("Sell: whole tokens"),
        amountRaw: z.string().regex(/^\d{1,20}$/).optional().describe("Raw units instead of the decimal amounts"),
        slippageBps: z.number().int().min(10).max(5000).optional(),
        priorityFee: z.union([z.literal("auto"), z.number().int().min(0).max(50_000_000)]).optional().describe('"auto" or micro-lamports per compute unit'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    run(async (a: { mint: string; wallet: string; side: "buy" | "sell"; amountSol?: string | number; amountTokens?: string | number; amountRaw?: string; slippageBps?: number; priorityFee?: "auto" | number }) => {
      const built = await api<Json>("POST", "/v1/swap", undefined, { mint: a.mint, wallet: a.wallet, side: a.side, amount: rawAmount(a), slippageBps: a.slippageBps, priorityFee: a.priorityFee });
      return { ...built, next: NEXT_SWAP };
    }),
  );

  server.registerTool(
    "justi_build_launch",
    {
      title: "Build an unsigned coin launch",
      description:
        "Build the create transaction for a new coin on justi.fun, with the same rules as the site (fee tiers, launch block fee, dev buy cap of 15% of supply, copy rule, 10 launches per wallet per day). The creator wallet must sign it; nothing is sent. mode: creator (creator earns 0 to 2.5%), holders (holders earn 0.5% in SOL), split (0.5% holders plus creator 0.25 to 2%). Without customMint the server picks a ...JUST vanity mint and signs that slot.",
      inputSchema: {
        wallet: address.describe("Creator wallet: pays, signs, owns the coin"),
        name: z.string().min(2).max(32),
        ticker: z.string().min(2).max(11).describe("2 to 10 letters or numbers"),
        description: z.string().max(280).optional(),
        image: z.string().min(10).max(2000).describe("https URL of the coin image (png, jpeg, gif or webp, up to 5 MB)"),
        mode: z.enum(["creator", "holders", "split"]),
        creatorBps: z.number().int().min(0).max(250).optional().describe("creator: 0-250 in steps of 25. split: 25-200. holders: 0"),
        devBuySol: decimal.optional().describe("Optional dev buy in SOL inside the create transaction"),
        xUrl: z.string().max(200).optional(),
        telegramUrl: z.string().max(200).optional(),
        website: z.string().max(200).optional(),
        customMint: address.optional().describe("Public key of a vanity mint the user holds. They sign with it too. Never pass a secret key."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    run(async (a: { wallet: string; name: string; ticker: string; description?: string; image: string; mode: string; creatorBps?: number; devBuySol?: string | number; xUrl?: string; telegramUrl?: string; website?: string; customMint?: string }) => {
      const built = await api<Json>("POST", "/v1/launches", undefined, {
        wallet: a.wallet,
        name: a.name,
        ticker: a.ticker,
        description: a.description ?? "",
        image: a.image,
        mode: a.mode,
        creatorBps: a.creatorBps ?? 0,
        devBuyLamports: a.devBuySol !== undefined ? toRaw(a.devBuySol, 9) : "0",
        xUrl: a.xUrl,
        telegramUrl: a.telegramUrl,
        website: a.website,
        mint: a.customMint,
      });
      return { ...built, coinUrl: `${SITE_URL}/coin/${built.mint}`, next: NEXT_LAUNCH };
    }),
  );

  server.registerTool(
    "justi_recent_trades",
    {
      title: "Recent trades of a coin",
      description: "Trades of one justi.fun coin, newest first, on the curve and on DAMM v2 after graduation. Filter by side or wallet. Amounts in SOL and whole tokens.",
      inputSchema: {
        mint: address,
        limit: z.number().int().min(1).max(100).optional().describe("Default 20"),
        side: z.enum(["buy", "sell"]).optional(),
        wallet: address.optional(),
        cursor: z.string().max(400).optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    run(async (a: { mint: string; limit?: number; side?: string; wallet?: string; cursor?: string }) => {
      const page = await api<Json>("GET", `/v1/tokens/${a.mint}/trades`, { limit: a.limit ?? 20, side: a.side, wallet: a.wallet, cursor: a.cursor });
      return {
        trades: page.trades.map((t: Json) => ({ ts: t.ts, side: t.side, venue: t.venue, sol: Number(fromRaw(t.solLamports, 9)), tokens: Number(fromRaw(t.tokenAmount, 6)), priceSol: t.priceSol, wallet: t.wallet, signature: t.signature })),
        nextCursor: page.nextCursor,
      };
    }),
  );

  server.registerTool(
    "justi_platform_stats",
    {
      title: "justi.fun platform totals",
      description: "Platform-wide totals of justi.fun: coins launched, volume, fees, holder payouts, burns.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    run(async () => api<Json>("GET", "/v1/platform/stats")),
  );

  server.registerTool(
    "justi_tx_status",
    {
      title: "Status of a transaction",
      description: "Status of any Solana signature (pending, confirmed, finalized, failed, unknown), and the swap or launch it belongs to when it was built through justi.fun.",
      inputSchema: { signature: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{64,90}$/) },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    run(async ({ signature }: { signature: string }) => api<Json>("GET", `/v1/tx/${signature}`)),
  );
};

const rawAmount = (a: { side: "buy" | "sell"; amountSol?: string | number; amountTokens?: string | number; amountRaw?: string }) => {
  if (a.amountRaw) return a.amountRaw;
  if (a.side === "buy" && a.amountSol !== undefined) return toRaw(a.amountSol, 9);
  if (a.side === "sell" && a.amountTokens !== undefined) return toRaw(a.amountTokens, 6);
  throw new ApiError("invalid_params", a.side === "buy" ? "Give amountSol (or amountRaw in lamports) for a buy." : "Give amountTokens (or amountRaw in base units) for a sell.", 400);
};
