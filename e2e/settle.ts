import type { Page } from "@playwright/test";

/** Waits for the page's entrance animations to finish, so axe measures the colours people actually see. */
export async function settle(page: Page) {
  await page.waitForFunction(
    () => document.getAnimations().every((a) => a.playState !== "running" || a.effect?.getTiming().iterations === Infinity),
    null,
    { timeout: 10_000 },
  );
}
