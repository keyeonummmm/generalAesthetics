// Content script that runs in the context of web pages
console.log('Content script initialized');

import React from 'react';
import { createRoot } from 'react-dom/client';
import Popup from './components/Popup';
import './styles/content.css';

// Establish connection with background script
const port = chrome.runtime.connect({ name: 'content-script' });

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
  style.textContent = require('./styles/content.css').default;
  
  // Append style and app container to shadow root
  shadowRoot.appendChild(style);
  shadowRoot.appendChild(appContainer);
  
  // Append main container to body
  document.body.appendChild(container);

  // Create root and render
  const root = createRoot(appContainer);
  root.render(React.createElement(Popup));
  
  // Listen for theme changes
  window.matchMedia('(prefers-color-scheme: dark)')
    .addEventListener('change', (e) => {
      appContainer.classList.toggle('theme-dark', e.matches);
      appContainer.classList.toggle('theme-light', !e.matches);
    });

  // Add toggle functionality
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'toggleInterface') {
      appContainer.style.display = 
        appContainer.style.display === 'none' ? 'block' : 'none';
    }
  });
}

// Initialize injection
injectApp();

export {}; // Keep module format 