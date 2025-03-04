// Content script that runs in the context of web pages
console.log('Content script initialized');

import React from 'react';
import { createRoot } from 'react-dom/client';
import Popup from './components/Popup';
import './styles/index.css';
import { ScreenshotSelection } from './UI/selection';
import { ThemeManager, createThemeToggle } from './UI/component';
import { PositionScale, PositionScaleManager } from './lib/PositionScaleManager';

// Establish connection with background script
let port = chrome.runtime.connect({ name: 'content-script' });
let reconnectionAttempts = 0;
const MAX_RECONNECTION_ATTEMPTS = 5;

// Function to handle port reconnection
function setupConnection() {
  port = chrome.runtime.connect({ name: 'content-script' });
  
  // Handle port disconnection
  port.onDisconnect.addListener(() => {
    const lastError = chrome.runtime.lastError;
    console.log('Content script disconnected', lastError ? `: ${lastError.message}` : '');
    
    // Attempt to reconnect if the disconnection wasn't due to navigation/tab close
    // and we haven't exceeded max attempts
    if (document.visibilityState === 'visible' && reconnectionAttempts < MAX_RECONNECTION_ATTEMPTS) {
      reconnectionAttempts++;
      console.log(`Attempting to reconnect (${reconnectionAttempts}/${MAX_RECONNECTION_ATTEMPTS})`);
      setTimeout(setupConnection, 1000 * reconnectionAttempts); // Exponential backoff
    } else if (reconnectionAttempts >= MAX_RECONNECTION_ATTEMPTS) {
      console.log('Max reconnection attempts reached. Please refresh the page to restore functionality.');
    } else {
      // Clear position cache when page is closed
      PositionScaleManager.clearPositionForCurrentTab().catch(error => {
        console.error('Failed to clear position cache:', error);
      });
      PositionScaleManager.clearTabId();
    }
  });
}

// Initialize connection
setupConnection();

// Reset reconnection counter when the page becomes visible again
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    reconnectionAttempts = 0;
    // Attempt to reconnect if needed
    try {
      port.postMessage({ type: 'ping' });
    } catch (e) {
      // If posting a message fails, connection is broken, try to reconnect
      setupConnection();
    }
  }
});

// Track interface state
let isInterfaceVisible = false;
let isInitialized = false;
let root: ReturnType<typeof createRoot> | null = null;
export let shadowRootRef: ShadowRoot | null = null;
export let themeToggle: { toggle: () => Promise<void> } | null = null;

// Track drag and resize state
let isDragging = false;
let isResizing = false;
let resizeDirection = '';
let startX = 0;
let startY = 0;
let startWidth = 0;
let startHeight = 0;
let startTop = 0;
let startLeft = 0;
let startScale = 1;
let currentPositionScale: PositionScale = PositionScaleManager.getDefaultPosition();

// Add global functions to hide/show the extension UI
export function hideExtensionUI() {
  if (shadowRootRef) {
    // Hide the shadow root element
    const rootElement = shadowRootRef.querySelector('.ga-root') as HTMLElement;
    if (rootElement) {
      rootElement.style.transition = 'none';
      rootElement.style.display = 'none';
    }
    
    // Hide the container element
    const container = document.getElementById('ga-notes-root');
    if (container) {
      container.style.transition = 'none';
      container.style.display = 'none';
    }
    
    // Update visibility state
    isInterfaceVisible = false;
  }
}

export function showExtensionUI() {
  if (shadowRootRef) {
    // Show the shadow root element
    const rootElement = shadowRootRef.querySelector('.ga-root') as HTMLElement;
    if (rootElement) {
      rootElement.style.transition = 'none';
      rootElement.style.display = 'block';
    }
    
    // Show the container element
    const container = document.getElementById('ga-notes-root');
    if (container) {
      container.style.transition = 'none';
      container.style.display = 'block';
    }
    
    // Update visibility state
    isInterfaceVisible = true;
  }
}

// Apply position and scale to the UI
function applyPositionAndScale(position: PositionScale) {
  if (!shadowRootRef) return;
  
  const container = document.getElementById('ga-notes-root');
  if (!container) return;
  
  // Get viewport dimensions
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  
  // Ensure position is within viewport bounds
  const minVisiblePortion = 50;
  
  // Calculate effective dimensions with scale
  const effectiveWidth = position.width * position.scale;
  const effectiveHeight = position.height * position.scale;
  
  // Constrain position to keep UI within viewport
  let x = position.x;
  let y = position.y;
  
  // Constrain horizontal position
  x = Math.max(-effectiveWidth + minVisiblePortion, x);
  x = Math.min(viewportWidth - minVisiblePortion, x);
  
  // Constrain vertical position
  y = Math.max(-effectiveHeight + minVisiblePortion, y);
  y = Math.min(viewportHeight - minVisiblePortion, y);
  
  // Apply position and size
  container.style.position = 'fixed';
  container.style.left = `${x}px`;
  container.style.top = `${y}px`;
  container.style.width = `${position.width}px`;
  container.style.height = `${position.height}px`;
  container.style.transform = `scale(${position.scale})`;
  container.style.transformOrigin = 'top left';
  container.style.zIndex = '9999';
  
  // Store current position and scale with constrained values
  currentPositionScale = { 
    ...position,
    x,
    y
  };
}

// Save current position and scale to cache
async function saveCurrentPosition() {
  await PositionScaleManager.updatePositionForCurrentTab(currentPositionScale);
}

// Add event listeners for drag and resize
function setupDragAndResize() {
  const container = document.getElementById('ga-notes-root');
  if (!container || !shadowRootRef) return;
  
  // Create resize handles
  const directions = ['n', 'e', 's', 'w', 'ne', 'se', 'sw', 'nw'];
  directions.forEach(dir => {
    const handle = document.createElement('div');
    handle.className = `resize-handle resize-${dir}`;
    handle.style.position = 'absolute';
    
    // Position the handles
    switch(dir) {
      case 'n':
        handle.style.top = '0';
        handle.style.left = '0';
        handle.style.right = '0';
        handle.style.height = '5px';
        handle.style.cursor = 'ns-resize';
        break;
      case 'e':
        handle.style.top = '0';
        handle.style.right = '0';
        handle.style.bottom = '0';
        handle.style.width = '5px';
        handle.style.cursor = 'ew-resize';
        break;
      case 's':
        handle.style.bottom = '0';
        handle.style.left = '0';
        handle.style.right = '0';
        handle.style.height = '5px';
        handle.style.cursor = 'ns-resize';
        break;
      case 'w':
        handle.style.top = '0';
        handle.style.left = '0';
        handle.style.bottom = '0';
        handle.style.width = '5px';
        handle.style.cursor = 'ew-resize';
        break;
      case 'ne':
        handle.style.top = '0';
        handle.style.right = '0';
        handle.style.width = '10px';
        handle.style.height = '10px';
        handle.style.cursor = 'ne-resize';
        break;
      case 'se':
        handle.style.bottom = '0';
        handle.style.right = '0';
        handle.style.width = '10px';
        handle.style.height = '10px';
        handle.style.cursor = 'se-resize';
        break;
      case 'sw':
        handle.style.bottom = '0';
        handle.style.left = '0';
        handle.style.width = '10px';
        handle.style.height = '10px';
        handle.style.cursor = 'sw-resize';
        break;
      case 'nw':
        handle.style.top = '0';
        handle.style.left = '0';
        handle.style.width = '10px';
        handle.style.height = '10px';
        handle.style.cursor = 'nw-resize';
        break;
    }
    
    // Add resize event listeners
    handle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      isResizing = true;
      resizeDirection = dir;
      startX = e.clientX;
      startY = e.clientY;
      startWidth = container.offsetWidth;
      startHeight = container.offsetHeight;
      startTop = container.offsetTop;
      startLeft = container.offsetLeft;
      startScale = currentPositionScale.scale;
      
      document.addEventListener('mousemove', handleResize);
      document.addEventListener('mouseup', stopResize);
    });
    
    container.appendChild(handle);
  });
  
  // Find the header element for drag functionality
  const header = shadowRootRef.querySelector('.header') as HTMLElement;
  if (header) {
    // Make header draggable
    header.style.cursor = 'move';
    header.addEventListener('mousedown', (e) => {
      // Ignore if clicking on buttons in the header
      if ((e.target as HTMLElement).tagName === 'BUTTON' || 
          (e.target as HTMLElement).closest('button')) {
        return;
      }
      
      e.preventDefault();
      isDragging = true;
      startX = e.clientX;
      startY = e.clientY;
      startLeft = container.offsetLeft;
      startTop = container.offsetTop;
      
      document.addEventListener('mousemove', handleDrag);
      document.addEventListener('mouseup', stopDrag);
    });
    
    // Double click to reset position and scale
    header.addEventListener('dblclick', async (e) => {
      // Ignore if double-clicking on buttons in the header
      if ((e.target as HTMLElement).tagName === 'BUTTON' || 
          (e.target as HTMLElement).closest('button')) {
        return;
      }
      
      e.preventDefault();
      const defaultPosition = await PositionScaleManager.resetToDefault();
      applyPositionAndScale(defaultPosition);
    });
  }
}

// Handle resize event
function handleResize(e: MouseEvent) {
  if (!isResizing) return;
  
  const container = document.getElementById('ga-notes-root');
  if (!container) return;
  
  e.preventDefault();
  
  const dx = e.clientX - startX;
  const dy = e.clientY - startY;
  
  let newWidth = startWidth;
  let newHeight = startHeight;
  let newTop = startTop;
  let newLeft = startLeft;
  
  // Calculate new dimensions based on resize direction
  if (resizeDirection.includes('e')) {
    newWidth = startWidth + dx;
  }
  if (resizeDirection.includes('s')) {
    newHeight = startHeight + dy;
  }
  if (resizeDirection.includes('w')) {
    newWidth = startWidth - dx;
    newLeft = startLeft + dx;
  }
  if (resizeDirection.includes('n')) {
    newHeight = startHeight - dy;
    newTop = startTop + dy;
  }
  
  // Apply minimum dimensions
  const minWidth = 300;
  const minHeight = 200;
  
  if (newWidth < minWidth) {
    if (resizeDirection.includes('w')) {
      newLeft = startLeft + (startWidth - minWidth);
    }
    newWidth = minWidth;
  }
  
  if (newHeight < minHeight) {
    if (resizeDirection.includes('n')) {
      newTop = startTop + (startHeight - minHeight);
    }
    newHeight = minHeight;
  }
  
  // Calculate scale based on size changes
  let newScale = currentPositionScale.scale;
  
  // Calculate horizontal and vertical scale factors
  const horizontalScaleFactor = newWidth / startWidth;
  const verticalScaleFactor = newHeight / startHeight;
  
  // Use the appropriate scale factor based on which direction is being resized
  if (resizeDirection.includes('e') || resizeDirection.includes('w')) {
    newScale = startScale * horizontalScaleFactor;
  } else if (resizeDirection.includes('n') || resizeDirection.includes('s')) {
    newScale = startScale * verticalScaleFactor;
  } else if (['ne', 'se', 'sw', 'nw'].includes(resizeDirection)) {
    // For corners, use the larger of the two scale factors
    newScale = startScale * Math.max(horizontalScaleFactor, verticalScaleFactor);
  }
  
  // Limit scale to reasonable values
  newScale = Math.max(0.5, Math.min(2, newScale));
  
  // Get viewport dimensions
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  
  // Ensure the container stays within viewport bounds
  const minVisiblePortion = 50;
  
  // Constrain horizontal position
  newLeft = Math.max(-newWidth * newScale + minVisiblePortion, newLeft);
  newLeft = Math.min(viewportWidth - minVisiblePortion, newLeft);
  
  // Constrain vertical position
  newTop = Math.max(-newHeight * newScale + minVisiblePortion, newTop);
  newTop = Math.min(viewportHeight - minVisiblePortion, newTop);
  
  // Update container style
  container.style.width = `${newWidth}px`;
  container.style.height = `${newHeight}px`;
  container.style.top = `${newTop}px`;
  container.style.left = `${newLeft}px`;
  container.style.transform = `scale(${newScale})`;
  
  // Update current position
  currentPositionScale.width = newWidth;
  currentPositionScale.height = newHeight;
  currentPositionScale.x = newLeft;
  currentPositionScale.y = newTop;
  currentPositionScale.scale = newScale;
}

// Stop resize event
function stopResize() {
  if (!isResizing) return;
  
  isResizing = false;
  resizeDirection = '';
  
  document.removeEventListener('mousemove', handleResize);
  document.removeEventListener('mouseup', stopResize);
  
  // Save the new position and scale
  saveCurrentPosition();
}

// Handle drag event
function handleDrag(e: MouseEvent) {
  if (!isDragging) return;
  
  const container = document.getElementById('ga-notes-root');
  if (!container) return;
  
  e.preventDefault();
  
  const dx = e.clientX - startX;
  const dy = e.clientY - startY;
  
  let newLeft = startLeft + dx;
  let newTop = startTop + dy;
  
  // Get viewport dimensions
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  
  // Get container dimensions (accounting for scale)
  const containerWidth = container.offsetWidth * currentPositionScale.scale;
  const containerHeight = container.offsetHeight * currentPositionScale.scale;
  
  // Ensure the container stays within viewport bounds
  // Allow at least 50px of the container to remain visible
  const minVisiblePortion = 50;
  
  // Constrain horizontal position
  newLeft = Math.max(-containerWidth + minVisiblePortion, newLeft);
  newLeft = Math.min(viewportWidth - minVisiblePortion, newLeft);
  
  // Constrain vertical position
  newTop = Math.max(-containerHeight + minVisiblePortion, newTop);
  newTop = Math.min(viewportHeight - minVisiblePortion, newTop);
  
  // Update container style
  container.style.left = `${newLeft}px`;
  container.style.top = `${newTop}px`;
  
  // Update current position
  currentPositionScale.x = newLeft;
  currentPositionScale.y = newTop;
}

// Stop drag event
function stopDrag() {
  if (!isDragging) return;
  
  isDragging = false;
  
  document.removeEventListener('mousemove', handleDrag);
  document.removeEventListener('mouseup', stopDrag);
  
  // Save the new position and scale
  saveCurrentPosition();
}

// Handle scale change
function handleScaleChange(newScale: number) {
  const container = document.getElementById('ga-notes-root');
  if (!container) return;
  
  // Limit scale to reasonable values
  newScale = Math.max(0.5, Math.min(2, newScale));
  
  container.style.transform = `scale(${newScale})`;
  currentPositionScale.scale = newScale;
  
  // Save the new position and scale
  saveCurrentPosition();
}

async function injectApp() {
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
  
  // Get position and scale from cache for current tab
  const position = await PositionScaleManager.getPositionForCurrentTab();
  
  // Apply position and scale
  applyPositionAndScale(position);
  
  // Setup drag and resize functionality
  setupDragAndResize();
  
  return appContainer;
}

// Add a function to get current visibility state
function getInterfaceVisibility(): boolean {
  // Check if the root container is visible
  const rootContainer = document.getElementById('ga-notes-root');
  return rootContainer ? rootContainer.style.display !== 'none' : false;
}

async function toggleInterface(forceState?: boolean) {
  try {
    if (!isInitialized) {
      const appContainer = await injectApp();
      if (appContainer) {
        // Make sure the root container is visible
        const rootContainer = document.getElementById('ga-notes-root');
        if (rootContainer) {
          rootContainer.style.display = 'block';
        }
        isInterfaceVisible = true;
      }
    } else if (shadowRootRef) {
      // Get the root container
      const rootContainer = document.getElementById('ga-notes-root');
      
      // Check actual current visibility if forceState isn't provided
      const currentVisibility = getInterfaceVisibility();
      isInterfaceVisible = forceState !== undefined ? forceState : !currentVisibility;
      
      // Update root container element
      if (rootContainer) {
        rootContainer.style.display = isInterfaceVisible ? 'block' : 'none';
      }
    }
    
    // Notify background script of state change
    try {
      port.postMessage({ 
        type: 'interfaceStateChanged', 
        isVisible: isInterfaceVisible 
      });
    } catch (e) {
      console.warn('Failed to notify background script about UI state change. Attempting to reconnect...');
      // If posting a message fails, connection is broken, try to reconnect
      reconnectionAttempts = 0;
      setupConnection();
    }
    
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
  } else if (message.type === 'resetPosition') {
    PositionScaleManager.resetToDefault().then(defaultPosition => {
      applyPositionAndScale(defaultPosition);
      sendResponse({ success: true });
    });
    return true;
  } else if (message.type === 'clearPositionForTab') {
    // Check if this message is for our tab
    PositionScaleManager.initTabId().then(currentTabId => {
      if (message.tabId === currentTabId) {
        PositionScaleManager.clearPositionForCurrentTab().catch(error => {
          console.error('Failed to clear position cache:', error);
        });
      }
      sendResponse({ success: true });
    });
    return true;
  }
  return true;
});

// Add window resize handler to adjust position when window size changes
window.addEventListener('resize', () => {
  // Only adjust position if the UI is using default position (not manually moved)
  const container = document.getElementById('ga-notes-root');
  if (!container) return;
  
  // Check if the position is close to the default position
  const defaultPosition = PositionScaleManager.getDefaultPosition();
  const rightEdgePosition = defaultPosition.x + defaultPosition.width;
  const currentRightEdgePosition = parseInt(container.style.left || '0') + parseInt(container.style.width || '0');
  
  // If the right edge is within 50px of the default right edge position,
  // assume it's at the default position and adjust it
  if (Math.abs(window.innerWidth - currentRightEdgePosition) < 50) {
    const newPosition = PositionScaleManager.getDefaultPosition();
    applyPositionAndScale(newPosition);
    saveCurrentPosition();
  }
});

export {};