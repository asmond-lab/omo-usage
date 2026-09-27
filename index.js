import { formatUsage, renderUsage } from "./src/format.js";
import { USAGE_SOURCES } from "./src/providers.js";

// The footer sorts extension statuses by key; "zz-" keeps this one at the end.
const STATUS_KEY = "zz-usage-left";
// Usage endpoints are rate limited and slow-moving; refresh at most this often.
const MIN_REFRESH_MS = 60_000;

export default function usageFooter(pi) {
  let generation = 0;
  let lastModelKey;
  let lastFetchedAt = 0;

  const clear = (ctx) => ctx.ui.setStatus(STATUS_KEY, undefined);

  async function refresh(ctx, force) {
    if (!ctx.hasUI) return;
    const model = ctx.model;
    const lookup = model && USAGE_SOURCES[model.provider];
    if (!lookup) {
      lastModelKey = undefined;
      clear(ctx);
      return;
    }
    const modelKey = `${model.provider}/${model.id}`;
    const modelChanged = modelKey !== lastModelKey;
    if (!force && !modelChanged && Date.now() - lastFetchedAt < MIN_REFRESH_MS) return;
    // Never show the previous model's numbers under a new model.
    if (modelChanged) clear(ctx);
    lastModelKey = modelKey;
    lastFetchedAt = Date.now();
    const mine = ++generation;
    let snapshot;
    try {
      const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
      snapshot = auth.ok && auth.apiKey ? await lookup(auth.apiKey, model) : undefined;
    } catch {
      snapshot = undefined;
    }
    // A slower lookup for an earlier model must not overwrite a newer one.
    if (mine !== generation) return;
    if (!snapshot) {
      clear(ctx);
      return;
    }
    ctx.ui.setStatus(STATUS_KEY, renderUsage(formatUsage(snapshot)));
  }

  pi.on("session_start", (_event, ctx) => refresh(ctx, true));
  pi.on("model_select", (_event, ctx) => refresh(ctx, true));
  pi.on("agent_end", (_event, ctx) => refresh(ctx, false));
  pi.on("session_shutdown", (_event, ctx) => clear(ctx));
}
