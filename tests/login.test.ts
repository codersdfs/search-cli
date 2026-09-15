// Tests for `ghfind login` token management.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { join } from "path";
import { tmpdir } from "os";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "fs";
import {
  parseHostsYmlToken,
  readGhCliToken,
  isLikelyGithubToken,
  maskToken,
  persistToken,
  runLoginWizard,
  type LoginDeps,
} from "../src/login";
import { loadConfig, saveConfig } from "../src/config";

describe("parseHostsYmlToken", () => {
  it("extracts the oauth_token under the matching host", () => {
    const yml = [
      "github.com:",
      "    git_protocol: https",
      "    oauth_token: gho_abc123",
      "    user: tester",
    ].join("\n");
    expect(parseHostsYmlToken(yml)).toBe("gho_abc123");
  });

  it("ignores tokens that belong to other hosts", () => {
    const yml = [
      "enterprise.example.com:",
      '    oauth_token: "gho_other"',
      "github.com:",
      "    oauth_token: gho_main",
    ].join("\n");
    expect(parseHostsYmlToken(yml)).toBe("gho_main");
  });

  it("returns undefined when the host is absent", () => {
    const yml = "enterprise.example.com:\n    oauth_token: gho_other\n";
    expect(parseHostsYmlToken(yml)).toBeUndefined();
  });

  it("returns undefined when the host has no oauth_token", () => {
    const yml = "github.com:\n    git_protocol: ssh\n    user: tester\n";
    expect(parseHostsYmlToken(yml)).toBeUndefined();
  });

  it("accepts CRLF line endings", () => {
    const yml =
      "github.com:\r\n    oauth_token: gho_crlf\r\n    user: tester\r\n";
    expect(parseHostsYmlToken(yml)).toBe("gho_crlf");
  });
});

describe("isLikelyGithubToken", () => {
  it("accepts ghp_, gho_, and github_pat_ prefixes", () => {
    expect(isLikelyGithubToken("ghp_longclassicpat")).toBe(true);
    expect(isLikelyGithubToken("gho_oauthfromgh")).toBe(true);
    expect(isLikelyGithubToken("github_pat_finegrained")).toBe(true);
  });

  it("rejects arbitrary strings", () => {
    expect(isLikelyGithubToken("password123")).toBe(false);
    expect(isLikelyGithubToken("")).toBe(false);
  });
});

describe("maskToken", () => {
  it("shows the prefix and tail of a long token", () => {
    expect(maskToken("ghp_abcdefghijklmnop")).toBe("ghp_abc…mnop");
  });
});

describe("readGhCliToken", () => {
  // Fresh, collision-proof dir per test. `tmpdir()/ghfind-login-gh-${Date.now()}`
  // was shared whenever two suites started in the same millisecond (e.g. tests
  // run concurrently in separate processes), so "no hosts.yml exists" could see
  // a hosts.yml another process had just written.
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "ghfind-login-gh-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("returns undefined when no hosts.yml exists", () => {
    expect(readGhCliToken(dir)).toBeUndefined();
  });

  it("reads the token from a gh-style hosts.yml", () => {
    writeFileSync(
      join(dir, "hosts.yml"),
      "github.com:\n    oauth_token: gho_fromgh\n",
      "utf-8",
    );
    expect(readGhCliToken(dir)).toBe("gho_fromgh");
  });

  it("respects GH_HOST when set", () => {
    writeFileSync(
      join(dir, "hosts.yml"),
      "ghe.corp.example:\n    oauth_token: gho_enterprise\n",
      "utf-8",
    );
    expect(readGhCliToken(dir, "ghe.corp.example")).toBe("gho_enterprise");
    expect(readGhCliToken(dir, "github.com")).toBeUndefined();
  });
});

describe("persistToken", () => {
  // Same collision-proof, self-cleaning temp dir as above.
  let configDir: string;
  let configFile: string;

  beforeEach(() => {
    configDir = mkdtempSync(join(tmpdir(), "ghfind-login-config-"));
    configFile = join(configDir, "config.json");
    process.env.GHFIND_CONFIG = configFile;
  });

  afterEach(() => {
    delete process.env.GHFIND_CONFIG;
    rmSync(configDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("writes the token into the config file", () => {
    persistToken("gho_imported", {
      readConfig: loadConfig,
      writeConfig: (config) => saveConfig(config),
    });
    expect(existsSync(configFile)).toBe(true);
    const saved = JSON.parse(readFileSync(configFile, "utf-8"));
    expect(saved.githubToken).toBe("gho_imported");
  });
});

describe("runLoginWizard", () => {
  const origEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...origEnv };
    vi.restoreAllMocks();
  });

  function makeDeps(overrides: Partial<LoginDeps>): LoginDeps {
    return {
      ask: async () => "",
      readGhCliToken: () => undefined,
      readConfig: () => ({
        githubToken: undefined,
        defaultSort: "best-match",
        defaultLimit: 50,
        theme: "tokyo-night",
        cacheTtlSeconds: 300,
        defaultTab: "search",
      }),
      writeConfig: () => {},
      ...overrides,
    };
  }

  it("imports the gh CLI token when confirmed", async () => {
    let wrote: Record<string, unknown> | undefined;
    await runLoginWizard(
      makeDeps({
        ask: async () => "y",
        readGhCliToken: () => "gho_fromgh",
        writeConfig: (config) => {
          wrote = config as unknown as Record<string, unknown>;
        },
      }),
    );
    expect(wrote?.githubToken).toBe("gho_fromgh");
  });

  it("does not import the gh CLI token when declined", async () => {
    const writeConfig = vi.fn();
    await runLoginWizard(
      makeDeps({
        ask: async () => "n",
        readGhCliToken: () => "gho_fromgh",
        writeConfig,
      }),
    );
    expect(writeConfig).not.toHaveBeenCalled();
  });

  it("saves a pasted token", async () => {
    const writeConfig = vi.fn();
    await runLoginWizard(
      makeDeps({
        ask: async () => "github_pat_fine",
        writeConfig,
      }),
    );
    expect(writeConfig).toHaveBeenCalledWith(
      expect.objectContaining({ githubToken: "github_pat_fine" }),
    );
  });

  it("rejects a suspicious pasted token unless confirmed", async () => {
    const writeConfig = vi.fn();
    await runLoginWizard(
      makeDeps({
        ask: async () => "super-secret",
        writeConfig,
      }),
    );
    expect(writeConfig).not.toHaveBeenCalled();
  });
});
