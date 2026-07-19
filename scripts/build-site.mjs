// Assembles the GitHub Pages download site into site-dist/: an index.html
// plus the packaged artifacts from release/ served directly from the
// *.github.io domain (org proxies often block github.com release downloads,
// which is the whole reason this site exists).
//
// Usage: node scripts/build-site.mjs   (requires `node scripts/package.mjs` output)

import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const releaseDir = resolve(root, "release");
const siteDir = resolve(root, "site-dist");

if (!existsSync(releaseDir)) {
  console.error("release/ not found — run `node scripts/package.mjs` first");
  process.exit(1);
}

rmSync(siteDir, { recursive: true, force: true });
mkdirSync(siteDir);

const files = readdirSync(releaseDir).filter((f) => f.endsWith(".zip") || f.endsWith(".crx"));
if (files.length === 0) {
  console.error("no .zip/.crx artifacts in release/");
  process.exit(1);
}

const artifacts = files.map((name) => {
  copyFileSync(resolve(releaseDir, name), resolve(siteDir, name));
  const bytes = readFileSync(resolve(releaseDir, name));
  return {
    name,
    size: `${(bytes.length / 1024 / 1024).toFixed(1)} MB`,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
});

const version = JSON.parse(readFileSync(resolve(root, "dist/manifest.json"), "utf8")).version;
const sha = (process.env.GITHUB_SHA ?? "local").slice(0, 7);
const ref = process.env.GITHUB_REF_NAME ?? "local";
const builtAt = new Date().toISOString().replace(/\.\d+Z$/, "Z");
const repoUrl = process.env.GITHUB_REPOSITORY
  ? `https://github.com/${process.env.GITHUB_REPOSITORY}`
  : "https://github.com/Developer-Geekay/Tripwire";

const zip = artifacts.find((a) => a.name.endsWith(".zip") && !a.name.endsWith("-dev.zip"));
const devZip = artifacts.find((a) => a.name.endsWith("-dev.zip"));
const crx = artifacts.find((a) => a.name.endsWith(".crx"));

const row = (a, label, note) => `
      <div class="card">
        <div class="card-head">
          <a class="dl" href="${a.name}" download>${a.name}</a>
          <span class="size">${a.size}</span>
        </div>
        <p class="note"><strong>${label}</strong> — ${note}</p>
        <code class="sha">sha256: ${a.sha256}</code>
      </div>`;

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Tripwire — downloads</title>
<style>
  :root { --bg:#0d1117; --raised:#161b22; --border:#30363d; --fg:#e6edf3; --muted:#8b949e; --accent:#3fb950; }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--fg);
         font:14px/1.6 ui-monospace,"Cascadia Code",Menlo,Consolas,monospace; }
  main { max-width:760px; margin:0 auto; padding:40px 20px; }
  h1 { color:var(--accent); letter-spacing:.08em; margin:0 0 4px; }
  .meta { color:var(--muted); font-size:12px; margin-bottom:28px; }
  .card { background:var(--raised); border:1px solid var(--border); border-radius:8px;
          padding:14px 16px; margin-bottom:14px; }
  .card-head { display:flex; align-items:baseline; gap:10px; flex-wrap:wrap; }
  .dl { color:var(--accent); font-weight:700; font-size:15px; text-decoration:none;
        overflow-wrap:anywhere; }
  .dl:hover { text-decoration:underline; }
  .size { color:var(--muted); font-size:12px; }
  .note { margin:6px 0; color:var(--fg); }
  .note strong { color:var(--fg); }
  .sha { display:block; color:var(--muted); font-size:11px; overflow-wrap:anywhere; }
  h2 { font-size:15px; margin:28px 0 8px; }
  ol { padding-left:22px; } li { margin:4px 0; }
  a { color:var(--accent); }
  .foot { margin-top:32px; color:var(--muted); font-size:12px; }
  kbd { background:var(--raised); border:1px solid var(--border); border-radius:4px; padding:0 5px; }
</style>
</head>
<body>
<main>
  <h1>tripwire</h1>
  <p class="meta">in-browser UI test runner · v${version} · built ${builtAt} from <code>${ref}</code>@<code>${sha}</code></p>
${zip ? row(zip, "Recommended", "unzip, then chrome://extensions or edge://extensions → Developer mode → Load unpacked → select the unzipped folder.") : ""}
${devZip ? row(devZip, "Debug build", "unminified with sourcemaps — installs as “Tripwire (Dev)”. Use it to step through the extension's code in DevTools when reporting issues.") : ""}
${crx ? row(crx, "Signed CRX3", "Chrome on Windows/macOS blocks .crx installs from outside the Web Store; use it on Linux, Edge, or via enterprise policy.") : ""}
  <h2>Install (zip)</h2>
  <ol>
    <li>Download and unzip <code>${zip?.name ?? "the zip"}</code>.</li>
    <li>Open <kbd>chrome://extensions</kbd> (or <kbd>edge://extensions</kbd>) and enable <strong>Developer mode</strong>.</li>
    <li>Click <strong>Load unpacked</strong> and select the unzipped folder.</li>
    <li>Open the page you want to test, click the Tripwire toolbar icon, hit <strong>run</strong>.</li>
  </ol>
  <p class="foot">Files are served from github.io because some organizations block direct
  github.com downloads. Source &amp; tagged releases: <a href="${repoUrl}">${repoUrl.replace("https://", "")}</a></p>
</main>
</body>
</html>
`;

writeFileSync(resolve(siteDir, "index.html"), html);
// Pages runs assets through Jekyll unless told not to; artifacts must be served verbatim.
writeFileSync(resolve(siteDir, ".nojekyll"), "");
console.log(`site-dist/ ready: index.html + ${artifacts.map((a) => a.name).join(", ")}`);
