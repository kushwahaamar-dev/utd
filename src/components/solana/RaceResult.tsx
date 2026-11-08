import { cx } from "@/components/ui";
import { addressUrl, shortAddress, txUrl } from "@/lib/solana/config";
import { formatLap, formatSol, sharePercent, type Lamports } from "./format";

export type RacePayoutRow = {
  player: string;
  name?: string;
  lamports: Lamports;
  lapMs?: number;
};

export type RaceResultLabels = {
  title: string;
  place: string;
  winner: string;
  time: string;
  prize: string;
  share: string;
  total: string;
  viewTx: string;
};

export const RACE_RESULT_LABELS: RaceResultLabels = {
  title: "Payout",
  place: "Place",
  winner: "Winner",
  time: "Lap",
  prize: "Prize",
  share: "Share",
  total: "Pot",
  viewTx: "View transaction on Solana Explorer",
};

const ORDINAL = ["1st", "2nd", "3rd"];

/** The settled split of a pot, in rank order, with the transaction that paid it. */
export function RaceResult({
  potLamports,
  payouts,
  signature,
  labels = RACE_RESULT_LABELS,
  className,
}: {
  potLamports: Lamports;
  payouts: RacePayoutRow[];
  signature?: string | null;
  labels?: RaceResultLabels;
  className?: string;
}) {
  return (
    <section aria-label={labels.title} className={cx("rounded-[4px] border border-rule bg-surface p-5", className)}>
      <table className="w-full border-collapse font-ui text-sm">
        <caption className="sr-only">{labels.title}</caption>
        <thead>
          <tr className="text-start text-xs text-muted">
            <th scope="col" className="pb-2 text-start font-normal">{labels.place}</th>
            <th scope="col" className="pb-2 text-start font-normal">{labels.winner}</th>
            <th scope="col" className="pb-2 text-end font-normal">{labels.time}</th>
            <th scope="col" className="pb-2 text-end font-normal">{labels.prize}</th>
            <th scope="col" className="pb-2 text-end font-normal">{labels.share}</th>
          </tr>
        </thead>
        <tbody>
          {payouts.map((p, i) => (
            <tr key={p.player} className="border-t border-rule">
              <th scope="row" className="py-2 text-start font-medium">{ORDINAL[i] ?? `${i + 1}th`}</th>
              <td className="py-2">
                <a href={addressUrl(p.player)} target="_blank" rel="noreferrer" className="underline-offset-2 hover:underline">
                  {p.name ?? shortAddress(p.player)}
                </a>
              </td>
              <td className="py-2 text-end tabular">{p.lapMs ? formatLap(p.lapMs) : "–"}</td>
              <td className="py-2 text-end tabular">{formatSol(p.lamports)}</td>
              <td className="py-2 text-end tabular text-muted">{sharePercent(p.lamports, potLamports)}%</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-line">
            <th scope="row" colSpan={3} className="pt-2 text-start font-medium">{labels.total}</th>
            <td className="pt-2 text-end tabular font-medium">{formatSol(potLamports)}</td>
            <td />
          </tr>
        </tfoot>
      </table>
      {signature ? (
        <p className="mt-4 font-ui text-xs">
          <a href={txUrl(signature)} target="_blank" rel="noreferrer" className="text-muted underline-offset-2 hover:text-ink hover:underline">
            {labels.viewTx} ({shortAddress(signature)})
          </a>
        </p>
      ) : null}
    </section>
  );
}
