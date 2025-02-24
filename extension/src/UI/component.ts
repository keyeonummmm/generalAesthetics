type Theme = 'light' | 'dark' | 'system';

export class ThemeManager {
  private static THEME_KEY = 'preferred-theme';
  private static systemThemeQuery = window.matchMedia('(prefers-color-scheme: dark)');
  private static container: Element | null = null;
  private static currentTheme: Theme = 'system';

  // Initialize with container reference
  static initialize(container: Element): void {
    this.container = container;
    this.loadAndApplyTheme();
  }

  // Get current theme (public method)
  static getCurrentTheme(): Theme {
    return this.currentTheme;
  }

  // Get saved theme preference
  private static async getSavedTheme(): Promise<Theme> {
    const result = await chrome.storage.local.get(this.THEME_KEY);
    return (result[this.THEME_KEY] as Theme) || 'system';
  }

  // Save theme preference
  private static async saveTheme(theme: Theme): Promise<void> {
    this.currentTheme = theme;
    await chrome.storage.local.set({ [this.THEME_KEY]: theme });
  }

  // Apply theme to container
  static async setTheme(theme: Theme): Promise<void> {
    if (!this.container) {
      console.error('Theme container not initialized');
      return;
    }

    // Save preference
    await this.saveTheme(theme);
    
    // Determine actual theme
    const isDark = theme === 'system' 
      ? this.systemThemeQuery.matches 
      : theme === 'dark';

    // Apply theme class to container
    this.container.classList.remove('theme-light', 'theme-dark');
    this.container.classList.add(isDark ? 'theme-dark' : 'theme-light');

    // Setup system theme listener if needed
    this.systemThemeQuery.removeEventListener('change', this.handleSystemThemeChange);
    if (theme === 'system') {
      this.systemThemeQuery.addEventListener('change', this.handleSystemThemeChange);
    }
  }

  // Handle system theme changes
  private static handleSystemThemeChange = async (e: MediaQueryListEvent) => {
    if (!this.container) return;
    
    const currentTheme = await this.getSavedTheme();
    if (currentTheme === 'system') {
      this.container.classList.remove('theme-light', 'theme-dark');
      this.container.classList.add(e.matches ? 'theme-dark' : 'theme-light');
    }
  };

  // Toggle between light and dark
  static async toggleTheme(): Promise<void> {
    if (!this.container) return;

    const currentTheme = await this.getSavedTheme();
    if (currentTheme === 'system') {
      await this.setTheme(this.systemThemeQuery.matches ? 'light' : 'dark');
    } else {
      await this.setTheme(currentTheme === 'dark' ? 'light' : 'dark');
    }
  }

  // Load and apply saved theme
  private static async loadAndApplyTheme(): Promise<void> {
    const theme = await this.getSavedTheme();
    await this.setTheme(theme);
  }
}

// Simple theme toggle component
export const createThemeToggle = (container: Element) => {
  ThemeManager.initialize(container);
  return {
    toggle: () => ThemeManager.toggleTheme()
  };
};
