/**
 * Check the OIC listing before pushing: the profile against the catalog's v2
 * schema, and every image against the catalog limits.
 *
 *   pnpm oic:check
 *
 * The schema lives in the OIC website repo; point OIC_SCHEMA at a checkout's
 * src/project-v2.schema.json if it isn't in the default sibling location.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import Ajv from "ajv";
import { parse } from "yaml";
import { imageSize } from "../lib/render/image.ts";

const root = fileURLToPath(new URL("../.oic/", import.meta.url));
const schemaPath = process.env.OIC_SCHEMA ?? fileURLToPath(new URL("../../open-industrial-collective/website/src/project-v2.schema.json", import.meta.url));
const problems: string[] = [];

const profile = parse(readFileSync(`${root}project.yaml`, "utf8")) as { description?: { file?: string }; branding?: { logo?: Record<string, string> }; media?: { src?: string }[] };

if (existsSync(schemaPath)) {
  const ajv = new Ajv({ allErrors: true, strict: false });
  ajv.addFormat("https-url", /^https:\/\/[^\s/@:]+(?::[0-9]+)?(?:[/?#][^\s]*)?$/);
  const validate = ajv.compile(JSON.parse(readFileSync(schemaPath, "utf8")));
  if (!validate(profile)) for (const e of validate.errors ?? []) problems.push(`profile ${e.instancePath || "/"} ${e.message}`);
} else {
  console.warn(`! Schema not found at ${schemaPath}; set OIC_SCHEMA to validate the profile.`);
}

const overview = profile.description?.file;
if (overview && statSync(`${root}${overview}`).size > 20 * 1024) problems.push(`${overview} is over 20 KB`);

const images = [profile.branding?.logo?.on_light, profile.branding?.logo?.on_dark, ...(profile.media ?? []).map((m) => m.src)].filter(Boolean) as string[];
for (const src of new Set(images)) {
  const path = `${root}${src}`;
  if (!existsSync(path)) {
    problems.push(`${src} is missing`);
    continue;
  }
  const bytes = new Uint8Array(readFileSync(path));
  const size = imageSize(bytes);
  if (bytes.length > 2 * 1024 * 1024) problems.push(`${src} is over 2 MB`);
  if (!size) problems.push(`${src} isn't a PNG, JPEG or WebP`);
  else if (size.width * size.height > 12_000_000) problems.push(`${src} is over 12 MP (${size.width}×${size.height})`);
}
if ((profile.media ?? []).length > 8) problems.push("more than 8 media items");

if (problems.length) {
  console.error(`✗ OIC listing problems:\n${problems.map((p) => `  - ${p}`).join("\n")}`);
  process.exit(1);
}
console.log(`✓ OIC profile valid; ${new Set(images).size} images within limits.`);
