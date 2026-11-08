import type { Locale } from "@/i18n/config";
import { getT } from "@/i18n/server";
import { FooterNav } from "./FooterNav";
import { NAV, type NavId } from "./nav";

export async function SiteFooter({ lang }: { lang: Locale }) {
  const [t, common] = await Promise.all([getT(lang, "shell"), getT(lang, "common")]);
  const labels = Object.fromEntries(NAV.map((entry) => [entry.id, t(`nav.${entry.id}`)])) as Record<NavId, string>;
  return (
    <footer className="site-footer border-t border-rule">
      <div className="shell-frame">
        <div className="grid grid-cols-1 gap-x-6 gap-y-10 pt-[clamp(40px,5vw,72px)] lg:grid-cols-12">
          <div className="min-w-0 lg:col-span-4">
            <p className="max-w-[28ch] text-[15px] font-medium leading-snug tracking-[-0.014em] text-balance text-ink">{common("site.tagline")}</p>
            <p className="mt-3 max-w-[46ch] text-[13px] leading-relaxed text-muted">{t("footer.privacy")}</p>
          </div>
          <nav aria-labelledby={`footer-pages-${lang}`} className="min-w-0 lg:col-span-7 lg:col-start-6">
            <h2 id={`footer-pages-${lang}`} className="sr-only">
              {t("footer.pages")}
            </h2>
            <FooterNav
              lang={lang}
              labels={labels}
              headings={{ labs: t("nav.label"), site: common("site.name"), language: t("language.label") }}
            />
          </nav>
        </div>
        <div className="mt-[clamp(32px,4vw,56px)] flex flex-col gap-1 border-t border-rule py-4 sm:flex-row sm:items-baseline sm:justify-between">
          <p className="shell-meta">{common("site.name")}</p>
          <a
            href="https://april-zhu.com/colorfigures"
            rel="noopener noreferrer"
            className="inline-flex min-h-11 items-center text-xs leading-snug text-muted underline-offset-4 hover:text-ink sm:text-end"
          >
            {t("footer.figures")}
          </a>
        </div>
      </div>
    </footer>
  );
}
