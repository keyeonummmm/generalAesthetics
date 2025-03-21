import { TextFormatter } from './TextFormatter';

/**
 * ListFormatter provides methods for formatting text as different types of lists
 */
export class ListFormatter {
  /**
   * Format selected text as a bulleted list
   * @returns boolean indicating success
   */
  public static formatBulletedList(): boolean {
    // Check if we're already in a list
    const listState = this.getListFormatState();
    
    // If we're in a different type of list, convert it
    if (listState.numberedList) {
      // First remove the current list formatting
      this.removeListFormatting();
      
      // Then apply the new list formatting
      return this.createList('bullet');
    }
    
    // If we're already in a bulleted list, do nothing
    if (listState.bulletedList) {
      return true;
    }
    
    // If no text is selected, apply to current line
    const selection = window.getSelection();
    if (selection && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      if (range.collapsed) {
        // Get the current line
        const currentLine = this.getCurrentLine();
        if (currentLine) {
          // Select the current line
          this.selectLine(currentLine);
          
          // Apply the list formatting
          const result = this.createList('bullet');
          
          // Restore cursor position
          this.restoreCursorToLine();
          
          return result;
        }
      }
    }
    
    // Otherwise, apply to selected text
    return this.createList('bullet');
  }

  /**
   * Format selected text as a numbered list
   * @returns boolean indicating success
   */
  public static formatNumberedList(): boolean {
    // Check if we're already in a list
    const listState = this.getListFormatState();
    
    // If we're in a different type of list, convert it
    if (listState.bulletedList) {
      // First remove the current list formatting
      this.removeListFormatting();
      
      // Then apply the new list formatting
      return this.createList('number');
    }
    
    // If we're already in a numbered list, do nothing
    if (listState.numberedList) {
      return true;
    }
    
    // If no text is selected, apply to current line
    const selection = window.getSelection();
    if (selection && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      if (range.collapsed) {
        // Get the current line
        const currentLine = this.getCurrentLine();
        if (currentLine) {
          // Select the current line
          this.selectLine(currentLine);
          
          // Apply the list formatting
          const result = this.createList('number');
          
          // Restore cursor position
          this.restoreCursorToLine();
          
          return result;
        }
      }
    }
    
    // Otherwise, apply to selected text
    return this.createList('number');
  }
  
  /**
   * Create a list of the specified type
   * @param listType The type of list to create ('bullet', 'number', or 'dash')
   * @returns boolean indicating success
   */
  private static createList(listType: 'bullet' | 'number'): boolean {
    try {
      let success = false;
      
      // First create a standard list using execCommand
      if (listType === 'bullet') {
        success = document.execCommand('insertUnorderedList', false);
      } else if (listType === 'number') {
        success = document.execCommand('insertOrderedList', false);
      }
      return success;
    } catch (error) {
      console.error(`Error creating ${listType} list:`, error);
      return false;
    }
  }

  /**
   * Check if the current selection is within a list
   * @returns object with list type information
   */
  public static getListFormatState(): { bulletedList: boolean; numberedList: boolean } {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) {
      return { bulletedList: false, numberedList: false };
    }
    
    const range = selection.getRangeAt(0);
    const container = range.commonAncestorContainer;
    
    // Find the closest list element
    let listElement = container.nodeType === Node.TEXT_NODE 
      ? container.parentElement 
      : container as HTMLElement;
    
    // Traverse up to find list elements
    while (listElement && listElement.nodeName !== 'UL' && listElement.nodeName !== 'OL') {
      listElement = listElement.parentElement;
    }
    
    if (!listElement) {
      return { bulletedList: false, numberedList: false };
    }
    
    // Determine list type
    const isBulletedList = listElement.nodeName === 'UL';
    const isNumberedList = listElement.nodeName === 'OL';
    
    return {
      bulletedList: isBulletedList,
      numberedList: isNumberedList
    };
  }

  /**
   * Remove list formatting from the current selection
   * @returns boolean indicating success
   */
  public static removeListFormatting(): boolean {
    const listState = this.getListFormatState();
    
    // For all list types, use execCommand('outdent')
    return document.execCommand('outdent', false);
  }
  
  /**
   * Exit from a list at the current cursor position
   * This is typically called when the user presses Enter at the end of an empty list item
   * @returns boolean indicating success
   */
  public static exitList(): boolean {
    const listState = this.getListFormatState();
    
    // If we're not in a list, do nothing
    if (!listState.bulletedList && !listState.numberedList) {
      return false;
    }
    
    // Get the current selection
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) {
      return false;
    }
    
    const range = selection.getRangeAt(0);
    const container = range.commonAncestorContainer;
    
    // Find the list item
    let listItem = container.nodeType === Node.TEXT_NODE 
      ? container.parentElement 
      : container as HTMLElement;
    
    while (listItem && listItem.nodeName !== 'LI') {
      listItem = listItem.parentElement;
    }
    
    // If we found a list item, check if it's empty
    if (listItem) {
      const isEmpty = !listItem.textContent || listItem.textContent.trim() === '';
      
      if (isEmpty) {
        // Remove the list formatting for this item
        return this.removeListFormatting();
      }
    }
    
    return false;
  }
  
  /**
   * Get the current line element where the cursor is positioned
   * @returns The line element or null if not found
   */
  private static getCurrentLine(): HTMLElement | null {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) {
      return null;
    }
    
    const range = selection.getRangeAt(0);
    const container = range.commonAncestorContainer;
    
    // If the container is a text node, get its parent
    let currentNode = container.nodeType === Node.TEXT_NODE 
      ? container.parentElement 
      : container as HTMLElement;
    
    // Check if we're already in a list item
    let listItem = currentNode;
    while (listItem && listItem.nodeName !== 'LI') {
      listItem = listItem.parentElement;
    }
    
    if (listItem) {
      return listItem;
    }
    
    // If we're not in a list item, find the current block element
    // (paragraph, div, etc.)
    const blockElements = ['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6'];
    
    while (currentNode && !blockElements.includes(currentNode.nodeName)) {
      currentNode = currentNode.parentElement;
    }
    
    return currentNode;
  }
  
  /**
   * Select the entire line
   * @param lineElement The line element to select
   */
  private static selectLine(lineElement: HTMLElement): void {
    const selection = window.getSelection();
    if (!selection) {
      return;
    }
    
    const range = document.createRange();
    range.selectNodeContents(lineElement);
    
    selection.removeAllRanges();
    selection.addRange(range);
  }
  
  /**
   * Restore cursor to the end of the current line
   */
  private static restoreCursorToLine(): void {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) {
      return;
    }
    
    const range = selection.getRangeAt(0);
    range.collapse(false); // Collapse to the end
    
    selection.removeAllRanges();
    selection.addRange(range);
  }
  
  /**
   * Check if the cursor is at the end of a list item
   * @returns boolean indicating if cursor is at the end of a list item
   */
  public static isCursorAtEndOfListItem(): boolean {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) {
      return false;
    }
    
    const range = selection.getRangeAt(0);
    
    // Check if the selection is collapsed (cursor)
    if (!range.collapsed) {
      return false;
    }
    
    const container = range.commonAncestorContainer;
    
    // Find the list item
    let listItem = container.nodeType === Node.TEXT_NODE 
      ? container.parentElement 
      : container as HTMLElement;
    
    while (listItem && listItem.nodeName !== 'LI') {
      listItem = listItem.parentElement;
    }
    
    // If we're not in a list item, return false
    if (!listItem) {
      return false;
    }
    
    // Check if the cursor is at the end of the list item
    if (container.nodeType === Node.TEXT_NODE) {
      const textNode = container as Text;
      return range.startOffset === textNode.length;
    } else {
      return range.startOffset === container.childNodes.length;
    }
  }
  
  /**
   * Check if the current list item is empty
   * @returns boolean indicating if the current list item is empty
   */
  public static isCurrentListItemEmpty(): boolean {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) {
      return false;
    }
    
    const range = selection.getRangeAt(0);
    const container = range.commonAncestorContainer;
    
    // Find the list item
    let listItem = container.nodeType === Node.TEXT_NODE 
      ? container.parentElement 
      : container as HTMLElement;
    
    while (listItem && listItem.nodeName !== 'LI') {
      listItem = listItem.parentElement;
    }
    
    // If we're not in a list item, return false
    if (!listItem) {
      return false;
    }
    
    // Check if the list item is empty
    return !listItem.textContent || listItem.textContent.trim() === '';
  }
}