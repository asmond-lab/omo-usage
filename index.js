import { FooterComponent } from "@code-yeongyu/senpi";
import { truncateToWidth } from "@earendil-works/pi-tui";
import { formatUsage, renderUsage } from "./src/format.js";
import { USAGE_SOURCES } from "./src/providers.js";

// Refresh after every model reply. Measured against Kiro: the usage count sometimes
// includes a reply 2-3s after it ends and sometimes only 40s+ later, and a lookup takes
// ~0.2s and costs no credits. So look up soon after a reply, then again a little later
// to catch a late count, without ever starting two lookups closer than MIN_INTERVAL_MS.
// - SETTLE_MS: wait this long after a reply before the first lookup.
// - FOLLOW_UP_MS: look again this long after that, in case the count landed late.
// - MIN_INTERVAL_MS: minimum gap between lookups. A reply inside the gap is not dropped.
// - MAX_WAIT_MS: during a long task replies keep arriving; do not postpone the lookup
//   past this, measured from the first reply that is still waiting to be shown.
export const SETTLE_MS = 5_000;
export const FOLLOW_UP_MS = 45_000;
export const MIN_INTERVAL_MS = 10_000;
export const MAX_WAIT_MS = 15_000;

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

function realTimer(fn, ms) {
  const handle = setTimeout(fn, ms);
  handle.unref?.();
  return handle;
}

/** The clock and timer are injectable so the refresh schedule can be tested exactly. */
export function createUsageFooter({ now = Date.now, setTimer = realTimer, clearTimer = clearTimeout } = {}) {
  return function usageFooter(pi) {
    let generation = 0;
    let modelKey;
    let lastStartedAt = -Infinity;
    let inFlight = 0;
    let pending = false;
    let timer;
    let scheduledAt = 0;
    let firstWaitingAt = 0;
    let followTimer;
    let followUp = false;
    let latestCtx;

    const show = (text) => {
      if (text === usageText) return;
      usageText = text;
      redraw();
    };
    const cancelTimer = () => {
      if (timer !== undefined) clearTimer(timer);
      timer = undefined;
    };
    const cancelFollowUp = () => {
      followUp = false;
      if (followTimer !== undefined) clearTimer(followTimer);
      followTimer = undefined;
    };

    async function lookUp(ctx) {
      const model = ctx.model;
      const lookup = model && USAGE_SOURCES[model.provider];
      const mine = ++generation;
      inFlight = mine;
      pending = false;
      lastStartedAt = now();
      let snapshot;
      try {
        const auth = lookup ? await ctx.modelRegistry.getApiKeyAndHeaders(model) : undefined;
        snapshot = auth?.ok && auth.apiKey ? await lookup(auth.apiKey, model) : undefined;
      } catch {
        snapshot = undefined;
      }
      if (inFlight === mine) inFlight = 0;
      // A slower lookup for an earlier model must not overwrite a newer one.
      if (mine !== generation) return;
      show(snapshot ? renderUsage(formatUsage(snapshot)) : undefined);
      // A reply finished while this lookup was running: pick it up as well.
      if (pending) request(latestCtx);
      else if (followUp) scheduleFollowUp();
    }

    // One extra lookup a while after a reply, for counts that arrive late.
    function scheduleFollowUp() {
      followUp = false;
      if (followTimer !== undefined) clearTimer(followTimer);
      followTimer = setTimer(() => {
        followTimer = undefined;
        if (timer === undefined && !inFlight) return lookUp(latestCtx);
      }, FOLLOW_UP_MS);
    }

    function request(ctx, force = false) {
      if (!ctx.hasUI) return;
      latestCtx = ctx;
      const model = ctx.model;
      if (!model || !USAGE_SOURCES[model.provider]) {
        modelKey = undefined;
        cancelTimer();
        cancelFollowUp();
        pending = false;
        generation++;
        show(undefined);
        return;
      }
      const key = `${model.provider}/${model.id}`;
      if (key !== modelKey) {
        // Never show the previous model's numbers under a new model.
        modelKey = key;
        show(undefined);
        cancelFollowUp();
        force = true;
      }
      if (force) {
        cancelTimer();
        return lookUp(ctx);
      }
      if (inFlight) {
        pending = true;
        return;
      }
      // A reply ran: after its lookup, also look once more later for a late count.
      followUp = true;
      // After a reply: give the provider time to record it, and respect the minimum gap.
      // Later replies push the lookup back so it includes them, up to MAX_WAIT_MS.
      if (timer === undefined) firstWaitingAt = now();
      const wanted = Math.max(now() + SETTLE_MS, lastStartedAt + MIN_INTERVAL_MS);
      const at = Math.max(Math.min(wanted, firstWaitingAt + MAX_WAIT_MS), lastStartedAt + MIN_INTERVAL_MS);
      if (timer === undefined || at > scheduledAt) {
        cancelTimer();
        scheduledAt = at;
        timer = setTimer(() => {
          timer = undefined;
          return lookUp(latestCtx);
        }, Math.max(0, at - now()));
      }
    }

    pi.on("session_start", (_event, ctx) => {
      if (ctx.hasUI) {
        appendFooterLine();
        // Clearing an unused status key is the extension API's way to ask for a repaint.
        redraw = () => ctx.ui.setStatus("zz-usage-left", undefined);
      }
      return request(ctx, true);
    });
    pi.on("model_select", (_event, ctx) => request(ctx, true));
    // Every model reply, including each step of a long tool-using task.
    pi.on("turn_end", (_event, ctx) => request(ctx));
    pi.on("agent_end", (_event, ctx) => request(ctx));
    pi.on("session_shutdown", () => {
      cancelTimer();
      cancelFollowUp();
      generation++;
      show(undefined);
    });
  };
}

export default createUsageFooter();
