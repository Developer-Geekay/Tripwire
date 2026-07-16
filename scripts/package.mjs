// Packages the built extension (dist/) into distributable artifacts:
//
//   release/tripwire-<version>-chromium.zip   Chrome + Edge (load unpacked, or
//                                             upload to either web store)
//   release/tripwire-<version>.crx            signed CRX3 package
//   release/RELEASE_NOTES.md                  install instructions for the release body
//
// CRX signing key, in priority order:
//   1. CRX_PRIVATE_KEY env var (PEM contents) — set this as a repo secret in
//      CI so the extension ID stays stable across releases
//   2. .crx-key.pem in the repo root (gitignored) for local packaging
//   3. a freshly generated key (saved to .crx-key.pem locally; in CI a
//      warning is printed because the extension ID will differ per release)
//
// Usage: node scripts/package.mjs   (requires `npm run build` output in dist/)
// RELEASE_VERSION (e.g. "v0.2.0") overrides the version stamped into the
// manifest and the artifact names.

import { execFileSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import ChromeExtension from "crx";

const root = resolve(import.meta.dirname, "..");
const distDir = resolve(root, "dist");
const releaseDir = resolve(root, "release");
const keyPath = resolve(root, ".crx-key.pem");

if (!existsSync(resolve(distDir, "manifest.json"))) {
  console.error("dist/manifest.json not found — run `npm run build` first");
  process.exit(1);
}

const packageVersion = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")).version;
const version = (process.env.RELEASE_VERSION || packageVersion).replace(/^v/, "");
if (!/^\d+(\.\d+){1,3}$/.test(version)) {
  console.error(`Version ${JSON.stringify(version)} is not a valid extension version`);
  process.exit(1);
}

// Stamp the release version into the packaged manifest.
const manifestPath = resolve(distDir, "manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
manifest.version = version;
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");

let privateKey;
if (process.env.CRX_PRIVATE_KEY?.trim()) {
  privateKey = process.env.CRX_PRIVATE_KEY;
  console.log("using CRX signing key from CRX_PRIVATE_KEY");
} else if (existsSync(keyPath)) {
  privateKey = readFileSync(keyPath, "utf8");
  console.log(`using CRX signing key from ${keyPath}`);
} else {
  privateKey = generateKeyPairSync("rsa", { modulusLength: 2048 })
    .privateKey.export({ type: "pkcs8", format: "pem" });
  writeFileSync(keyPath, privateKey, { mode: 0o600 });
  console.warn(
    process.env.CI
      ? "WARNING: generated a one-off CRX key — the extension ID will change every release. " +
        "Set the CRX_PRIVATE_KEY repo secret to keep it stable."
      : `generated a new CRX signing key at ${keyPath} (gitignored — keep it to keep your extension ID)`,
  );
}

rmSync(releaseDir, { recursive: true, force: true });
mkdirSync(releaseDir);

const zipName = `tripwire-${version}-chromium.zip`;
execFileSync("zip", ["-r", "-q", resolve(releaseDir, zipName), "."], { cwd: distDir });
console.log(`wrote release/${zipName}`);

const crx = new ChromeExtension({ privateKey });
await crx.load(distDir);
const crxBuffer = await crx.pack();
const crxName = `tripwire-${version}.crx`;
writeFileSync(resolve(releaseDir, crxName), crxBuffer);
console.log(`wrote release/${crxName} (extension id: ${crx.generateAppId()})`);

const notes = `## Tripwire ${version}

In-browser UI test runner for Chrome and Edge. See the repository README for usage.

### Install for testing (recommended)

1. Download **${zipName}** and unzip it.
2. Open \`chrome://extensions\` (or \`edge://extensions\`) → enable **Developer mode**.
3. **Load unpacked** → select the unzipped folder.
4. Open the page you want to test, click the Tripwire toolbar icon, hit **run**.

### About the .crx

**${crxName}** is the signed package format. Chrome on Windows/macOS blocks
.crx installs from outside the Web Store, so for manual testing prefer the
zip above; the .crx is useful on Linux, for Edge, and for enterprise policy
deployment (\`ExtensionInstallSources\`).
`;
writeFileSync(resolve(releaseDir, "RELEASE_NOTES.md"), notes);
console.log("wrote release/RELEASE_NOTES.md");
