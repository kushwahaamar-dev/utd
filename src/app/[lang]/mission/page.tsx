import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { PageHead, page } from "@/components/editorial/Editorial";
import { MissionApp } from "@/components/mission/MissionApp";
import { cx } from "@/components/ui/cx";
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
    <Suspense fallback={<div className={cx(page, "min-h-[70vh]")} aria-busy="true" />}>
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
    <MissionApp lang={lang} messages={messages} head={<PageHead label={t("head.kicker")} title={t("head.title")} lede={<p>{t("head.lede")}</p>} />} />
  );
}
