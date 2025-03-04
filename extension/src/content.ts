// Content script that runs in the context of web pages
console.log('Content script initialized');

import React from 'react';
import { createRoot } from 'react-dom/client';
import Popup from './components/Popup';
import './styles/index.css';
import { ScreenshotSelection } from './UI/selection';
import { ThemeManager, createThemeToggle } from './UI/component';

// Establish connection with background script
const port = chrome.runtime.connect({ name: 'content-script' });

// Track interface state
let isInterfaceVisible = false;
let isInitialized = false;
let root: ReturnType<typeof createRoot> | null = null;
export let shadowRootRef: ShadowRoot | null = null;
export let themeToggle: { toggle: () => Promise<void> } | null = null;

// Add global functions to hide/show the extension UI
export function hideExtensionUI() {
  if (shadowRootRef) {
    const rootElement = shadowRootRef.querySelector('.ga-root') as HTMLElement;
    if (rootElement) {
      // Remove fade-out animation and hide immediately
      rootElement.style.transition = 'none';
      rootElement.style.display = 'none';
    }
    
    // Also hide the container element
    const container = document.getElementById('ga-notes-root');
    if (container) {
      // Remove fade-out animation and hide immediately
      container.style.transition = 'none';
      container.style.display = 'none';
    }
  }
}

export function showExtensionUI() {
  if (shadowRootRef) {
    const rootElement = shadowRootRef.querySelector('.ga-root') as HTMLElement;
    if (rootElement) {
      // Make it visible immediately
      rootElement.style.transition = 'none';
      rootElement.style.display = 'block';
    }
    
    // Also show the container element
    const container = document.getElementById('ga-notes-root');
    if (container) {
      // Make it visible immediately
      container.style.transition = 'none';
      container.style.display = 'block';
    }
  }
}

function injectApp() {
  // Prevent multiple initializations
  if (isInitialized) {
    console.debug('App already initialized');
    return null;
  }

  // Create container
  const container = document.createElement('div');
  container.id = 'ga-notes-root';
  
  // Create shadow root and store reference
  shadowRootRef = container.attachShadow({ mode: 'closed' });
  
  // Create app container inside shadow root
  const appContainer = document.createElement('div');
  appContainer.className = 'ga-notes-container';
  
  // Initialize theme manager and create theme toggle
  themeToggle = createThemeToggle(appContainer);
  
  // Create style element for our CSS
  const style = document.createElement('style');
  style.textContent = require('./styles/index.css').default;
  
  // Append to shadow root using our stored reference
  shadowRootRef.appendChild(style);
  shadowRootRef.appendChild(appContainer);
  
  // Append main container to body
  document.body.appendChild(container);

  // Create root and render
  root = createRoot(appContainer);
  root.render(React.createElement(Popup));

  isInitialized = true;
  return appContainer;
}

// Add a function to get current visibility state
function getInterfaceVisibility(): boolean {
  if (shadowRootRef) {
    const appContainer = shadowRootRef.querySelector('.ga-notes-container');
    if (appContainer instanceof HTMLElement) {
      return appContainer.style.display !== 'none';
    }
  }
  return false;
}

function toggleInterface(forceState?: boolean) {
  try {
    if (!isInitialized) {
      const appContainer = injectApp();
      if (appContainer) {
        appContainer.style.display = 'block';
        isInterfaceVisible = true;
      }
    } else if (shadowRootRef) {
      const appContainer = shadowRootRef.querySelector('.ga-notes-container');
      if (appContainer instanceof HTMLElement) {
        // Check actual current visibility if forceState isn't provided
        const currentVisibility = getInterfaceVisibility();
        isInterfaceVisible = forceState !== undefined ? forceState : !currentVisibility;
        appContainer.style.display = isInterfaceVisible ? 'block' : 'none';
      }
    }
    
    // Notify background script of state change
    port.postMessage({ 
      type: 'interfaceStateChanged', 
      isVisible: isInterfaceVisible 
    });
    
    return true;
  } catch (error) {
    console.error('Toggle failed:', error);
    return false;
  }
}

// Export function to update visibility state
export function updateInterfaceVisibility(visible: boolean) {
  isInterfaceVisible = visible;
}

// Export function to toggle theme
export function toggleTheme() {
  themeToggle?.toggle().catch(error => {
    console.error('Failed to toggle theme:', error);
  });
}

// Add to message listener
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'toggleInterface') {
    const success = toggleInterface();
    sendResponse({ success });
  } else if (message.type === 'hideInterface') {
    const success = toggleInterface(false);
    sendResponse({ success });
  } else if (message.type === 'showInterface') {
    const success = toggleInterface(true);
    sendResponse({ success });
  } else if (message.type === 'HIDE_EXTENSION_UI') {
    hideExtensionUI();
    sendResponse({ success: true });
  } else if (message.type === 'SHOW_EXTENSION_UI') {
    showExtensionUI();
    sendResponse({ success: true });
  } else if (message.type === 'initScreenshotSelection') {
    new ScreenshotSelection();
    sendResponse({ success: true });
  } else if (message.type === 'toggleTheme') {
    toggleTheme();
    sendResponse({ success: true });
  }
  return true;
});

export {};