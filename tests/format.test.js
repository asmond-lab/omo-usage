import { describe, expect, test } from "bun:test";
import { bar, formatUsage, levelFor, renderUsage } from "../src/format.js";

describe("color thresholds from the approved design", () => {
  test("more than half left is green", () => {
    expect(levelFor(0.51)).toBe("success");
    expect(levelFor(1)).toBe("success");
  });
  test("exactly half and down to 20% is amber", () => {
    expect(levelFor(0.5)).toBe("warning");
    expect(levelFor(0.2)).toBe("warning");
  });
  test("under 20% is red", () => {
    expect(levelFor(0.1999)).toBe("error");
    expect(levelFor(0)).toBe("error");
  });
});

describe("progress bar", () => {
  test("filled cells are the part left, at a fixed width", () => {
    expect(bar(1, 10)).toBe("▕██████████▏");
    expect(bar(0, 10)).toBe("▕░░░░░░░░░░▏");
    expect(bar(0.5, 10)).toBe("▕█████░░░░░▏");
  });
  test("out-of-range input is clamped instead of breaking the width", () => {
    expect(bar(1.4, 10)).toBe(bar(1, 10));
    expect(bar(-0.3, 10)).toBe(bar(0, 10));
  });
});

describe("footer text", () => {
  const reset = new Date(2026, 9, 1, 9, 0).getTime(); // Oct 1, local time

  test("Kiro credits show percent, exact count, and reset day", () => {
    const { text, level } = formatUsage({ label: "Kiro", remaining: 3914, total: 5000, unit: "count", resetAt: reset });
    expect(level).toBe("success");
    expect(text).toContain("Kiro ");
    expect(text).toContain("78% 남음");
    expect(text).toContain("3,914 / 5,000");
    expect(text).toContain("10/01 리셋");
    expect(text).not.toContain("곧 소진");
  });

  test("a percent-only source does not repeat the number as a fraction", () => {
    const { text, level } = formatUsage({ label: "ChatGPT", remaining: 49, total: 100, unit: "percent", resetAt: reset });
    expect(level).toBe("warning");
    expect(text).toContain("49% 남음");
    expect(text).not.toContain("/ 100");
  });

  test("dollar balances keep cents", () => {
    const { text } = formatUsage({ label: "OpenRouter", remaining: 0.92, total: 1, unit: "usd" });
    expect(text).toContain("$0.92 / $1.00");
  });

  test("under 20% turns red and says it is running out instead of the reset day", () => {
    const { text, level } = formatUsage({ label: "Kiro", remaining: 600, total: 5000, unit: "count", resetAt: reset });
    expect(level).toBe("error");
    expect(text).toContain("12% 남음");
    expect(text).toContain("곧 소진");
    expect(text).not.toContain("리셋");
  });

  test("a zero total never divides by zero", () => {
    const { text, level } = formatUsage({ label: "X", remaining: 0, total: 0, unit: "count" });
    expect(level).toBe("error");
    expect(text).toContain("0% 남음");
  });
});

describe("colored render", () => {
  const GREEN = "\x1b[38;2;74;222;128m", AMBER = "\x1b[38;2;251;191;36m", RED = "\x1b[38;2;248;113;113m", EMPTY = "\x1b[38;2;82;82;91m";
  const render = (remaining, total) => renderUsage(formatUsage({ label: "K", remaining, total, unit: "count" }));

  test("each level uses its fixed design color, not the theme's", () => {
    expect(render(9, 10).startsWith(GREEN)).toBe(true);
    expect(render(3, 10).startsWith(AMBER)).toBe(true);
    expect(render(1, 10).startsWith(RED)).toBe(true);
  });
  test("only the part left is colored; the empty part is dimmed", () => {
    const out = render(1, 2);
    expect(out).toContain(AMBER + "K ▕███████");
    expect(out).toContain(EMPTY + "░░░░░░░");
  });
  test("an empty bar is all dimmed and a full bar has no empty cells", () => {
    expect(render(0, 5)).toContain(EMPTY + "░".repeat(14));
    expect(render(5, 5)).toContain(EMPTY + "\x1b[39m");
  });
});
