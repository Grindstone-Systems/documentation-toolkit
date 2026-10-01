/**
 * The bundled Riverbend sample (synthetic; see fixtures/sample/README.md).
 * Loaded on demand, so it costs nothing until someone asks for it.
 */
export async function loadSample(): Promise<{ project: Record<string, string>; tags: Record<string, string> }> {
  const { PROJECT, TAGS } = await import("./sample-data.ts");
  const strip = (files: Record<string, string>, re: RegExp) => Object.fromEntries(Object.entries(files).map(([p, t]) => [p.replace(re, ""), t]));
  return { project: strip(PROJECT, /^.*\/riverbend-project\//), tags: strip(TAGS, /^.*\/sample\//) };
}
