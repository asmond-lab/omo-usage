// Remaining-usage lookups. Each takes the active model's resolved API key and
// returns a snapshot, or undefined when the account has no usable limit to show.
// Only endpoints that report an amount LEFT are used; per-minute rate limits are not.

const TIMEOUT_MS = 10_000;

async function getJson(url, init) {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!response.ok) throw new Error(`${new URL(url).host} returned HTTP ${response.status}`);
  return response.json();
}

function jwtClaim(token, path) {
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
    return path.reduce((value, key) => value?.[key], payload);
  } catch {
    return undefined;
  }
}

/** ChatGPT / Codex subscription: the weekly (primary) window, as the official Codex client reads it. */
async function chatgpt(apiKey) {
  const accountId = jwtClaim(apiKey, ["https://api.openai.com/auth", "chatgpt_account_id"]);
  const data = await getJson("https://chatgpt.com/backend-api/wham/usage", {
    headers: { Authorization: `Bearer ${apiKey}`, ...(accountId ? { "ChatGPT-Account-Id": accountId } : {}) },
  });
  const windows = [data.rate_limit?.primary_window, data.rate_limit?.secondary_window].filter(Boolean);
  if (windows.length === 0) return undefined;
  // Show whichever window is closest to running out.
  const tightest = windows.reduce((a, b) => (b.used_percent > a.used_percent ? b : a));
  return {
    label: "ChatGPT",
    remaining: Math.max(0, 100 - tightest.used_percent),
    total: 100,
    unit: "percent",
    resetAt: tightest.reset_at ? tightest.reset_at * 1000 : undefined,
  };
}

/** Kiro subscription credits for the account's profile. */
async function kiro(apiKey, model) {
  const region = model.kiroRegion ?? "us-east-1";
  const base = `https://management.${region}.kiro.dev/`;
  const headers = { Authorization: `Bearer ${apiKey}`, Accept: "application/json" };
  let profileArn = model.kiroProfileArn;
  if (!profileArn) {
    const profiles = await getJson(base + "List-Available-Profiles", { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: "{}" });
    profileArn = profiles.profiles?.find((p) => p.arn)?.arn;
  }
  if (!profileArn) return undefined;
  const url = new URL("Get-Usage-Limits", base);
  url.searchParams.set("origin", "KIRO_CLI");
  url.searchParams.set("profileArn", profileArn);
  url.searchParams.set("resourceType", "AGENTIC_REQUEST");
  const data = await getJson(url.toString(), { headers });
  const bucket = (data.usageBreakdownList ?? []).find((b) => b.resourceType === "CREDIT") ?? data.usageBreakdownList?.[0];
  if (!bucket || !(bucket.usageLimit > 0)) return undefined;
  return {
    label: "Kiro",
    remaining: Math.max(0, bucket.usageLimit - bucket.currentUsage),
    total: bucket.usageLimit,
    unit: "count",
    resetAt: data.nextDateReset ? data.nextDateReset * 1000 : undefined,
  };
}

/** OpenRouter: the key's own spending limit. Keys without a limit have nothing to show. */
async function openrouter(apiKey) {
  const { data } = await getJson("https://openrouter.ai/api/v1/key", { headers: { Authorization: `Bearer ${apiKey}` } });
  if (!(data?.limit > 0) || typeof data.limit_remaining !== "number") return undefined;
  return { label: "OpenRouter", remaining: Math.max(0, data.limit_remaining), total: data.limit, unit: "usd" };
}

/** Vercel AI Gateway: prepaid credit balance against everything added so far. */
async function vercel(apiKey) {
  const data = await getJson("https://ai-gateway.vercel.sh/v1/credits", { headers: { Authorization: `Bearer ${apiKey}` } });
  const balance = Number(data.balance);
  const used = Number(data.total_used);
  if (!Number.isFinite(balance) || !Number.isFinite(used) || balance + used <= 0) return undefined;
  return { label: "Vercel", remaining: balance, total: balance + used, unit: "usd" };
}

/** Claude subscription (OAuth): the tighter of the 5-hour and 7-day windows. Undocumented endpoint. */
async function anthropicSubscription(apiKey) {
  const data = await getJson("https://api.anthropic.com/api/oauth/usage", {
    headers: { Authorization: `Bearer ${apiKey}`, "anthropic-version": "2023-06-01", "anthropic-beta": "oauth-2025-04-20" },
  });
  const windows = [data.five_hour, data.seven_day].filter((w) => w && typeof w.utilization === "number");
  if (windows.length === 0) return undefined;
  const tightest = windows.reduce((a, b) => (b.utilization > a.utilization ? b : a));
  return {
    label: "Claude",
    remaining: Math.max(0, 100 - tightest.utilization),
    total: 100,
    unit: "percent",
    resetAt: tightest.resets_at ? Date.parse(tightest.resets_at) : undefined,
  };
}

/** provider id -> lookup. Providers not listed here are hidden. */
export const USAGE_SOURCES = {
  "chatgpt-subscription": chatgpt,
  "openai-codex": chatgpt,
  kiro,
  openrouter,
  "vercel-ai-gateway": vercel,
  "anthropic-subscription": anthropicSubscription,
};
