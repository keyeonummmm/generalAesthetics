// Content script that runs in the context of web pages
console.log('Content script initialized');

import React from 'react';
import { createRoot } from 'react-dom/client';
import Popup from './components/Popup';
import './styles/index.css';

// Establish connection with background script
const port = chrome.runtime.connect({ name: 'content-script' });

// Track interface visibility state
let isInterfaceVisible = false;

function injectApp() {
  // Create container
  const container = document.createElement('div');
  container.id = 'ga-notes-root';
  
  // Create shadow root
  const shadowRoot = container.attachShadow({ mode: 'closed' });
  
  // Create app container inside shadow root
  const appContainer = document.createElement('div');
  appContainer.className = 'ga-notes-container';
  appContainer.style.display = 'none';
  
  // Add theme class based on user preference
  appContainer.classList.add(
    window.matchMedia('(prefers-color-scheme: dark)').matches 
      ? 'theme-dark' 
      : 'theme-light'
  );

  // Create style element for our CSS
  const style = document.createElement('style');
  style.textContent = require('./styles/index.css').default;
  
  // Append style and app container to shadow root
  shadowRoot.appendChild(style);
  shadowRoot.appendChild(appContainer);
  
  // Append main container to body
  document.body.appendChild(container);

  // Create root and render
  const root = createRoot(appContainer);
  root.render(React.createElement(Popup));
  
  // Listen for theme changes
  const themeMediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
  const handleThemeChange = (e: MediaQueryListEvent) => {
    appContainer.classList.toggle('theme-dark', e.matches);
    appContainer.classList.toggle('theme-light', !e.matches);
  };
  
  themeMediaQuery.addEventListener('change', handleThemeChange);

  // Handle interface visibility toggle
  const toggleInterface = () => {
    isInterfaceVisible = !isInterfaceVisible;
    appContainer.style.display = isInterfaceVisible ? 'block' : 'none';
    // Notify background script of state change
    port.postMessage({ type: 'interfaceStateChanged', isVisible: isInterfaceVisible });
  };

  // Listen for toggle messages from background script
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'toggleInterface') {
      toggleInterface();
      sendResponse({ success: true });
    }
    return true; // Keep the message channel open for async response
  });

  // Listen for custom events from components
  window.addEventListener('ga-interface-hidden', () => {
    isInterfaceVisible = false;
    // Notify background script of state change
    port.postMessage({ type: 'interfaceStateChanged', isVisible: false });
  });

  // Cleanup function
  const cleanup = () => {
    themeMediaQuery.removeEventListener('change', handleThemeChange);
    window.removeEventListener('ga-interface-hidden', () => {});
    port.disconnect();
  };

  // Add cleanup on window unload
  window.addEventListener('unload', cleanup);
}

// Initialize injection
injectApp();

export {}; // Keep module format 