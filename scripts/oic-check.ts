/**
 * Check the OIC listing with OIC's own importer and Charter preflight, the
 * same code review runs (`profile:check` in open-industrial-collective/website).
 *
 *   pnpm oic:check              # the working tree; flags files not committed yet
 *   pnpm oic:check --ref HEAD   # exactly what OIC would import from that commit
 *
 * Uses the website checkout in OIC_WEBSITE if set, otherwise a cached shallow
 * clone of the public website repo under node_modules/.cache. CI runs the same
 * check through the profile-check Action.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const repo = fileURLToPath(new URL("..", import.meta.url));
const run = (cmd: string, args: string[], cwd: string) => execFileSync(cmd, args, { cwd, stdio: ["ignore", "ignore", "inherit"] });

let website = process.env.OIC_WEBSITE;
if (!website) {
  website = fileURLToPath(new URL("../node_modules/.cache/oic-website", import.meta.url));
  if (!existsSync(`${website}/.git`)) run("git", ["clone", "-q", "--depth", "1", "https://github.com/open-industrial-collective/website.git", website], repo);
  else {
    run("git", ["fetch", "-q", "--depth", "1", "origin", "main"], website);
    run("git", ["reset", "-q", "--hard", "FETCH_HEAD"], website);
  }
  // Install the importer's dependencies only when its lockfile changes.
  const lock = createHash("sha256").update(readFileSync(`${website}/package-lock.json`)).digest("hex");
  const stamp = `${website}/node_modules/.lock-hash`;
  if (!existsSync(stamp) || readFileSync(stamp, "utf8") !== lock) {
    run("npm", ["ci", "--no-audit", "--no-fund", "--ignore-scripts"], website);
    writeFileSync(stamp, lock);
  }
}

if (!existsSync(`${website}/scripts/check-profile.ts`)) {
  console.error(`✗ ${website} has no profile check (scripts/check-profile.ts). Update that checkout, or point OIC_WEBSITE at one that has it.`);
  process.exit(1);
}
const r = spawnSync("npm", ["run", "-s", "profile:check", "--", repo, ...process.argv.slice(2)], { cwd: website, stdio: "inherit" });
process.exit(r.status ?? 1);
