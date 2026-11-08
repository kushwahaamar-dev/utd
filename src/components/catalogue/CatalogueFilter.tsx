"use client";

import { useId, useRef, useState } from "react";
import { useCommonT } from "@/i18n/client";

/**
 * A search box over the cards of the index it sits in. The cards stay server
 * rendered: each <li data-catalogue-item data-search="…"> is shown or hidden here,
 * and a group with nothing left to show hides with them.
 */
export function CatalogueFilter({ total }: { total: number }) {
  const t = useCommonT();
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [shown, setShown] = useState(total);

  function apply(query: string) {
    const root = input.current?.closest<HTMLElement>("[data-catalogue]");
    if (!root) return;
    const words = query.toLocaleLowerCase().split(/\s+/).filter(Boolean);
    let visible = 0;
    for (const item of root.querySelectorAll<HTMLElement>("[data-catalogue-item]")) {
      const hay = (item.dataset.search ?? "").toLocaleLowerCase();
      const match = words.every((w) => hay.includes(w));
      item.hidden = !match;
      if (match) visible += 1;
    }
    for (const group of root.querySelectorAll<HTMLElement>("[data-catalogue-group]")) {
      group.hidden = !group.querySelector("[data-catalogue-item]:not([hidden])");
    }
    setShown(visible);
  }

  return (
    <div className="flex w-full max-w-sm flex-col gap-1.5">
      <label htmlFor={id} className="font-ui text-[11px] font-medium uppercase leading-4 tracking-[0.08em] text-muted">
        {t("catalogue.search")}
      </label>
      <input
        ref={input}
        id={id}
        type="search"
        autoComplete="off"
        spellCheck={false}
        onChange={(e) => apply(e.target.value)}
        className="ink-field min-h-11 w-full"
      />
      <p role="status" aria-live="polite" className="tabular min-h-5 font-ui text-xs text-muted">
        {shown === total ? t("catalogue.all", { total }) : shown === 0 ? t("catalogue.none") : t("catalogue.some", { shown, total })}
      </p>
    </div>
  );
}
