"use client";

import Link from "next/link";
import { Icon } from "@/components/ui";
import { useLocale } from "@/i18n/client";
import { SolanaText, useSolanaT } from "./SolanaText";

function Inner({ className }: { className?: string }) {
  const t = useSolanaT();
  const locale = useLocale();
  return (
    <Link href={`/${locale}/races`} className={className ?? "inline-flex min-h-11 items-center gap-1 font-ui text-sm font-bold"}>
      {t("races.title")}
      <Icon name="chevron-right" size={16} />
    </Link>
  );
}

/** A plain link to /races; loads its own strings, so it can sit anywhere under the language layout. */
export function RacesLink({ className }: { className?: string }) {
  return (
    <SolanaText>
      <Inner className={className} />
    </SolanaText>
  );
}
