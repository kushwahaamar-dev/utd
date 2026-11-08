"use client";

import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Section } from "@/components/editorial/Editorial";
import { Callout } from "@/components/ui";
import { useLocale } from "@/i18n/client";
import { PROGRAM_ID } from "@/lib/solana/config";
import { SolanaProvider } from "@/lib/solana/provider";
import { enterRace as payEntry } from "@/lib/solana/race-actions";
import { useRaces, useStdb, useStdbActions, type Race } from "@/lib/stdb";
import { PublicKey } from "@solana/web3.js";
import { RaceCard, type EnterState, type RaceCardLabels } from "./RaceCard";
import { RaceResult, type RaceResultLabels } from "./RaceResult";
import { useSolanaT } from "./SolanaText";
import { WalletBar, bumpBalances } from "./WalletBar";
import { raceFlyHref } from "./race-link";
import { walletErrorText } from "./shared";
import { useLinkedWallet } from "./useModule";
import { useRaceView } from "./useRaceView";

function useRaceLabels(): { card: RaceCardLabels; result: RaceResultLabels } {
  const t = useSolanaT();
  return useMemo(
    () => ({
      card: {
        pot: t("races.card.pot"),
        entryFee: t("races.card.entryFee"),
        entrants: t("races.card.entrants"),
        closesIn: t("races.card.closesIn"),
        closed: t("races.card.closed"),
        podium: t("races.card.podium"),
        noTimes: t("races.card.noTimes"),
        enter: t("races.card.enter"),
        entering: t("races.card.entering"),
        entered: t("races.card.entered"),
        connect: t("races.card.connect"),
        settled: t("races.card.settled"),
        cancelled: t("races.card.cancelled"),
        open: t("races.card.open"),
        closedStatus: t("races.card.closedStatus"),
        viewRace: t("races.card.viewRace"),
        viewPayout: t("races.card.viewPayout"),
      },
      result: {
        title: t("races.result.title"),
        place: t("races.result.place"),
        winner: t("races.result.winner"),
        time: t("races.result.time"),
        prize: t("races.result.prize"),
        share: t("races.result.share"),
        total: t("races.result.total"),
        viewTx: t("races.result.viewTx"),
      },
    }),
    [t],
  );
}

function RaceRow({ race, wallet, linked }: { race: Race; wallet: string | null; linked: boolean }) {
  const t = useSolanaT();
  const lang = useLocale();
  const router = useRouter();
  const { connection } = useConnection();
  const adapter = useWallet();
  const { enterRace } = useStdbActions();
  const labels = useRaceLabels();
  const view = useRaceView(race);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const flyHref = raceFlyHref(lang, race.course, race.id);

  if (!view) return null;
  const state: EnterState = view.mine
    ? "entered"
    : pending
      ? "pending"
      : view.card.status !== "open"
        ? "closed"
        : !wallet || !linked || !PROGRAM_ID
          ? "no-wallet"
          : "ready";

  async function onEnter() {
    if (!PROGRAM_ID) return;
    setPending(true);
    setError(null);
    let sig: string | null = null;
    try {
      sig = (await payEntry(connection, adapter, PROGRAM_ID, new PublicKey(race.onchain))).signature;
      bumpBalances();
      await enterRace(race.id, sig);
      if (flyHref) router.push(flyHref);
    } catch (e) {
      const reason = sig ? (e instanceof Error ? e.message : String(e)) : walletErrorText(t, e);
      setError(sig ? t("races.recordError", { sig: sig.slice(0, 12), reason }) : t("races.enterError", { reason }));
    } finally {
      setPending(false);
    }
  }

  return (
    <li className="grid gap-4">
      <RaceCard race={view.card} enter={state} onEnter={onEnter} labels={labels.card} />
      {error ? (
        <Callout tone="danger" live>
          {error}
        </Callout>
      ) : null}
      {view.mine && view.card.status === "open" && flyHref ? (
        <p className="text-sm">
          <Link href={flyHref} className="inline-flex min-h-11 items-center font-bold">
            {t("races.fly")}
          </Link>{" "}
          <span className="text-muted">{t("races.flyHint")}</span>
        </p>
      ) : null}
      {view.card.status === "settled" && view.payouts.length ? (
        <RaceResult potLamports={view.card.potLamports} payouts={view.payouts} signature={race.settleSig} labels={labels.result} />
      ) : null}
    </li>
  );
}

function Races() {
  const t = useSolanaT();
  const { status } = useStdb();
  const { publicKey } = useWallet();
  const wallet = publicKey?.toBase58() ?? null;
  const linked = useLinkedWallet(wallet);
  const { races, ready } = useRaces();

  return (
    <>
      <Section id="races-wallet" index="01" title={t("wallet.title")}>
        <div className="max-w-xl">
          <WalletBar />
        </div>
      </Section>
      <Section id="races-list" index="02" title={t("races.listTitle")}>
        <div aria-live="polite">
          {status === "offline" ? (
            <Callout tone="warn">{t("races.offline")}</Callout>
          ) : !ready ? (
            <p className="text-muted" aria-busy="true">
              {t("races.loading")}
            </p>
          ) : races.length === 0 ? (
            <p className="text-muted">{t("races.empty")}</p>
          ) : (
            <ul className="grid gap-8 xl:grid-cols-2">
              {races.map((race) => (
                <RaceRow key={race.id.toString()} race={race} wallet={wallet} linked={linked} />
              ))}
            </ul>
          )}
        </div>
      </Section>
    </>
  );
}

/** /[lang]/races: every prize race from the module, with the enter flow. */
export function RacesApp() {
  return (
    <SolanaProvider>
      <Races />
    </SolanaProvider>
  );
}
