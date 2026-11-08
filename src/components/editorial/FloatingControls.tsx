"use client";

import { useSyncExternalStore, type ReactNode } from "react";
import { cx } from "@/components/ui/cx";
import { setSetting } from "@/lib/settings/settings";
import { useResolvedTheme } from "@/lib/settings/hooks";
import { FONT_CHOICES, FONT_NAMES, getFont, isFontChoice, setFont, subscribeFont } from "./fonts";

export type FloatingControlsLabels = { font: string; theme: string; light: string; dark: string };

function Chevrons() {
  return (
    <svg aria-hidden="true" viewBox="0 0 12 12" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-muted">
      <path d="M3.5 4.7L6 2.5l2.5 2.2M3.5 7.3L6 9.5l2.5-2.2" />
    </svg>
  );
}

function ThemeButton({ label, active, onClick, children }: { label: string; active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      className={cx(
        "grid size-8 place-items-center rounded-full transition-colors [@media(pointer:coarse)]:size-10",
        active ? "bg-sunken text-ink shadow-[inset_0_0_0_1px_var(--card-line)]" : "text-muted hover:text-ink",
      )}
    >
      {children}
    </button>
  );
}

/** The floating pill at the page's corner: the reading face and the theme. */
export function FloatingControls({ labels, className }: { labels: FloatingControlsLabels; className?: string }) {
  const font = useSyncExternalStore(subscribeFont, getFont, () => "sans" as const);
  const theme = useResolvedTheme();

  return (
    <div
      className={cx(
        "fixed bottom-4 end-4 z-40 flex items-center gap-1 rounded-full border border-(--card-line) bg-surface/90 p-1 shadow-ink-lg backdrop-blur-md",
        className,
      )}
    >
      <label className="relative flex h-8 items-center gap-2 rounded-full ps-1 pe-2 text-[13px] has-[select:focus-visible]:outline-2 has-[select:focus-visible]:outline-offset-1 has-[select:focus-visible]:outline-(--focus) [@media(pointer:coarse)]:h-10">
        <span aria-hidden="true" className="grid size-6 place-items-center rounded-[7px] bg-select font-body text-[11px] font-medium text-white">
          Aa
        </span>
        <span aria-hidden="true" className="whitespace-nowrap">
          {FONT_NAMES[font]}
        </span>
        <Chevrons />
        <select
          aria-label={labels.font}
          value={font}
          onChange={(event) => isFontChoice(event.target.value) && setFont(event.target.value)}
          className="absolute inset-0 size-full cursor-pointer opacity-0"
        >
          {FONT_CHOICES.map((choice) => (
            <option key={choice} value={choice}>
              {FONT_NAMES[choice]}
            </option>
          ))}
        </select>
      </label>
      <span aria-hidden="true" className="h-4 w-px bg-rule" />
      <div role="group" aria-label={labels.theme} className="flex items-center">
        <ThemeButton label={labels.light} active={theme === "light"} onClick={() => setSetting("theme", "light")}>
          <svg aria-hidden="true" viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <circle cx="10" cy="10" r="3.4" />
            <path d="M10 2.5v1.8M10 15.7v1.8M2.5 10h1.8M15.7 10h1.8M4.7 4.7l1.3 1.3M14 14l1.3 1.3M15.3 4.7L14 6M6 14l-1.3 1.3" />
          </svg>
        </ThemeButton>
        <ThemeButton label={labels.dark} active={theme === "dark"} onClick={() => setSetting("theme", "dark")}>
          <svg aria-hidden="true" viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round">
            <path d="M16.5 11.6A6.8 6.8 0 0 1 8.4 3.5a6.8 6.8 0 1 0 8.1 8.1z" />
          </svg>
        </ThemeButton>
      </div>
    </div>
  );
}
