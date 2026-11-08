import { PublicKey } from "@solana/web3.js";
import { Timestamp } from "spacetimedb";
import { tables } from "@/lib/stdb/bindings";
import { AVAILABLE, loadDrone } from "@/content/index.generated";
import { decodeRace, type Race, type RaceEvent } from "@/lib/solana/race";
import type { Conn } from "./sinks/stdb";
import { chainClient, replayRecent, trackHashOf, upsertRaceArgs, watchProgram, type ChainEvent } from "./chain";

// Mirrors on-chain races into SpacetimeDB: a race created by a sponsor shows up in
// the races table, entries move the pot, and a settle writes the payouts onto the
// entrants' rows. Lap times flow the other way (module -> submit_result jobs).

const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString("hex");

/** Course ids as the fly page reports laps: `<drone>-<course>`. */
export async function knownCourses(): Promise<string[]> {
  const ids: string[] = [];
  for (const drone of AVAILABLE.drone) {
    const content = await loadDrone(drone);
    for (const course of content?.courses ?? []) ids.push(`${drone}-${course.id}`);
  }
  return ids;
}

export function courseResolver(courses: readonly string[]): (trackHash: string) => string {
  const byHash = new Map(courses.map((c) => [hex(trackHashOf(c)), c]));
  return (trackHash) => byHash.get(trackHash.replace(/^0x/, "").toLowerCase()) ?? `track-${trackHash.slice(0, 8)}`;
}

export async function startRaceMirror(conn: Conn, log: (line: string) => void): Promise<() => Promise<void>> {
  const { connection } = chainClient();
  const courseOf = courseResolver(await knownCourses());

  await new Promise<void>((resolve, reject) => {
    conn
      .subscriptionBuilder()
      .onApplied(() => resolve())
      .onError((ctx) => reject(ctx.event ?? new Error("race subscription failed")))
      .subscribe([tables.race, tables.raceEntry]);
  });

  async function upsert(address: string, settleSig?: string) {
    const info = await connection.getAccountInfo(new PublicKey(address), "confirmed");
    const race: Race | null = info ? decodeRace(address, info.data) : null;
    if (!race) return;
    const args = upsertRaceArgs(race);
    await conn.reducers.workerUpsertRace({
      onchain: args.onchain,
      course: courseOf(race.trackHash),
      entryLamports: args.entryLamports,
      potLamports: args.potLamports,
      closesAt: Timestamp.fromDate(args.closesAt),
      status: args.status,
      settleSig,
    });
  }

  async function payouts(event: Extract<RaceEvent, { name: "RaceSettled" }>, signature: string) {
    const race = [...conn.db.race.iter()].find((r) => r.onchain === event.race);
    if (!race) return;
    const entries = [...conn.db.raceEntry.iter()].filter((e) => e.raceId === race.id);
    for (const payout of event.payouts) {
      const entry = entries.find((e) => e.wallet === payout.player);
      if (!entry) continue;
      await conn.reducers.workerRaceEntryResult({
        entryId: entry.id,
        verified: true,
        bestMs: undefined,
        lapId: undefined,
        resultSig: entry.resultSig ?? signature,
        payoutLamports: payout.lamports,
      });
    }
  }

  async function handle({ signature, event }: ChainEvent) {
    if (!("race" in event)) return;
    switch (event.name) {
      case "RaceCreated":
      case "RaceEntered":
      case "RaceCancelled":
        await upsert(event.race);
        break;
      case "RaceSettled":
        await upsert(event.race, signature);
        await payouts(event, signature);
        break;
    }
  }

  const safely = (e: ChainEvent) =>
    void handle(e).catch((error) => log(`race mirror: ${e.event.name} ${e.signature.slice(0, 8)}: ${error instanceof Error ? error.message : error}`));

  const { config } = chainClient();
  const replayed = await replayRecent(connection, config.programId, safely, { limit: 200 }).catch(() => 0);
  const stop = await watchProgram(safely);
  log(`race mirror on: ${replayed} past events replayed`);
  return stop;
}
