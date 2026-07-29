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
}

const THEMES: Record<string, Theme> = {
  "premium-dark": {
    name: "premium-dark",
    bg: "#3D3B3B", surface: "#4a4848", surfaceAlt: "#525050",
    text: "#e0e4f0", muted: "#a8a6a6",
    blue: "#89b4fa", green: "#a6e3a1", yellow: "#f9e2af", red: "#f38ba8",
    teal: "#94e2d5", purple: "#cba6f7", orange: "#fab387",
    border: "#1C1C1C", borderAlt: "#2a2a2a", separator: "#1C1C1C",
    selectionBg: "#2A2A9C", selectionText: "#ffffff",
    success: "#a6e3a1", warning: "#f9e2af", error: "#f38ba8",
  },
  "tokyo-night": {
    name: "tokyo-night",
    bg: "#3D3B3B", surface: "#4a4848", surfaceAlt: "#525050",
    text: "#e0e4f0", muted: "#a8a6a6",
    blue: "#89b4fa", green: "#a6e3a1", yellow: "#f9e2af", red: "#f38ba8",
    teal: "#94e2d5", purple: "#cba6f7", orange: "#fab387",
    border: "#1C1C1C", borderAlt: "#2a2a2a", separator: "#1C1C1C",
    selectionBg: "#2A2A9C", selectionText: "#ffffff",
    success: "#a6e3a1", warning: "#f9e2af", error: "#f38ba8",
  },
  dracula: {
    name: "dracula",
    bg: "#3D3B3B", surface: "#4a4848", surfaceAlt: "#525050",
    text: "#f8f8f2", muted: "#a8a6a6",
    blue: "#8be9fd", green: "#50fa7b", yellow: "#f1fa8c", red: "#ff5555",
    teal: "#50fa7b", purple: "#bd93f9", orange: "#ffb86c",
    border: "#1C1C1C", borderAlt: "#2a2a2a", separator: "#1C1C1C",
    selectionBg: "#2A2A9C", selectionText: "#ffffff",
    success: "#50fa7b", warning: "#f1fa8c", error: "#ff5555",
  },
  monokai: {
    name: "monokai",
    bg: "#3D3B3B", surface: "#4a4848", surfaceAlt: "#525050",
    text: "#f8f8f2", muted: "#a8a6a6",
    blue: "#66d9ef", green: "#a6e22e", yellow: "#e6db74", red: "#f92672",
    teal: "#a6e22e", purple: "#ae81ff", orange: "#fd971f",
    border: "#1C1C1C", borderAlt: "#2a2a2a", separator: "#1C1C1C",
    selectionBg: "#2A2A9C", selectionText: "#f8f8f2",
    success: "#a6e22e", warning: "#e6db74", error: "#f92672",
  },
};

export function loadTheme(name: string): Theme {
  return THEMES[name] ?? THEMES["tokyo-night"];
}

export function listThemes(): string[] {
  return Object.keys(THEMES);
}
