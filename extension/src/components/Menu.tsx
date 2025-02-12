// Menu.tsx
// This component is responsible for the menu that appears when the user clicks the menu button.
// Theme toggle button

import React, { useState, useEffect } from 'react';
import { ThemeManager } from '../UI/component';

interface MenuProps {
  isOpen: boolean;
  onClose: () => void;
}

const Menu: React.FC<MenuProps> = ({ isOpen, onClose }) => {
  const [theme, setTheme] = useState(ThemeManager.getInitialTheme());

  useEffect(() => {
    ThemeManager.setupSystemThemeListener();
  }, []);

  const handleThemeChange = (newTheme: 'light' | 'dark' | 'system') => {
    ThemeManager.setTheme(newTheme);
    setTheme(newTheme);
    
    // Immediately refresh theme when switching to system
    if (newTheme === 'system') {
      const systemTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      document.documentElement.classList.remove('theme-light', 'theme-dark');
      document.documentElement.classList.add(`theme-${systemTheme}`);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="menu-overlay" onClick={onClose}>
      <div className="menu-container" onClick={e => e.stopPropagation()}>
        <div className="menu-section">
          <h3 className="menu-title">Theme</h3>
          <div className="menu-options">
            <label className="menu-option">
              <input
                type="radio"
                name="theme"
                checked={theme === 'light'}
                onChange={() => handleThemeChange('light')}
              />
              <span className="menu-option-label">
                <span className="menu-option-icon">☀️</span>
                Light
              </span>
            </label>
            <label className="menu-option">
              <input
                type="radio"
                name="theme"
                checked={theme === 'dark'}
                onChange={() => handleThemeChange('dark')}
              />
              <span className="menu-option-label">
                <span className="menu-option-icon">🌙</span>
                Dark
              </span>
            </label>
            <label className="menu-option">
              <input
                type="radio"
                name="theme"
                checked={theme === 'system'}
                onChange={() => handleThemeChange('system')}
              />
              <span className="menu-option-label">
                <span className="menu-option-icon">💻</span>
                System
              </span>
            </label>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Menu;
