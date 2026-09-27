import { describe, expect, mock, test } from "bun:test";

// The extension imports OMO's footer class and width helper from the host. Stand in
// minimal versions so the real render wrapper can be exercised without a terminal.
class FakeFooter {
  render() { return ["BUILT-IN FOOTER"]; }
}
mock.module("@code-yeongyu/senpi", () => ({ FooterComponent: FakeFooter }));
mock.module("@earendil-works/pi-tui", () => ({
  truncateToWidth: (text, width, ellipsis) => (text.replace(/\x1b\[[0-9;]*m/g, "").length > width ? text.slice(0, width - 1) + ellipsis : text),
}));

const { createUsageFooter, MIN_INTERVAL_MS, SETTLE_MS, MAX_WAIT_MS, FOLLOW_UP_MS } = await import("../index.js");
const { USAGE_SOURCES } = await import("../src/providers.js");

const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");
const settle = () => new Promise((r) => setTimeout(r, 0));

// A fake host with a manual clock: timers fire only when the test advances time.
function host() {
  const handlers = {};
  let clock = 1_000_000;
  const timers = [];
  const usageFooter = createUsageFooter({
    now: () => clock,
    setTimer: (fn, ms) => { const t = { at: clock + ms, fn }; timers.push(t); return t; },
    clearTimer: (t) => { const i = timers.indexOf(t); if (i >= 0) timers.splice(i, 1); },
  });
  const ctx = {
    hasUI: true,
    model: undefined,
    ui: { setStatus: () => {} },
    modelRegistry: { getApiKeyAndHeaders: async () => ({ ok: true, apiKey: "test-key" }) },
  };
  usageFooter({ on: (name, fn) => (handlers[name] = fn) });
  const footer = new FakeFooter();
  return {
    ctx,
    fire: async (name) => { await handlers[name]({}, ctx); await settle(); },
    advance: async (ms) => {
      clock += ms;
      for (const t of timers.filter((x) => x.at <= clock)) { timers.splice(timers.indexOf(t), 1); await t.fn(); }
      await settle();
    },
    pendingTimers: () => timers.length,
    footerLines: (width = 200) => footer.render(width),
  };
}

function withSource(provider, fn, run) {
  const original = USAGE_SOURCES[provider];
  USAGE_SOURCES[provider] = fn;
  return run().finally(() => { if (original) USAGE_SOURCES[provider] = original; else delete USAGE_SOURCES[provider]; });
}

// A source whose remaining amount the test can change, counting lookups.
function counter(start = 100) {
  const state = { calls: 0, remaining: start };
  state.fn = async () => { state.calls++; return { label: "T", remaining: state.remaining, total: 100, unit: "percent" }; };
  return state;
}

describe("usage gets its own line under the built-in footer", () => {
  test("the built-in footer is kept and the usage line is appended after it", async () => {
    const h = host();
    h.ctx.model = { provider: "test-p", id: "m1" };
    await withSource("test-p", async () => ({ label: "Test", remaining: 30, total: 100, unit: "percent" }), () => h.fire("session_start"));
    const lines = h.footerLines();
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe("BUILT-IN FOOTER");
    expect(strip(lines[1])).toBe("Test ▕████░░░░░░░░░░▏ 30% 남음");
  });

  test("nothing is added when the model has no usage source", async () => {
    const h = host();
    h.ctx.model = { provider: "test-p", id: "m1" };
    await withSource("test-p", counter(80).fn, async () => {
      await h.fire("session_start");
      expect(h.footerLines()).toHaveLength(2);
      h.ctx.model = { provider: "no-such-provider", id: "x" };
      await h.fire("model_select");
    });
    expect(h.footerLines()).toEqual(["BUILT-IN FOOTER"]);
  });

  test("a narrow terminal cuts the line instead of wrapping it", async () => {
    const h = host();
    h.ctx.model = { provider: "test-p", id: "m1" };
    await withSource("test-p", async () => ({ label: "Test", remaining: 3000, total: 5000, unit: "count" }), () => h.fire("session_start"));
    const narrow = strip(h.footerLines(20)[1]);
    expect(narrow.length).toBeLessThanOrEqual(20);
    expect(narrow.endsWith("…")).toBe(true);
  });

  test("a failed lookup adds no line rather than stale or wrong numbers", async () => {
    const h = host();
    h.ctx.model = { provider: "test-p", id: "m1" };
    await withSource("test-p", async () => { throw new Error("network down"); }, () => h.fire("session_start"));
    expect(h.footerLines()).toEqual(["BUILT-IN FOOTER"]);
  });

  test("a slow lookup for the old model cannot overwrite the new model", async () => {
    const h = host();
    let releaseOld;
    const oldDone = new Promise((r) => (releaseOld = r));
    await withSource("slow-p", async () => { await oldDone; return { label: "Old", remaining: 90, total: 100, unit: "percent" }; }, () =>
      withSource("fast-p", async () => ({ label: "New", remaining: 10, total: 100, unit: "percent" }), async () => {
        h.ctx.model = { provider: "slow-p", id: "a" };
        const pendingOld = h.fire("session_start");
        h.ctx.model = { provider: "fast-p", id: "b" };
        await h.fire("model_select");
        releaseOld();
        await pendingOld;
      }));
    const shown = strip(h.footerLines().join("\n"));
    expect(shown).toContain("New");
    expect(shown).not.toContain("Old");
  });

  test("the extension stays silent without a UI", async () => {
    const h = host();
    h.ctx.hasUI = false;
    h.ctx.model = { provider: "test-p", id: "m1" };
    const c = counter();
    await withSource("test-p", c.fn, () => h.fire("session_start"));
    expect(c.calls).toBe(0);
  });
});

describe("refresh timing", () => {
  test("a reply is looked up after the provider has had time to record it", async () => {
    const h = host();
    h.ctx.model = { provider: "test-p", id: "m1" };
    const c = counter(90);
    await withSource("test-p", c.fn, async () => {
      await h.fire("session_start");
      await h.advance(MIN_INTERVAL_MS);
      c.remaining = 80;
      await h.fire("turn_end");
      // Not immediately: the provider records a reply a few seconds after it ends.
      expect(c.calls).toBe(1);
      await h.advance(SETTLE_MS - 1);
      expect(c.calls).toBe(1);
      await h.advance(1);
    });
    expect(c.calls).toBe(2);
    expect(strip(h.footerLines()[1])).toContain("80% 남음");
  });

  test("each step of a long task counts, not only the end of the task", async () => {
    const h = host();
    h.ctx.model = { provider: "test-p", id: "m1" };
    const c = counter(90);
    await withSource("test-p", c.fn, async () => {
      await h.fire("session_start");
      for (const left of [85, 80, 75]) {
        await h.advance(MIN_INTERVAL_MS);
        c.remaining = left;
        await h.fire("turn_end");
        await h.advance(SETTLE_MS);
      }
    });
    expect(c.calls).toBe(4);
    expect(strip(h.footerLines()[1])).toContain("75% 남음");
  });

  test("replies close together are folded into one lookup that includes the last of them", async () => {
    const h = host();
    h.ctx.model = { provider: "test-p", id: "m1" };
    const c = counter(90);
    await withSource("test-p", c.fn, async () => {
      await h.fire("session_start");
      await h.advance(1000);
      await h.fire("turn_end");
      await h.advance(1000);
      await h.fire("turn_end");
      c.remaining = 70;
      await h.fire("agent_end");
      expect(h.pendingTimers()).toBe(1);
      await h.advance(MAX_WAIT_MS);
    });
    expect(c.calls).toBe(2);
    expect(strip(h.footerLines()[1])).toContain("70% 남음");
  });

  test("a steady stream of replies still updates within the maximum wait", async () => {
    const h = host();
    h.ctx.model = { provider: "test-p", id: "m1" };
    const c = counter(90);
    await withSource("test-p", c.fn, async () => {
      await h.fire("session_start");
      await h.advance(MIN_INTERVAL_MS);
      // A reply every 2s would keep pushing a naive settle delay back forever.
      for (let i = 0; i < 8; i++) {
        await h.fire("turn_end");
        await h.advance(2000);
      }
    });
    expect(c.calls).toBeGreaterThanOrEqual(2);
  });

  test("lookups never start closer together than the minimum gap", async () => {
    const h = host();
    h.ctx.model = { provider: "test-p", id: "m1" };
    const starts = [];
    let clockRef = 0;
    const c = counter(90);
    await withSource("test-p", async () => { starts.push(clockRef); return c.fn(); }, async () => {
      await h.fire("session_start");
      for (let i = 0; i < 60; i++) {
        clockRef += 1000;
        await h.advance(1000);
        await h.fire("turn_end");
      }
    });
    expect(starts.length).toBeGreaterThan(2);
    for (let i = 1; i < starts.length; i++) expect(starts[i] - starts[i - 1]).toBeGreaterThanOrEqual(MIN_INTERVAL_MS);
  });

  test("switching models looks up immediately, even inside the gap", async () => {
    const h = host();
    h.ctx.model = { provider: "test-p", id: "m1" };
    const a = counter(90);
    const b = counter(40);
    await withSource("test-p", a.fn, () => withSource("other-p", b.fn, async () => {
      await h.fire("session_start");
      await h.advance(500);
      h.ctx.model = { provider: "other-p", id: "m2" };
      await h.fire("model_select");
    }));
    expect(b.calls).toBe(1);
    expect(strip(h.footerLines()[1])).toContain("40% 남음");
  });

  test("closing the session cancels a waiting lookup", async () => {
    const h = host();
    h.ctx.model = { provider: "test-p", id: "m1" };
    const c = counter(90);
    await withSource("test-p", c.fn, async () => {
      await h.fire("session_start");
      await h.advance(1000);
      await h.fire("turn_end");
      expect(h.pendingTimers()).toBe(1);
      await h.fire("session_shutdown");
      await h.advance(MAX_WAIT_MS);
    });
    expect(h.pendingTimers()).toBe(0);
    expect(c.calls).toBe(1);
    expect(h.footerLines()).toEqual(["BUILT-IN FOOTER"]);
  });

  test("a count that lands late is picked up by one follow-up lookup", async () => {
    const h = host();
    h.ctx.model = { provider: "test-p", id: "m1" };
    const c = counter(90);
    await withSource("test-p", c.fn, async () => {
      await h.fire("session_start");
      await h.advance(MIN_INTERVAL_MS);
      await h.fire("turn_end");
      await h.advance(SETTLE_MS);
      // The provider has not counted the reply yet.
      expect(c.calls).toBe(2);
      expect(strip(h.footerLines()[1])).toContain("90% 남음");
      c.remaining = 80;
      await h.advance(FOLLOW_UP_MS);
    });
    expect(c.calls).toBe(3);
    expect(strip(h.footerLines()[1])).toContain("80% 남음");
  });

  test("an idle session stops looking up after the follow-up", async () => {
    const h = host();
    h.ctx.model = { provider: "test-p", id: "m1" };
    const c = counter(90);
    await withSource("test-p", c.fn, async () => {
      await h.fire("session_start");
      await h.advance(MIN_INTERVAL_MS);
      await h.fire("turn_end");
      await h.advance(SETTLE_MS);
      await h.advance(FOLLOW_UP_MS);
      const afterFollowUp = c.calls;
      await h.advance(10 * 60_000);
      expect(c.calls).toBe(afterFollowUp);
    });
    expect(h.pendingTimers()).toBe(0);
  });
});
