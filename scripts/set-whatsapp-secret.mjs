#!/usr/bin/env node
/**
 * Copies WHATSAPP_ACCESS_TOKEN from .env into Firebase Secret Manager, where the Cloud
 * Functions read it. The token is never printed and the temp file is removed right away.
 * Usage: npm run secrets:whatsapp   (after `firebase login` and `firebase use <project>`)
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const env = Object.fromEntries(
  readFileSync(new URL("../.env", import.meta.url), "utf8")
    .split(/\r?\n/)
    .filter((l) => /^[A-Z0-9_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim().replace(/^"|"$/g, "")]),
);
const secrets = ["WHATSAPP_ACCESS_TOKEN", "WHATSAPP_APP_SECRET", "WHATSAPP_VERIFY_TOKEN"];
const dir = mkdtempSync(join(tmpdir(), "wa-secret-"));
try {
  for (const name of secrets) {
    const value = env[name];
    if (!value) {
      console.log(`- ${name}: not in .env, skipped`);
      continue;
    }
    const file = join(dir, name);
    writeFileSync(file, value, { mode: 0o600 });
    execFileSync("firebase", ["functions:secrets:set", name, "--data-file", file], {
      stdio: ["ignore", "inherit", "inherit"],
      shell: process.platform === "win32",
    });
    console.log(`✔ ${name} saved to Firebase Secret Manager`);
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
