// Tests for `ghfind --doctor` diagnostics
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { join } from "node:path";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";

describe("doctor", () => {
  const origEnv = { ...process.env };
  const origExitCode = process.exitCode;
  let tmpDirs: string[] = [];

  beforeEach(() => {
    const dir = mkdtempSync(join(tmpdir(), "ghfind-doctor-"));
    tmpDirs.push(dir);
    process.env.GHFIND_CONFIG = join(dir, "config.json");
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    process.env = { ...origEnv };
    // doctor sets process.exitCode by design; leaking it fails the whole suite.
    process.exitCode = origExitCode ?? 0;
    for (const dir of tmpDirs) rmSync(dir, { recursive: true, force: true });
    tmpDirs = [];
    vi.restoreAllMocks();
  });

  it("reports at least one check and sets an exit code", async () => {
    const { runDoctor } = await import("../src/doctor.ts");
    await runDoctor();
    expect(process.exitCode).toBeDefined();
    expect(console.log).toHaveBeenCalled();
  });

  it("flags an invalid config file as a failure", async () => {
    const badPath = mkdtempSync(join(tmpdir(), "ghfind-doctor-bad-"));
    tmpDirs.push(badPath);
    process.env.GHFIND_CONFIG = join(badPath, "config.json");
    writeFileSync(process.env.GHFIND_CONFIG, "{ not valid json");
    const { runDoctor } = await import("../src/doctor.ts");
    await runDoctor();
    expect(process.exitCode).toBe(1);
  });

  it("emits no ANSI escape codes when NO_COLOR is set", async () => {
    const logs: string[] = [];
    // console.log is already spied in beforeEach; swap in a collecting impl.
    (
      console.log as unknown as {
        mockImplementation: (fn: (...args: unknown[]) => void) => void;
      }
    ).mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    });
    process.env.NO_COLOR = "1";
    const { runDoctor } = await import("../src/doctor.ts");
    await runDoctor();
    const output = logs.join("\n");
    expect(output).toContain("ghfind doctor");
    expect(output).not.toContain("\x1b[");
  });
});

describe("installVersionAt", () => {
  const tmp = mkdtempSync(join(tmpdir(), "ghfind-doctor-install-"));

  it("reads the version from a Windows-style npm prefix layout", () => {
    // <prefix>/ghfind.cmd → <prefix>/node_modules/github-search-cli/package.json
    const prefix = join(tmp, "win-prefix");
    const pkgDir = join(prefix, "node_modules", "github-search-cli");
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(
      join(pkgDir, "package.json"),
      JSON.stringify({ name: "github-search-cli", version: "9.1.0" }),
    );
    writeFileSync(join(prefix, "ghfind.cmd"), "@echo off\n");

    const { installVersionAt } = require("../src/doctor.ts");
    const info = installVersionAt(join(prefix, "ghfind.cmd"));
    expect(info).not.toBeNull();
    expect(info?.version).toBe("9.1.0");
    expect(info?.dir.replace(/\\/g, "/")).toContain(
      "win-prefix/node_modules/github-search-cli",
    );
  });

  it("reads the version from a Unix-style npm prefix layout", () => {
    // <prefix>/bin/ghfind → <prefix>/lib/node_modules/github-search-cli/package.json
    const prefix = join(tmp, "unix-prefix");
    const pkgDir = join(prefix, "lib", "node_modules", "github-search-cli");
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(
      join(pkgDir, "package.json"),
      JSON.stringify({ name: "github-search-cli", version: "9.4.4" }),
    );
    mkdirSync(join(prefix, "bin"), { recursive: true });
    writeFileSync(join(prefix, "bin", "ghfind"), "#!/bin/sh\n");

    const { installVersionAt } = require("../src/doctor.ts");
    const info = installVersionAt(join(prefix, "bin", "ghfind"));
    expect(info).not.toBeNull();
    expect(info?.version).toBe("9.4.4");
  });

  it("returns null for a shim with no discoverable install", () => {
    const { installVersionAt } = require("../src/doctor.ts");
    const info = installVersionAt(join(tmp, "does-not-exist", "ghfind"));
    expect(info).toBeNull();
  });
});
