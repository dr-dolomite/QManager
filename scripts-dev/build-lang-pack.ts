import { readFileSync, readdirSync, existsSync, mkdirSync, renameSync } from "node:fs";
import { join, relative } from "node:path";
import { createHash } from "node:crypto";

// ---------------------------------------------------------------------------
// Paths - resolve relative to repo root (the cwd when bun invokes this)
// ---------------------------------------------------------------------------
const repoRoot = process.cwd();
const availableLangsPath = join(repoRoot, "lib/i18n/available-languages.ts");
const langPacksShPath = join(repoRoot, "scripts/usr/lib/qmanager/language_packs.sh");
const publicLocalesDir = join(repoRoot, "public/locales");
const manifestPath = join(repoRoot, "language-packs/manifest.json");
const outDir = join(repoRoot, "qmanager-build/lang");

// Normalize backslashes to forward slashes. Used for relative paths passed to
// tar — safe across all tar flavors (GNU/MSYS2/bsdtar) and all platforms.
// Absolute Windows paths (D:/foo or /d/foo) are NOT safe: bsdtar and MSYS2 tar
// have incompatible expectations. We avoid the issue by spawning tar with
// cwd = outDir and passing all paths relative to that cwd.
function fwd(p: string): string {
  return p.replace(/\\/g, "/");
}

// ---------------------------------------------------------------------------
// Terminal helpers
// ---------------------------------------------------------------------------
const isTTY = process.stdout.isTTY;
function green(s: string) { return isTTY ? `\x1b[32m${s}\x1b[0m` : s; }
function red(s: string) { return isTTY ? `\x1b[31m${s}\x1b[0m` : s; }
function yellow(s: string) { return isTTY ? `\x1b[33m${s}\x1b[0m` : s; }

function timestamp() {
  const d = new Date();
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `[${hh}:${mm}:${ss}]`;
}
function log(msg: string) { console.log(`${green(timestamp())} ${msg}`); }
function warn(msg: string) { console.warn(`${yellow(timestamp())} WARNING: ${msg}`); }
function fail(msg: string): never {
  process.stderr.write(`${red("ERROR:")} ${msg}\n`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Usage
// ---------------------------------------------------------------------------
function printUsage() {
  console.log(`
Usage: bun run package:lang <code> [version] [options]

Arguments:
  code        BCP-47 language code (e.g. it, fr, de). Must be registered in
              lib/i18n/available-languages.ts and have bundled: false.
  version     Optional. Defaults to today's UTC date YYYY.MM.DD.

Options:
  --publish                Upload tarball to the 'language-packs' GitHub release
                           and auto-patch manifest.json. Requires gh CLI + auth.
                           Mutually exclusive with --update-manifest.
  --push                   After updating manifest.json (via --publish or
                           --update-manifest), commit and push it to git.
                           Skips gracefully if manifest is already up to date.
  --update-manifest <url>  Patch language-packs/manifest.json manually with the
                           given asset URL. Mutually exclusive with --publish.
  --contributors <csv>     Comma-separated contributor names/handles (e.g.
                           "@fmase" or "@fmase,@other"). Preserved from the
                           existing manifest entry when omitted.
  --skip-check             Skip the 'bun run i18n:check' step.
  -h, --help               Print this help and exit.

Output: qmanager-build/lang/qmanager-lang-<code>-<version>.tar.gz

Examples:
  # Build only (no manifest update)
  bun run package:lang it
  bun run package:lang fr 2026.04.23

  # Recommended: build, upload to GitHub, update + push manifest in one command
  bun run package:lang it --publish --push
  bun run package:lang it --publish --push --contributors "@fmase"

  # Manual: build, upload yourself, then update manifest with the asset URL
  bun run package:lang de --update-manifest https://example.com/de.tar.gz --push
`.trim());
}

// ---------------------------------------------------------------------------
// Arg parsing
// ---------------------------------------------------------------------------
interface Args {
  code: string;
  version: string;
  updateManifestUrl: string | null;
  publish: boolean;
  push: boolean;
  skipCheck: boolean;
  contributors: string[];
  contributorsExplicit: boolean;
}

function parseArgs(): Args {
  const argv = Bun.argv.slice(2);
  if (argv.includes("-h") || argv.includes("--help")) { printUsage(); process.exit(0); }
  const positional: string[] = [];
  let updateManifestUrl: string | null = null;
  let publish = false;
  let push = false;
  let skipCheck = false;
  let contributors: string[] = [];
  let contributorsExplicit = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--update-manifest") {
      const url = argv[++i];
      if (!url || url.startsWith("--")) fail("--update-manifest requires a URL argument.");
      updateManifestUrl = url;
    } else if (arg === "--publish") {
      publish = true;
    } else if (arg === "--push") {
      push = true;
    } else if (arg === "--skip-check") {
      skipCheck = true;
    } else if (arg === "--contributors") {
      const csv = argv[++i];
      if (!csv || csv.startsWith("--")) fail("--contributors requires a comma-separated list of names.");
      contributors = csv.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
      contributorsExplicit = true;
    } else if (arg.startsWith("--")) {
      fail(`Unknown option: ${arg}`);
    } else {
      positional.push(arg);
    }
  }
  if (positional.length === 0) { printUsage(); process.exit(1); }
  const code = positional[0];
  const codePattern = /^[a-zA-Z0-9-]{1,12}$/;
  if (!codePattern.test(code)) {
    fail(`Invalid language code '${code}'. Must match [a-zA-Z0-9-], max 12 chars.`);
  }
  // Reject leading/trailing hyphen or double-hyphen (mirrors lp_pack_is_code_safe)
  if (code.startsWith("-") || code.endsWith("-") || code.includes("--")) {
    fail(`Invalid language code '${code}'. Cannot start/end with hyphen or contain '--'.`);
  }
  let version = positional[1] ?? null;
  if (!version) {
    const d = new Date();
    const yyyy = d.getUTCFullYear();
    const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(d.getUTCDate()).padStart(2, "0");
    version = `${yyyy}.${mm}.${dd}`;
  } else {
    // Warn if not YYYY.MM.DD - non-fatal; frontend compareVersion is lexicographic
    if (!/^\d{4}\.\d{2}\.\d{2}$/.test(version)) {
      warn(`Version '${version}' is not YYYY.MM.DD format. Frontend compareVersion() does lexicographic comparison - verify ordering is intentional.`);
    }
  }
  if (publish && updateManifestUrl) {
    fail("--publish and --update-manifest are mutually exclusive.");
  }
  if (push && !publish && !updateManifestUrl) {
    fail("--push requires --publish or --update-manifest (no manifest update would occur otherwise).");
  }
  return { code, version, updateManifestUrl, publish, push, skipCheck, contributors, contributorsExplicit };
}

// ---------------------------------------------------------------------------
// Parse available-languages.ts for a code entry
// ---------------------------------------------------------------------------
interface LangMeta {
  native_name: string;
  english_name: string;
  rtl: boolean;
  bundled: boolean;
}

function parseLangEntry(code: string): LangMeta {
  let src: string;
  try {
    src = readFileSync(availableLangsPath, "utf-8");
  } catch {
    fail(`Cannot read ${availableLangsPath}`);
  }
  // Match each flat object literal { ... } in the file. Entries in
  // AVAILABLE_LANGUAGES are flat (no nested objects) so this regex is reliable.
  const entryRegex = /\{([^{}]*)\}/gs;
  let match: RegExpExecArray | null;
  while ((match = entryRegex.exec(src)) !== null) {
    const block = match[1];
    const codeMatch = block.match(/code:\s*"([^"]+)"/);
    if (!codeMatch || codeMatch[1] !== code) continue;
    const nativeMatch = block.match(/native_name:\s*"([^"]+)"/);
    const englishMatch = block.match(/english_name:\s*"([^"]+)"/);
    const rtlMatch = block.match(/rtl:\s*(true|false)/);
    const bundledMatch = block.match(/bundled:\s*(true|false)/);
    if (!nativeMatch || !englishMatch || !rtlMatch) {
      fail(`Code '${code}' entry in available-languages.ts is missing required fields (native_name, english_name, rtl).`);
    }
    return {
      native_name: nativeMatch[1],
      english_name: englishMatch[1],
      rtl: rtlMatch[1] === "true",
      bundled: bundledMatch ? bundledMatch[1] === "true" : false,
    };
  }
  fail(`Code '${code}' is not registered in lib/i18n/available-languages.ts - add an entry first.`);
}

// ---------------------------------------------------------------------------
// Parse LP_REQUIRED_NS from language_packs.sh
// ---------------------------------------------------------------------------
function parseRequiredNamespaces(): string[] {
  let src: string;
  try {
    src = readFileSync(langPacksShPath, "utf-8");
  } catch {
    fail(`Cannot read ${langPacksShPath}`);
  }
  const m = src.match(/LP_REQUIRED_NS="([^"]+)"/);
  if (!m) fail(`Could not find LP_REQUIRED_NS="..." in ${langPacksShPath}`);
  return m[1].trim().split(/\s+/);
}

// ---------------------------------------------------------------------------
// Collect all dotted scalar paths from parsed JSON (for completeness calc)
// ---------------------------------------------------------------------------
function collectPaths(value: unknown, prefix: string, out: Set<string>) {
  if (value === null || typeof value !== "object") { out.add(prefix); return; }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) { collectPaths(value[i], `${prefix}.${i}`, out); }
    return;
  }
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    collectPaths(v, `${prefix}.${k}`, out);
  }
}

function collectLocaleKeys(localeDir: string): Set<string> {
  const keys = new Set<string>();
  const files = readdirSync(localeDir).filter((f) => f.endsWith(".json"));
  for (const file of files) {
    const ns = file.replace(/\.json$/, "");
    const parsed = JSON.parse(readFileSync(join(localeDir, file), "utf-8"));
    collectPaths(parsed, ns, keys);
  }
  return keys;
}

// ---------------------------------------------------------------------------
// GitHub publish helper
// ---------------------------------------------------------------------------
async function publishToGitHub(archivePath: string, archiveName: string): Promise<string> {
  // 1. Verify gh is available
  const ghCheck = Bun.spawnSync(["gh", "--version"], { stdout: "pipe", stderr: "pipe" });
  if (ghCheck.exitCode !== 0) {
    fail("gh CLI not found. Install from https://cli.github.com and run 'gh auth login'.");
  }

  // 2. Detect repo owner/name
  const repoResult = Bun.spawnSync(
    ["gh", "repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"],
    { stdout: "pipe", stderr: "pipe" },
  );
  const nameWithOwner = repoResult.stdout
    ? new TextDecoder().decode(repoResult.stdout).trim()
    : "";
  if (repoResult.exitCode !== 0 || !nameWithOwner) {
    fail("Could not detect GitHub repo. Make sure you are inside a GitHub-backed git repo and 'gh auth login' has been run.");
  }

  // 3. Persistent release tag
  const RELEASE_TAG = "language-packs";

  // 4. Ensure the release exists; create it if not
  const viewResult = Bun.spawnSync(
    ["gh", "release", "view", RELEASE_TAG, "--json", "tagName"],
    { stdout: "pipe", stderr: "pipe" },
  );
  if (viewResult.exitCode !== 0) {
    log(`Creating persistent '${RELEASE_TAG}' GitHub release...`);
    const createResult = Bun.spawnSync(
      [
        "gh", "release", "create", RELEASE_TAG,
        "--title", "Language Packs",
        "--notes", "Persistent release hosting QManager language pack tarballs. Assets are updated automatically — do not delete this release.",
        "--latest=false",
      ],
      { stdout: "pipe", stderr: "pipe" },
    );
    if (createResult.exitCode !== 0) {
      const stderr = createResult.stderr ? new TextDecoder().decode(createResult.stderr) : "(no output)";
      fail(`gh release create failed: ${stderr}`);
    }
  }

  // 5. Upload tarball (--clobber replaces existing asset with same filename)
  log(`Uploading ${archiveName} to '${RELEASE_TAG}' release...`);
  const uploadResult = Bun.spawnSync(
    ["gh", "release", "upload", RELEASE_TAG, archivePath, "--clobber"],
    { stdout: "pipe", stderr: "pipe" },
  );
  if (uploadResult.exitCode !== 0) {
    const stderr = uploadResult.stderr ? new TextDecoder().decode(uploadResult.stderr) : "(no output)";
    fail(`gh release upload failed: ${stderr}`);
  }

  // 6. Construct asset URL deterministically (fixed GitHub release asset pattern)
  return `https://github.com/${nameWithOwner}/releases/download/${RELEASE_TAG}/${archiveName}`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const args = parseArgs();
  const { code, version, updateManifestUrl, publish, push, skipCheck, contributors, contributorsExplicit } = args;

  log(`Building language pack for: ${code} @ ${version}`);

  // 1. Validate code registration
  log("Checking code registration in available-languages.ts...");
  const meta = parseLangEntry(code);
  if (meta.bundled) {
    fail(`Code '${code}' is bundled: true - bundled packs ship with the firmware, no tarball needed.`);
  }
  log(`  Found: ${meta.english_name} / ${meta.native_name} (rtl: ${meta.rtl})`);

  // 2. Extract LP_REQUIRED_NS
  log("Extracting LP_REQUIRED_NS from language_packs.sh...");
  const requiredNs = parseRequiredNamespaces();
  log(`  Required namespaces (${requiredNs.length}): ${requiredNs.join(", ")}`);

  // 3. Verify namespace files exist
  const localeDir = join(publicLocalesDir, code);
  if (!existsSync(localeDir)) { fail(`Locale directory does not exist: ${localeDir}`); }

  log("Verifying required namespace files...");
  const missing = requiredNs.filter((ns) => !existsSync(join(localeDir, `${ns}.json`)));
  if (missing.length > 0) {
    fail(`Missing required namespace files in ${localeDir}:\n  ${missing.map((ns) => `${ns}.json`).join("\n  ")}`);
  }
  log(`  All ${requiredNs.length} required namespace files present.`);

  // 4. Validate all JSON files parse cleanly
  log("Validating JSON syntax in locale directory...");
  const allJsonFiles = readdirSync(localeDir).filter((f) => f.endsWith(".json"));
  for (const file of allJsonFiles) {
    const filePath = join(localeDir, file);
    const raw = readFileSync(filePath, "utf-8");
    try { JSON.parse(raw); }
    catch (e) { fail(`JSON parse error in ${filePath}: ${(e as Error).message}`); }
  }
  log(`  ${allJsonFiles.length} JSON files valid.`);

  // 5. Run i18n:check
  if (skipCheck) {
    warn("Skipping i18n:check (--skip-check flag set).");
  } else {
    log("Running bun run i18n:check...");
    const result = Bun.spawnSync(["bun", "run", "i18n:check"], {
      cwd: repoRoot, stdout: "pipe", stderr: "pipe",
    });
    const stdout = result.stdout ? new TextDecoder().decode(result.stdout) : "";
    const stderr = result.stderr ? new TextDecoder().decode(result.stderr) : "";
    if (result.exitCode !== 0) {
      if (stdout) process.stdout.write(stdout);
      if (stderr) process.stderr.write(stderr);
      fail("i18n:check failed. Fix the errors above, or run with --skip-check to bypass.");
    }
    // Surface the summary line so the caller can see the error/warning count
    const summaryLine = stdout.split("\n").find((l) => l.includes("error(s)") || l.includes("warning(s)"));
    if (summaryLine) log(`  [i18n:check] ${summaryLine.trim()}`);
    else log("  [i18n:check] passed.");
  }

  // 6. Build tarball
  log("Building tarball...");
  mkdirSync(outDir, { recursive: true });
  const archiveName = `qmanager-lang-${code}-${version}.tar.gz`;
  const archivePath = join(outDir, archiveName);
  // Flat layout: -C <localeDir> changes into the locale dir so entries are just
  // <ns>.json at the tarball root. The on-device worker (language_packs.sh)
  // extracts to a staging dir and expects files at the top level, no subdir prefix.
  //
  // Spawn with cwd = outDir and pass all paths as RELATIVE to outDir. Absolute
  // Windows paths (D:/foo vs /d/foo) have incompatible forms across tar flavors
  // (MSYS2 GNU tar vs Windows System32 bsdtar); relative paths sidestep the issue
  // entirely and work identically on Git Bash, pwsh, WSL, macOS, and Linux.
  const jsonFiles = readdirSync(localeDir).filter((f) => f.endsWith(".json"));
  const relLocaleDir = fwd(relative(outDir, localeDir));
  const tarResult = Bun.spawnSync(["tar", "-czf", archiveName, "-C", relLocaleDir, ...jsonFiles], {
    cwd: outDir,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (tarResult.exitCode !== 0) {
    const tarStderr = tarResult.stderr ? new TextDecoder().decode(tarResult.stderr) : "(no output)";
    fail(`tar failed: ${tarStderr}`);
  }
  log(`  Archive: ${archivePath}`);

  // 7. Compute sha256 and size, write .sha256 sidecar for upload
  log("Computing SHA-256...");
  const bytes = await Bun.file(archivePath).bytes();
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const sizeBytes = bytes.length;
  log(`  ${sizeBytes} bytes, sha256: ${sha256}`);

  // Sidecar format matches `sha256sum <file>`: "<hash>  <filename>\n" (two spaces).
  // Upload alongside the tarball for human verification against the manifest.
  const sidecarPath = `${archivePath}.sha256`;
  await Bun.write(sidecarPath, `${sha256}  ${archiveName}\n`);
  log(`  Sidecar: ${sidecarPath}`);

  // 8. Publish to GitHub (--publish)
  let publishedUrl: string | null = null;
  if (publish) {
    publishedUrl = await publishToGitHub(archivePath, archiveName);
    log(`  Published URL: ${publishedUrl}`);
  }

  // 9. Compute completeness vs EN reference locale
  log("Computing translation completeness...");
  const enLocaleDir = join(publicLocalesDir, "en");
  const enKeys = collectLocaleKeys(enLocaleDir);
  const targetKeys = collectLocaleKeys(localeDir);
  const enCount = enKeys.size;
  const trCount = targetKeys.size;
  const completeness = Math.round(Math.min(trCount / enCount, 1) * 1000) / 1000;
  log(`  EN keys: ${enCount}, ${code} keys: ${trCount}, completeness: ${completeness}`);

  // 10. Resolve contributors: CLI value takes priority; otherwise fall back to
  //    the existing manifest entry so a republish without --contributors does
  //    not silently drop a previously-set contributors list.
  let resolvedContributors: string[] | undefined;
  if (contributorsExplicit) {
    resolvedContributors = contributors.length > 0 ? contributors : undefined;
  } else {
    // Try to read the existing manifest entry's contributors field.
    try {
      const raw = readFileSync(manifestPath, "utf-8");
      const parsed = JSON.parse(raw) as { packs?: Record<string, unknown>[] };
      const existing = (parsed.packs ?? []).find((p) => p.code === code);
      if (existing && Array.isArray(existing.contributors) && (existing.contributors as unknown[]).length > 0) {
        resolvedContributors = existing.contributors as string[];
      }
    } catch {
      // Manifest doesn't exist yet or is malformed — silently skip.
    }
  }

  // 11. Assemble entry object
  const entry: Record<string, unknown> = {
    code,
    native_name: meta.native_name,
    english_name: meta.english_name,
    rtl: meta.rtl,
    version,
    completeness,
    size_bytes: sizeBytes,
    sha256,
    url: publishedUrl ?? updateManifestUrl ?? "<FILL_URL>",
    ...(resolvedContributors && resolvedContributors.length > 0 ? { contributors: resolvedContributors } : {}),
  };

  // 12. Patch manifest.json if --update-manifest or --publish was used
  if (updateManifestUrl || publish) {
    log(`Patching manifest.json with URL: ${publishedUrl ?? updateManifestUrl}`);
    let manifest: Record<string, unknown>;
    try {
      manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
    } catch {
      fail(`Cannot read or parse ${manifestPath}`);
    }
    const packs = (manifest.packs as Record<string, unknown>[]) ?? [];
    const filtered = packs.filter((p) => p.code !== code);
    filtered.push(entry);
    filtered.sort((a, b) => String(a.code).localeCompare(String(b.code)));
    manifest.packs = filtered;
    manifest.generated_at = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
    // Write atomically via tmp file so a crash mid-write cannot corrupt the manifest
    const tmp = `${manifestPath}.tmp.${process.pid}`;
    await Bun.write(tmp, JSON.stringify(manifest, null, 2) + "\n");
    renameSync(tmp, manifestPath);
    log("  manifest.json updated.");
  }

  // 13. Push manifest to git (--push)
  if (push) {
    log("Committing and pushing language-packs/manifest.json...");
    const gitAdd = Bun.spawnSync(["git", "add", "language-packs/manifest.json"], {
      cwd: repoRoot, stdout: "pipe", stderr: "pipe",
    });
    if (gitAdd.exitCode !== 0) {
      fail(`git add failed: ${new TextDecoder().decode(gitAdd.stderr)}`);
    }
    const gitDiff = Bun.spawnSync(["git", "diff", "--cached", "--exit-code", "language-packs/manifest.json"], {
      cwd: repoRoot, stdout: "pipe", stderr: "pipe",
    });
    if (gitDiff.exitCode === 0) {
      warn("manifest.json is already up to date in git — skipping commit and push.");
    } else {
      const commitMsg = `chore(lang): update manifest for ${code} ${version}`;
      const gitCommit = Bun.spawnSync(["git", "commit", "-m", commitMsg], {
        cwd: repoRoot, stdout: "pipe", stderr: "pipe",
      });
      if (gitCommit.exitCode !== 0) {
        fail(`git commit failed: ${new TextDecoder().decode(gitCommit.stderr)}`);
      }
      const gitPush = Bun.spawnSync(["git", "push"], {
        cwd: repoRoot, stdout: "pipe", stderr: "pipe",
      });
      if (gitPush.exitCode !== 0) {
        fail(`git push failed: ${new TextDecoder().decode(gitPush.stderr)}`);
      }
      log("  manifest.json committed and pushed.");
    }
  }

  // 14. Print summary
  console.log("");
  console.log(`Pack built! ${archivePath} (${sizeBytes} bytes, completeness ${completeness})`);
  console.log(`SHA-256: ${sha256}`);
  console.log("Manifest entry:");
  console.log(JSON.stringify(entry, null, 2));

  if (!updateManifestUrl && !publish) {
    console.log(`
Next steps (or re-run with --publish --push to do this automatically):
  1. Upload ${archiveName} to the 'language-packs' GitHub release:
       gh release upload language-packs ${archivePath} --clobber
  2. Re-run with --update-manifest <url> --push to patch and commit manifest.json,
     OR paste the entry above into language-packs/manifest.json manually and commit.`);
  }
}

main().catch((e) => { fail(String(e)); });
