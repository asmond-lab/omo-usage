import { describe, expect, test } from "bun:test";
import usageFooter from "../index.js";
import { USAGE_SOURCES } from "../src/providers.js";

// A fake host that records the footer and lets a test fire the extension's events.
function host() {
  const handlers = {};
  const status = new Map();
  const ctx = {
    hasUI: true,
    model: undefined,
    ui: { theme: { fg: (color, text) => `<${color}>${text}` }, setStatus: (k, v) => (v === undefined ? status.delete(k) : status.set(k, v)) },
    modelRegistry: { getApiKeyAndHeaders: async () => ({ ok: true, apiKey: "test-key" }) },
  };
  usageFooter({ on: (name, fn) => (handlers[name] = fn) });
  return { ctx, status, fire: (name) => handlers[name]({}, ctx) };
}

function withSource(provider, fn, run) {
  const original = USAGE_SOURCES[provider];
  USAGE_SOURCES[provider] = fn;
  return run().finally(() => { if (original) USAGE_SOURCES[provider] = original; else delete USAGE_SOURCES[provider]; });
}

describe("follows the currently selected model", () => {
  test("shows the active model's remaining usage in the footer", async () => {
    const h = host();
    h.ctx.model = { provider: "test-p", id: "m1" };
    await withSource("test-p", async () => ({ label: "Test", remaining: 30, total: 100, unit: "percent" }), () => h.fire("session_start"));
    const shown = [...h.status.values()];
    expect(shown).toHaveLength(1);
    expect(shown[0].replace(/\x1b\[[0-9;]*m/g, "")).toBe("Test ▕████░░░░░░░░░░▏ 30% 남음");
  });

  test("switching to a model with no usage source hides it", async () => {
    const h = host();
    h.ctx.model = { provider: "test-p", id: "m1" };
    await withSource("test-p", async () => ({ label: "Test", remaining: 80, total: 100, unit: "percent" }), async () => {
      await h.fire("session_start");
      expect(h.status.size).toBe(1);
      h.ctx.model = { provider: "no-such-provider", id: "x" };
      await h.fire("model_select");
    });
    expect(h.status.size).toBe(0);
  });

  test("a failed lookup hides the bar instead of showing stale or wrong numbers", async () => {
    const h = host();
    h.ctx.model = { provider: "test-p", id: "m1" };
    await withSource("test-p", async () => { throw new Error("network down"); }, () => h.fire("session_start"));
    expect(h.status.size).toBe(0);
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
    const shown = [...h.status.values()].join("");
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
    expect(h.status.size).toBe(0);
  });
});
