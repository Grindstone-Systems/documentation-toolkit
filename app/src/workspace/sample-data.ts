/** Sample file contents, bundled into one chunk that loads only when the sample is opened. */
export const PROJECT = import.meta.glob("../../../fixtures/sample/riverbend-project/**/*.{json,py,sql,bin}", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
export const TAGS = import.meta.glob("../../../fixtures/sample/riverbend-tags.json", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
