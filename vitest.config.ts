import { defineConfig } from "vitest/config";

export default defineConfig({
  // Tests build synthetic backups from scratch; shared CI runners can be many times slower than a laptop.
  test: { include: ["lib/**/*.test.ts", "cli/**/*.test.ts"], testTimeout: 30_000 },
});
