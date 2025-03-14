// TextFormatter.ts - Handles rich text formatting operations
import { v4 as uuidv4 } from 'uuid';

// Define types for formatting options
export type TextFormatType = 'bold' | 'italic' | 'underline';

export interface FormatOption {
  id: string;
  type: TextFormatType;
  label: string;
  icon: string;
  command: string;
}

// Format options configuration
export const FORMAT_OPTIONS: FormatOption[] = [
  { id: 'bold', type: 'bold', label: 'Bold', icon: '𝐁', command: 'bold', },
  { id: 'italic', type: 'italic', label: 'Italic', icon: '𝐼', command: 'italic', },
  { id: 'underline', type: 'underline', label: 'Underline', icon: '𝑈', command: 'underline', },
];

/**
 * Manages text formatting operations for rich text editing.
 * Provides methods for applying and tracking active format states.
 */
export class TextFormatter {
  // Track active format state and continuous formatting
  private static activeFormats: Record<string, boolean> = {};
  private static isContinuousFormatting = false;
  private static contentElement: HTMLElement | null = null;
  
  /**
   * Initialize the formatter with a reference to the content editable element
   */
  public static initialize(contentElement: HTMLElement) {
    this.contentElement = contentElement;
    this.resetState();
  }
  
  /**
   * Reset the formatter state
   */
  public static resetState() {
    this.activeFormats = {};
    this.isContinuousFormatting = false;
  }
  
  /**
   * Apply formatting to selected text or at cursor position
   */
  public static applyFormat(format: string): boolean {
    if (!this.contentElement) {
      console.error('[TextFormatter] No content element set');
      return false;
    }
    
    // Focus the content element if not already focused
    if (document.activeElement !== this.contentElement) {
      this.contentElement.focus();
    }
    
    // Get current selection
    const selection = window.getSelection();
    if (!selection) {
      return false;
    }
    
    // Determine if there's a real text selection (not just cursor position)
    const hasTextSelection = selection.toString().length > 0;
    
    let success = false;
    
    try {
      // Apply the format using execCommand
      success = document.execCommand(format, false);
      
      // Check if the command was successful
      if (success) {
        // Update the active formats state based on what was just applied
        this.updateActiveFormats(format);
        
        // If we applied formatting to selected text, we'll enable continuous formatting
        // for subsequently typed characters
        if (hasTextSelection) {
          this.isContinuousFormatting = true;
        } else {
          // If there was no selection, we're toggling continuous formatting mode
          // for this format
          this.toggleActiveFormat(format);
        }
      } else {
        console.warn(`[TextFormatter] Format application failed: ${format}`);
      }
    } catch (e) {
      console.error(`[TextFormatter] Error applying format: ${format}`, e);
      success = false;
    }
    
    return success;
  }
  
  /**
   * Apply all active formats to newly inserted text
   */
  public static applyActiveFormats(): boolean {
    if (!this.contentElement) {
      console.error('[TextFormatter] No content element set');
      return false;
    }
    
    if (!this.isContinuousFormatting || Object.keys(this.activeFormats).length === 0) {
      return false;
    }
    
    // Focus the content element if not already focused
    if (document.activeElement !== this.contentElement) {
      this.contentElement.focus();
    }
    
    // Get current selection
    const selection = window.getSelection();
    if (!selection) {
      console.error('[TextFormatter] No selection available');
      return false;
    }
    
    // Check if selection is in our content element
    if (selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      
      // Improved check for selection inside content element - also check parent for text nodes
      const isInContent = this.validateSelectionInContent(range, this.contentElement);
      
      if (!isInContent) {
        return false;
      }
      
      // Apply each active format
      let success = true;
      try {
        // Temporarily disable continuous formatting while applying formats
        // to avoid recursion
        const wasContinuous = this.isContinuousFormatting;
        this.isContinuousFormatting = false;
        
        // Apply each active format to the current position
        Object.entries(this.activeFormats).forEach(([format, value]) => {
          if (value === true) {
            const applied = document.execCommand(format, false);
            
            if (!applied) {
              console.warn(`[TextFormatter] Failed to apply active format: ${format}`);
              success = false;
            }
          }
        });
        
        // Restore continuous formatting state
        this.isContinuousFormatting = wasContinuous;
      } catch (e) {
        console.error('[TextFormatter] Error applying active formats', e);
        success = false;
      }
      
      return success;
    }
    
    return false;
  }
  
  /**
   * Toggle a format in the active formats list
   */
  private static toggleActiveFormat(format: string) {
    // For toggle formats like bold, italic, etc.
    if (this.activeFormats[format]) {
      // Format is active, remove it
      delete this.activeFormats[format];
      
      // If removing a format leaves no active formats, disable continuous formatting
      if (Object.keys(this.activeFormats).length === 0) {
        this.isContinuousFormatting = false;
      }
    } else {
      // Format is not active, add it
      this.activeFormats[format] = true;
      this.isContinuousFormatting = true;
    }
  }
  
  /**
   * Update active formats based on selection or command state
   */
  private static updateActiveFormats(format: string) {
    // For toggle formats, check their state
    const isActive = document.queryCommandState(format);
    
    if (isActive) {
      this.activeFormats[format] = true;
    } else {
      delete this.activeFormats[format];
    }
    
    // Update continuous formatting flag
    this.isContinuousFormatting = Object.keys(this.activeFormats).length > 0;
  }
  
  /**
   * Update active formats based on current selection
   */
  public static updateFormatsFromSelection(): Record<string, boolean> {
    if (!this.contentElement) {
      console.error('[TextFormatter] No content element set');
      return {};
    }
    
    // Check if selection is in our content element
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) {
      return this.activeFormats;
    }
    
    const range = selection.getRangeAt(0);
    const isValidSelection = this.validateSelectionInContent(range, this.contentElement);
    
    if (!isValidSelection) {
      return this.activeFormats;
    }
    
    // Check standard formats
    const formats = ['bold', 'italic', 'underline'];
    formats.forEach(format => {
      const isActive = document.queryCommandState(format);
      
      if (isActive) {
        this.activeFormats[format] = true;
      } else {
        delete this.activeFormats[format];
      }
    });
    
    // Update continuous formatting state if we have a non-collapsed selection
    // A collapsed selection is just a cursor, non-collapsed is actual selected text
    if (!selection.isCollapsed && Object.keys(this.activeFormats).length > 0) {
      this.isContinuousFormatting = true;
    }
    
    return this.activeFormats;
  }
  
  /**
   * Check if a selection is valid within our content element
   */
  private static validateSelectionInContent(range: Range, contentElement: HTMLElement): boolean {
    // Check if the range's common ancestor is within our content element
    const isContained = contentElement.contains(range.commonAncestorContainer);
    
    // Also check parent node in case of text nodes
    const parentContained = 
      range.commonAncestorContainer.nodeType === Node.TEXT_NODE && 
      contentElement.contains(range.commonAncestorContainer.parentNode);
    
    return isContained || parentContained;
  }
  
  /**
   * Get HTML content with formatting preserved
   */
  public static getFormattedContent(element: HTMLElement): string {
    return element.innerHTML;
  }
  
  /**
   * Set HTML content with formatting preserved
   */
  public static setFormattedContent(element: HTMLElement, content: string): void {
    element.innerHTML = content;
  }
  
  /**
   * Clear all formatting from selected text
   */
  public static clearFormatting(): boolean {
    // Reset active formats
    this.resetState();
    
    // Apply the removeFormat command
    return document.execCommand('removeFormat', false);
  }
  
  /**
   * Get the current active formats
   */
  public static getActiveFormats(): Record<string, boolean> {
    return { ...this.activeFormats };
  }
  
  /**
   * Get the continuous formatting state
   */
  public static getContinuousFormatting(): boolean {
    return this.isContinuousFormatting;
  }
  
  /**
   * Set the continuous formatting state
   */
  public static setContinuousFormatting(state: boolean): void {
    this.isContinuousFormatting = state;
  }
}

// Export a singleton instance
export const TextFormatterInstance = new TextFormatter(); 