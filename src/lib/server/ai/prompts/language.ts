import "server-only";
import type { Locale } from "@/i18n/config";

/** English names, the way prompts name languages. */
export const LANGUAGE_NAMES: Record<Locale, string> = {
  en: "English",
  es: "Spanish",
  fr: "French",
  de: "German",
  zh: "Simplified Chinese",
  hi: "Hindi",
};

/** Untrusted text (names, chat, bench dumps) goes inside a fence the model is told to treat as data. */
export function quoted(label: string, text: string): string {
  const safe = text.replaceAll("<<<", "‹‹‹").replaceAll(">>>", "›››");
  return `${label}:\n<<<\n${safe}\n>>>`;
}
