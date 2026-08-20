import { create } from "zustand";

/* 默认跟随系统；用户可临时反转昼夜，再次点击即可恢复系统跟随。 */

export type Theme = "light" | "dark";
export type ThemePreference = "system" | Theme;

const SYSTEM_THEME_QUERY = "(prefers-color-scheme: dark)";
const THEME_PREFERENCE_KEY = "narralume:theme-preference";

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

function resolvedTheme(preference: ThemePreference): Theme {
  return preference === "system" ? systemTheme() : preference;
}

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
}

interface ThemeState {
  preference: ThemePreference;
  theme: Theme;
  toggleTheme: () => void;
}

const initialPreference = readPreference();

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
}));

export function followSystemTheme(): () => void {
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
