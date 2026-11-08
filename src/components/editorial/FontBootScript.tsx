"use client";

import { FONT_CHOICES, FONT_KEY } from "./fonts";

// Same trick as SettingsBootScript: runs while the HTML is parsed so a saved face never flashes, and is an
// inert text/plain block when React builds it in the browser on a soft language switch.
const BOOT = `(function(){try{var f=localStorage.getItem(${JSON.stringify(FONT_KEY)});if(${JSON.stringify(FONT_CHOICES)}.indexOf(f)>0)document.documentElement.dataset.font=f}catch(e){}})()`;

export function FontBootScript() {
  const onServer = typeof window === "undefined";
  return (
    <script
      type={onServer ? "text/javascript" : "text/plain"}
      suppressHydrationWarning
      dangerouslySetInnerHTML={{ __html: BOOT }}
    />
  );
}
