import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { join } from "path";
import { mkdirSync, writeFileSync, unlinkSync, rmdirSync, existsSync } from "fs";
import { tmpdir } from "os";

// Tests for config loading with controlled env vars
describe("config", () => {
  const origEnv = { ...process.env };
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `search-cli-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    process.env = { ...origEnv };
    try { unlinkSync(join(tmpDir, "config.json")); } catch {}
    try { rmdirSync(tmpDir); } catch {}
  });

  it("loads defaults when no config file exists", async () => {
    process.env.SEARCH_CLI_CONFIG = join(tmpDir, "config.json");
    const { loadConfig } = await import("../src/config.ts");
    const cfg = loadConfig();
    expect(cfg.defaultSort).toBe("best-match");
    expect(cfg.defaultLimit).toBe(50);
    expect(cfg.theme).toBe("tokyo-night");
    expect(cfg.cacheTtlSeconds).toBe(300);
    expect(cfg.defaultTab).toBe("search");
  });

  it("reads GITHUB_TOKEN from env", async () => {
    process.env.SEARCH_CLI_CONFIG = join(tmpDir, "config.json");
    process.env.GITHUB_TOKEN = "gh_test_token";
    const { loadConfig } = await import("../src/config.ts");
    const cfg = loadConfig();
    expect(cfg.githubToken).toBe("gh_test_token");
  });

  it("loads config from explicit path", async () => {
    const cfgPath = join(tmpDir, "config.json");
    writeFileSync(cfgPath, JSON.stringify({
      defaultSort: "stars",
      defaultLimit: 100,
      theme: "dracula",
    }));
    process.env.SEARCH_CLI_CONFIG = cfgPath;
    const { loadConfig } = await import("../src/config.ts");
    const cfg = loadConfig();
    expect(cfg.defaultSort).toBe("stars");
    expect(cfg.defaultLimit).toBe(100);
    expect(cfg.theme).toBe("dracula");
    expect(cfg.cacheTtlSeconds).toBe(300); // default
  });

  it("merges partial config with defaults", async () => {
    const cfgPath = join(tmpDir, "config.json");
    writeFileSync(cfgPath, JSON.stringify({ defaultLimit: 25 }));
    process.env.SEARCH_CLI_CONFIG = cfgPath;
    const { loadConfig } = await import("../src/config.ts");
    const cfg = loadConfig();
    expect(cfg.defaultLimit).toBe(25);
    expect(cfg.defaultSort).toBe("best-match");
    expect(cfg.theme).toBe("tokyo-night");
  });
});
