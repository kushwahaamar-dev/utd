"use client";

import { useMemo } from "react";
import { useRaceEntries, useStdb, type Race, type RaceEntry } from "@/lib/stdb";
import type { RaceCardRace } from "./RaceCard";
import type { RacePayoutRow } from "./RaceResult";

const secs = (micros: bigint) => Number(micros / 1_000_000n);

/** One module race joined with its entries: the card's props, the viewer's own entry and rank, and the payout rows. */
export function useRaceView(race: Race | undefined) {
  const { entries } = useRaceEntries(race?.id ?? null);
  const { identity } = useStdb();
  return useMemo(() => {
    if (!race) return null;
    const finishers = entries.filter((e) => e.bestMs != null);
    const mine: RaceEntry | undefined = entries.find((e) => identity && e.identity.isEqual(identity));
    const card: RaceCardRace = {
      address: race.onchain,
      title: race.course,
      entryLamports: race.entryLamports,
      potLamports: race.potLamports,
      entryCount: entries.length,
      closesAt: secs(race.closesAt.microsSinceUnixEpoch),
      status: race.status === "open" || race.status === "settled" ? race.status : "closed",
      top3: finishers.slice(0, 3).map((e) => ({ player: e.wallet, lapMs: e.bestMs! })),
      settleSig: race.settleSig ?? null,
    };
    const payouts: RacePayoutRow[] = finishers
      .filter((e) => e.payoutLamports != null)
      .map((e) => ({ player: e.wallet, lamports: e.payoutLamports!, lapMs: e.bestMs! }));
    const myRank = mine?.bestMs != null ? finishers.findIndex((e) => e.id === mine.id) + 1 : null;
    return { card, mine, myRank, finishers: finishers.length, payouts };
  }, [race, entries, identity]);
}
