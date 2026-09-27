// Pure rendering: a usage snapshot in, the footer text and color out.

const BAR_CELLS = 14;

/** Color bucket for the fraction of usage left (0..1). */
export function levelFor(leftFraction) {
  if (leftFraction > 0.5) return "success";
  if (leftFraction >= 0.2) return "warning";
  return "error";
}

/** Filled/empty cell counts for the part still left, at a fixed width. */
export function barCells(leftFraction, cells = BAR_CELLS) {
  const clamped = Math.min(1, Math.max(0, leftFraction));
  const filled = Math.round(clamped * cells);
  return { filled, empty: cells - filled };
}

/** Plain-text bar, used where no color is available. */
export function bar(leftFraction, cells = BAR_CELLS) {
  const { filled, empty } = barCells(leftFraction, cells);
  return "▕" + "█".repeat(filled) + "░".repeat(empty) + "▏";
}

function formatAmount(snapshot) {
  if (snapshot.unit === "usd") {
    return `$${snapshot.remaining.toFixed(2)} / $${snapshot.total.toFixed(2)}`;
  }
  return `${Math.round(snapshot.remaining).toLocaleString("en-US")} / ${Math.round(snapshot.total).toLocaleString("en-US")}`;
}

/** "10/01" in the viewer's local time zone. */
function formatReset(resetAt) {
  const d = new Date(resetAt);
  return `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")} 리셋`;
}

/**
 * snapshot: { label, remaining, total, unit: "count" | "usd" | "percent", resetAt?: ms }
 * Returns { text, level } where level is a theme color name.
 */
export function formatUsage(snapshot) {
  const left = snapshot.total > 0 ? snapshot.remaining / snapshot.total : 0;
  const level = levelFor(left);
  const pct = Math.round(left * 100);
  const details = [];
  if (snapshot.unit !== "percent") details.push(formatAmount(snapshot));
  if (level === "error") details.push("곧 소진");
  else if (snapshot.resetAt) details.push(formatReset(snapshot.resetAt));
  const tail = `${pct}% 남음${details.length ? " · " + details.join(" · ") : ""}`;
  return { text: `${snapshot.label} ${bar(left)} ${tail}`, level, label: snapshot.label, cells: barCells(left), tail };
}

// The approved design fixes these three colors; theme "success/warning/error" vary by
// theme (some render success as olive), so the level colors are set directly.
const LEVEL_RGB = { success: [74, 222, 128], warning: [251, 191, 36], error: [248, 113, 113] };
const EMPTY_RGB = [82, 82, 91];

function rgb([r, g, b], text) {
  return `\x1b[38;2;${r};${g};${b}m${text}\x1b[39m`;
}

/**
 * Colored footer string: the filled part in the level color, the empty part dimmed
 * so the bar's length reads at a glance.
 */
export function renderUsage(usage) {
  const color = LEVEL_RGB[usage.level];
  const { filled, empty } = usage.cells;
  return rgb(color, `${usage.label} ▕${"█".repeat(filled)}`) + rgb(EMPTY_RGB, "░".repeat(empty)) + rgb(color, `▏ ${usage.tail}`);
}
