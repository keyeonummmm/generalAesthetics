import selectionStyles from '../styles/selection.css';
import { hideExtensionUI as globalHideUI, showExtensionUI as globalShowUI } from '../content';

// Keep track of active selection instances to prevent multiple overlays
let activeSelectionInstance: ScreenshotSelection | null = null;

// Add event listener for initialization
document.addEventListener('init-screenshot-selection', () => {
  // Remove existing instance if there is one
  if (activeSelectionInstance) {
    activeSelectionInstance.cleanup();
  }
  // Create new instance
  activeSelectionInstance = new ScreenshotSelection();
});

export class ScreenshotSelection {
  private overlay!: HTMLDivElement;
  private selection!: HTMLDivElement;
  private startX = 0;
  private startY = 0;
  private isSelecting = false;
  private lastCaptureTime = 0;
  private readonly CAPTURE_COOLDOWN = 1000; // 1 second cooldown

  constructor() {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => this.initialize());
    } else {
      this.initialize();
    }
  }

  private initialize() {
    // Remove any existing overlay elements first
    this.removeExistingOverlays();
    
    const style = document.createElement('style');
    style.textContent = selectionStyles;
    document.head.appendChild(style);

    this.overlay = this.createOverlay();
    this.selection = this.createSelection();
    this.overlay.appendChild(this.selection);
    document.body.appendChild(this.overlay);
    this.bindEvents();
  }

  private removeExistingOverlays() {
    // Remove any existing overlays to prevent multiple instances
    const existingOverlays = document.querySelectorAll('.screenshot-overlay');
    existingOverlays.forEach(overlay => {
      overlay.remove();
    });
  }

  private createOverlay(): HTMLDivElement {
    const overlay = document.createElement('div');
    overlay.className = 'screenshot-overlay';
    return overlay;
  }

  private createSelection(): HTMLDivElement {
    const selection = document.createElement('div');
    selection.className = 'screenshot-selection';
    return selection;
  }

  private bindEvents() {
    this.overlay.addEventListener('mousedown', this.handleMouseDown);
    this.overlay.addEventListener('mousemove', this.handleMouseMove);
    this.overlay.addEventListener('mouseup', this.handleMouseUp);
  }

  private handleMouseDown = (e: MouseEvent) => {
    this.isSelecting = true;
    this.startX = e.clientX;
    this.startY = e.clientY;
    this.selection.style.left = `${this.startX}px`;
    this.selection.style.top = `${this.startY}px`;
    this.selection.style.width = '0';
    this.selection.style.height = '0';
  };

  private handleMouseMove = (e: MouseEvent) => {
    if (!this.isSelecting) return;

    const width = e.clientX - this.startX;
    const height = e.clientY - this.startY;

    this.selection.style.width = `${Math.abs(width)}px`;
    this.selection.style.height = `${Math.abs(height)}px`;
    this.selection.style.left = `${width > 0 ? this.startX : e.clientX}px`;
    this.selection.style.top = `${height > 0 ? this.startY : e.clientY}px`;
  };

  private canCapture(): boolean {
    const now = Date.now();
    if (now - this.lastCaptureTime < this.CAPTURE_COOLDOWN) {
      return false;
    }
    this.lastCaptureTime = now;
    return true;
  }

  // Hide extension UI elements in the shadow DOM
  private hideExtensionUI() {
    // Use the global function from content.ts
    globalHideUI();
    
    // Also hide any other extension elements that might be in the DOM
    const extensionElements = document.querySelectorAll('[id^="general-aesthetics-"], [class^="ga-"]');
    extensionElements.forEach(element => {
      if (element instanceof HTMLElement) {
        element.style.display = 'none';
      }
    });
  }

  // Restore extension UI elements
  private showExtensionUI() {
    // Use the global function from content.ts
    globalShowUI();
    
    // Also show any other extension elements that were hidden
    const extensionElements = document.querySelectorAll('[id^="general-aesthetics-"], [class^="ga-"]');
    extensionElements.forEach(element => {
      if (element instanceof HTMLElement) {
        element.style.display = '';  // Reset to default display value
      }
    });
  }

  private handleMouseUp = async () => {
    if (!this.isSelecting) return;
    this.isSelecting = false;

    if (!this.canCapture()) {
      this.cleanup();
      return;
    }

    try {
      const rect = this.selection.getBoundingClientRect();
      
      // Hide extension UI before taking screenshot
      this.hideExtensionUI();
      
      // Add capturing classes right before screenshot
      this.overlay.classList.add('capturing');
      this.selection.classList.add('capturing');
      
      await new Promise(resolve => setTimeout(resolve, 100));

      // Capture the entire visible tab first
      const response = await chrome.runtime.sendMessage({
        type: 'CAPTURE_VISIBLE_TAB',
        dimensions: {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
          devicePixelRatio: window.devicePixelRatio
        }
      });

      if (!response?.captureData) {
        throw new Error('No capture data received');
      }

      // Create canvas for cropping
      const canvas = document.createElement('canvas');
      canvas.width = rect.width;
      canvas.height = rect.height;

      const ctx = canvas.getContext('2d');
      if (!ctx) {
        throw new Error('Failed to get canvas context');
      }

      // Load the captured image
      const img = new Image();
      img.src = response.captureData;
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = () => reject(new Error('Failed to load captured image'));
      });

      // Draw the selected portion
      ctx.drawImage(
        img,
        rect.left * window.devicePixelRatio,
        rect.top * window.devicePixelRatio,
        rect.width * window.devicePixelRatio,
        rect.height * window.devicePixelRatio,
        0,
        0,
        rect.width,
        rect.height
      );

      chrome.runtime.sendMessage({
        type: 'SELECTION_CAPTURE',
        data: canvas.toDataURL('image/png')
      });

    } catch (error) {
      console.error('Selection capture failed:', error);
      chrome.runtime.sendMessage({
        type: 'SELECTION_CAPTURE_ERROR',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    } finally {
      // Don't show the extension UI again here, as it will be shown by Popup.tsx
      // Don't remove capturing classes either, as we're cleaning up the entire overlay
      
      // Clean up immediately instead of waiting
      this.cleanup();
    }
  };

  public cleanup() {
    // Set the active instance to null
    if (activeSelectionInstance === this) {
      activeSelectionInstance = null;
    }
    
    const styles = document.querySelectorAll('style');
    styles.forEach(style => {
      if (style.textContent === selectionStyles) {
        style.remove();
      }
    });
    
    // Ensure overlay is removed
    if (this.overlay && this.overlay.parentNode) {
      this.overlay.remove();
    }
  }
}
