/**
 * SearchState — owns all TUI state and domain calls.
 *
 * The TUI view layer reads from SearchState and dispatches actions.
 * This module is testable without the OpenTUI renderer.
 */
import type { Repo, SearchOptions, SortStrategy, SessionState } from "./types";
import type { TabName } from "./trending";
import { tabSince } from "./trending";
import { parseQuery, applyFlagFilters, rankRepos, createGitHubSearch, SearchModule, TrendingAdapter } from "./search";
import { restoreSession, saveSession } from "./session";
import { appendHistory } from "./history";
import { toggleBookmark, isBookmarked } from "./bookmarks";
import { saveSearch, getSavedSearches, touchSavedSearch } from "./saved-searches";
import { fetchDeepDive, buildDeepDiveText } from "./deepdive";
import { fetchTopics } from "./explore";
import { loadConfig } from "./config";

export type Overlay =
  | "none" | "history" | "bookmarks" | "saved" | "help"
  | "topics" | "export" | "compare" | "notifications"
  | "share" | "leader" | "readme";

export interface SearchState {
  // Core search state
  currentRepos: Repo[];
  currentSort: SortStrategy;
  currentLimit: number;
  currentQueryInput: string;
  isLoading: boolean;
  currentMode: "search" | "trending";
  currentPage: number;
  totalCount: number;

  // Trending
  trendingTab: TabName;
  trendingPeriod: string;

  // UI overlays
  currentOverlay: Overlay;
  deepDiveActive: boolean;
  compareList: Repo[];
  graphFullscreen: boolean;
  chartCommitData: number[];
  quitArmed: boolean;
}

export class SearchStateManager {
  private config = loadConfig();
  private provider = createGitHubSearch(undefined, this.config.githubTokens);
  private trendingSearch = new SearchModule(new TrendingAdapter());

  state: SearchState = {
    currentRepos: [],
    currentSort: this.config.defaultSort,
    currentLimit: this.config.defaultLimit,
    currentQueryInput: "",
    isLoading: false,
    currentMode: "search",
    currentPage: 1,
    totalCount: 0,
    trendingTab: "This Week",
    trendingPeriod: "this week",
    currentOverlay: "none",
    deepDiveActive: false,
    compareList: [],
    graphFullscreen: false,
    chartCommitData: [],
    quitArmed: false,
  };

  constructor() {
    const session = restoreSession();
    if (session) {
      this.state.currentMode = session.mode;
      this.state.currentQueryInput = session.query;
      this.state.currentSort = session.sort;
      this.state.currentLimit = session.limit;
      this.state.trendingTab = (session.trendingTab as TabName) ?? "This Week";
    }
  }

  // ── Search ──

  async search(query: string, page: number = 1): Promise<void> {
    this.state.isLoading = true;
    this.state.currentQueryInput = query;
    this.state.currentPage = page;
    try {
      const parsed = applyFlagFilters(parseQuery(query), {});
      const response = await this.provider.search(parsed, {
        limit: this.state.currentLimit,
        sort: this.state.currentSort,
        json: false,
        verbose: false,
        token: this.config.githubToken,
        page,
      });
      this.state.currentRepos = rankRepos(response.repos, this.state.currentSort);
      this.state.totalCount = response.totalCount;
      this.state.currentMode = "search";
      appendHistory({ query, mode: "search", timestamp: Date.now(), resultCount: response.repos.length });
    } catch (err) {
      throw err;
    } finally {
      this.state.isLoading = false;
    }
  }

  async nextPage(): Promise<void> {
    await this.search(this.state.currentQueryInput, this.state.currentPage + 1);
  }

  async prevPage(): Promise<void> {
    if (this.state.currentPage > 1) {
      await this.search(this.state.currentQueryInput, this.state.currentPage - 1);
    }
  }

  // ── Trending ──

  async loadTrending(tab: TabName): Promise<void> {
    this.state.isLoading = true;
    this.state.trendingTab = tab;
    this.state.currentMode = "trending";
    try {
      const response = await this.trendingSearch.search(
        { keywords: [], qualifiers: [], raw: "trending" },
        { limit: 25, sort: "stars", json: false, verbose: false, trendingSince: tabSince(tab) },
      );
      this.state.currentRepos = response.repos;
      this.state.totalCount = response.totalCount;
      appendHistory({ query: `trending:${tab}`, mode: "trending", tab, timestamp: Date.now(), resultCount: response.repos.length });
    } finally {
      this.state.isLoading = false;
    }
  }

  // ── Bookmarks ──

  toggleBookmark(repo: Repo): boolean {
    return toggleBookmark(repo);
  }

  isBookmarked(fullName: string): boolean {
    return isBookmarked(fullName);
  }

  // ── Saved searches ──

  saveCurrentSearch(name: string): void {
    saveSearch(name, this.state.currentQueryInput, this.state.currentMode, this.state.currentSort, this.state.currentLimit);
  }

  getSavedSearches() {
    return getSavedSearches();
  }

  touchSavedSearch(name: string): void {
    touchSavedSearch(name);
  }

  // ── Deep dive ──

  async deepDive(repo: Repo): Promise<string> {
    this.state.deepDiveActive = true;
    try {
      const data = await fetchDeepDive(repo, this.config.githubToken);
      return buildDeepDiveText(data);
    } finally {
      this.state.deepDiveActive = false;
    }
  }

  // ── Compare ──

  addToCompare(repo: Repo): void {
    if (!this.state.compareList.some((r) => r.fullName === repo.fullName)) {
      this.state.compareList.push(repo);
    }
  }

  removeFromCompare(fullName: string): void {
    this.state.compareList = this.state.compareList.filter((r) => r.fullName !== fullName);
  }

  clearCompare(): void {
    this.state.compareList = [];
  }

  // ── Session ──

  saveSession(): void {
    const s: SessionState = {
      mode: this.state.currentMode,
      query: this.state.currentQueryInput,
      sort: this.state.currentSort,
      limit: this.state.currentLimit,
      trendingTab: this.state.trendingTab,
    };
    saveSession(s);
  }

  // ── Setters ──

  setSort(sort: SortStrategy): void {
    this.state.currentSort = sort;
  }

  setLimit(limit: number): void {
    this.state.currentLimit = limit;
  }

  setOverlay(overlay: Overlay): void {
    this.state.currentOverlay = overlay;
  }

  setGraphFullscreen(fullscreen: boolean): void {
    this.state.graphFullscreen = fullscreen;
  }

  setChartCommitData(data: number[]): void {
    this.state.chartCommitData = data;
  }

  setQuitArmed(armed: boolean): void {
    this.state.quitArmed = armed;
  }
}
