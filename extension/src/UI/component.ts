// This file is responsible for managing the theme of the extension.

type Theme = 'light' | 'dark' | 'system';

export class ThemeManager {
  private static THEME_KEY = 'preferred-theme';
  private static systemThemeQuery = window.matchMedia('(prefers-color-scheme: dark)');

  static getInitialTheme(): Theme {
    const savedTheme = localStorage.getItem(this.THEME_KEY) as Theme;
    return savedTheme || 'light'; // Default to light
  }

  static getCurrentTheme(): 'light' | 'dark' {
    const preference = this.getInitialTheme();
    if (preference === 'system') {
      return this.systemThemeQuery.matches ? 'dark' : 'light';
    }
    return preference;
  }

  static setTheme(theme: Theme): void {
    const actualTheme = theme === 'system' ? this.getCurrentTheme() : theme;
    document.documentElement.classList.remove('theme-light', 'theme-dark');
    document.documentElement.classList.add(`theme-${actualTheme}`);
    localStorage.setItem(this.THEME_KEY, theme);
  }

  static setupSystemThemeListener(): void {
    this.systemThemeQuery.addEventListener('change', (e) => {
      if (this.getInitialTheme() === 'system') {
        this.setTheme('system');
      }
    });
  }

  static toggleTheme(): Theme {
    const currentTheme = document.documentElement.classList.contains('theme-dark') ? 'dark' : 'light';
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    this.setTheme(newTheme);
    return newTheme;
  }
}

export const ThemeToggle = () => {
  // Initialize theme
  const currentTheme = ThemeManager.getInitialTheme();
  ThemeManager.setTheme(currentTheme);
  
  // Add click handler to toggle theme
  return {
    toggle: () => ThemeManager.toggleTheme()
  };
};
