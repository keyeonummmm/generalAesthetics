// Content script that runs in the context of web pages
console.log('Content script initialized');

import React from 'react';
import { createRoot } from 'react-dom/client';
import Popup from './components/Popup';
import './styles/index.css';

// Establish connection with background script
const port = chrome.runtime.connect({ name: 'content-script' });

// Track interface state
let isInterfaceVisible = false;
let isInitialized = false;
let root: ReturnType<typeof createRoot> | null = null;
export let shadowRootRef: ShadowRoot | null = null;

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
  
  // Add theme class based on user preference
  appContainer.classList.add(
    window.matchMedia('(prefers-color-scheme: dark)').matches 
      ? 'theme-dark' 
      : 'theme-light'
  );

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
  
  // Listen for theme changes
  const themeMediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
  const handleThemeChange = (e: MediaQueryListEvent) => {
    appContainer.classList.toggle('theme-dark', e.matches);
    appContainer.classList.toggle('theme-light', !e.matches);
  };
  
  themeMediaQuery.addEventListener('change', handleThemeChange);

  isInitialized = true;
  return appContainer;
}

function destroyApp() {
  try {
    // Only called on window unload
    if (root) {
      root.unmount();
      root = null;
    }
    
    const container = document.getElementById('ga-notes-root');
    if (container && container.isConnected) {
      document.body.removeChild(container);
    }
    
    isInterfaceVisible = false;
    isInitialized = false;
    
    port.disconnect();
    return true;
  } catch (error) {
    console.error('Error during cleanup:', error);
    return false;
  }
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
        // Use forceState if provided, otherwise toggle
        isInterfaceVisible = forceState !== undefined ? forceState : !isInterfaceVisible;
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

// Listen for messages from both background and ActionButton
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'toggleInterface') {
    const success = toggleInterface();
    sendResponse({ success });
  } else if (message.type === 'hideInterface') {
    const success = toggleInterface(false); // Force hide
    sendResponse({ success });
  }
  return true;
});

// Clean up on Chrome native hide
chrome.runtime.onSuspend.addListener(() => {
  isInterfaceVisible = false;
  if (shadowRootRef) {
    const appContainer = shadowRootRef.querySelector('.ga-notes-container');
    if (appContainer instanceof HTMLElement) {
      appContainer.style.display = 'none';
    }
  }
});

// Only cleanup on window unload
window.addEventListener('unload', destroyApp);

export {}; // Keep module format 