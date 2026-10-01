import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { sampleEvidence } from "../test/helpers.ts";
import { defaultConfig, type ToolkitConfig } from "./config.ts";
import { buildDocument } from "./document/packs.ts";
import { renderDocx } from "./render/docx.ts";
import { imageSize } from "./render/image.ts";

const config = (over: Partial<ToolkitConfig> = {}): ToolkitConfig => ({ ...defaultConfig(), identity: { ...defaultConfig().identity, date: "2026-09-29", customer: "City of Riverbend" }, ...over });

// 1×1 PNG.
const PNG = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0));

async function word(cfg = config(), assets = new Map<string, Uint8Array>()) {
  const ev = await sampleEvidence();
  const bytes = await renderDocx(buildDocument(ev, cfg), cfg, { assets });
  const files = unzipSync(bytes);
  return { bytes, files, xml: strFromU8(files["word/document.xml"]!) };
}

describe("Word export", () => {
  it("is a valid package with real styles, headers and repeating table headers", async () => {
    const { files, xml } = await word();
    expect(Object.keys(files)).toEqual(expect.arrayContaining(["[Content_Types].xml", "word/document.xml", "word/styles.xml", "word/numbering.xml", "docProps/core.xml"]));
    expect(xml).toContain('w:val="Heading1"');
    expect(xml).toContain('w:val="Heading2"');
    expect(xml).toContain("<w:tblHeader/>");
    expect(Object.keys(files).some((f) => /word\/header\d*\.xml/.test(f))).toBe(true);
    expect(xml).toContain("System overview");
    expect(xml).toContain("Appendix: Tag inventory");
  });

  it("is byte-for-byte reproducible and dated from the config", async () => {
    const a = await word();
    const b = await word();
    expect(a.bytes).toEqual(b.bytes);
    expect(strFromU8(a.files["docProps/core.xml"]!)).toContain("2026-09-29T00:00:00Z");
  });

  it("escapes input text and honours redaction", async () => {
    const cfg = config({ identity: { ...config().identity, project: "A & B <script>" }, redact: { addresses: true, usernames: true, code: true } });
    const { xml } = await word(cfg);
    expect(xml).toContain("A &amp; B &lt;script&gt;");
    expect(xml).not.toContain("SELECT SUM(hours)");
  });

  it("embeds the logo", async () => {
    const { files } = await word(config({ logo: "assets/logo.png" }), new Map([["assets/logo.png", PNG]]));
    expect(Object.keys(files).some((f) => f.startsWith("word/media/"))).toBe(true);
  });

  it("reads image sizes from headers", () => {
    expect(imageSize(PNG)).toEqual({ width: 1, height: 1 });
  });
});
