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

const { default: usageFooter } = await import("../index.js");
const { USAGE_SOURCES } = await import("../src/providers.js");

const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");

// A fake host that fires the extension's events and records repaint requests.
function host() {
  const handlers = {};
  let repaints = 0;
  const ctx = {
    hasUI: true,
    model: undefined,
    ui: { setStatus: () => repaints++ },
    modelRegistry: { getApiKeyAndHeaders: async () => ({ ok: true, apiKey: "test-key" }) },
  };
  usageFooter({ on: (name, fn) => (handlers[name] = fn) });
  const footer = new FakeFooter();
  return {
    ctx,
    fire: (name) => handlers[name]({}, ctx),
    footerLines: (width = 200) => footer.render(width),
    repaints: () => repaints,
  };
}

function withSource(provider, fn, run) {
  const original = USAGE_SOURCES[provider];
  USAGE_SOURCES[provider] = fn;
  return run().finally(() => { if (original) USAGE_SOURCES[provider] = original; else delete USAGE_SOURCES[provider]; });
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
    expect(h.repaints()).toBeGreaterThan(0);
  });

  test("nothing is added when the model has no usage source", async () => {
    const h = host();
    h.ctx.model = { provider: "test-p", id: "m1" };
    await withSource("test-p", async () => ({ label: "Test", remaining: 80, total: 100, unit: "percent" }), async () => {
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

  test("turns within a minute on the same model reuse the last lookup", async () => {
    const h = host();
    h.ctx.model = { provider: "test-p", id: "m1" };
    let calls = 0;
    await withSource("test-p", async () => { calls++; return { label: "T", remaining: 60, total: 100, unit: "percent" }; }, async () => {
      await h.fire("session_start");
      await h.fire("agent_end");
      await h.fire("agent_end");
    });
    expect(calls).toBe(1);
  });

  test("the extension stays silent without a UI", async () => {
    const h = host();
    h.ctx.hasUI = false;
    h.ctx.model = { provider: "test-p", id: "m1" };
    let calls = 0;
    await withSource("test-p", async () => { calls++; return { label: "T", remaining: 60, total: 100, unit: "percent" }; }, () => h.fire("session_start"));
    expect(calls).toBe(0);
  });
});
