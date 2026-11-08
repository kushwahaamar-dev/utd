import { cx } from "@/components/ui";
import { addressUrl, shortAddress, txUrl } from "@/lib/solana/config";
import { parseSkillId } from "@/lib/verify/skill";

export type CredentialStampLabels = {
  score: string;
  issued: string;
  verified: string;
  viewTx: string;
  viewAccount: string;
};

export const CREDENTIAL_STAMP_LABELS: CredentialStampLabels = {
  score: "Score",
  issued: "Issued",
  verified: "Verified on Solana devnet",
  viewTx: "Transaction",
  viewAccount: "Credential account",
};

const LAB_COLOR = { drone: "var(--color-tomato)", board: "var(--color-cobalt)", robotics: "var(--color-mint)", flight: "var(--color-mustard)" } as const;

// Perforated edge: holes along the border, solid inside. The first mask layer
// punches a hole at every 14px grid corner; the second covers everything but
// the outer 7px, so only the border ring keeps the holes.
const PERFORATION = {
  maskImage: "radial-gradient(circle at 7px 7px, transparent 4px, #000 4.5px), linear-gradient(#000, #000)",
  maskSize: "14px 14px, calc(100% - 14px) calc(100% - 14px)",
  maskPosition: "-7px -7px, 50% 50%",
  maskRepeat: "repeat, no-repeat",
  WebkitMaskImage: "radial-gradient(circle at 7px 7px, transparent 4px, #000 4.5px), linear-gradient(#000, #000)",
  WebkitMaskSize: "14px 14px, calc(100% - 14px) calc(100% - 14px)",
  WebkitMaskPosition: "-7px -7px, 50% 50%",
  WebkitMaskRepeat: "repeat, no-repeat",
} as const;

/**
 * A credential as a postage stamp. Colors come from the theme tokens
 * (--stamp-paper, --stamp-edge, --ink, --muted); the band color follows the lab.
 * `title` is the human name of the skill, which the caller localizes.
 */
export function CredentialStamp({
  skillId,
  title,
  score,
  issuedAt,
  address,
  signature,
  labels = CREDENTIAL_STAMP_LABELS,
  className,
}: {
  skillId: string;
  title: string;
  score: number;
  /** Unix seconds. */
  issuedAt: number;
  address?: string;
  signature?: string;
  labels?: CredentialStampLabels;
  className?: string;
}) {
  const lab = parseSkillId(skillId)?.lab;
  const color = lab ? LAB_COLOR[lab] : "var(--color-blush)";
  const date = new Date(issuedAt * 1000).toISOString().slice(0, 10);

  return (
    <figure className={cx("m-0 inline-block max-w-full [filter:drop-shadow(0_2px_3px_var(--shadow-c))]", className)}>
      <div className="p-[7px]" style={{ background: "var(--stamp-paper)", ...PERFORATION }}>
        <div className="grid gap-3 p-4 text-ink" style={{ outline: "1px solid var(--stamp-edge)", outlineOffset: "-1px" }}>
          <div className="h-2 w-full" style={{ background: color }} aria-hidden="true" />
          <figcaption className="grid gap-1">
            <span className="font-ui text-[11px] tracking-[0.08em] text-muted uppercase">{labels.verified}</span>
            <span className="text-lg leading-tight font-medium tracking-[-0.01em]">{title}</span>
          </figcaption>
          <div className="flex items-end justify-between gap-4 font-ui">
            <span>
              <span className="block text-[11px] text-muted">{labels.score}</span>
              <span className="text-4xl leading-none tabular">{score}</span>
            </span>
            <span className="text-end text-xs">
              <span className="block text-muted">{labels.issued}</span>
              <time dateTime={date} className="tabular">{date}</time>
            </span>
          </div>
          {address || signature ? (
            <p className="flex flex-wrap gap-x-3 gap-y-1 border-t border-dashed pt-2 font-ui text-[11px]" style={{ borderColor: "var(--stamp-edge)" }}>
              {address ? (
                <a href={addressUrl(address)} target="_blank" rel="noreferrer" className="text-muted underline-offset-2 hover:text-ink hover:underline">
                  {labels.viewAccount} {shortAddress(address)}
                </a>
              ) : null}
              {signature ? (
                <a href={txUrl(signature)} target="_blank" rel="noreferrer" className="text-muted underline-offset-2 hover:text-ink hover:underline">
                  {labels.viewTx} {shortAddress(signature)}
                </a>
              ) : null}
            </p>
          ) : null}
        </div>
      </div>
    </figure>
  );
}
