// Tests for `ghfind --doctor` diagnostics
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { join } from "path";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";

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
});
