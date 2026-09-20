/**
 * Theme system — Premium palettes with nuanced color layers.
 * Each theme provides a rich color hierarchy for premium visual depth.
 */
export interface Theme {
  name: string;
  /** Primary background — deepest layer */
  bg: string;
  /** Secondary surface — cards, panels, elevated areas */
  surface: string;
  /** Tertiary surface — subtle hover/focus states */
  surfaceAlt: string;
  /** Primary text — highest contrast */
  text: string;
  /** Secondary text — labels, metadata */
  muted: string;
  /** Accent colors for semantic meaning */
  blue: string;
  green: string;
  yellow: string;
  red: string;
  teal: string;
  purple: string;
  orange: string;
  /** Border and divider color */
  border: string;
  /** Subtle border for inner dividers */
  borderAlt: string;
  /** Darkest thin colorblock - thicker than border, acts as visual separator */
  separator: string;
  /** Selection/hover background */
  selectionBg: string;
  /** Selection/hover text */
  selectionText: string;
  /** Success state color */
  success: string;
  /** Warning state color */
  warning: string;
  /** Error state color */
  error: string;
  /** Modal/overlay panel background (darker than surface) */
  surfaceDim: string;
  /** Primary accent for titles and highlights */
  accent: string;
  /** Dimmed accent for secondary accents */
  accentDim: string;
  /** Border for floating/modal panels */
  borderAccent: string;
}

const THEMES: Record<string, Theme> = {
  "tokyo-night": {
    name: "tokyo-night",
    // Genuine Tokyo Night palette — cool blue-violet mood
    bg: "#1a1b26",
    surface: "#24283b",
    surfaceAlt: "#292e42",
    text: "#c0caf5",
    muted: "#565f89",
    blue: "#7aa2f7",
    green: "#9ece6a",
    yellow: "#e0af68",
    red: "#f7768e",
    teal: "#73daca",
    purple: "#bb9af7",
    orange: "#ff9e64",
    border: "#24283b",
    borderAlt: "#1f2335",
    separator: "#1f2335",
    selectionBg: "#2d3f76",
    selectionText: "#c0caf5",
    success: "#9ece6a",
    warning: "#e0af68",
    error: "#f7768e",
    surfaceDim: "#16161e",
    accent: "#7aa2f7",
    accentDim: "#5d7abf",
    borderAccent: "#1f2335",
  },
  "premium-dark": {
    name: "premium-dark",
    // Warm counter-mood to Tokyo Night — amber/rust accent
    bg: "#1e1e2e",
    surface: "#262637",
    surfaceAlt: "#2e2e42",
    text: "#cdd6f4",
    muted: "#6c7086",
    blue: "#89b4fa",
    green: "#a6e3a1",
    yellow: "#f9e2af",
    red: "#f38ba8",
    teal: "#94e2d5",
    purple: "#cba6f7",
    orange: "#fab387",
    border: "#313244",
    borderAlt: "#2a2a3d",
    separator: "#2a2a3d",
    selectionBg: "#45475a",
    selectionText: "#cdd6f4",
    success: "#a6e3a1",
    warning: "#f9e2af",
    error: "#f38ba8",
    surfaceDim: "#181825",
    accent: "#f9e2af",
    accentDim: "#c9a87a",
    borderAccent: "#313244",
  },
};

export function loadTheme(name: string): Theme {
  return THEMES[name] ?? THEMES["tokyo-night"];
}

export function listThemes(): string[] {
  return Object.keys(THEMES);
}

// ─── Terminal-matched surface blending ────────────────────────────────
/** Parse a hex color to [r,g,b]; expands 3-digit form (#abc → #aabbcc). */
function parseHex(hex: string): [number, number, number] | null {
  let h = hex.trim().replace(/^#/, "");
  if (h.length === 3)
    h = h
      .split("")
      .map((c) => c + c)
      .join("");
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

const toHex2 = (n: number) => n.toString(16).padStart(2, "0");

/** Linear blend between two hex colors; t=0 → a, t=1 → b. */
export function mixHex(a: string, b: string, t: number): string {
  const ca = parseHex(a);
  const cb = parseHex(b);
  if (!ca || !cb) return a;
  const mix = (x: number, y: number) => Math.round(x + (y - x) * t);
  return `#${toHex2(mix(ca[0], cb[0]))}${toHex2(mix(ca[1], cb[1]))}${toHex2(mix(ca[2], cb[2]))}`;
}

/** Perceived luminance (0–1); < 0.5 reads as a dark terminal background. */
export function isDarkHex(hex: string): boolean {
  const c = parseHex(hex);
  if (!c) return false;
  return (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255 < 0.5;
}

/**
 * Derive card/surface/border layer colors from the terminal background so
 * panels blend into the user's terminal instead of fighting it. Layers are
 * the background lightened by small steps (and surfaceDim darkened, for
 * sunken modals). Returns null for light backgrounds, where the dark-theme
 * chrome wouldn't work — callers should keep the theme's own layers then.
 */
export function deriveSurfaceLayers(
  bgHex: string,
): Record<string, string> | null {
  if (!isDarkHex(bgHex)) return null;
  const w = "#ffffff";
  return {
    surface: mixHex(bgHex, w, 0.045),
    surfaceAlt: mixHex(bgHex, w, 0.07),
    // Sunken modal/overlay panels (toast etc.) — darker than the backdrop
    surfaceDim: mixHex(bgHex, "#000000", 0.15),
    border: mixHex(bgHex, w, 0.09),
    borderAlt: mixHex(bgHex, w, 0.055),
    separator: mixHex(bgHex, w, 0.055),
    borderAccent: mixHex(bgHex, w, 0.065),
  };
}

/**
 * Parse an OSC color reply spec into #rrggbb.
 * Handles `rgb:RR/GG/BB`, `rgb:RRRR/GGGG/BBBB` (values scaled to 8-bit),
 * and `rgba:...` (alpha component ignored).
 */
export function parseOscColor(spec: string): string | null {
  const m = spec
    .trim()
    .match(
      /^(?:rgb|rgba):([0-9a-fA-F]{1,4})\/([0-9a-fA-F]{1,4})\/([0-9a-fA-F]{1,4})(?:\/[0-9a-fA-F]{1,4})?$/,
    );
  if (!m) return null;
  // Scale the channel to 8-bit regardless of digit count (1–4 hex digits).
  const chan = (h: string): number => {
    const value = parseInt(h, 16);
    const max = 16 ** h.length - 1;
    return Math.round((value * 255) / max);
  };
  const hex = (n: number) => n.toString(16).padStart(2, "0");
  return `#${hex(chan(m[1]))}${hex(chan(m[2]))}${hex(chan(m[3]))}`;
}

/**
 * Query the terminal's actual default background color via OSC 11.
 *
 * Must be called BEFORE the opentui renderer takes over stdin. Enables raw
 * mode, writes `ESC ] 11 ; ? BEL`, and parses the reply (`rgb:R/G/B`, ST- or
 * BEL-terminated). Returns null when the terminal doesn't answer — e.g.
 * piped output, Windows conhost, or terminals without OSC 11 support — in
 * which case callers should fall back to the theme's bg.
 *
 * (Implemented directly rather than via opentui's TerminalPalette: its stdin
 * subscription depends on renderer session machinery that isn't running yet
 * at boot, so it never receives the reply.)
 */
export async function detectTerminalBackground(
  timeoutMs = 400,
): Promise<string | null> {
  const stdin = process.stdin;
  const stdout = process.stdout;
  const setRawMode = (
    stdin as typeof stdin & { setRawMode?: (m: boolean) => unknown }
  ).setRawMode;
  if (!stdout.isTTY || !stdin.isTTY || typeof setRawMode !== "function")
    return null;

  return new Promise<string | null>((resolve) => {
    const wasRaw = stdin.isRaw === true;
    let settled = false;
    let buffer = "";

    const finish = (result: string | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      stdin.removeListener("data", onData);
      try {
        setRawMode.call(stdin, wasRaw);
      } catch {
        /* best effort restore */
      }
      stdin.pause();
      resolve(result);
    };

    // Reply: ESC ] 11 ; <spec> (BEL | ESC \)
    const onData = (d: Buffer) => {
      buffer += d.toString("latin1");
      // biome-ignore lint/suspicious/noControlCharactersInRegex: matches raw ANSI OSC-11 escape bytes, which are control characters by definition
      const m = buffer.match(/\x1b\]11;([^\x07\x1b]*)(?:\x07|\x1b\\)/);
      if (m) finish(parseOscColor(m[1]));
    };

    const timer = setTimeout(() => finish(null), timeoutMs);
    try {
      setRawMode.call(stdin, true);
      stdin.on("data", onData);
      stdin.resume();
      stdout.write("\x1b]11;?\x07");
    } catch {
      finish(null);
    }
  });
}
