import { FooterComponent } from "@code-yeongyu/senpi";
import { truncateToWidth } from "@earendil-works/pi-tui";
import { formatUsage, renderUsage } from "./src/format.js";
import { USAGE_SOURCES } from "./src/providers.js";

// Usage endpoints are rate limited and slow-moving; refresh at most this often.
const MIN_REFRESH_MS = 60_000;

// OMO's footer puts every extension status on one shared line, where a long bar gets
// cut off. Instead, append our own line under the built-in footer: OMO still draws its
// footer exactly as before, and this line appears only when there is usage to show.
let usageText;
let redraw = () => {};

let patched = false;
function appendFooterLine() {
  if (patched) return;
  patched = true;
  const render = FooterComponent.prototype.render;
  FooterComponent.prototype.render = function renderWithUsage(width) {
    const lines = render.call(this, width);
    // truncateToWidth counts wide (Korean) characters correctly and keeps colors intact.
    return usageText ? [...lines, truncateToWidth(usageText, width, "…")] : lines;
  };
}

export default function usageFooter(pi) {
  let generation = 0;
  let lastModelKey;
  let lastFetchedAt = 0;

  const show = (text) => {
    if (text === usageText) return;
    usageText = text;
    redraw();
  };

  async function refresh(ctx, force) {
    if (!ctx.hasUI) return;
    const model = ctx.model;
    const lookup = model && USAGE_SOURCES[model.provider];
    if (!lookup) {
      lastModelKey = undefined;
      show(undefined);
      return;
    }
    const modelKey = `${model.provider}/${model.id}`;
    const modelChanged = modelKey !== lastModelKey;
    if (!force && !modelChanged && Date.now() - lastFetchedAt < MIN_REFRESH_MS) return;
    // Never show the previous model's numbers under a new model.
    if (modelChanged) show(undefined);
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
    show(snapshot ? renderUsage(formatUsage(snapshot)) : undefined);
  }

  pi.on("session_start", (_event, ctx) => {
    if (ctx.hasUI) {
      appendFooterLine();
      // Clearing an unused status key is the extension API's way to ask for a repaint.
      redraw = () => ctx.ui.setStatus("zz-usage-left", undefined);
    }
    return refresh(ctx, true);
  });
  pi.on("model_select", (_event, ctx) => refresh(ctx, true));
  pi.on("agent_end", (_event, ctx) => refresh(ctx, false));
  pi.on("session_shutdown", () => show(undefined));
}

/** Test hook: the line appended under the footer, or undefined when hidden. */
export function currentUsageLine() {
  return usageText;
}
