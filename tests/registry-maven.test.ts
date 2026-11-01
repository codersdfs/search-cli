// Maven Central's Solr endpoint is the one registry here with no popularity data
// and no per-row version: it publishes `latestVersion`, `numFound`, and a
// `group:artifact` id. A provider that quietly reports downloads: 0 and lets the
// formatter say "0/mo" would be lying, which is why the catalog window is `none`.
import { describe, it, expect, afterEach } from "vitest";
import {
  mavenProvider,
  mavenSearchUrl,
  normalizeMavenDoc,
} from "../src/registries/maven.ts";
import { getProvider } from "../src/registries/index.ts";
import { registryMeta } from "../src/registries/catalog.ts";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const DOC = {
  id: "com.cobber.fta:cli",
  g: "com.cobber.fta",
  a: "cli",
  latestVersion: "17.1.0",
  repositoryId: "central",
  p: "jar",
  timestamp: 1751215759000,
  versionCount: 192,
};

const PAYLOAD = { response: { numFound: 2431, start: 0, docs: [DOC] } };

describe("mavenSearchUrl", () => {
  it("asks for JSON with rows bounded by Maven's ceiling", () => {
    expect(mavenSearchUrl("json parser", 25)).toBe(
      "https://search.maven.org/solrsearch/select?q=json%20parser&rows=25&wt=json",
    );
    expect(mavenSearchUrl("json", 200)).toContain("rows=200");
  });

  it("never uses core=gav, which returns non-JSON for some queries", () => {
    expect(mavenSearchUrl("cli", 20)).not.toContain("core=");
  });
});

describe("normalizeMavenDoc", () => {
  it("maps a coordinate to Package using latestVersion", () => {
    expect(normalizeMavenDoc(DOC)).toMatchObject({
      name: "com.cobber.fta:cli",
      version: "17.1.0",
      description: null,
      url: "https://central.sonatype.com/artifact/com.cobber.fta/cli",
      downloads: 0,
      score: 0,
      publisher: "com.cobber.fta",
      keywords: [],
      registry: "maven",
    });
  });

  it("keeps the whole coordinate as the name so groupId is not lost", () => {
    expect(normalizeMavenDoc(DOC).name).toContain(":");
  });

  it("survives a doc with no group/artifact id", () => {
    const out = normalizeMavenDoc({});
    expect(out.name).toBe("");
    expect(out.url).toBe("https://central.sonatype.com/");
  });

  it("the catalog declares Maven's download window as none", () => {
    expect(registryMeta("maven").downloadsWindow).toBe("none");
  });
});

describe("mavenProvider.search", () => {
  it("is registered under the maven id", () => {
    expect(getProvider("maven")).toBe(mavenProvider);
  });

  it("reads numFound and docs", async () => {
    globalThis.fetch = (async () =>
      jsonResponse(PAYLOAD)) as unknown as typeof fetch;
    const res = await mavenProvider.search("cli", 20);
    expect(res.totalCount).toBe(2431);
    expect(res.packages[0].name).toBe("com.cobber.fta:cli");
  });

  it("tolerates a payload with no response object", async () => {
    globalThis.fetch = (async () =>
      jsonResponse({
        responseHeader: { status: 0 },
      })) as unknown as typeof fetch;
    const res = await mavenProvider.search("nothing", 20);
    expect(res.packages).toEqual([]);
    expect(res.totalCount).toBe(0);
  });

  it("clamps a too-large limit to 200 before fetching", async () => {
    let seenUrl = "";
    globalThis.fetch = (async (url: string | URL | Request) => {
      seenUrl = String(url);
      return jsonResponse({ response: { numFound: 0, docs: [] } });
    }) as unknown as typeof fetch;
    await mavenProvider.search("cli", 500);
    expect(seenUrl).toContain("rows=200");
  });

  it("throws an error naming the registry on a failed request", async () => {
    globalThis.fetch = (async () =>
      new Response("blocked", { status: 403 })) as unknown as typeof fetch;
    await expect(mavenProvider.search("cli", 20)).rejects.toThrow(
      "Maven Central search failed: HTTP 403",
    );
  });
});
