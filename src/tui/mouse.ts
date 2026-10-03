/**
 * Mouse support for the ghfind TUI.
 *
 * OpenTUI already emits SGR mouse tracking and hit-tests every event into a
 * `MouseEvent` whose `target` is the deepest renderable under the pointer
 * (`Renderable.processMouseEvent`). Nothing in the shell consumed them, so the
 * renderer threw the events away. This module turns them into the same
 * affordances the keyboard already offers.
 *
 * Design notes (all verified against @opentui/core 0.4.5):
 *
 *  - `SelectRenderable` has no `onMouseEvent` override and no public row
 *    geometry, so `hitIndexForY` reads `scrollOffset` / `linesPerItem` through
 *    ONE narrow cast (see `selectRowGeometry`). If a future release renames
 *    those fields the helper degrades to "no row" — clicks no-op instead of
 *    throwing. Single choke point, easy to re-point.
 *  - `setSelectedIndex` / `selectCurrent` both emit `selectionChanged` /
 *    `itemSelected`, so clicks reuse the handlers the keyboard path already
 *    drives (`src/tui.ts`) with zero duplicated logic.
 *  - `dispatchMouseEvent` auto-focuses the nearest `focusable` ancestor on
 *    left-press *unless the event is `defaultPrevented`*. `keepFocus: true`
 *    calls `preventDefault()` so clicking a row never steals focus from the
 *    query input.
 *  - `processMouseEvent` bubbles to the parent unless `stopPropagation()` is
 *    called, so every row handler stops it — otherwise a click would also fire
 *    the enclosing panel's dismiss handler.
 *  - Every `TextRenderable` defaults to `selectable: true`, and a left-press on
 *    a selectable renderable is swallowed into a text-selection drag before the
 *    shell ever sees it. `isInteractiveText()` marks the ones that must opt out.
 */
import type {
  BoxRenderable,
  CliRenderer,
  SelectRenderable,
} from "@opentui/core";

/** Two clicks closer together than this count as a double-click. */
export const DOUBLE_CLICK_MS = 400;

/**
 * Row geometry the hit test needs. `SelectRenderable` keeps all three fields
 * private, so this is the structural shape `selectRowGeometry` projects onto.
 */
export interface SelectRowGeometry {
  /** Row's screen-space top edge (`Renderable.screenY`). */
  readonly screenY: number;
  /** Visible viewport height in rows. */
  readonly height: number;
  /** Current option count. */
  readonly optionCount: number;
  /** Index of the first visible row (private `scrollOffset`). */
  readonly scrollOffset: number;
  /** Row pitch in terminal lines (private `linesPerItem`). */
  readonly linesPerItem: number;
}

/** Public stand-in used by the tests — no OpenTUI renderer required. */
export type SelectGeometryLike = SelectRowGeometry;

/**
 * Map a screen-space y coordinate to an option index, or -1 when the click
 * misses every row (empty list, click below the last row, click past the
 * viewport). Pure — no renderer state, so the off-by-one surface at scroll
 * boundaries is directly testable.
 */
export function hitIndexForY(
  geometry: SelectGeometryLike,
  screenY: number,
): number {
  const pitch = geometry.linesPerItem;
  // A zero/negative pitch means the renderable is unmeasured or malformed;
  // treat every click as a miss rather than dividing by zero.
  if (pitch <= 0) return -1;
  if (geometry.optionCount <= 0) return -1;

  const localY = screenY - geometry.screenY;
  // Above the first row, or at/below the viewport's bottom edge.
  if (localY < 0 || localY >= geometry.height) return -1;

  const row = Math.floor(localY / pitch);
  const index = geometry.scrollOffset + row;
  // The last page of options is usually shorter than the viewport, leaving
  // empty rows below it. Clamp those onto the final option rather than
  // treating the click as a miss — a user aiming at the last row should land on
  // it even when their pointer drifts a line or two.
  const last = geometry.optionCount - 1;
  if (index < 0) return 0;
  return index > last ? last : index;
}

/**
 * Project a `SelectRenderable` onto `SelectRowGeometry`.
 *
 * The single narrow cast in this module: `scrollOffset` and `linesPerItem` are
 * declared `private` in OpenTUI's `.d.ts` but are plain instance fields at
 * runtime (verified in `index.node.js`). A rename in a future release yields
 * `undefined` → `pitch <= 0` → every click misses, which is a visible no-op
 * rather than a crash.
 */
export function selectRowGeometry(select: SelectRenderable): SelectRowGeometry {
  const internal = select as unknown as {
    scrollOffset?: number;
    linesPerItem?: number;
  };
  return {
    screenY: select.screenY,
    height: select.height,
    optionCount: select.options.length,
    scrollOffset: internal.scrollOffset ?? 0,
    linesPerItem: internal.linesPerItem ?? 0,
  };
}

export interface ClickToSelectOptions {
  /**
   * Runs the list's Enter-equivalent (open the URL, run the export, ...).
   * Called on the second click of a double-click, and only when the row is
   * already selected.
   */
  onOpen?: () => void;
  /**
   * Called when a click lands on the list but resolves to no row — the empty
   * area under the last option. Full-screen overlays use it to dismiss on a
   * click below their content.
   */
  onClickMiss?: () => void;
  /**
   * `true` for the main results list: `preventDefault()` the press so OpenTUI
   * does not auto-focus the list away from the query input. Overlays leave it
   * `false` so ↑↓ / Enter keep working right after a click.
   */
  keepFocus?: boolean;
  /** Rows per wheel notch. Defaults to 3. */
  wheelStep?: number;
  /** Called with the row index as the pointer moves over the list. */
  onHoverRow?: (index: number) => void;
}

export interface AttachedSelect {
  /** Forget the pending double-click (call when the list's options change). */
  reset(): void;
  /** Row index the pointer last selected, or -1. Exposed for tests/status. */
  readonly lastHovered: number;
}

/**
 * Wire click-to-select, double-click-to-open, wheel scrolling, and hover
 * feedback onto one `SelectRenderable`.
 */
export function attachClickToSelect(
  renderer: CliRenderer,
  select: SelectRenderable,
  options: ClickToSelectOptions = {},
): AttachedSelect {
  const wheelStep = options.wheelStep ?? 3;
  let lastClickIndex = -1;
  let lastClickAt = 0;
  let lastHovered = -1;

  select.onMouseDown = (event) => {
    // A click on the list must not also reach the enclosing overlay panel's
    // dismiss handler, and must not steal focus from the query input.
    event.stopPropagation();
    if (options.keepFocus) event.preventDefault();

    const index = hitIndexForY(selectRowGeometry(select), event.y);
    if (index < 0) {
      lastClickIndex = -1;
      options.onClickMiss?.();
      return;
    }

    const now = Date.now();
    const alreadySelected = select.getSelectedIndex() === index;
    const isDouble =
      alreadySelected &&
      index === lastClickIndex &&
      now - lastClickAt < DOUBLE_CLICK_MS;

    lastClickIndex = index;
    lastClickAt = now;

    if (isDouble) {
      lastClickIndex = -1;
      options.onOpen?.();
      return;
    }

    // Emits `selectionChanged`, which the shell already uses to refresh the
    // detail pane — the click path and the keyboard path converge here.
    select.setSelectedIndex(index);
  };

  select.onMouseScroll = (event) => {
    // Claim the wheel: without stopPropagation the renderer's focused-renderable
    // fallback would also scroll whatever happens to hold focus.
    event.stopPropagation();
    const direction = event.scroll?.direction;
    if (direction === "up") select.moveUp(wheelStep);
    else if (direction === "down") select.moveDown(wheelStep);
    // "left"/"right" belong to the scrollbar, not the list.
    else return;
    renderer.requestRender();
  };

  attachHoverHighlight(renderer, select, {
    onHover: (index) => {
      lastHovered = index;
      options.onHoverRow?.(index);
    },
    // A stale row must never outlive the options it pointed at.
    onLeave: () => {
      lastHovered = -1;
    },
  });

  return {
    reset() {
      lastClickIndex = -1;
      lastClickAt = 0;
    },
    get lastHovered() {
      return lastHovered;
    },
  };
}

export interface HoverOptions {
  /** Row under the pointer, or -1 when the pointer left the list / missed. */
  onHover?: (index: number) => void;
  /** Called once when the pointer leaves the list. */
  onLeave?: () => void;
}

/**
 * Give a list a pointer cursor and a subtle background tint while hovered.
 *
 * A `SelectRenderable` can only tint its whole background (the selected row
 * owns `selectedBackgroundColor`), so the hover state is a list-wide lift —
 * enough to read as "this is live", without pretending to be per-row.
 */
export function attachHoverHighlight(
  renderer: CliRenderer,
  select: SelectRenderable,
  options: HoverOptions = {},
): void {
  const idleBackground = select.backgroundColor;
  // OpenTUI's `parseColor` only understands "transparent", CSS colour names,
  // and 3/4/6/8-digit hex — an `rgba(...)` string silently resolves to magenta.
  // A white tint at 6% alpha is the 8-digit-hex form of that.
  const hoverBackground = "#ffffff0f";
  let hovered = -1;

  select.onMouseOver = () => {
    renderer.setMousePointer("pointer");
    select.backgroundColor = hoverBackground;
    renderer.requestRender();
  };

  select.onMouseOut = () => {
    renderer.setMousePointer("default");
    select.backgroundColor = idleBackground;
    if (hovered !== -1) {
      hovered = -1;
      options.onLeave?.();
    }
    renderer.requestRender();
  };

  // Report the row under the pointer, resolved exactly like a click — but only
  // when it changed, so a stationary pointer does not re-render every frame.
  select.onMouseMove = (event) => {
    const index = hitIndexForY(selectRowGeometry(select), event.y);
    if (index === hovered) return;
    hovered = index;
    options.onHover?.(index);
  };
}

/**
 * Dismiss a full-screen overlay when the click lands on the panel itself
 * rather than on its content (border, padding, or a sibling region). Children
 * that handle their own clicks call `stopPropagation()`, so this only fires for
 * genuine outside-clicks.
 */
export function attachClickOutside(
  target: BoxRenderable,
  onDismiss: () => void,
): void {
  target.onMouseDown = (event) => {
    event.stopPropagation();
    onDismiss();
  };
}

/**
 * Make a non-list Box clickable: click runs `onActivate`, hovering swaps the
 * border to the accent colour and shows a pointer cursor.
 *
 * `setBorder`/`getBorder` are passed in rather than imported so the unit tests
 * can drive this with a plain object.
 */
export function attachClickableBox(
  renderer: CliRenderer,
  box: BoxRenderable,
  handlers: {
    onActivate: () => void;
    /** Border colour while not hovered. */
    idleBorder: string;
    /** Border colour while hovered / selected. */
    activeBorder: string;
    onStateChange?: () => void;
  },
): void {
  box.onMouseDown = (event) => {
    event.stopPropagation();
    handlers.onActivate();
  };
  box.onMouseOver = () => {
    renderer.setMousePointer("pointer");
    box.borderColor = handlers.activeBorder;
    handlers.onStateChange?.();
    renderer.requestRender();
  };
  box.onMouseOut = () => {
    renderer.setMousePointer("default");
    box.borderColor = handlers.idleBorder;
    handlers.onStateChange?.();
    renderer.requestRender();
  };
}

/**
 * Option-key that keeps a non-interactive `TextRenderable` from swallowing
 * left-presses as a text-selection drag.
 *
 * Every `TextRenderable` (and `BoxRenderable`) defaults to `selectable: true`,
 * and a left-press on a selectable renderable is turned into a selection drag
 * *before* the shell's handlers run — so a click over such text does nothing.
 * Pass this to every purely decorative renderable:
 *
 * ```ts
 * new TextRenderable(renderer, { content: "", selectable: false })
 * ```
 *
 * The query input keeps the default (`true`) so clicking into it still places
 * the cursor.
 */
export const NON_INTERACTIVE_TEXT = { selectable: false } as const;
