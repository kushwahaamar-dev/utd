"use client";

import { useEffect, useState } from "react";
import { Button, Chip, cx, type ChipTone } from "@/components/ui";
import { addressUrl, shortAddress, txUrl } from "@/lib/solana/config";
import { formatCountdown, formatLap, formatSol, type Lamports } from "./format";

export type RaceCardRace = {
  /** Race account address (PDA). */
  address: string;
  /** Short name of the course or race. */
  title?: string;
  entryLamports: Lamports;
  potLamports: Lamports;
  entryCount: number;
  /** Unix seconds. */
  closesAt: number;
  status: "open" | "closed" | "settled" | "cancelled";
  /** Podium in rank order; only finishers. */
  top3: { player: string; lapMs: number; name?: string }[];
  settleSig?: string | null;
};

/** What the Enter button should do for this viewer. */
export type EnterState = "ready" | "pending" | "entered" | "no-wallet" | "closed";

export type RaceCardLabels = {
  pot: string;
  entryFee: string;
  entrants: string;
  closesIn: string;
  closed: string;
  podium: string;
  noTimes: string;
  enter: string;
  entering: string;
  entered: string;
  connect: string;
  settled: string;
  cancelled: string;
  open: string;
  closedStatus: string;
  viewRace: string;
  viewPayout: string;
};

export const RACE_CARD_LABELS: RaceCardLabels = {
  pot: "Prize pot",
  entryFee: "Entry",
  entrants: "Entrants",
  closesIn: "Closes in",
  closed: "Closed",
  podium: "Podium",
  noTimes: "No verified times yet",
  enter: "Enter race",
  entering: "Waiting for wallet",
  entered: "You are in",
  connect: "Connect a wallet to enter",
  settled: "Settled",
  cancelled: "Cancelled",
  open: "Open",
  closedStatus: "Closed",
  viewRace: "Race account",
  viewPayout: "Payout transaction",
};

const STATUS_TONE: Record<RaceCardRace["status"], ChipTone> = { open: "mint", closed: "mustard", settled: "cobalt", cancelled: "blush" };
const PLACE_TONE: ChipTone[] = ["mustard", "plain", "blush"];

function useNow(initial?: number): number | null {
  const [now, setNow] = useState<number | null>(initial ?? null);
  useEffect(() => {
    if (initial !== undefined) return;
    const tick = () => setNow(Math.floor(Date.now() / 1000));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [initial]);
  return now;
}

/**
 * One prize race: pot, fee, entrants, a countdown to close and the podium.
 * Props only; the caller fetches the race and runs the enter transaction.
 * `now` (unix seconds) freezes the clock, for tests and screenshots.
 */
export function RaceCard({
  race,
  enter,
  onEnter,
  labels = RACE_CARD_LABELS,
  now: frozenNow,
  className,
}: {
  race: RaceCardRace;
  enter: EnterState;
  onEnter?: () => void;
  labels?: RaceCardLabels;
  now?: number;
  className?: string;
}) {
  const now = useNow(frozenNow);
  const left = now === null ? null : formatCountdown(race.closesAt - now);
  const statusLabel = { open: labels.open, closed: labels.closedStatus, settled: labels.settled, cancelled: labels.cancelled }[race.status];
  const titleId = `race-${race.address}`;

  return (
    <article aria-labelledby={titleId} className={cx("grid gap-5 rounded-[4px] border border-rule bg-surface p-5 sm:p-6", className)}>
      <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0 flex-1 basis-48">
          <Chip tone={STATUS_TONE[race.status]} dot>
            {statusLabel}
          </Chip>
          <h3 id={titleId} className="mt-3 text-[clamp(20px,2vw,26px)] leading-tight font-medium tracking-[-0.02em]">
            {race.title ?? shortAddress(race.address)}
          </h3>
        </div>
        <p className="text-end">
          <span className="font-ui text-xs text-muted">{labels.pot}</span>
          <span className="mt-1 block font-ui text-3xl leading-none tabular">{formatSol(race.potLamports)}</span>
        </p>
      </header>

      <dl className="grid grid-cols-3 gap-3 border-y border-rule py-3 font-ui text-xs">
        <div>
          <dt className="text-muted">{labels.entryFee}</dt>
          <dd className="mt-1 text-sm tabular">{formatSol(race.entryLamports)}</dd>
        </div>
        <div>
          <dt className="text-muted">{labels.entrants}</dt>
          <dd className="mt-1 text-sm tabular">{race.entryCount}</dd>
        </div>
        <div>
          <dt className="text-muted">{race.status === "open" ? labels.closesIn : labels.closed}</dt>
          <dd className="mt-1 text-sm tabular" suppressHydrationWarning>
            {race.status === "open" ? (left ?? (now === null ? "…" : labels.closed)) : statusLabel}
          </dd>
        </div>
      </dl>

      <section aria-label={labels.podium}>
        {race.top3.length === 0 ? (
          <p className="font-ui text-xs text-muted">{labels.noTimes}</p>
        ) : (
          <ol className="grid gap-2">
            {race.top3.map((p, i) => (
              <li key={p.player} className="flex items-center justify-between gap-3 font-ui text-sm">
                <span className="flex min-w-0 items-center gap-2">
                  <Chip tone={PLACE_TONE[i]} aria-label={`#${i + 1}`}>
                    {i + 1}
                  </Chip>
                  <a href={addressUrl(p.player)} target="_blank" rel="noreferrer" className="truncate text-ink underline-offset-2 hover:underline">
                    {p.name ?? shortAddress(p.player)}
                  </a>
                </span>
                <span className="tabular">{formatLap(p.lapMs)}</span>
              </li>
            ))}
          </ol>
        )}
      </section>

      <footer className="flex flex-wrap items-center justify-between gap-3">
        <EnterButton state={enter} labels={labels} onEnter={onEnter} />
        <span className="flex flex-wrap gap-x-4 gap-y-1 font-ui text-xs">
          <a href={addressUrl(race.address)} target="_blank" rel="noreferrer" className="text-muted underline-offset-2 hover:text-ink hover:underline">
            {labels.viewRace}
          </a>
          {race.settleSig ? (
            <a href={txUrl(race.settleSig)} target="_blank" rel="noreferrer" className="text-muted underline-offset-2 hover:text-ink hover:underline">
              {labels.viewPayout}
            </a>
          ) : null}
        </span>
      </footer>
    </article>
  );
}

function EnterButton({ state, labels, onEnter }: { state: EnterState; labels: RaceCardLabels; onEnter?: () => void }) {
  if (state === "entered") return <Chip tone="mint">{labels.entered}</Chip>;
  const text = { ready: labels.enter, pending: labels.entering, "no-wallet": labels.connect, closed: labels.closed }[state];
  return (
    <Button variant="primary" onClick={onEnter} disabled={state !== "ready"} aria-busy={state === "pending"}>
      {text}
    </Button>
  );
}
