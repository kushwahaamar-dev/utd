import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import {
  Column,
  CompactList,
  FloatingControls,
  GlyphScene,
  KeyValueFooter,
  LiveNow,
  PcbTraces,
  ProjectCard,
  SelectionBox,
  Section,
  Stamp,
  Timeline,
  riseIndex,
} from "@/components/editorial";
import { getDataMessages } from "@/components/data";
import { ArrowLink } from "@/components/marketing";
import { BOARD_IDS, DRONE_IDS, ROBOTICS_IDS } from "@/content/ids";
import { isLocale } from "@/i18n/config";
import { alternatesFor } from "@/i18n/seo";
import { getT } from "@/i18n/server";

type Props = PageProps<"/[lang]">;

const counts = { boards: BOARD_IDS.length, benches: ROBOTICS_IDS.length, drones: DRONE_IDS.length };
const REPO = "https://github.com/kushwahaamar-dev/utd";

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { lang } = await params;
  if (!isLocale(lang)) return {};
  const [t, common] = await Promise.all([getT(lang, "shell"), getT(lang, "common")]);
  return {
    // The landing's tab reads as the product, not "Dashboard".
    title: { absolute: `${common("site.name")} · ${common("site.tagline")}` },
    description: t("dashboard.metaDescription", counts),
    alternates: alternatesFor(lang, ""),
  };
}

export default function LandingPage({ params }: Props) {
  return (
    <Suspense fallback={<div className="min-h-[70vh]" aria-busy="true" />}>
      <Landing params={params} />
    </Suspense>
  );
}

async function Landing({ params }: Pick<Props, "params">) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  const [t, data] = await Promise.all([getT(lang, "shell"), getDataMessages(lang)]);
  const [lead, focus, tail] = t("landing.title").split("*");

  return (
    <div className="relative pb-[clamp(96px,12vw,160px)]">
      <PcbTraces />
      <Column className="relative pt-[clamp(72px,11vw,136px)]">
        <h1 style={riseIndex(0)} className="rise text-base font-normal leading-[1.6] tracking-[-0.011em] text-muted text-pretty">
          {lead}
          <SelectionBox>{focus}</SelectionBox>
          {tail}
        </h1>
        <p style={riseIndex(1)} className="rise mt-6 text-pretty text-muted">
          {t("landing.p1")}
        </p>
        <p style={riseIndex(2)} className="rise mt-4 text-pretty text-muted">
          {t("landing.p2")}
        </p>
      </Column>

      <Column wide className="relative mt-[clamp(32px,5vw,56px)]">
        <div style={riseIndex(3)} className="rise">
          <GlyphScene
            labels={{
              scene: t("landing.scene.alt"),
              time: t("landing.scene.time"),
              dawn: t("landing.scene.dawn"),
              noon: t("landing.scene.noon"),
              dusk: t("landing.scene.dusk"),
              night: t("landing.scene.night"),
            }}
          />
        </div>
      </Column>

      <Column className="relative">
        <Section id={`labs-${lang}`} n="01" motif="chip" tone="tomato" tilt={-4} title={t("landing.labs.title")}>
          <div className="grid grid-cols-1 gap-x-5 gap-y-9 min-[480px]:grid-cols-2">
            <ProjectCard
              href={`/${lang}/boards`}
              title={t("landing.labs.board.title")}
              meta={t("landing.labs.board.meta", { count: counts.boards })}
              description={t("landing.labs.board.text")}
              image={{ src: "/thumbs/boards/uno-r3.webp", width: 720, height: 449 }}
              tone="var(--color-tomato)"
            />
            <ProjectCard
              href={`/${lang}/robotics`}
              title={t("landing.labs.robotics.title")}
              meta={t("landing.labs.robotics.meta", { count: counts.benches })}
              description={t("landing.labs.robotics.text")}
              image={{ src: "/thumbs/robotics/tb6612fng.webp", width: 720, height: 524 }}
              tone="var(--color-mint-m)"
            />
            <ProjectCard
              href={`/${lang}/drones`}
              title={t("landing.labs.drones.title")}
              meta={t("landing.labs.drones.meta", { count: counts.drones })}
              description={t("landing.labs.drones.text")}
              image={{ src: "/thumbs/drones/quad5.webp", width: 720, height: 431 }}
              tone="var(--color-cobalt)"
            />
            <ProjectCard
              href={`/${lang}/drones/racer/fly`}
              title={t("landing.labs.flight.title")}
              meta={t("landing.labs.flight.meta")}
              description={t("landing.labs.flight.text")}
              image={{ src: "/thumbs/drones/racer.webp", width: 720, height: 450 }}
              tone="var(--color-mustard)"
            />
          </div>
        </Section>

        <Section id={`mission-${lang}`} n="02" motif="arm" tone="plum" tilt={3} title={t("landing.mission.title")}>
          <p className="max-w-[44ch] text-pretty text-muted">{t("landing.mission.text")}</p>
          <ArrowLink href={`/${lang}/mission`} className="mt-3">
            {t("landing.mission.cta")}
          </ArrowLink>
        </Section>

        <Section id={`live-${lang}`} n="03" motif="scope" tone="green" tilt={-3} title={t("landing.live.title")}>
          <LiveNow
            locale={lang}
            messages={data}
            course="quad5-race"
            lobbyHref={`/${lang}/together`}
            labels={{ course: t("landing.live.course"), lobby: t("landing.live.lobby") }}
          />
        </Section>

        <Section id={`solana-${lang}`} n="04" motif="chain" tone="copper" tilt={4} title={t("landing.solana.title")}>
          <CompactList
            items={[
              { title: t("landing.solana.pools.title"), description: t("landing.solana.pools.text"), href: `/${lang}/together`, icon: "target" },
              { title: t("landing.solana.creds.title"), description: t("landing.solana.creds.text"), href: `/${lang}/passport`, icon: "lock" },
            ]}
          />
          <div className="mt-4 flex flex-wrap gap-x-6">
            <ArrowLink href={`/${lang}/passport`}>{t("landing.solana.passport")}</ArrowLink>
            <ArrowLink href={`/${lang}/verify`}>{t("landing.solana.verify")}</ArrowLink>
          </div>
        </Section>

        <Section id={`built-${lang}`} n="05" motif="gear" tone="cobalt" tilt={-2} title={t("landing.built.title")}>
          <Timeline
            items={(["stdb", "agents", "chain", "cloud"] as const).map((id) => ({
              title: t(`landing.built.${id}.title`),
              meta: t(`landing.built.${id}.meta`),
              text: t(`landing.built.${id}.text`),
            }))}
          />
        </Section>

        <footer className="mt-[clamp(88px,11vw,144px)]">
          <div aria-hidden="true" className="mb-6 flex justify-end gap-1">
            <Stamp motif="dish" tone="cobalt" value="HU" size={52} tilt={-6} />
            <Stamp motif="drone" tone="tomato" value="26" size={52} tilt={5} className="-ms-2 mt-3" />
          </div>
          <KeyValueFooter
            rows={[
              { label: t("landing.footer.builtOn"), value: "Next.js, SpacetimeDB" },
              { label: t("landing.footer.agents"), value: "NVIDIA Nemotron" },
              { label: t("landing.footer.chain"), value: "Solana" },
              { label: t("landing.footer.cloud"), value: "Vultr" },
              { label: t("landing.footer.source"), value: "kushwahaamar-dev/utd", href: REPO },
            ]}
          />
        </footer>
      </Column>

      <FloatingControls
        labels={{ font: t("landing.controls.font"), theme: t("landing.controls.theme"), light: t("landing.controls.light"), dark: t("landing.controls.dark") }}
      />
    </div>
  );
}
