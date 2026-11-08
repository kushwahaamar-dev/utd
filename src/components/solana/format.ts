const LAMPORTS_PER_SOL = BigInt(1_000_000_000);

export type Lamports = bigint | number;

/** "0.05 SOL": up to 4 decimals, trailing zeros trimmed, and never "0 SOL" for a non-zero amount. */
export function formatSol(lamports: Lamports): string {
  const value = BigInt(lamports);
  const negative = value < BigInt(0);
  const abs = negative ? -value : value;
  if (abs > BigInt(0) && abs < BigInt(100_000)) return `${negative ? "-" : ""}<0.0001 SOL`;
  const whole = abs / LAMPORTS_PER_SOL;
  const frac = (abs % LAMPORTS_PER_SOL).toString().padStart(9, "0").slice(0, 4).replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole}${frac ? `.${frac}` : ""} SOL`;
}

/** 8123 -> "8.123s", 72345 -> "1:12.345". */
export function formatLap(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  const seconds = (ms % 60_000) / 1000;
  return minutes > 0 ? `${minutes}:${seconds.toFixed(3).padStart(6, "0")}` : `${seconds.toFixed(3)}s`;
}

/** Share of a prize in whole percent, for the payout breakdown. */
export function sharePercent(part: Lamports, total: Lamports): number {
  const whole = BigInt(total);
  return whole === BigInt(0) ? 0 : Number((BigInt(part) * BigInt(1000)) / whole) / 10;
}

/** Seconds left as "2h 05m", "4m 09s" or "12s"; null once the time has passed. */
export function formatCountdown(secondsLeft: number): string | null {
  if (secondsLeft <= 0) return null;
  const s = Math.floor(secondsLeft);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h >= 24) return `${Math.floor(h / 24)}d ${h % 24}h`;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  if (m > 0) return `${m}m ${String(s % 60).padStart(2, "0")}s`;
  return `${s}s`;
}
