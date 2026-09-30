/**
 * Privacy and offline acceptance check (docs/PRIVACY.md).
 *
 *   pnpm build && pnpm privacy:check
 *
 * Serves the production build, drives Chrome with puppeteer-core, and fails if
 *  - any request goes anywhere but the app's own origin, or
 *  - processing or any export fails once the network is switched off.
 * Set CHROME_PATH if Chrome isn't in the default macOS location.
 */
import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer, { type Page } from "puppeteer-core";
import { preview } from "vite";
import { treeFromDir } from "../cli/fs.ts";
import { zipOf } from "../test/helpers.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const chrome = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const work = mkdtempSync(join(tmpdir(), "dt-privacy-"));
const downloads = join(work, "downloads");
mkdirSync(downloads);

// A project export ZIP built from the synthetic sample, plus its tag export.
const tree = treeFromDir(`${root}fixtures/sample/riverbend-project`);
writeFileSync(join(work, "Riverbend.zip"), zipOf(Object.fromEntries(tree.entries.map((e) => [e.path, tree.bytes(e.path)!]))));
const tagsFile = `${root}fixtures/sample/riverbend-tags.json`;

const server = await preview({ root: `${root}app`, configFile: `${root}vite.config.ts`, preview: { port: 5198, strictPort: true }, logLevel: "error" });
const origin = "http://127.0.0.1:5198";
const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ["--no-sandbox"] });
const failures: string[] = [];
const step = (m: string) => console.log(`• ${m}`);

async function clickText(page: Page, text: string) {
  const ok = await page.evaluate((t) => {
    const el = [...document.querySelectorAll<HTMLElement>("button, a, [role=radio]")].find((b) => (b.getAttribute("aria-label") || b.textContent || "").trim().startsWith(t));
    el?.click();
    return !!el;
  }, text);
  if (!ok) throw new Error(`No control "${text}"`);
}

async function waitForDownload(name: RegExp, before: number) {
  for (let i = 0; i < 100; i++) {
    const hit = readdirSync(downloads).find((f) => name.test(f) && !f.endsWith(".crdownload"));
    if (hit && readdirSync(downloads).length > before && statSync(join(downloads, hit)).size > 0) return hit;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`No download matching ${name}`);
}

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  const cdp = await page.createCDPSession();
  await cdp.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: downloads, eventsEnabled: true });
  page.on("request", (r) => {
    const url = r.url();
    if (!/^(data|blob|about):/.test(url) && !url.startsWith(origin)) failures.push(`Request left the origin: ${url}`);
  });
  page.on("console", (m) => m.type() === "error" && failures.push(`Console error: ${m.text()}`));
  page.on("pageerror", (e) => failures.push(`Page error: ${(e as Error).message}`));
  page.on("dialog", (d) => void d.accept());
  // Workers report their requests on their own targets.
  browser.on("targetcreated", async (t) => {
    const w = await t.worker().catch(() => null);
    if (w && !w.url().startsWith(origin) && !w.url().startsWith("blob:")) failures.push(`Worker from another origin: ${w.url()}`);
  });

  step("Load the app and the sample");
  await page.goto(`${origin}/#/workspace/sample`, { waitUntil: "networkidle0" });
  await page.waitForSelector(".ws[data-summary]", { timeout: 20000 });

  step("Switch the network off");
  await page.setOfflineMode(true);

  step("Open a project export and a tag export while offline");
  await clickText(page, "Source files");
  await clickText(page, "Start over");
  await page.waitForSelector(".open-panel");
  const input = await page.waitForSelector('input[type=file][accept=".gwbk,.zip,.json"]');
  await input!.uploadFile(join(work, "Riverbend.zip"), tagsFile);
  await page.waitForFunction(() => document.querySelector(".ws")?.getAttribute("data-summary")?.includes("views"), { timeout: 20000 });
  const counts = await page.$eval(".ws", (e) => e.getAttribute("data-summary"));
  if (!counts?.includes("10 views")) failures.push(`Unexpected counts offline: ${counts}`);

  step("Export everything while offline");
  await clickText(page, "Export");
  for (const [label, name] of [
    ["Download Reference (HTML)", /-reference\.html$/],
    ["Download Word (.docx)", /-reference\.docx$/],
    ["Download Inventories (CSV)", /-inventories\.zip$/],
    ["Save workspace", /-workspace\.zip$/],
  ] as const) {
    const before = readdirSync(downloads, { withFileTypes: true }).length;
    await clickText(page, label);
    step(`  ${await waitForDownload(name, before)}`);
  }

  step("Open the exported reference from disk with the network off");
  const html = readdirSync(downloads).find((f) => f.endsWith(".html"))!;
  const ref = await browser.newPage();
  ref.on("request", (r) => !/^(data|blob|about|file):/.test(r.url()) && failures.push(`Reference made a request: ${r.url()}`));
  await ref.setOfflineMode(true);
  await ref.goto(`file://${join(downloads, html)}`);
  await ref.type("#q", "turbidity");
  const hits = await ref.$$eval("#results li", (l) => l.length);
  if (!hits) failures.push("Offline search in the exported reference found nothing for 'turbidity'.");
} catch (e) {
  failures.push((e as Error).message);
} finally {
  await browser.close();
  await new Promise<void>((r) => server.httpServer.close(() => r()));
  rmSync(work, { recursive: true, force: true });
}

if (failures.length) {
  console.error(`\n✗ Privacy check failed:\n${[...new Set(failures)].map((f) => `  - ${f}`).join("\n")}`);
  process.exit(1);
}
console.log("\n✓ No request left the origin, and processing and every export worked offline.");
