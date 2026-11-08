export const FONT_KEY = "iynk-font";

export const FONT_CHOICES = ["sans", "serif", "mono"] as const;

export type FontChoice = (typeof FONT_CHOICES)[number];

export function isFontChoice(value: unknown): value is FontChoice {
  return FONT_CHOICES.includes(value as FontChoice);
}

export const FONT_NAMES: Record<FontChoice, string> = { sans: "Geist Sans", serif: "Newsreader", mono: "Geist Mono" };

const listeners = new Set<() => void>();
let watcher: MutationObserver | null = null;

export function getFont(): FontChoice {
  const value = document.documentElement.dataset.font;
  return isFontChoice(value) ? value : "sans";
}

/** The reading face lives on <html data-font>; this follows that attribute, whoever sets it. */
export function subscribeFont(listener: () => void): () => void {
  listeners.add(listener);
  if (!watcher) {
    watcher = new MutationObserver(() => listeners.forEach((notify) => notify()));
    watcher.observe(document.documentElement, { attributes: true, attributeFilter: ["data-font"] });
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      watcher?.disconnect();
      watcher = null;
    }
  };
}

export function setFont(choice: FontChoice) {
  if (choice === "sans") delete document.documentElement.dataset.font;
  else document.documentElement.dataset.font = choice;
  try {
    localStorage.setItem(FONT_KEY, choice);
  } catch {
    // a private window keeps the choice for this page only
  }
}
