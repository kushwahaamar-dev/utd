import { expect, test, type Browser, type Page } from "@playwright/test";
import boardlab from "../src/i18n/messages/en/boardlab.json";
import robotics from "../src/i18n/messages/en/robotics.json";
import together from "../src/i18n/messages/en/together.json";
import { dockCopy, openDock } from "./dock-shared";

// Rooms run on SpacetimeDB, so these tests need the local module (npm run stdb:start, npm run stdb:publish)
// and the app built with NEXT_PUBLIC_STDB_URI pointing at it. Each person is their own browser context:
// the database knows people by the identity token in their storage, and tabs of one context share it.

const ANA = { v: 1, name: "Ana", color: "#ef6a4c" };
const BO = { v: 1, name: "Bo", color: "#76a0e2" };
const main = (page: Page) => page.locator("main#main-en");
const fill = (template: string, params: Record<string, string>) => template.replace(/\{(\w+)\}/g, (_, k: string) => params[k] ?? "");

function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  return errors;
}

async function openLesson(page: Page, url: string) {
  await page.goto(url);
  await expect(main(page).locator(".cm-content")).toBeVisible({ timeout: 20_000 });
}

/** Opens the dock's Together tab and starts a room; this tab is the host and holds the keyboard. */
async function startRoom(page: Page) {
  const dock = await openDock(page, false);
  await dock.getByRole("tab", { name: dockCopy.tabs.together }).click();
  await dock.getByRole("button", { name: together.panel.start }).click();
  await expect(dock.getByText(together.bar.keyboardYou)).toBeVisible();
  await expect(page).toHaveURL(/[?&]room=[a-z0-9]{6}/);
  return dock;
}

/** Opens a room link's dock, which shows Together, and waits for the host's snapshot. */
async function joinRoom(page: Page, hostName: string) {
  const dock = await openDock(page, false);
  await expect(dock.getByRole("tab", { name: dockCopy.tabs.together })).toHaveAttribute("aria-selected", "true");
  await expect(dock.getByText(fill(together.bar.keyboardOther, { name: hostName }))).toBeVisible({ timeout: 15_000 });
  return dock;
}

/** A fresh browser profile for one person, with their room name already chosen. */
async function person(browser: Browser, baseURL: string | undefined, identity: typeof ANA) {
  const context = await browser.newContext({ baseURL });
  await context.addInitScript((who) => {
    if (!localStorage.getItem("iynk:together:v1")) localStorage.setItem("iynk:together:v1", JSON.stringify(who));
  }, identity);
  return context.newPage();
}

const failure = (page: Page, id: string) => main(page).locator(`[data-failure="${id}"]`);
// A lesson's faults sit in its rail's Break it tab; each screen opens its own tab.
const breakItTab = (page: Page) => main(page).getByRole("tab", { name: new RegExp(`^${boardlab.failures.title}`) }).click();
const view = (page: Page, name: string) => main(page).getByRole("radio", { name, exact: true });

test("two people in one room share the build, and only the keyboard holder changes it", async ({ browser, baseURL }) => {
  test.setTimeout(120_000);

  const a = await person(browser, baseURL, ANA);
  const errorsA = watchErrors(a);
  await openLesson(a, "/en/boards/uno-r3/blink");
  const dockA = await startRoom(a);

  // Before anyone joins, the host breaks the board: the joiner gets it from the host's snapshot.
  await breakItTab(a);
  await failure(a, "short-5v").getByRole("button", { name: boardlab.failures.trigger }).click();
  await expect(failure(a, "short-5v")).toContainText(boardlab.failures.active);

  const b = await person(browser, baseURL, BO);
  const errorsB = watchErrors(b);
  await openLesson(b, a.url());
  const dockB = await joinRoom(b, ANA.name);
  await breakItTab(b);
  await expect(failure(b, "short-5v")).toContainText(boardlab.failures.active);

  // A view change is free for everyone; it travels both ways.
  await view(a, boardlab.view.schematic).click();
  await expect(view(b, boardlab.view.schematic)).toHaveAttribute("aria-checked", "true");

  // The holder's code reaches the other tab.
  await main(a).locator(".cm-content").click();
  await a.keyboard.press("ControlOrMeta+End");
  await a.keyboard.type("\n// wired by Ana");
  await expect(main(b).locator(".cm-content")).toContainText("// wired by Ana", { timeout: 10_000 });

  // Without the keyboard, breaking the board is refused, on both screens.
  await failure(b, "brownout").getByRole("button", { name: boardlab.failures.trigger }).click();
  await expect(dockB.getByText(fill(together.bar.denied, { name: ANA.name }))).toBeVisible();
  await expect(failure(b, "brownout")).not.toContainText(boardlab.failures.active);
  await expect(failure(a, "brownout")).not.toContainText(boardlab.failures.active);
  await expect(failure(b, "short-5v")).toContainText(boardlab.failures.active);

  // The host passes the keyboard; now the other tab changes the build for both.
  await dockA.getByRole("button", { name: together.bar.pass, exact: true }).click();
  await expect(dockB.getByText(together.bar.keyboardYou)).toBeVisible();
  await failure(b, "brownout").getByRole("button", { name: boardlab.failures.trigger }).click();
  await expect(failure(a, "brownout")).toContainText(boardlab.failures.active);
  await expect(failure(b, "brownout")).toContainText(boardlab.failures.active);

  expect(errorsA).toEqual([]);
  expect(errorsB).toEqual([]);
});

test("a bench's steps reach the joiner's figure, then each new step reaches both", async ({ browser, baseURL }) => {
  test.setTimeout(120_000);
  const step = (page: Page, id: string) => main(page).locator(`[data-step="${id}"]`);
  const doIt = (page: Page, id: string) => step(page, id).getByRole("button", { name: new RegExp(`^${robotics.steps.doIt} ?:`) });

  const a = await person(browser, baseURL, ANA);
  const errorsA = watchErrors(a);
  await a.goto("/en/robotics/esp32-s3-build");
  await expect(main(a).locator("iframe")).toHaveCount(1);
  await startRoom(a);
  await doIt(a, "strip").click();
  await expect(step(a, "strip")).toContainText(robotics.steps.done, { timeout: 15_000 });

  const b = await person(browser, baseURL, BO);
  const errorsB = watchErrors(b);
  await b.goto(a.url());
  const dockB = await joinRoom(b, ANA.name);
  await expect(step(b, "strip")).toContainText(robotics.steps.done, { timeout: 15_000 });

  await doIt(a, "pick-place").click();
  await expect(step(a, "pick-place")).toContainText(robotics.steps.done, { timeout: 15_000 });
  await expect(step(b, "pick-place")).toContainText(robotics.steps.done, { timeout: 15_000 });

  // The joiner can't build without the keyboard.
  await doIt(b, "headers").click();
  await expect(dockB.getByText(fill(together.bar.denied, { name: ANA.name }))).toBeVisible();

  expect(errorsA).toEqual([]);
  expect(errorsB).toEqual([]);
});

test("chat reaches both people, and the host can remove someone", async ({ browser, baseURL }) => {
  test.setTimeout(120_000);

  const a = await person(browser, baseURL, ANA);
  const errorsA = watchErrors(a);
  await openLesson(a, "/en/boards/uno-r3/blink");
  const dockA = await startRoom(a);

  const b = await person(browser, baseURL, BO);
  const errorsB = watchErrors(b);
  await openLesson(b, a.url());
  const dockB = await joinRoom(b, ANA.name);
  await expect(dockA.getByText(fill(together.bar.people.other, { count: "2" }))).toBeVisible({ timeout: 15_000 });

  await dockB.getByLabel(together.chat.label).fill("which pin is the LED on?");
  await dockB.getByRole("button", { name: together.chat.send }).click();
  await expect(dockA.getByRole("log").getByText("which pin is the LED on?")).toBeVisible({ timeout: 10_000 });
  await expect(dockB.getByRole("log").getByText("which pin is the LED on?")).toBeVisible();

  await dockA.getByRole("button", { name: fill(together.bar.remove, { name: BO.name }) }).click();
  await a.getByRole("dialog").getByRole("button", { name: together.bar.removeYes, exact: true }).click();
  await expect(dockB.getByText(together.panel.ended.removed)).toBeVisible({ timeout: 15_000 });

  expect(errorsA).toEqual([]);
  expect(errorsB).toEqual([]);
});
