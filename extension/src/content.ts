// Content script that runs in the context of web pages
console.log('Content script initialized');

import React from 'react';
import { createRoot } from 'react-dom/client';
import Popup from './components/Popup';
import './styles/index.css';
import { ScreenshotSelection } from './UI/selection';
import { ThemeManager, createThemeToggle } from './UI/component';
import { PositionScale, PositionScaleManager, OperationType } from './lib/PositionScaleManager';

// Establish connection with background script
let port = chrome.runtime.connect({ name: 'content-script' });
let reconnectionAttempts = 0;
const MAX_RECONNECTION_ATTEMPTS = 5;

// // Global variables for Debugging
// const DEBUG = {
//   RESIZE: true,
//   DRAG: true,
//   POSITION: true,
//   EVENT: true,
//   STATE: true,
//   VISIBILITY: true
// };

// // Debug logger utility
// function debugLog(category: keyof typeof DEBUG, message: string, data?: any) {
//   if (DEBUG[category]) {
//     const timestamp = new Date().toISOString().split('T')[1].split('Z')[0];
//     const dataStr = data ? ` | Data: ${JSON.stringify(data)}` : '';
//     console.log(`[${timestamp}][${category}] ${message}${dataStr}`);
//   }
// }

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
      setTimeout(setupConnection, 1000 * reconnectionAttempts); // Exponential backoff
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
let resizeAnimationFrameId: number | null = null;
let currentPositionScale: PositionScale = PositionScaleManager.getDefaultPosition();

// Add new variables to track resize cursor state
let resizeObserver: ResizeObserver | null = null;
let resizeEdges = {
  top: false,
  right: false,
  bottom: false,
  left: false
};

// Object to store container event handlers for proper cleanup
interface EventHandlers {
  mousemove?: (e: MouseEvent) => void;
  mouseleave?: (e: MouseEvent) => void;
  mousedown?: (e: MouseEvent) => void;
  headerMousedown?: (e: MouseEvent) => void;
  headerDblclick?: (e: MouseEvent) => void;
}

const containerEventHandlers: EventHandlers = {};

// Add global functions to hide/show the extension UI
export function hideExtensionUI() {
  const container = document.getElementById('ga-notes-root');
  if (container) {
    container.style.transition = 'none';
    container.style.display = 'none';
  }
  
  // Then handle shadow DOM elements if available
  if (shadowRootRef) {
    // Try to hide app container
    const appContainer = shadowRootRef.querySelector('.app-container') as HTMLElement;
    if (appContainer) {
      appContainer.style.transition = 'none';
      appContainer.style.display = 'none';
    }
    
    // Try to hide any ga-root element
    const rootElement = shadowRootRef.querySelector('.ga-root') as HTMLElement;
    if (rootElement) {
      rootElement.style.transition = 'none';
      rootElement.style.display = 'none';
    }
  }
  
  // Update visibility state
  isInterfaceVisible = false;
  
  // Remove the event capture when UI is hidden
  removeEventCapture();
  
  // Important: Inform the background script that the UI is now hidden
  try {
    chrome.runtime.sendMessage({ type: 'interfaceStateChanged', isVisible: false });
  } catch (e) {
    console.warn('Failed to notify background script about UI state change:', e);
  }
}

export function showExtensionUI() {
  // Show the container element first
  const container = document.getElementById('ga-notes-root');
  if (container) {
    container.style.transition = 'none';
    container.style.display = 'block';
  }
  
  // Then handle shadow DOM elements if available
  if (shadowRootRef) {
    // Try to show app container
    const appContainer = shadowRootRef.querySelector('.app-container') as HTMLElement;
    if (appContainer) {
      appContainer.style.transition = 'none';
      appContainer.style.display = 'block';
    }
    
    // Try to show any ga-root element
    const rootElement = shadowRootRef.querySelector('.ga-root') as HTMLElement;
    if (rootElement) {
      rootElement.style.transition = 'none';
      rootElement.style.display = 'block';
    }
  }
  
  // Update visibility state
  isInterfaceVisible = true;
  
  // Add the event capture when UI is shown
  setupEventCapture();
  
  // Reapply position and scale to ensure proper layout
  PositionScaleManager.getPositionForCurrentTab()
    .then(position => {
      applyPositionAndScale(position);

      // Refresh resize handles with a small delay to ensure DOM is ready
      setTimeout(() => {
        setupDragAndResize();
      }, 100);
    })
    .catch(error => {
      console.warn('Failed to get position on show:', error);
    });
  
  // Inform the background script that the UI is now visible
  try {
    chrome.runtime.sendMessage({ type: 'interfaceStateChanged', isVisible: true });
  } catch (e) {
    console.warn('Failed to notify background script about UI state change:', e);
  }
}

// Function to capture events and prevent them from reaching the host page
function setupEventCapture() {
  const container = document.getElementById('ga-notes-root');
  if (!container) return;
  
  // Instead of capturing all events, we'll add a boundary event handler
  // This will only prevent events from leaving our extension UI
  document.addEventListener('keydown', preventHostPageInterference, true);
  document.addEventListener('keyup', preventHostPageInterference, true);
  document.addEventListener('keypress', preventHostPageInterference, true);
  
  // Create a focus trap to keep focus within the extension UI
  createFocusTrap(container);
}

// Function to prevent events from interfering with the host page
// This only stops events that are not originating from our extension
function preventHostPageInterference(e: Event) {
  const container = document.getElementById('ga-notes-root');
  if (!container) return;
  if (isInterfaceVisible && !container.contains(e.target as Node)) {
    return;
  }
  if (isInterfaceVisible && container.contains(e.target as Node)) {
    return;
  }
}

// Function to create a focus trap for the extension UI
function createFocusTrap(container: HTMLElement) {
  // Create invisible elements to trap focus
  const startTrap = document.createElement('div');
  startTrap.tabIndex = 0;
  startTrap.style.position = 'absolute';
  startTrap.style.opacity = '0';
  startTrap.style.pointerEvents = 'none';
  startTrap.setAttribute('aria-hidden', 'true');
  startTrap.className = 'focus-trap-start';
  
  const endTrap = document.createElement('div');
  endTrap.tabIndex = 0;
  endTrap.style.position = 'absolute';
  endTrap.style.opacity = '0';
  endTrap.style.pointerEvents = 'none';
  endTrap.setAttribute('aria-hidden', 'true');
  endTrap.className = 'focus-trap-end';
  
  // Add the trap elements to the container
  container.insertBefore(startTrap, container.firstChild);
  container.appendChild(endTrap);
  
  // Add event listeners to the trap elements
  startTrap.addEventListener('focus', () => {
    // Find the last focusable element in the container
    const focusableElements = container.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
    if (focusableElements.length > 0) {
      (focusableElements[focusableElements.length - 1] as HTMLElement).focus();
    } else {
      // If no focusable elements, focus the container itself
      container.focus();
    }
  });
  
  endTrap.addEventListener('focus', () => {
    // Find the first focusable element in the container
    const focusableElements = container.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
    if (focusableElements.length > 0) {
      (focusableElements[0] as HTMLElement).focus();
    } else {
      // If no focusable elements, focus the container itself
      container.focus();
    }
  });
  
  // Add a boundary event handler to the container
  // This prevents events from leaving our extension UI
  container.addEventListener('keydown', (e) => {
    // Don't stop propagation within our extension
    // This allows typing in contentEditable elements
    
    // Only handle Tab key for focus trapping
    if (e.key === 'Tab') {
      // Get all focusable elements in the container
      const focusableElements = container.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
      if (focusableElements.length === 0) return;
      
      // Get the first and last focusable elements
      const firstFocusableElement = focusableElements[0] as HTMLElement;
      const lastFocusableElement = focusableElements[focusableElements.length - 1] as HTMLElement;
      
      // If Shift+Tab is pressed and the first element is focused, move to the last element
      if (e.shiftKey && document.activeElement === firstFocusableElement) {
        e.preventDefault();
        lastFocusableElement.focus();
      }
      // If Tab is pressed and the last element is focused, move to the first element
      else if (!e.shiftKey && document.activeElement === lastFocusableElement) {
        e.preventDefault();
        firstFocusableElement.focus();
      }
    }
  });
  
  // Add a boundary event handler to stop events at the container boundary
  container.addEventListener('keydown', (e) => {
    // Stop propagation at the container boundary to prevent
    // events from reaching the host page
    e.stopPropagation();
  }, false); // Use bubbling phase, not capture phase
}

// Function to remove event capture
function removeEventCapture() {
  const container = document.getElementById('ga-notes-root');
  if (!container) return;
  
  // Remove document-level event listeners
  document.removeEventListener('keydown', preventHostPageInterference, true);
  document.removeEventListener('keyup', preventHostPageInterference, true);
  document.removeEventListener('keypress', preventHostPageInterference, true);
  
  // Remove focus trap elements
  const startTrap = container.querySelector('.focus-trap-start');
  const endTrap = container.querySelector('.focus-trap-end');
  
  if (startTrap) {
    startTrap.remove();
  }
  
  if (endTrap) {
    endTrap.remove();
  }
}

// Function to capture and stop propagation of events
function captureEvent(e: Event) {
  // Only stop propagation for events that should not reach the host page
  // Don't interfere with normal input handling within our extension
  const container = document.getElementById('ga-notes-root');
  if (container && container.contains(e.target as Node)) {
    // Let events propagate within our extension
    return;
  }
  
  // Stop propagation for events outside our extension
  e.stopPropagation();
}

// Apply position and scale to the UI
function applyPositionAndScale(position: PositionScale, direction: string = '') {
  // Select the root container directly from document
  const container = document.getElementById('ga-notes-root') as HTMLElement;
  if (!container) {
    return;
  }
  
  // If we're resizing, ensure the resizing class is applied
  // This will disable transitions for immediate/synchronous resizing
  if (direction && !container.classList.contains('resizing')) {
    container.classList.add('resizing');
  }
  
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
  
  // Determine transform origin based on resize direction
  let transformOrigin = 'top left'; // Default
  
  if (direction) {
    // Adjust transform origin based on which edges are being resized
    const hasNorth = direction.includes('n');
    const hasSouth = direction.includes('s');
    const hasEast = direction.includes('e');
    const hasWest = direction.includes('w');
    
    const vertical = hasNorth ? 'top' : hasSouth ? 'bottom' : 'center';
    const horizontal = hasWest ? 'left' : hasEast ? 'right' : 'center';
    
    transformOrigin = `${horizontal} ${vertical}`;
  }
  
  // Apply position, dimensions and scale to the root container
  container.style.position = 'fixed';
  container.style.left = `${x}px`;
  container.style.top = `${y}px`;
  container.style.width = `${position.width}px`;
  container.style.height = `${position.height}px`;
  container.style.transform = `scale(${position.scale})`;
  container.style.transformOrigin = transformOrigin;
  container.style.zIndex = '9999';
  container.style.display = 'block';
  
  // Apply dimensions to popup-container inside shadow DOM
  if (shadowRootRef) {
    // First find the popup-container
    const popupContainer = shadowRootRef.querySelector('.popup-container') as HTMLElement;
    if (popupContainer) {
      // Apply dimensions to popup-container - ensure synchronous updates
      // Force layout reflow to apply changes immediately
      popupContainer.style.width = `${position.width}px`;
      void popupContainer.offsetWidth; // Force reflow
      popupContainer.style.height = `${position.height}px`;
      void popupContainer.offsetHeight; // Force reflow
      
      // Ensure the footer is properly visible by adjusting container content
      const content = shadowRootRef.querySelector('.content') as HTMLElement;
      const header = shadowRootRef.querySelector('.header') as HTMLElement;
      const footer = shadowRootRef.querySelector('.footer') as HTMLElement;
      
      if (content && header && footer) {
        // Calculate available height for content
        const headerHeight = header.offsetHeight;
        const footerHeight = footer.offsetHeight;
        const containerHeight = position.height;
        
        // Set content height to fill available space while preserving footer visibility
        content.style.height = `${containerHeight - headerHeight - footerHeight}px`;
        content.style.minHeight = '50px'; // Ensure minimum content height
      }
    }
    
    // Also apply to the app container as before
    const appContainer = shadowRootRef.querySelector('.app-container') as HTMLElement;
    if (appContainer) {
      // For the app container, we need to set all dimensions but keep it relative to its parent
      appContainer.style.position = 'relative';
      appContainer.style.width = '100%';
      appContainer.style.height = '100%';
      appContainer.style.display = 'block';
      appContainer.style.top = '0';
      appContainer.style.left = '0';
      appContainer.style.zIndex = '1';
      appContainer.style.overflow = 'hidden';
      appContainer.style.borderRadius = '8px';
    }
  }
  
  // Store current position and scale with constrained values
  currentPositionScale = { 
    ...position,
    x,
    y
  };
}

// Save current position and scale to cache
async function saveCurrentPosition() {
  try {
    await PositionScaleManager.updatePositionForCurrentTab(currentPositionScale);
    
    // Notify background script about the position change
    try {
      // Get the current tab ID
      const tabId = await PositionScaleManager.initTabId();
  
      // Send the position to the background script
      chrome.runtime.sendMessage({
        type: 'saveResizeState',
        tabId,
        position: currentPositionScale
      }).then(() => {
      }).catch(error => {
        console.warn('Failed to notify background script about position change:', error);
      });
    } catch (error) {
      console.warn('Failed to get tab ID for position notification:', error);
    }
  } catch (error) {
    console.warn('Failed to save position:', error);
  }
}

// Save only position (x, y) during drag operations
async function savePositionOnly() {
  try {
    const position = { x: currentPositionScale.x, y: currentPositionScale.y };
    await PositionScaleManager.updatePositionOnly(position);
    try {
      // Get the current tab ID
      const tabId = await PositionScaleManager.initTabId();
      
      // Send the position to the background script
      chrome.runtime.sendMessage({
        type: 'savePositionOnly',
        tabId,
        position,
        operationType: OperationType.DRAGGING
      }).then(() => {
      }).catch(error => {
        console.warn('Failed to notify background script about position change:', error);
      });
    } catch (error) {
      console.warn('Failed to get tab ID for position notification:', error);
    }
  } catch (error) {
    console.warn('Failed to save position:', error);
  }
}

// Save only dimensions (width, height) during resize operations
async function saveDimensionsOnly() {
  try {
    const dimensions = { 
      width: currentPositionScale.width, 
      height: currentPositionScale.height 
    };
    await PositionScaleManager.updateDimensionsOnly(dimensions);
    try {
      // Get the current tab ID
      const tabId = await PositionScaleManager.initTabId();
      
      // Send the dimensions to the background script
      chrome.runtime.sendMessage({
        type: 'saveDimensionsOnly',
        tabId,
        dimensions,
        operationType: OperationType.RESIZING
      }).then(() => {
      }).catch(error => {
        console.warn('Failed to notify background script about dimension change:', error);
      });
    } catch (error) {
      console.warn('Failed to get tab ID for dimensions notification:', error);
    }
  } catch (error) {
    console.warn('Failed to save dimensions:', error);
  }
}

function setupDragAndResize() {
  const container = document.getElementById('ga-notes-root');
  if (!container || !shadowRootRef) return;
  
  // Reset state flags when setting up
  isResizing = false;
  isDragging = false;
  resizeDirection = '';
  
  // Clear any existing event listeners to avoid duplicates
  removeResizeHandlers();
  removeDragHandlers();
  
  // Setup visual resize handles
  setupResizeHandles(container);
  
  // Add edge detection for resize cursor
  setupEdgeResizing(container);
  
  // Setup dragging functionality (separate from resizing)
  setupDragging(container);
}

// Function to remove existing resize handlers to avoid duplicates
function removeResizeHandlers() {
  const container = document.getElementById('ga-notes-root');
  if (!container) return;
  
  // Remove resize handles from container
  const handles = container.querySelectorAll('.resize-handle');
  handles.forEach(handle => handle.remove());
  
  // Remove resize handles from shadow DOM
  if (shadowRootRef) {
    const shadowHandles = shadowRootRef.querySelectorAll('.resize-handle');
    shadowHandles.forEach(handle => handle.remove());
    
    // Also check app container specifically
    const appContainer = shadowRootRef.querySelector('.app-container');
    if (appContainer) {
      const appHandles = appContainer.querySelectorAll('.resize-handle');
      appHandles.forEach(handle => handle.remove());
    }
    
    // Also check popup container
    const popupContainer = shadowRootRef.querySelector('.popup-container');
    if (popupContainer) {
      const popupHandles = popupContainer.querySelectorAll('.resize-handle');
      popupHandles.forEach(handle => handle.remove());
    }
  }
  
  // Remove event listeners from container
  if (containerEventHandlers.mousemove) {
    container.removeEventListener('mousemove', containerEventHandlers.mousemove);
    containerEventHandlers.mousemove = undefined;
  }
  
  if (containerEventHandlers.mouseleave) {
    container.removeEventListener('mouseleave', containerEventHandlers.mouseleave);
    containerEventHandlers.mouseleave = undefined;
  }
  
  if (containerEventHandlers.mousedown) {
    container.removeEventListener('mousedown', containerEventHandlers.mousedown);
    containerEventHandlers.mousedown = undefined;
  }
  
  // Remove document event listeners for resize
  document.removeEventListener('mousemove', handleResize, true);
  document.removeEventListener('mousemove', handleResize); // non-capture version
  document.removeEventListener('mouseup', stopResize, true);
  document.removeEventListener('mouseup', stopResize); // non-capture version
  
  // Reset resize state
  isResizing = false;
  resizeDirection = '';
  
  // Reset resize edges
  resizeEdges.top = false;
  resizeEdges.right = false;
  resizeEdges.bottom = false;
  resizeEdges.left = false;
  
  // Reset cursor and remove resizing class
  if (container) {
    container.style.cursor = 'default';
    container.classList.remove('resizing');
  }
}

// Setup resize handles
function setupResizeHandles(container: HTMLElement) {
  
  // Remove any existing resize handles first
  removeResizeHandlers();
  
  // Create resize handles for each direction
  const directions = ['n', 'e', 's', 'w', 'ne', 'se', 'sw', 'nw'];
  
  // Find the popup-container inside shadow DOM
  let targetContainer = container;
  if (shadowRootRef) {
    // First try to use popup-container as the primary target
    const popupContainer = shadowRootRef.querySelector('.popup-container') as HTMLElement;
    if (popupContainer) {
      targetContainer = popupContainer;
    } else {
      // Fallback to app-container if popup-container not found
      const appContainer = shadowRootRef.querySelector('.app-container') as HTMLElement;
      if (appContainer) {
        targetContainer = appContainer;
      }
    }
  }
  
  directions.forEach(dir => {
    const handle = document.createElement('div');
    handle.className = `resize-handle resize-${dir}`;
    handle.setAttribute('data-direction', dir);
    
    // Set explicit z-index to ensure handles are above other elements
    handle.style.zIndex = '10001';
    handle.style.position = 'absolute';
    
    // Position the handle based on direction
    switch(dir) {
      case 'n':
        handle.style.top = '0';
        handle.style.left = '0';
        handle.style.right = '0';
        handle.style.height = '14px';
        handle.style.cursor = 'ns-resize';
        break;
      case 's':
        handle.style.bottom = '0';
        handle.style.left = '0';
        handle.style.right = '0';
        handle.style.height = '14px';
        handle.style.cursor = 'ns-resize';
        break;
      case 'e':
        handle.style.right = '0';
        handle.style.top = '0';
        handle.style.bottom = '0';
        handle.style.width = '14px';
        handle.style.cursor = 'ew-resize';
        break;
      case 'w':
        handle.style.left = '0';
        handle.style.top = '0';
        handle.style.bottom = '0';
        handle.style.width = '14px';
        handle.style.cursor = 'ew-resize';
        break;
      case 'ne':
        handle.style.top = '0';
        handle.style.right = '0';
        handle.style.width = '20px';
        handle.style.height = '20px';
        handle.style.cursor = 'ne-resize';
        break;
      case 'nw':
        handle.style.top = '0';
        handle.style.left = '0';
        handle.style.width = '20px';
        handle.style.height = '20px';
        handle.style.cursor = 'nw-resize';
        break;
      case 'se':
        handle.style.bottom = '0';
        handle.style.right = '0';
        handle.style.width = '20px';
        handle.style.height = '20px';
        handle.style.cursor = 'se-resize';
        break;
      case 'sw':
        handle.style.bottom = '0';
        handle.style.left = '0';
        handle.style.width = '20px';
        handle.style.height = '20px';
        handle.style.cursor = 'sw-resize';
        break;
    }
    
    // Add the handle to the container
    targetContainer.appendChild(handle);

    handle.addEventListener('mousedown', (async (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation(); // Prevent event propagation
      
      // Try to lock the resize operation
      const lockAcquired = await PositionScaleManager.lockOperation(OperationType.RESIZING);
      if (!lockAcquired) {
        return;
      }
      
      isResizing = true;
      isDragging = false; // Ensure dragging is off
      
      resizeDirection = dir;
      container.classList.add('resizing');
      
      const rect = container.getBoundingClientRect();
      startX = e.clientX;
      startY = e.clientY;
      startWidth = rect.width;
      startHeight = rect.height;
      startLeft = rect.left;
      startTop = rect.top;
      startScale = currentPositionScale.scale;
      // Add event listeners for resize
      document.addEventListener('mousemove', handleResize, true);
      document.addEventListener('mouseup', stopResize, true);
    }) as unknown as EventListener);
  });
}

// Setup dragging
function setupDragging(container: HTMLElement) {
  // Find the header element for dragging
  const headerElement = shadowRootRef ? shadowRootRef.querySelector('.header') : null;
  
  if (!headerElement) {
    return;
  }
  // Header mousedown handler
  const headerMousedownHandler = async (e: MouseEvent) => {
    // Don't initiate drag if clicking on certain elements (like buttons)
    if ((e.target as HTMLElement).closest('.header-action')) {
      return;
    }
    
    e.preventDefault();
    e.stopPropagation(); // Stop event propagation
    
    // Try to lock the drag operation
    const lockAcquired = await PositionScaleManager.lockOperation(OperationType.DRAGGING);
    if (!lockAcquired) {
      return;
    }
    
    isDragging = true;
    isResizing = false; // Ensure resizing is off
    
    // Get starting positions
    const rect = container.getBoundingClientRect();
    startX = e.clientX;
    startY = e.clientY;
    startLeft = rect.left;
    startTop = rect.top;
    // Add mousemove and mouseup event listeners
    document.addEventListener('mousemove', handleDrag, true);
    document.addEventListener('mouseup', stopDrag, true);
  };
  
  // Double-click handler to expand/collapse
  const headerDblclickHandler = async (e: MouseEvent) => {
    // Don't handle double-click if clicking on certain elements (like buttons)
    if ((e.target as HTMLElement).closest('.header-action')) {
      return;
    }
    
    e.preventDefault();
    e.stopPropagation(); // Stop event propagation
    
    // Reset to default position and scale
    try {
      const defaultPosition = await PositionScaleManager.resetToDefault();
      applyPositionAndScale(defaultPosition);
      await saveCurrentPosition();
    } catch (error) {
      console.error('Failed to reset position:', error);
    }
  };
  
  // Add header event listeners
  headerElement.addEventListener('mousedown', headerMousedownHandler as unknown as EventListener);
  headerElement.addEventListener('dblclick', headerDblclickHandler as unknown as EventListener);
}

// Add new function for edge-based resizing
function setupEdgeResizing(container: HTMLElement) {
  // Increase threshold for edge detection
  const EDGE_THRESHOLD = 15; // Increased from 10px
  // Store references to event listeners for proper cleanup
  const mousemoveHandler = (e: MouseEvent) => {
    if (isDragging || isResizing) return;
    
    // Find the header element - we don't want to show resize cursor on the header
    const header = shadowRootRef?.querySelector('.header') as HTMLElement;
    if (header && header.contains(e.target as Node)) {
      // If we're over the header, let the header handle cursor (for dragging)
      return;
    }
    
    const rect = container.getBoundingClientRect();
    
    // Calculate effective threshold based on current scale
    const effectiveThreshold = EDGE_THRESHOLD / currentPositionScale.scale;
    
    // Compute relative mouse position
    const offsetX = e.clientX - rect.left;
    const offsetY = e.clientY - rect.top;
    
    // Previous edge state for change detection
    const prevEdges = { ...resizeEdges };
    
    // Detect which edges the mouse is near using the effective threshold
    resizeEdges.top = offsetY <= effectiveThreshold;
    resizeEdges.right = rect.width - offsetX <= effectiveThreshold;
    resizeEdges.bottom = rect.height - offsetY <= effectiveThreshold;
    resizeEdges.left = offsetX <= effectiveThreshold;
    
    // Log if edge detection state changed
    if (prevEdges.top !== resizeEdges.top || 
        prevEdges.right !== resizeEdges.right || 
        prevEdges.bottom !== resizeEdges.bottom || 
        prevEdges.left !== resizeEdges.left) {
    }
    
    // Set appropriate cursor based on position
    let newCursor = 'default';
    
    if (resizeEdges.top && resizeEdges.left) {
      newCursor = 'nw-resize';
    } else if (resizeEdges.top && resizeEdges.right) {
      newCursor = 'ne-resize';
    } else if (resizeEdges.bottom && resizeEdges.left) {
      newCursor = 'sw-resize';
    } else if (resizeEdges.bottom && resizeEdges.right) {
      newCursor = 'se-resize';
    } else if (resizeEdges.top) {
      newCursor = 'n-resize';
    } else if (resizeEdges.right) {
      newCursor = 'e-resize';
    } else if (resizeEdges.bottom) {
      newCursor = 's-resize';
    } else if (resizeEdges.left) {
      newCursor = 'w-resize';
    }
    
    if (container.style.cursor !== newCursor) {
      container.style.cursor = newCursor;
    }
  };
  
  // Reset cursor when mouse leaves
  const mouseleaveHandler = () => {
    if (!isDragging && !isResizing) {
      container.style.cursor = 'default';
      // Reset resize edges when mouse leaves
      resizeEdges.top = false;
      resizeEdges.right = false;
      resizeEdges.bottom = false;
      resizeEdges.left = false;
    }
  };
  
  // Store the mousedown handler for later cleanup
  const mousedownHandler = (e: MouseEvent) => {
    // Skip if we're already dragging or resizing
    if (isDragging || isResizing) {
      return;
    }
    
    // Skip if we're clicking on the header (header handles dragging)
    const header = shadowRootRef?.querySelector('.header') as HTMLElement;
    if (header && header.contains(e.target as Node)) {
      return;
    }
    
    // Only proceed if we're on an edge
    if (!(resizeEdges.top || resizeEdges.right || resizeEdges.bottom || resizeEdges.left)) {
      return;
    }
    
    // If we've gotten here, we're definitely resizing, so stop the event
    e.preventDefault();
    e.stopPropagation();
    
    // Set resizing state immediately to prevent drag from interfering
    isResizing = true;
    isDragging = false;
    
    // Determine resize direction based on edges
    let direction = '';
    if (resizeEdges.top) direction += 'n';
    if (resizeEdges.right) direction += 'e';
    if (resizeEdges.bottom) direction += 's';
    if (resizeEdges.left) direction += 'w';
    resizeDirection = direction;
    
    startX = e.clientX;
    startY = e.clientY;
    startWidth = container.offsetWidth;
    startHeight = container.offsetHeight;
    startTop = container.offsetTop;
    startLeft = container.offsetLeft;
    startScale = currentPositionScale.scale;
    // Add a class to indicate we're resizing
    container.classList.add('resizing');
    
    // Use capture phase to ensure our handlers get called first
    document.addEventListener('mousemove', handleResize, true);
    document.addEventListener('mouseup', stopResize, true);
  };
  
  // Register event listeners and store references for cleanup
  container.addEventListener('mousemove', mousemoveHandler);
  container.addEventListener('mouseleave', mouseleaveHandler);
  container.addEventListener('mousedown', mousedownHandler);
  
  // Store references for cleanup
  containerEventHandlers.mousemove = mousemoveHandler;
  containerEventHandlers.mouseleave = mouseleaveHandler;
  containerEventHandlers.mousedown = mousedownHandler;
  
  // Create a ResizeObserver to maintain content layout during resize
  if (shadowRootRef) {
    if (resizeObserver) {
      resizeObserver.disconnect();
    }
    
    resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.target === container && shadowRootRef) {
          // When container is resized, adjust content area
          const content = shadowRootRef.querySelector('.content') as HTMLElement;
          const header = shadowRootRef.querySelector('.header') as HTMLElement;
          const footer = shadowRootRef.querySelector('.footer') as HTMLElement;
          const tabList = shadowRootRef.querySelector('.tab-list') as HTMLElement;
          const popupContainer = shadowRootRef.querySelector('.popup-container') as HTMLElement;
          
          if (content && header && footer && popupContainer) {
            // Calculate available height for content
            const headerHeight = header.offsetHeight;
            const footerHeight = footer.offsetHeight;
            const containerHeight = container.offsetHeight;
            
            // Ensure the popup container height is synchronized
            popupContainer.style.height = `${containerHeight}px`;
            void popupContainer.offsetHeight; // Force reflow
            
            // Set content height to fill available space while ensuring footer is visible
            const contentHeight = containerHeight - headerHeight - footerHeight;
            content.style.height = `${Math.max(50, contentHeight)}px`;
            content.style.overflow = 'auto';
            
            // Ensure tab-list doesn't change height
            if (tabList) {
              tabList.style.flexShrink = '0';
            }
          }
        }
      }
    });
    
    resizeObserver.observe(container);
  }
}

// Handle resize event
function handleResize(e: MouseEvent) {
  if (!isResizing || isDragging) {
    return; // Skip if we're not resizing or if we're dragging
  }
  
  const container = document.getElementById('ga-notes-root');
  if (!container) {
    return;
  }
  
  e.preventDefault();
  e.stopPropagation(); // Stop propagation to prevent other handlers from running
  
  // Adjust for scaling effect on mouse movement
  const scale = currentPositionScale.scale;
  const dx = (e.clientX - startX) / scale;
  const dy = (e.clientY - startY) / scale;
  
  // Define minimum dimensions
  const minWidth = 300;
  const minHeight = 200;
  
  // Calculate the right and bottom edge positions of the original element
  // These are the positions we want to maintain when resizing from left/top
  const startRight = startLeft + startWidth;
  const startBottom = startTop + startHeight;
  
  let newWidth = startWidth;
  let newHeight = startHeight;
  let newTop = startTop;
  let newLeft = startLeft;
  
  // Calculate new dimensions based on resize direction
  if (resizeDirection.includes('e')) {
    // East/right edge - adjust width only
    newWidth = Math.max(minWidth, startWidth + dx);
  }
  
  if (resizeDirection.includes('w')) {
    // West/left edge - adjust left position and width
    if (dx > 0) {
      // Pushing in (moving right) - decrease width, increase left
      // Limit how far we can push in to maintain minimum width
      const maxDeltaX = startWidth - minWidth;
      const adjustedDx = Math.min(dx, maxDeltaX);
      
      newLeft = startLeft + adjustedDx;
      newWidth = startRight - newLeft; // Maintain right edge position
    } else {
      // Pulling out (moving left) - increase width, decrease left
      // No minimum width constraint needed here as we're increasing width
      newLeft = startLeft + dx; // Move left edge to the left
      newWidth = startRight - newLeft; // Maintain right edge position
    }
  }
  
  if (resizeDirection.includes('s')) {
    // South/bottom edge - adjust height only
    newHeight = Math.max(minHeight, startHeight + dy);
  }
  
  if (resizeDirection.includes('n')) {
    // North/top edge - adjust top position and height
    if (dy > 0) {
      // Pushing in (moving down) - decrease height, increase top
      // Limit how far we can push in to maintain minimum height
      const maxDeltaY = startHeight - minHeight;
      const adjustedDy = Math.min(dy, maxDeltaY);
      
      newTop = startTop + adjustedDy;
      newHeight = startBottom - newTop; // Maintain bottom edge position
    } else {
      // Pulling out (moving up) - increase height, decrease top
      // No minimum height constraint needed here as we're increasing height
      newTop = startTop + dy; // Move top edge up
      newHeight = startBottom - newTop; // Maintain bottom edge position
    }
  }
  
  // Ensure minimum dimensions are respected
  if (newWidth < minWidth) {
    if (resizeDirection.includes('w')) {
      // If resizing from left, adjust left position to maintain right edge
      newLeft = startRight - minWidth;
    }
    newWidth = minWidth;
  }
  
  if (newHeight < minHeight) {
    if (resizeDirection.includes('n')) {
      // If resizing from top, adjust top position to maintain bottom edge
      newTop = startBottom - minHeight;
    }
    newHeight = minHeight;
  }
  
  // Get viewport dimensions
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  
  // Ensure the container stays within viewport bounds
  const minVisiblePortion = 50;
  
  // Calculate effective dimensions with scale
  const effectiveWidth = newWidth * scale;
  const effectiveHeight = newHeight * scale;
  
  // Store original values before constraining
  const preConstraintLeft = newLeft;
  const preConstraintTop = newTop;
  
  // Constrain horizontal position accounting for scale
  newLeft = Math.max(-effectiveWidth + minVisiblePortion, newLeft);
  newLeft = Math.min(viewportWidth - minVisiblePortion, newLeft);
  
  // Constrain vertical position accounting for scale
  newTop = Math.max(-effectiveHeight + minVisiblePortion, newTop);
  newTop = Math.min(viewportHeight - minVisiblePortion, newTop);
  
  // If we had to constrain the position, adjust the dimensions to maintain the opposite edge
  if (resizeDirection.includes('w') && preConstraintLeft !== newLeft) {
    // Left edge was constrained, adjust width to maintain right edge position
    newWidth = startRight - newLeft;
  }
  
  if (resizeDirection.includes('n') && preConstraintTop !== newTop) {
    // Top edge was constrained, adjust height to maintain bottom edge position
    newHeight = startBottom - newTop;
  }
  
  // Update the currentPositionScale values
  currentPositionScale.width = newWidth;
  currentPositionScale.height = newHeight;
  currentPositionScale.x = newLeft;
  currentPositionScale.y = newTop;
  
  // Apply the changes using the consistent method
  // Use requestAnimationFrame to improve performance and prevent stuttering
  if (!resizeAnimationFrameId) {
    resizeAnimationFrameId = requestAnimationFrame(() => {
      // Pass the resize direction to applyPositionAndScale
      applyPositionAndScale(currentPositionScale, resizeDirection);
      resizeAnimationFrameId = null;
    });
  }
  
  // Update the content area to maintain header and footer heights
  if (shadowRootRef) {
    const content = shadowRootRef.querySelector('.content') as HTMLElement;
    const header = shadowRootRef.querySelector('.header') as HTMLElement;
    const footer = shadowRootRef.querySelector('.footer') as HTMLElement;
    const tabList = shadowRootRef.querySelector('.tab-list') as HTMLElement;
    const popupContainer = shadowRootRef.querySelector('.popup-container') as HTMLElement;
    
    if (content && header && footer && popupContainer) {
      // Calculate available height for content
      const headerHeight = header.offsetHeight;
      const footerHeight = footer.offsetHeight;
      
      // Ensure the popup container height matches new dimensions
      popupContainer.style.height = `${newHeight}px`;
      void popupContainer.offsetHeight; // Force reflow
      
      // Set content height to fill available space while preserving header and footer
      const contentHeight = newHeight - headerHeight - footerHeight;
      content.style.height = `${Math.max(50, contentHeight)}px`;
      content.style.overflow = 'auto';
      
      // Ensure tab-list doesn't change height during resize
      if (tabList) {
        tabList.style.flexShrink = '0';
      }
    }
  }
}

// Stop resize event
function stopResize() {
  if (!isResizing) {
    return;
  }
  
  isResizing = false;
  resizeDirection = '';
  
  // Cancel any pending animation frames
  if (resizeAnimationFrameId !== null) {
    cancelAnimationFrame(resizeAnimationFrameId);
    resizeAnimationFrameId = null;
  }
  
  const container = document.getElementById('ga-notes-root');
  if (!container) {
    return;
  }
  
  // Apply changes
  container.classList.remove('resizing');
  
  // Ensure the popup container has the final dimensions and layout
  if (shadowRootRef) {
    const popupContainer = shadowRootRef.querySelector('.popup-container') as HTMLElement;
    const content = shadowRootRef.querySelector('.content') as HTMLElement;
    const header = shadowRootRef.querySelector('.header') as HTMLElement;
    const footer = shadowRootRef.querySelector('.footer') as HTMLElement;
    
    if (popupContainer && container) {
      // Make sure popup container has the same dimensions as the root container
      popupContainer.style.height = `${container.offsetHeight}px`;
      void popupContainer.offsetHeight; // Force reflow
      
      // Adjust content area to maintain proper layout
      if (content && header && footer) {
        const headerHeight = header.offsetHeight;
        const footerHeight = footer.offsetHeight;
        const containerHeight = container.offsetHeight;
        
        const contentHeight = containerHeight - headerHeight - footerHeight;
        content.style.height = `${Math.max(50, contentHeight)}px`;
      }
    }
  }
  
  // Remove event listeners, including those with capture phase
  document.removeEventListener('mousemove', handleResize, true);
  document.removeEventListener('mousemove', handleResize);
  document.removeEventListener('mouseup', stopResize, true);
  document.removeEventListener('mouseup', stopResize);
  
  // Save the position
  saveDimensionsOnly();
  
  // Release the operation lock
  (async () => {
    await PositionScaleManager.releaseOperationLock();
  })();
}

// Handle drag event
function handleDrag(e: MouseEvent) {
  if (!isDragging || isResizing) {
    return;
  }
  
  const container = document.getElementById('ga-notes-root');
  if (!container) {
    return;
  }
  
  e.preventDefault();
  e.stopPropagation(); // Stop event propagation
  
  // Adjust for scaling effect on mouse movement
  const scale = currentPositionScale.scale;
  const dx = (e.clientX - startX);
  const dy = (e.clientY - startY);
  
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
  const oldLeft = newLeft;
  newLeft = Math.max(-containerWidth + minVisiblePortion, newLeft);
  newLeft = Math.min(viewportWidth - minVisiblePortion, newLeft);
  
  // Constrain vertical position
  const oldTop = newTop;
  newTop = Math.max(-containerHeight + minVisiblePortion, newTop);
  newTop = Math.min(viewportHeight - minVisiblePortion, newTop);
  
  // Update the position scale object first to ensure consistency
  currentPositionScale.x = newLeft;
  currentPositionScale.y = newTop;
  
  // Use applyPositionAndScale to consistently update the UI
  // Use 'center center' for dragging to ensure smooth movement
  applyPositionAndScale(currentPositionScale, 'center center');
}

// Stop drag event
function stopDrag() {
  if (!isDragging) {
    return;
  }
  
  isDragging = false;
  
  // Remove event listeners, including those with capture phase
  document.removeEventListener('mousemove', handleDrag, true);
  document.removeEventListener('mousemove', handleDrag);
  document.removeEventListener('mouseup', stopDrag, true);
  document.removeEventListener('mouseup', stopDrag);
  
  // Save the new position using the position-only method
  savePositionOnly();
  
  // Release the operation lock
  (async () => {
    await PositionScaleManager.releaseOperationLock();
  })();
}

async function injectApp() {
  // Don't inject if already injected
  if (document.getElementById('ga-notes-root')) {
    return document.getElementById('ga-notes-root');
  }
  // Create root container for the extension
  const rootContainer = document.createElement('div');
  rootContainer.id = 'ga-notes-root';
  document.body.appendChild(rootContainer);
  // Create shadow DOM for style isolation
  shadowRootRef = rootContainer.attachShadow({ mode: 'closed' });
  
  // Get a fresh position for this tab
  try {
    const position = await PositionScaleManager.getPositionForCurrentTab();
    // Apply the position immediately to avoid flicker
    currentPositionScale = position;
    // Use top left transform origin for initial positioning
    applyPositionAndScale(position, 'top left');
  } catch (error) {
    console.error('Failed to get position:', error);
    // Use default position
    const defaultPosition = await PositionScaleManager.getDefaultPosition();
    currentPositionScale = defaultPosition;
    // Use top right transform origin for default positioning
    applyPositionAndScale(defaultPosition, 'top right');
  }
  
  // Create app container inside shadow root
  const appContainer = document.createElement('div');
  appContainer.className = 'ga-notes-container app-container';
  
  // Initialize theme manager and create theme toggle
  themeToggle = createThemeToggle(appContainer);
  
  // Create style element for our CSS
  const style = document.createElement('style');
  style.textContent = require('./styles/index.css').default;
  
  // Append to shadow root using our stored reference
  shadowRootRef.appendChild(style);
  shadowRootRef.appendChild(appContainer);
  
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
  
  // Setup event capture to prevent events from reaching the host page
  setupEventCapture();
  
  // Log initialization for debugging
  console.debug('App initialized with resize functionality');
  
  // Add a small delay to ensure all elements are properly rendered before setting up resize
  setTimeout(() => {
    // Refresh resize handles
    setupDragAndResize();
  }, 500);
  
  // Set initial visibility
  isInterfaceVisible = getInterfaceVisibility();
  updateInterfaceVisibility(isInterfaceVisible);
  
  return rootContainer;
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
    } else {
      // Check actual current visibility if forceState isn't provided
      const currentVisibility = getInterfaceVisibility();
      isInterfaceVisible = forceState !== undefined ? forceState : !currentVisibility;
      
      // Based on the new visibility state, call the appropriate function
      if (isInterfaceVisible) {
        showExtensionUI();
      } else {
        hideExtensionUI();
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
  const container = document.getElementById('ga-notes-root');
  if (container) {
    container.style.display = visible ? 'block' : 'none';
  }
}

// Function to toggle the theme
export function toggleTheme() {
  if (!themeToggle) return;
  
  // Use the toggle method from the themeToggle object
  themeToggle.toggle().catch(error => {
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
  } else if (message.type === 'updateResizeState') {
    // Handle resize state updates from background script
    if (message.position) {
      applyPositionAndScale(message.position);
      sendResponse({ success: true });
    } else {
      sendResponse({ success: false, error: 'No position data provided' });
    }
  } else if (message.type === 'updatePosition') {
    // Apply the new position and scale
    applyPositionAndScale(message.position, 'center center');
    sendResponse({ success: true });
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
    // Use top right transform origin for default positioning
    applyPositionAndScale(newPosition, 'top right');
    saveCurrentPosition();
  }
});

// Clean up resources when extension is unloaded
function cleanup() {
  // Remove event listeners
  document.removeEventListener('keydown', captureEvent);
  
  // Clean up resize event listeners
  removeResizeHandlers();
  
  // Clean up drag event listeners
  removeDragHandlers();
  
  // Disconnect resize observer if it exists
  if (resizeObserver) {
    resizeObserver.disconnect();
    resizeObserver = null;
  }
  
  // Remove the root element from the page
  const rootElement = document.getElementById('ga-notes-root');
  if (rootElement) {
    rootElement.remove();
  }
  
  // Reset state
  shadowRootRef = null;
  isInterfaceVisible = false;
}

// New function to clean up drag event listeners
function removeDragHandlers() {
  if (!shadowRootRef) return;
  
  // Find header element
  const header = shadowRootRef.querySelector('.header') as HTMLElement;
  if (!header) return;
  
  // Remove drag event handlers from header
  if (containerEventHandlers.headerMousedown) {
    header.removeEventListener('mousedown', containerEventHandlers.headerMousedown);
    containerEventHandlers.headerMousedown = undefined;
  }
  
  if (containerEventHandlers.headerDblclick) {
    header.removeEventListener('dblclick', containerEventHandlers.headerDblclick);
    containerEventHandlers.headerDblclick = undefined;
  }
  
  // Remove document event listeners for drag
  document.removeEventListener('mousemove', handleDrag, true);
  document.removeEventListener('mousemove', handleDrag);
  document.removeEventListener('mouseup', stopDrag, true);
  document.removeEventListener('mouseup', stopDrag);
  
  // Reset drag state
  isDragging = false;
}

export {};