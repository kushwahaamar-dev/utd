"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { Locale } from "@/i18n/config";
import type { Messages } from "@/i18n/namespaces";
import { createTranslator, type Translate } from "@/i18n/translate";

export type MissionMessages = Messages["mission"];
export type MissionT = Translate<MissionMessages>;

type Value = { locale: Locale; t: MissionT };

const Text = createContext<Value | null>(null);

/** The mission strings a server page loaded with getMessages(lang, "mission"). */
export function MissionTextProvider({ locale, messages, children }: { locale: Locale; messages: MissionMessages; children: ReactNode }) {
  const value = useMemo(() => ({ locale, t: createTranslator(locale, messages, `${locale}/mission`) }), [locale, messages]);
  return <Text.Provider value={value}>{children}</Text.Provider>;
}

export function useMissionText(): Value {
  const value = useContext(Text);
  if (!value) throw new Error("iynk mission: render inside <MissionTextProvider>.");
  return value;
}

export function useMissionT(): MissionT {
  return useMissionText().t;
}
