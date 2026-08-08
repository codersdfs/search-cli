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
