"use client";

import Link from "next/link";
import { eyebrow } from "@/components/editorial/Editorial";
import { Icon } from "@/components/ui";
import { useLocale } from "@/i18n/client";
import { htmlLang } from "@/i18n/config";
import { explorerUrl } from "@/lib/solana/config";
import type { Credential } from "@/lib/stdb";
import { skillTitle } from "./CredentialCard";
import { useSolanaT } from "./SolanaText";

/** A credential as the module mirrors it: fast, with a link that re-reads the account straight from Solana. */
export function MirrorCredential({ credential }: { credential: Credential }) {
  const t = useSolanaT();
  const locale = useLocale();
  const date = new Intl.DateTimeFormat(htmlLang(locale), { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(Number(credential.at.microsSinceUnixEpoch / 1000n)),
  );
  const titleId = `mirror-${credential.pda || credential.id}`;
  return (
    <article aria-labelledby={titleId} className="grid gap-3 rounded-[4px] border border-rule bg-surface p-5">
      <p className={eyebrow}>{t("credential.issued", { date })}</p>
      <h3 id={titleId} className="text-[clamp(20px,2vw,26px)] leading-tight font-medium tracking-[-0.02em]">
        {skillTitle(t, credential.skill)}
      </h3>
      <div className="-my-2 flex flex-wrap gap-x-6 font-body text-sm font-semibold">
        {credential.pda ? (
          <Link href={`/${locale}/verify?credential=${credential.pda}`} className="inline-flex min-h-11 items-center gap-1.5">
            {t("credential.verifyOnChain")}
            <Icon name="chevron-right" size={16} />
          </Link>
        ) : null}
        {credential.sig ? (
          <a href={explorerUrl("tx", credential.sig)} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-1.5">
            {t("credential.tx")}
            <Icon name="external" size={16} />
          </a>
        ) : null}
      </div>
    </article>
  );
}
