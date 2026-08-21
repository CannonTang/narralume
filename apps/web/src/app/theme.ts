import { create } from "zustand";

/* 默认跟随系统；用户可临时反转昼夜，再次点击即可恢复系统跟随。 */

export type Theme = "light" | "dark";
export type ThemePreference = "system" | Theme;
export type VisualTheme =
  | "editorial"
  | "publisher"
  | "night"
  | "forest"
  | "indigo"
  | "amber";

export interface VisualThemeOption {
  id: VisualTheme;
  label: string;
  description: string;
}

export const VISUAL_THEMES: VisualThemeOption[] = [
  {
    id: "editorial",
    label: "文学编辑室",
    description: "温和纸面，适合日常编写与整理",
  },
  {
    id: "publisher",
    label: "出版书架",
    description: "更强的封面、纸张与出版物气质",
  },
  {
    id: "night",
    label: "夜灯写作室",
    description: "深色画布，适合长时间沉浸写作",
  },
  {
    id: "forest",
    label: "松柏档案馆",
    description: "青绿纸面，安静、自然、偏知识库气质",
  },
  {
    id: "indigo",
    label: "靛青校稿台",
    description: "蓝灰画布，清晰、理性、适合长篇校订",
  },
  {
    id: "amber",
    label: "琥珀印刷所",
    description: "金黄纸张，温暖、复古、强调出版感",
  },
];

const SYSTEM_THEME_QUERY = "(prefers-color-scheme: dark)";
const THEME_PREFERENCE_KEY = "narralume:theme-preference";
const VISUAL_THEME_KEY = "narralume:visual-theme";

function themeFor(matchesDark: boolean): Theme {
  return matchesDark ? "dark" : "light";
}

function systemTheme(): Theme {
  if (typeof window.matchMedia !== "function") return "light";
  return themeFor(window.matchMedia(SYSTEM_THEME_QUERY).matches);
}

function readPreference(): ThemePreference {
  try {
    const value = window.localStorage.getItem(THEME_PREFERENCE_KEY);
    return value === "light" || value === "dark" ? value : "system";
  } catch {
    return "system";
  }
}

function readVisualTheme(): VisualTheme {
  try {
    const value = window.localStorage.getItem(VISUAL_THEME_KEY);
    return value === "publisher" ||
      value === "night" ||
      value === "forest" ||
      value === "indigo" ||
      value === "amber"
      ? value
      : "editorial";
  } catch {
    return "editorial";
  }
}

function resolvedTheme(preference: ThemePreference): Theme {
  return preference === "system" ? systemTheme() : preference;
}

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
}

export function applyVisualTheme(theme: VisualTheme): void {
  document.documentElement.dataset.visualTheme = theme;
}

interface ThemeState {
  preference: ThemePreference;
  theme: Theme;
  toggleTheme: () => void;
  visualTheme: VisualTheme;
  setVisualTheme: (theme: VisualTheme) => void;
}

const initialPreference = readPreference();
const initialVisualTheme = readVisualTheme();

export const useTheme = create<ThemeState>()((set, get) => ({
  preference: initialPreference,
  theme: resolvedTheme(initialPreference),
  toggleTheme: () => {
    const current = get();
    const preference: ThemePreference =
      current.preference === "system"
        ? current.theme === "light"
          ? "dark"
          : "light"
        : "system";
    try {
      if (preference === "system") {
        window.localStorage.removeItem(THEME_PREFERENCE_KEY);
      } else {
        window.localStorage.setItem(THEME_PREFERENCE_KEY, preference);
      }
    } catch {
      /* 私密模式下只保留当前会话。 */
    }
    const theme = resolvedTheme(preference);
    applyTheme(theme);
    set({ preference, theme });
  },
  visualTheme: initialVisualTheme,
  setVisualTheme: (visualTheme) => {
    try {
      window.localStorage.setItem(VISUAL_THEME_KEY, visualTheme);
    } catch {
      /* 私密模式下只保留当前会话。 */
    }
    applyVisualTheme(visualTheme);
    set({ visualTheme });
  },
}));

export function followSystemTheme(): () => void {
  applyVisualTheme(initialVisualTheme);
  if (typeof window.matchMedia !== "function") {
    const preference = readPreference();
    const theme = preference === "system" ? "light" : preference;
    applyTheme(theme);
    useTheme.setState({ preference, theme });
    return () => undefined;
  }

  const media = window.matchMedia(SYSTEM_THEME_QUERY);
  const sync = (event?: MediaQueryListEvent) => {
    const preference = useTheme.getState().preference;
    if (preference !== "system") return;
    const theme = themeFor(event?.matches ?? media.matches);
    applyTheme(theme);
    useTheme.setState({ theme });
  };
  sync();
  media.addEventListener("change", sync);
  return () => media.removeEventListener("change", sync);
}
