/**
 * Overlay registry seam.
 *
 * Each overlay owns its own renderable subtree, its own keybinds, and its
 * own refresh logic. The TUI shell no longer hard-codes if/else-if chains
 * over id strings; it queries this registry.
 *
 * When migrating an overlay out of src/tui.ts, add its module here and
 * register it in OVERLAYS. The test suite in tests/overlay-registry.test.ts
 * fails if the registry is out of sync with the dispatcher's id set.
 */

export interface Overlay {
  /** Stable id matched by the dispatcher's setOverlay(id) calls. */
  id: string;
  /**
   * Build the root renderable for this overlay. Called once during shell
   * construction; the caller adds the result to the modal layer.
   */
  build(): unknown;
  /**
   * Optional refresh hook fired every time the overlay becomes visible.
   * Use this to re-read history, re-list bookmarks, etc.
   */
  onShow?(): void;
  /**
   * Optional teardown fired when the overlay is hidden. Cancel pending
   * fetches, drop focus, etc.
   */
  onHide?(): void;
  /**
   * Optional key handler. Return true if the overlay consumed the key
   * (caller should not propagate to the main view).
   */
  handleKey?(key: string): boolean;
}

// ponytail: registry is an array (not a Map) to keep import order trivial
// and to let tests inspect id order. Add when we exceed ~20 overlays.
export const OVERLAYS: Overlay[] = [];
// helpOverlay intentionally not auto-registered: the migration is gradual.
// Uncomment when src/tui.ts is ready to consume the registry instead of
// building helpBox inline.
// import { helpOverlay } from "./help";
// OVERLAYS.push(helpOverlay);

const byId = new Map<string, Overlay>();
for (const o of OVERLAYS) byId.set(o.id, o);

export function getOverlay(id: string): Overlay | undefined {
  return byId.get(id);
}
