/**
 * Regenerate the OIC listing images into .oic/media/.
 *
 *   pnpm oic:media             # all shots
 *   pnpm oic:media evidence    # only shots whose name contains "evidence"
 *
 * Starts the Vite dev server, drives your installed Chrome with puppeteer-core
 * through the synthetic Riverbend sample, and writes 2× JPEGs sized for the
 * catalog (≤ 12 MP, < 2 MB) plus logo.png. Set CHROME_PATH if Chrome isn't in
 * the default macOS location, and OIC_MEDIA_OUT (with a trailing slash) to
 * write somewhere else for a dry run.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import puppeteer, { type Page } from "puppeteer-core";
import { createServer } from "vite";
import { buildDocument, defaultConfig, renderHtml } from "../lib/index.ts";
import { sampleEvidence } from "../test/helpers.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const out = process.env.OIC_MEDIA_OUT ?? fileURLToPath(new URL("../.oic/media/", import.meta.url));
const chrome = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const only = process.argv[2];
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function click(page: Page, text: string) {
  const ok = await page.evaluate((t) => {
    const el = [...document.querySelectorAll<HTMLElement>("button, a, [role=radio], li[role=option]")].find((b) => (b.getAttribute("aria-label") || b.textContent || "").trim().startsWith(t));
    el?.click();
    return !!el;
  }, text);
  if (!ok) throw new Error(`No control "${text}"`);
  await wait(600);
}

/** Set a labelled field in the Customize panel the way typing would. */
async function fill(page: Page, label: string, value: string) {
  const ok = await page.evaluate(
    (l, v) => {
      const field = [...document.querySelectorAll(".field")].find((f) => f.querySelector("span")?.textContent?.trim() === l);
      const input = field?.querySelector<HTMLInputElement | HTMLTextAreaElement>("input, textarea");
      if (!input) return false;
      const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(input, v);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    },
    label,
    value,
  );
  if (!ok) throw new Error(`No field "${label}"`);
}

async function openSample(page: Page, scheme: "light" | "dark") {
  await page.evaluateOnNewDocument((s) => localStorage.setItem("dt.theme", s), scheme);
  await page.goto(`${base}/#/workspace/sample`, { waitUntil: "networkidle0" });
  await page.waitForSelector(".ws[data-summary]");
  await fill(page, "Customer", "City of Riverbend (sample)");
  await fill(page, "Prepared by", "Grindstone Systems");
  await click(page, "Content");
  await fill(page, "What this system does", "Riverbend is a fictional 12 MGD surface-water treatment plant used to demonstrate Documentation Toolkit. Intake pumps feed four filters and a clearwell.");
  await click(page, "Details");
  await wait(800);
}

/** Scroll the preview iframe to a section. */
const previewTo = (page: Page, id: string) =>
  page.evaluate((s) => {
    const f = document.querySelector<HTMLIFrameElement>("iframe.preview")!;
    const el = f.contentDocument!.getElementById(s)!;
    f.contentWindow!.scrollTo(0, el.getBoundingClientRect().top + f.contentWindow!.scrollY - 8);
  }, id);

type Shot = { name: string; run: (page: Page) => Promise<void> };

const shots: Shot[] = [
  {
    name: "workspace",
    run: async (page) => {
      await openSample(page, "light");
      await previewTo(page, "s-system-map");
    },
  },
  {
    name: "evidence",
    run: async (page) => {
      await openSample(page, "light");
      await click(page, "Evidence");
      await page.type(".search-field input", "P101 speed");
      await wait(300);
      await page.click(".entity-list li[role=option]");
      await wait(600);
    },
  },
  {
    name: "coverage",
    run: async (page) => {
      await openSample(page, "dark");
      await click(page, "Coverage");
    },
  },
  {
    name: "operator-framework",
    run: async (page) => {
      await openSample(page, "light");
      await click(page, "Choose a pack");
      await click(page, "Operator Manual Framework");
      await wait(900);
      await previewTo(page, "s-op-alarm-response");
    },
  },
  {
    name: "reference",
    run: async (page) => {
      const ev = await sampleEvidence();
      const cfg = { ...defaultConfig(), appearance: { ...defaultConfig().appearance, theme: "harbor" as const }, identity: { ...defaultConfig().identity, customer: "City of Riverbend (sample)", date: "2026-09-29", author: "Grindstone Systems" } };
      await page.setContent(renderHtml(buildDocument(ev, cfg), cfg), { waitUntil: "load" });
      await page.evaluate(() => {
        document.documentElement.style.scrollBehavior = "auto";
        (document.getElementById("q") as HTMLInputElement).value = "";
        window.scrollTo(0, document.getElementById("s-tags")!.offsetTop - 12);
      });
    },
  },
  {
    name: "agents",
    run: async (page) => {
      await page.evaluateOnNewDocument(() => localStorage.setItem("dt.theme", "dark"));
      await page.goto(`${base}/#/agents`, { waitUntil: "networkidle0" });
    },
  },
];

const server = await createServer({ root: `${root}app`, configFile: `${root}vite.config.ts`, server: { port: 5199, strictPort: true }, logLevel: "error" });
await server.listen();
const base = "http://127.0.0.1:5199";
await mkdir(out, { recursive: true });
const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ["--hide-scrollbars"] });
try {
  if (!only || "logo".includes(only)) {
    const page = await browser.newPage();
    await page.setViewport({ width: 512, height: 512, deviceScaleFactor: 1 });
    const svg = (await readFile(`${root}app/public/favicon.svg`, "utf8")).replace("<svg ", '<svg width="512" height="512" ');
    await page.setContent(`<body style="margin:0;background:transparent">${svg}</body>`);
    await writeFile(`${out}logo.png`, await page.screenshot({ type: "png", omitBackground: true, clip: { x: 0, y: 0, width: 512, height: 512 } }));
    console.log(`✓ ${out}logo.png`);
    await page.close();
  }
  for (const s of shots.filter((s) => !only || s.name.includes(only))) {
    const page = await browser.newPage();
    await page.setViewport({ width: 1600, height: 1000, deviceScaleFactor: 2 });
    await s.run(page);
    await wait(1200);
    await page.screenshot({ path: `${out}${s.name}.jpg`, type: "jpeg", quality: 88 });
    console.log(`✓ ${out}${s.name}.jpg`);
    await page.close();
  }
} finally {
  await browser.close();
  await server.close();
}
