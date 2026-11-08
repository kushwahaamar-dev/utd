import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Stamp } from "@/components/editorial";
import { eyebrow } from "@/components/editorial/Editorial";
import { MissionApp } from "@/components/mission/MissionApp";
import { isLocale } from "@/i18n/config";
import { alternatesFor } from "@/i18n/seo";
import { getMessages, getT } from "@/i18n/server";

type Props = { params: Promise<{ lang: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { lang } = await params;
  if (!isLocale(lang)) return {};
  const t = await getT(lang, "mission");
  return { title: t("meta.title"), description: t("meta.description"), alternates: alternatesFor(lang, "/mission") };
}

export default function MissionPage({ params }: Props) {
  return (
    <Suspense fallback={<div className="min-h-[70vh]" aria-busy="true" />}>
      <Mission params={params} />
    </Suspense>
  );
}

async function Mission({ params }: Props) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  const messages = await getMessages(lang, "mission");
  const t = await getT(lang, "mission");

  return (
    <MissionApp lang={lang} messages={messages} head={
        <header className="pt-[clamp(72px,11vw,136px)]">
          <div className="flex items-center gap-3.5">
            <Stamp motif="arm" tone="plum" value="MC" size={46} tilt={-3} />
            <p className={eyebrow}>{t("head.kicker")}</p>
          </div>
          <h1 className="mt-7 text-balance text-[clamp(24px,3.2vw,32px)] font-medium leading-[1.2] tracking-[-0.022em]">{t("head.title")}</h1>
          <p className="mt-4 max-w-[46ch] text-pretty text-muted">{t("head.lede")}</p>
        </header>
      } />
  );
}
