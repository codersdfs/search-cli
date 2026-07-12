/**
 * `search-cli init` wizard — interactive one-time config setup.
 * 
 * ponytail: simple stdin prompts, no curses/readline UI.
 */
import { createInterface } from "readline";
import { saveConfig } from "./config.ts";
import { listThemes } from "./themes.ts";
import type { Config, SortStrategy } from "./types.ts";

function ask(query: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(query, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

export async function runInitWizard(): Promise<void> {
  console.log("");
  console.log("  search-cli setup wizard");
  console.log("  ──────────────────────");
  console.log("");

  const token = await ask("  GitHub token (optional, press Enter to skip): ");
  if (token && !token.startsWith("ghp_") && !token.startsWith("github_pat_") && !token.startsWith("gho_")) {
    console.log("  ⚠ Token doesn't look like a GitHub token (should start with ghp_, gho_, or github_pat_)");
  }

  const sortStr = await ask("  Default sort [best-match/stars/updated/forks] (best-match): ");
  const limitStr = await ask("  Default result limit [10-100] (50): ");

  const themes = listThemes();
  const themeStr = await ask(`  Theme [${themes.join("/")}] (tokyo-night): `);

  const config: Config = {
    defaultSort: (["best-match", "stars", "updated", "forks"].includes(sortStr)
      ? sortStr
      : "best-match") as SortStrategy,
    defaultLimit: Math.min(100, Math.max(10, parseInt(limitStr) || 50)),
    theme: themes.includes(themeStr) ? themeStr : "tokyo-night",
    cacheTtlSeconds: 300,
    defaultTab: "search",
  };

  if (token) config.githubToken = token;

  saveConfig(config);
  const { configPath } = await import("./config.ts");
  console.log(`  ✓ Config saved to ${configPath()}`);
  console.log("  Run 'search-cli' to start browsing!");
  console.log("");
}
