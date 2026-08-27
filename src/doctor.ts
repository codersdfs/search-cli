/**
 * `ghfind --doctor` — environment diagnostics for troubleshooting
 * installation / launch problems (missing Bun, wrong libc build, bad config).
 *
 * Runs a battery of checks and prints a PASS / WARN / FAIL report, then exits
 * non-zero if any FAIL check was detected.
 */
import { existsSync, readFileSync, mkdirSync } from "fs";
import { spawnSync } from "child_process";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { homedir, platform, arch } from "os";
import { loadConfig, configPath, stateDir, cacheDir } from "./config";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_DIR = join(__dirname, "..");

type CheckStatus = "PASS" | "WARN" | "FAIL";
interface CheckResult {
  status: CheckStatus;
  label: string;
  detail: string;
}

const results: CheckResult[] = [];

function add(status: CheckStatus, label: string, detail: string): void {
  results.push({ status, label, detail });
}

function run(
  cmd: string,
  args: string[],
): { status: number | null; stdout: string; stderr: string } {
  try {
    const res = spawnSync(cmd, args, { encoding: "utf8", timeout: 15000 });
    return {
      status: res.status,
      stdout: res.stdout ?? "",
      stderr: res.stderr ?? "",
    };
  } catch {
    return { status: null, stdout: "", stderr: "" };
  }
}

function hasSystemBun(): { ok: boolean; version?: string } {
  const res = run("bun", ["--version"]);
  return res.status === 0
    ? { ok: true, version: res.stdout.trim() }
    : { ok: false };
}

function bundledBunPath(): string {
  return join(PKG_DIR, "vendor", platform() === "win32" ? "bun.exe" : "bun");
}

/** Verify a bun binary actually runs (wrong libc flavor → ENOENT / segfault). */
function bunRuns(bin: string): { ok: boolean; version?: string } {
  const res = run(bin, ["--version"]);
  if (res.status !== 0) return { ok: false };
  return { ok: true, version: res.stdout.trim() };
}

function detectLibc(): "musl" | "glibc" | "unknown" {
  if (platform() !== "linux") return "unknown";
  try {
    const osRelease = readFileSync("/etc/os-release", "utf8");
    if (/alpine|musl/i.test(osRelease)) return "musl";
  } catch {
    // ignore
  }
  const ldd = run("ldd", ["--version"]);
  const out = `${ldd.stdout}${ldd.stderr}`;
  if (/musl/i.test(out)) return "musl";
  if (/glibc|GNU libc/i.test(out)) return "glibc";
  return "unknown";
}

async function checkRuntime(): Promise<void> {
  const runningOnBun = process.versions.bun !== undefined;
  const runtime = runningOnBun
    ? `Bun ${process.versions.bun}`
    : `Node ${process.version}`;
  add(
    runningOnBun ? "PASS" : "WARN",
    "Runtime",
    `Running on ${runtime}. The interactive TUI needs Bun.`,
  );
}

function checkBundledBun(): { ok: boolean } {
  const path = bundledBunPath();
  if (!existsSync(path)) {
    add(
      "WARN",
      "Bundled Bun",
      `Not found (${path}). Run \`npm install\` or install Bun manually.`,
    );
    return { ok: false };
  }
  const check = bunRuns(path);
  if (check.ok) {
    add("PASS", "Bundled Bun", `${path} (v${check.version})`);
    return { ok: true };
  }
  const libc = detectLibc();
  const hint =
    libc === "musl"
      ? "Installed Bun is the glibc build, but this system uses musl."
      : libc === "glibc"
        ? "Installed Bun is the musl build, but this system uses glibc."
        : "The bundled binary does not launch.";
  add("FAIL", "Bundled Bun", `${path} does not launch. ${hint}`);
  return { ok: false };
}

function checkSystemBun(bundledOk: boolean): void {
  const sys = hasSystemBun();
  if (sys.ok) {
    add("PASS", "System Bun", `Found \`bun\` on PATH (v${sys.version}).`);
  } else if (bundledOk) {
    add(
      "WARN",
      "System Bun",
      "No \`bun\` on PATH. Bundled Bun is working, so this is only a fallback.",
    );
  } else {
    add(
      "FAIL",
      "System Bun",
      "No \`bun\` on PATH. Install it: curl -fsSL https://bun.sh/install | bash",
    );
  }
}

function checkNodeVersion(): void {
  const major = parseInt(process.version.replace(/^v/, "").split(".")[0], 10);
  if (Number.isNaN(major) || major >= 20) {
    add("PASS", "Node version", `Node ${process.version} (>= 20 required)`);
  } else {
    add(
      "FAIL",
      "Node version",
      `Node ${process.version} is too old (>= 20 required)`,
    );
  }
}

function checkBuildOutput(): void {
  const dist = join(PKG_DIR, "dist", "cli.js");
  if (existsSync(dist)) {
    add("PASS", "Build output", `${dist}`);
  } else {
    add(
      "WARN",
      "Build output",
      "dist/cli.js not found. Run `npm run build` (Node-only fallback needs it).",
    );
  }
}

function checkSource(): void {
  const src = join(PKG_DIR, "src", "cli.ts");
  if (existsSync(src)) {
    add("PASS", "Source", `${src}`);
  } else {
    add("FAIL", "Source", "src/cli.ts not found. Reinstall the package.");
  }
}

function checkTuiBackend(): void {
  const isTTY = process.stdout.isTTY && process.stdin.isTTY;
  add(
    isTTY ? "PASS" : "WARN",
    "Terminal (TTY)",
    isTTY
      ? "stdin/stdout are TTYs — TUI can render."
      : "stdin/stdout are not TTYs — the TUI cannot render (piped/non-interactive).",
  );
}

function checkConfig(): void {
  const path = configPath();
  if (!existsSync(path)) {
    add(
      "WARN",
      "Config",
      `Not found (${path}). Run \`ghfind init\` or it will use defaults.`,
    );
    return;
  }
  try {
    const raw = readFileSync(path, "utf-8");
    JSON.parse(raw);
    add("PASS", "Config", `${path} (valid JSON)`);
  } catch (err) {
    add(
      "FAIL",
      "Config",
      `${path} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

function checkGithubToken(): void {
  const config = loadConfig();
  const token = config.githubToken || process.env.GITHUB_TOKEN;
  if (token) {
    const preview = token.slice(0, 7);
    add("PASS", "GitHub token", `Configured (${preview}…).`);
  } else {
    add(
      "WARN",
      "GitHub token",
      "No token found. Unauthenticated requests hit lower rate limits.",
    );
  }
}

function checkDirs(): void {
  for (const [label, dir] of [
    ["State dir", stateDir()],
    ["Cache dir", cacheDir()],
  ] as const) {
    try {
      mkdirSync(dir, { recursive: true });
      add("PASS", label, dir);
    } catch (err) {
      add(
        "FAIL",
        label,
        `${dir} not writable: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}

function printReport(): void {
  const colors = (s: string, n: CheckStatus) => {
    const code =
      n === "PASS" ? "\x1b[32m" : n === "WARN" ? "\x1b[33m" : "\x1b[31m";
    return `${code}${s}\x1b[0m`;
  };

  console.log("\n  ghfind doctor — environment diagnostics");
  console.log(`  ${platform()} ${arch} · ${homedir()}`);
  console.log("  ─────────────────────────────────────────");
  for (const r of results) {
    console.log(
      `  ${colors(r.status.padEnd(4), r.status)}  ${r.label}: ${r.detail}`,
    );
  }
  console.log("  ─────────────────────────────────────────");

  const fails = results.filter((r) => r.status === "FAIL").length;
  const warns = results.filter((r) => r.status === "WARN").length;
  if (fails === 0 && warns === 0) {
    console.log("  All checks passed.");
  } else if (fails === 0) {
    console.log(
      `  ${warns} warning(s) — ghfind should work, but review the items above.`,
    );
  } else {
    console.log(
      `  ${fails} failed check(s). Resolve these before running the TUI.`,
    );
  }
  console.log("");
}

export async function runDoctor(): Promise<void> {
  await checkRuntime();
  const bundled = checkBundledBun();
  checkSystemBun(bundled.ok);
  checkNodeVersion();
  checkBuildOutput();
  checkSource();
  checkTuiBackend();
  checkConfig();
  checkGithubToken();
  checkDirs();
  printReport();

  const hasFail = results.some((r) => r.status === "FAIL");
  process.exitCode = hasFail ? 1 : 0;
}
