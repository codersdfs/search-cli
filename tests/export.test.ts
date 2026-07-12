import { describe, it, expect } from "bun:test";
import { formatJson, formatCsv, formatMarkdown, formatText } from "../src/export.ts";
import type { Repo } from "../src/types.ts";

const makeRepo = (name: string, stars: number): Repo => ({
  id: 1,
  fullName: `owner/${name}`,
  name,
  owner: "owner",
  description: `Repo ${name}`,
  url: `https://github.com/owner/${name}`,
  stars,
  forks: stars / 10,
  watchers: 0,
  language: "Rust",
  topics: ["cli"],
  archived: false,
  isFork: false,
  private: false,
  createdAt: "2023-01-01T00:00:00Z",
  updatedAt: "2024-06-15T00:00:00Z",
  pushedAt: "2024-06-15T00:00:00Z",
  score: 0,
});

const repos = [makeRepo("cli-tool", 5000), makeRepo("web-framework", 12000)];

describe("export formats", () => {
  it("formats as JSON", () => {
    const output = formatJson(repos);
    const parsed = JSON.parse(output);
    expect(parsed.length).toBe(2);
    expect(parsed[0].fullName).toBe("owner/cli-tool");
  });

  it("formats as CSV with header row", () => {
    const output = formatCsv(repos);
    expect(output).toContain("rank,full_name,stars,forks,language,url");
    expect(output).toContain("owner/cli-tool");
    expect(output).toContain("5000");
  });

  it("formats as Markdown table", () => {
    const output = formatMarkdown(repos);
    expect(output).toContain("| # | Repo | Stars | Forks | Language |");
    expect(output).toContain("|---|");
    expect(output).toContain("[owner/cli-tool]");
    expect(output).toContain("[owner/web-framework]");
  });

  it("formats as plain text", () => {
    const output = formatText(repos);
    expect(output).toContain("1. owner/cli-tool");
    expect(output).toContain("2. owner/web-framework");
    expect(output).toContain("https://github.com/owner");
  });

  it("handles empty repos list", () => {
    expect(formatJson([])).toBe("[]");
    expect(formatCsv([])).toBe("rank,full_name,stars,forks,language,url");
    expect(formatMarkdown([])).toContain("| # | Repo");
    expect(formatText([])).toBe("");
  });
});
