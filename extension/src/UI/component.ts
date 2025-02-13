type Theme = 'light' | 'dark' | 'system';

export class ThemeManager {
  private static THEME_KEY = 'preferred-theme';
  private static systemThemeQuery = window.matchMedia('(prefers-color-scheme: dark)');

  // Get saved theme preference
  static getSavedTheme(): Theme {
    return (localStorage.getItem(this.THEME_KEY) as Theme) || 'system';
  }

  // Apply theme to document
  static setTheme(theme: Theme): void {
    // Save preference
    localStorage.setItem(this.THEME_KEY, theme);
    
    // Determine actual theme
    const isDark = theme === 'system' 
      ? this.systemThemeQuery.matches 
      : theme === 'dark';

    // Apply theme class
    document.documentElement.classList.remove('theme-light', 'theme-dark');
    document.documentElement.classList.add(isDark ? 'theme-dark' : 'theme-light');

    // Setup system theme listener if needed
    this.systemThemeQuery.removeEventListener('change', this.handleSystemThemeChange);
    if (theme === 'system') {
      this.systemThemeQuery.addEventListener('change', this.handleSystemThemeChange);
    }
  }

  // Handle system theme changes
  private static handleSystemThemeChange = (e: MediaQueryListEvent) => {
    if (this.getSavedTheme() === 'system') {
      document.documentElement.classList.remove('theme-light', 'theme-dark');
      document.documentElement.classList.add(e.matches ? 'theme-dark' : 'theme-light');
    }
  };

  // Toggle between light and dark
  static toggleTheme(): void {
    const currentTheme = this.getSavedTheme();
    if (currentTheme === 'system') {
      this.setTheme(this.systemThemeQuery.matches ? 'light' : 'dark');
    } else {
      this.setTheme(currentTheme === 'dark' ? 'light' : 'dark');
    }
  }

  // Initialize theme
  static initialize(): void {
    this.setTheme(this.getSavedTheme());
  }
}

// Simple theme toggle component
export const ThemeToggle = () => {
  ThemeManager.initialize();
  return {
    toggle: () => ThemeManager.toggleTheme()
  };
};
