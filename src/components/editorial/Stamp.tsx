import { useId, type CSSProperties, type ReactNode } from "react";
import { cx } from "@/components/ui/cx";

export const STAMP_MOTIFS = ["chip", "drone", "resistor", "iron", "scope", "arm", "dish", "chain", "gear"] as const;

export type StampMotif = (typeof STAMP_MOTIFS)[number];

export type StampTone = "tomato" | "cobalt" | "green" | "copper" | "plum";

// Ink on stamp paper, one step lighter in the dark theme where the paper is a dark sepia.
const TONES: Record<StampTone, string> = {
  tomato: "text-[#b83f25] dark:text-[#f2866b]",
  cobalt: "text-[#2b4a99] dark:text-[#8fb0f2]",
  green: "text-[#0f6b48] dark:text-[#5fd6a2]",
  copper: "text-[#94561f] dark:text-[#e2a066]",
  plum: "text-[#6b3a7a] dark:text-[#d5a0e6]",
};

const W = 60;
const H = 72;

// Each motif is drawn in a 48 x 48 box with currentColor strokes.
const ART: Record<StampMotif, ReactNode> = {
  chip: (
    <>
      <rect x="14" y="14" width="20" height="20" rx="2.5" />
      <rect x="19" y="19" width="10" height="10" rx="1" opacity=".55" />
      <circle cx="17.5" cy="17.5" r="1" fill="currentColor" stroke="none" />
      {[0, 1, 2, 3].map((i) => (
        <path key={i} d={`M${18 + i * 4} 7v7M${18 + i * 4} 34v7M7 ${18 + i * 4}h7M34 ${18 + i * 4}h7`} />
      ))}
    </>
  ),
  drone: (
    <>
      <path d="M24 24L10 10M24 24L38 10M24 24L10 38M24 24L38 38" />
      {[[10, 10], [38, 10], [10, 38], [38, 38]].map(([x, y]) => (
        <g key={`${x}-${y}`}>
          <circle cx={x} cy={y} r="6" opacity=".55" />
          <path d={`M${x - 4.2} ${y}h8.4M${x} ${y - 4.2}v8.4`} strokeWidth="1" />
        </g>
      ))}
      <rect x="18.5" y="19.5" width="11" height="9" rx="2.5" fill="currentColor" fillOpacity=".16" />
      <circle cx="24" cy="31.5" r="1.6" />
    </>
  ),
  resistor: (
    <>
      <path d="M3 22h11M34 22h11" />
      <rect x="14" y="14.5" width="20" height="15" rx="7.5" />
      <path d="M19.5 15.5v13M23.5 14.8v14.4M27.5 15.5v13" strokeWidth="2.4" opacity=".75" />
      <path d="M31.2 16.6v10.8" strokeWidth="1.2" />
      <path d="M5 38l3.5-5 4 10 4-10 4 10 4-10 4 10 4-10 3.5 5" strokeWidth="1.3" opacity=".7" />
    </>
  ),
  iron: (
    <>
      <g transform="rotate(38 24 24)">
        <rect x="20.5" y="3" width="7" height="19" rx="3.5" />
        <path d="M22 9h4M22 12h4M22 15h4" strokeWidth="1" opacity=".55" />
        <rect x="21.5" y="22" width="5" height="4" rx="1" />
        <path d="M24 26v11" />
        <path d="M22.4 37h3.2L24 42z" fill="currentColor" />
      </g>
      <path d="M8 44h20M12 44v-3M24 44v-3" strokeWidth="1.2" />
      <path d="M36 28q-3.5-3 0-6t0-6" strokeWidth="1.1" opacity=".65" />
      <path d="M41 26q-3.5-3 0-6t0-5" strokeWidth="1.1" opacity=".45" />
    </>
  ),
  scope: (
    <>
      <rect x="5" y="7" width="38" height="27" rx="3.5" />
      <path d="M5 20.5h38M24 7v27M14.5 7v27M33.5 7v27M5 13.7h38M5 27.3h38" strokeWidth=".8" strokeDasharray="1 2.6" opacity=".6" />
      <path d="M8 21q4-10 8 0t8 0 8 0 8 0" strokeWidth="1.9" />
      <circle cx="13" cy="40.5" r="2.6" />
      <circle cx="23" cy="40.5" r="2.6" />
      <path d="M31 40.5h9" strokeWidth="2.2" opacity=".6" />
    </>
  ),
  arm: (
    <>
      <path d="M6 44h24" />
      <rect x="9" y="38" width="18" height="6" rx="1.5" />
      <circle cx="18" cy="35" r="3.2" />
      <path d="M18 35L26 19" strokeWidth="2.6" opacity=".7" />
      <circle cx="26" cy="19" r="3.2" />
      <path d="M26 19L38 13" strokeWidth="2.6" opacity=".7" />
      <circle cx="38" cy="13" r="2.4" />
      <path d="M38 13l6-1.5M38 13l5.5 4.5" />
    </>
  ),
  dish: (
    <>
      <path d="M9 12A22 22 0 0 0 31 34Z" fill="currentColor" fillOpacity=".12" />
      <path d="M20 23L31 12" />
      <circle cx="32.2" cy="10.8" r="1.8" />
      <path d="M21 29l-5 15M21 29l6 15M12 44h20" strokeWidth="1.4" />
      <path d="M36 18q4-1 5-5.5M38.5 22.5q7-2 8-10" strokeWidth="1.2" opacity=".7" />
    </>
  ),
  chain: (
    <g transform="rotate(-35 24 24)">
      <rect x="18" y="17.5" width="25" height="13" rx="6.5" />
      <rect x="5" y="17.5" width="25" height="13" rx="6.5" strokeWidth="5" stroke="var(--stamp-paper)" />
      <rect x="5" y="17.5" width="25" height="13" rx="6.5" />
    </g>
  ),
  gear: (
    <>
      {Array.from({ length: 8 }, (_, i) => (
        <rect key={i} x="21.2" y="6.5" width="5.6" height="6.2" rx="1" transform={`rotate(${i * 45} 24 24)`} />
      ))}
      <circle cx="24" cy="24" r="12" />
      <circle cx="24" cy="24" r="4.5" />
      <path d="M24 12v4.5M24 31.5V36M12 24h4.5M31.5 24H36" strokeWidth="1" opacity=".5" />
    </>
  ),
};

type StampProps = {
  motif: StampMotif;
  tone?: StampTone;
  /** The denomination in the corner: a section number, a count. */
  value?: string;
  /** Width in px; the stamp is 5:6. */
  size?: number;
  /** Degrees of tilt, as if pressed on by hand. */
  tilt?: number;
  className?: string;
};

function perforation() {
  const holes: ReactNode[] = [];
  for (let i = 0; i < 10; i++) {
    const x = 3 + i * 6;
    holes.push(<circle key={`t${i}`} cx={x} cy="0" r="2.1" />, <circle key={`b${i}`} cx={x} cy={H} r="2.1" />);
  }
  for (let i = 0; i < 12; i++) {
    const y = 3 + i * 6;
    holes.push(<circle key={`l${i}`} cx="0" cy={y} r="2.1" />, <circle key={`r${i}`} cx={W} cy={y} r="2.1" />);
  }
  return holes;
}

/** A perforated postage stamp inked with a piece of hardware. Decorative: it names nothing the page doesn't say. */
export function Stamp({ motif, tone = "tomato", value, size = 56, tilt = -3, className }: StampProps) {
  const id = useId();
  const style: CSSProperties = { width: size, height: (size * H) / W, transform: `rotate(${tilt}deg)` };
  return (
    <svg
      viewBox={`-2 -2 ${W + 4} ${H + 4}`}
      aria-hidden="true"
      focusable="false"
      style={style}
      className={cx("shrink-0 overflow-visible [filter:drop-shadow(0_1.5px_2px_rgb(0_0_0/0.16))] dark:[filter:drop-shadow(0_1.5px_2px_rgb(0_0_0/0.5))]", TONES[tone], className)}
    >
      <defs>
        <mask id={`${id}-cut`}>
          <rect x="-2" y="-2" width={W + 4} height={H + 4} fill="#fff" />
          <g fill="#000">{perforation()}</g>
        </mask>
      </defs>
      <rect width={W} height={H} fill="var(--stamp-paper)" stroke="var(--stamp-edge)" strokeWidth="0.8" mask={`url(#${id}-cut)`} />
      <rect x="5" y="5" width={W - 10} height={H - 10} fill="none" stroke="currentColor" strokeWidth="0.7" opacity=".55" />
      <g transform="translate(6 8)" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        {ART[motif]}
      </g>
      <g fill="currentColor" fontFamily="var(--font-mono, monospace)" fontSize="6.4" fontWeight="600">
        <text x="9" y={H - 9.5}>{value ?? ""}</text>
        <text x={W - 9} y={H - 9.5} textAnchor="end" opacity=".6" fontSize="4.6" letterSpacing=".6">
          iynk
        </text>
      </g>
    </svg>
  );
}
