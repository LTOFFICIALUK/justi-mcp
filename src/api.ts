// Minimal client for the justi.fun public API (the MCP server needs only a few calls).
export const API_URL = (process.env.JUSTI_API_URL || "https://server-production-cc13.up.railway.app").replace(/\/+$/, "");
const API_KEY = process.env.JUSTI_API_KEY || "";
export const SITE_URL = "https://justi.fun";

export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
    public details: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

export const api = async <T>(method: "GET" | "POST", path: string, query?: Record<string, unknown>, body?: unknown): Promise<T> => {
  const qs = query
    ? Object.entries(query)
        .filter(([, v]) => v !== undefined && v !== null && v !== "")
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
        .join("&")
    : "";
  const headers: Record<string, string> = { accept: "application/json", "user-agent": "justi-mcp/0.1.0" };
  if (API_KEY) headers.authorization = `Bearer ${API_KEY}`;
  if (body !== undefined) headers["content-type"] = "application/json";
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}${qs ? `?${qs}` : ""}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(45_000) });
  } catch (e) {
    throw new ApiError("network", `Could not reach the justi.fun API: ${e instanceof Error ? e.message : String(e)}`, 0);
  }
  const text = await res.text();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new ApiError("bad_response", `The API answered ${res.status} with something that is not JSON.`, res.status);
  }
  if (!res.ok) {
    const e = (json as { error?: { code?: string; message?: string; details?: Record<string, unknown> } }).error;
    throw new ApiError(e?.code ?? "error", e?.message ?? `The API answered ${res.status}.`, res.status, e?.details ?? {});
  }
  return json as T;
};

/** Decimal amount to raw integer units without float rounding. */
export const toRaw = (amount: string | number, decimals: number): string => {
  const text = typeof amount === "number" ? amount.toFixed(decimals) : amount.trim();
  const m = /^(\d*)(?:\.(\d*))?$/.exec(text);
  if (!m || (m[1] === "" && (m[2] ?? "") === "")) throw new ApiError("invalid_params", `Not a positive decimal amount: ${amount}`, 400);
  const frac = (m[2] ?? "").slice(0, decimals).padEnd(decimals, "0");
  return (BigInt(m[1] || "0") * 10n ** BigInt(decimals) + BigInt(frac || "0")).toString();
};

export const fromRaw = (raw: string, decimals: number): string => {
  const v = BigInt(raw);
  const base = 10n ** BigInt(decimals);
  const frac = (v % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  return frac ? `${v / base}.${frac}` : `${v / base}`;
};
