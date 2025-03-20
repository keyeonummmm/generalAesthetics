/**
 * SpreadsheetFormatter.ts
 * Handles the creation and manipulation of lightweight spreadsheet grids in the editor
 */

export class SpreadsheetFormatter {
  // Track state per tab using a tabId key
  private static contentElements: Map<string, HTMLElement | null> = new Map();
  private static currentFocusedCells: Map<string, HTMLTableCellElement | null> = new Map();
  private static userInteracted: Map<string, boolean> = new Map();
  
  /**
   * Initialize the formatter with the content element for a specific tab
   */
  public static initialize(contentElement: HTMLElement, tabId: string): void {
    this.contentElements.set(tabId, contentElement);
    this.currentFocusedCells.set(tabId, null);
    this.userInteracted.set(tabId, false);
  }

  /**
   * Clean up resources for a specific tab when it's closed
   */
  public static cleanup(tabId: string): void {
    this.contentElements.delete(tabId);
    this.currentFocusedCells.delete(tabId);
    this.userInteracted.delete(tabId);
  }
  
  /**
   * Insert a new spreadsheet at the current selection or at the end of the content
   */
  public static insertSpreadsheet(tabId: string): boolean {
    const contentElement = this.contentElements.get(tabId);
    if (!contentElement) {
      console.error('[SpreadsheetFormatter] No content element available for tab', tabId);
      return false;
    }
    
    // Create a new spreadsheet with 2x2 grid
    const spreadsheetElement = this.createSpreadsheetElement(2, 2, tabId);
    
    // Get current selection
    const selection = window.getSelection();
    if (selection && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      
      // Check if selection is within our content area
      if (contentElement.contains(range.commonAncestorContainer)) {
        // Insert at current selection
        range.deleteContents();
        range.insertNode(spreadsheetElement);
        
        // Set selection after the spreadsheet
        range.setStartAfter(spreadsheetElement);
        range.setEndAfter(spreadsheetElement);
        selection.removeAllRanges();
        selection.addRange(range);
        
        // Don't automatically focus - wait for user interaction
        // Only focus if user has already interacted with something
        if (this.userInteracted.get(tabId)) {
          this.focusFirstCell(spreadsheetElement, tabId);
        }
        return true;
      }
    }
    
    // If there's no valid selection, append to the end
    contentElement.appendChild(spreadsheetElement);
    
    // Don't automatically focus - wait for user interaction
    // Only focus if user has already interacted with something
    if (this.userInteracted.get(tabId)) {
      this.focusFirstCell(spreadsheetElement, tabId);
    }
    return true;
  }
  
  /**
   * Create a new spreadsheet element with the specified number of rows and columns
   */
  private static createSpreadsheetElement(rows: number, columns: number, tabId: string): HTMLElement {
    // Create container
    const container = document.createElement('div');
    container.className = 'ga-spreadsheet-container';
    container.setAttribute('contenteditable', 'false');
    
    // Generate a unique ID for the spreadsheet
    const spreadsheetId = `spreadsheet-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    container.setAttribute('data-spreadsheet-id', spreadsheetId);
    
    // Also store the tab ID to link this spreadsheet to its tab
    container.setAttribute('data-tab-id', tabId);
    
    // Create column controls
    const columnControls = document.createElement('div');
    columnControls.className = 'ga-spreadsheet-column-controls';
    
    const columnControlsInner = document.createElement('div');
    columnControlsInner.className = 'ga-spreadsheet-controls-inner';
    
    const removeColumnBtn = document.createElement('button');
    removeColumnBtn.className = 'ga-spreadsheet-control-btn';
    removeColumnBtn.textContent = '-';
    removeColumnBtn.title = 'Remove column';
    removeColumnBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.removeColumn(container);
    });
    
    const addColumnBtn = document.createElement('button');
    addColumnBtn.className = 'ga-spreadsheet-control-btn';
    addColumnBtn.textContent = '+';
    addColumnBtn.title = 'Add column';
    addColumnBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.addColumn(container);
    });
    
    columnControlsInner.appendChild(removeColumnBtn);
    columnControlsInner.appendChild(addColumnBtn);
    columnControls.appendChild(columnControlsInner);
    container.appendChild(columnControls);
    
    // Create row controls
    const rowControls = document.createElement('div');
    rowControls.className = 'ga-spreadsheet-row-controls';
    
    const rowControlsInner = document.createElement('div');
    rowControlsInner.className = 'ga-spreadsheet-controls-inner';
    
    const removeRowBtn = document.createElement('button');
    removeRowBtn.className = 'ga-spreadsheet-control-btn';
    removeRowBtn.textContent = '-';
    removeRowBtn.title = 'Remove row';
    removeRowBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.removeRow(container);
    });
    
    const addRowBtn = document.createElement('button');
    addRowBtn.className = 'ga-spreadsheet-control-btn';
    addRowBtn.textContent = '+';
    addRowBtn.title = 'Add row';
    addRowBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.addRow(container);
    });
    
    rowControlsInner.appendChild(removeRowBtn);
    rowControlsInner.appendChild(addRowBtn);
    rowControls.appendChild(rowControlsInner);
    container.appendChild(rowControls);
    
    // Create table and grid
    const table = document.createElement('table');
    table.className = 'ga-spreadsheet-table';
    container.appendChild(table);
    
    // Create rows and cells
    for (let i = 0; i < rows; i++) {
      const row = document.createElement('tr');
      
      for (let j = 0; j < columns; j++) {
        const cell = document.createElement('td');
        cell.className = 'ga-spreadsheet-cell';
        cell.setAttribute('contenteditable', 'true');
        cell.dataset.rowIndex = i.toString();
        cell.dataset.colIndex = j.toString();
        
        cell.addEventListener('keydown', (e) => {
          this.userInteracted.set(tabId, true);
          this.handleCellKeydown(e);
        });
        
        // Add focus and blur events for tracking
        cell.addEventListener('focus', (e) => {
          this.currentFocusedCells.set(tabId, cell);
        });
        
        cell.addEventListener('blur', (e) => {
          if (this.currentFocusedCells.get(tabId) === cell) {
            this.currentFocusedCells.set(tabId, null);
          }
        });
        
        // Add mousedown handler to ensure cell gets focus
        cell.addEventListener('mousedown', (e) => {
          this.userInteracted.set(tabId, true);
          e.stopPropagation();
          
          // Don't focus here as it can interfere with click event
          // Let the click event handle the focus
          
          // Mark that this cell should be focused on click
          cell.dataset.shouldFocus = 'true';
          
          // Moved focus to click handler for better browser compatibility
        });
        
        // Add click handler to ensure cell maintains focus
        cell.addEventListener('click', (e) => {
          this.userInteracted.set(tabId, true);
          // Prevent event from bubbling up
          e.stopPropagation();
          
          // Ensure this cell gets focused - this is critical
          this.currentFocusedCells.set(tabId, cell);
          cell.focus();
          
          // Clear the shouldFocus flag
          cell.dataset.shouldFocus = 'false';
          
          // Simpler cursor placement logic that's more reliable
          if (e.target === cell) {
            const selection = window.getSelection();
            if (selection) {
              try {
                // If cell has text, place cursor at appropriate position
                if (cell.textContent && cell.firstChild && cell.firstChild.nodeType === Node.TEXT_NODE) {
                  const range = document.createRange();
                  const textNode = cell.firstChild as Text;
                  const offset = this.getOffsetAtPoint(textNode, e.clientX);
                  range.setStart(textNode, offset);
                  range.collapse(true);
                  selection.removeAllRanges();
                  selection.addRange(range);
                } else {
                  // Empty cell, just focus it
                  const range = document.createRange();
                  range.selectNodeContents(cell);
                  range.collapse(true);
                  selection.removeAllRanges();
                  selection.addRange(range);
                }
              } catch (err) {
                // If anything goes wrong, just make sure it's focused
                cell.focus();
              }
            }
          }
          
          // Use setTimeout to double-check focus remains on the cell
          setTimeout(() => {
            if (document.activeElement !== cell) {
              cell.focus();
            }
          }, 50);
        });
        
        row.appendChild(cell);
      }
      
      table.appendChild(row);
    }
    
    // Make the container selectable as a whole, but only if clicking directly on container or table
    container.addEventListener('click', (e) => {
      this.userInteracted.set(tabId, true);
      const target = e.target as HTMLElement;
      
      
      if (e.target === container || e.target === table) {
        this.selectSpreadsheet(container);
      }
    });
    
    return container;
  }
  
  /**
   * Helper to get text offset at a specific x coordinate
   */
  private static getOffsetAtPoint(node: Node, x: number): number {
    if (node.nodeType !== Node.TEXT_NODE) return 0;
    
    const textNode = node as Text;
    const range = document.createRange();
    const textContent = textNode.textContent || '';
    
    // Try each character position until we find the right one
    for (let i = 0; i <= textContent.length; i++) {
      range.setStart(textNode, 0);
      range.setEnd(textNode, i);
      const rect = range.getBoundingClientRect();
      if (x <= rect.right) {
        return i;
      }
    }
    
    return textContent.length;
  }
  
  /**
   * Handle keydown events in spreadsheet cells
   */
  private static handleCellKeydown(e: KeyboardEvent): void {
    const cell = e.target as HTMLTableCellElement;
    const row = cell.parentElement as HTMLTableRowElement;
    const table = row.parentElement as HTMLTableElement;
    
    // Get cell position
    const rowIndex = Array.from(table.rows).indexOf(row);
    const cellIndex = Array.from(row.cells).indexOf(cell);

    // Navigation with Tab and arrow keys
    if (e.key === 'Tab') {
      e.preventDefault();
      
      if (e.shiftKey) {
        // Move to previous cell or last cell of previous row
        if (cellIndex > 0) {
          row.cells[cellIndex - 1].focus();
        } else if (rowIndex > 0) {
          const prevRow = table.rows[rowIndex - 1];
          prevRow.cells[prevRow.cells.length - 1].focus();
        }
      } else {
        // Move to next cell or first cell of next row
        if (cellIndex < row.cells.length - 1) {
          row.cells[cellIndex + 1].focus();
        } else if (rowIndex < table.rows.length - 1) {
          table.rows[rowIndex + 1].cells[0].focus();
        }
      }
    }
    
    // Add arrow key navigation
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft' || 
        e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      
      // Only override arrow keys if at boundaries or with modifier keys
      const selection = window.getSelection();
      if (!selection) return;
      
      const isAtStart = selection.focusOffset === 0;
      const isAtEnd = cell.textContent && 
                      selection.focusOffset === (cell.textContent.length);
      
      // Handle arrow keys with modifiers or at text boundaries
      if (e.ctrlKey || e.metaKey || e.altKey || 
          (e.key === 'ArrowLeft' && isAtStart) || 
          (e.key === 'ArrowRight' && isAtEnd) ||
          e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        
        e.preventDefault();
        
        if (e.key === 'ArrowLeft' && isAtStart) {
          // Move to previous cell
          if (cellIndex > 0) {
            row.cells[cellIndex - 1].focus();
          } else if (rowIndex > 0) {
            const prevRow = table.rows[rowIndex - 1];
            prevRow.cells[prevRow.cells.length - 1].focus();
          }
        } else if (e.key === 'ArrowRight' && isAtEnd) {
          // Move to next cell
          if (cellIndex < row.cells.length - 1) {
            row.cells[cellIndex + 1].focus();
          } else if (rowIndex < table.rows.length - 1) {
            table.rows[rowIndex + 1].cells[0].focus();
          }
        } else if (e.key === 'ArrowUp') {
          // Move to cell above
          if (rowIndex > 0) {
            const targetCell = table.rows[rowIndex - 1].cells[
              Math.min(cellIndex, table.rows[rowIndex - 1].cells.length - 1)
            ];
            targetCell.focus();
          }
        } else if (e.key === 'ArrowDown') {
          // Move to cell below
          if (rowIndex < table.rows.length - 1) {
            const targetCell = table.rows[rowIndex + 1].cells[
              Math.min(cellIndex, table.rows[rowIndex + 1].cells.length - 1)
            ];
            targetCell.focus();
          }
        }
      }
    }
  }
  
  /**
   * Add a new column to the spreadsheet
   */
  private static addColumn(container: HTMLElement): void {
    const table = container.querySelector('table') as HTMLTableElement;
    if (!table) return;
    
    // Get the tab ID from the container
    const tabId = container.getAttribute('data-tab-id') || 'default';
    
    // Add a cell to each row
    Array.from(table.rows).forEach((row, rowIndex) => {
      const cellIndex = row.cells.length;
      const cell = document.createElement('td');
      cell.className = 'ga-spreadsheet-cell';
      cell.setAttribute('contenteditable', 'true');
      cell.dataset.rowIndex = rowIndex.toString();
      cell.dataset.colIndex = cellIndex.toString();
      
      // Add same event listeners as in createSpreadsheetElement
      cell.addEventListener('keydown', (e) => {
        this.userInteracted.set(tabId, true);
        this.handleCellKeydown(e);
      });
      
      // Add focus and blur events for tracking
      cell.addEventListener('focus', (e) => {
        this.currentFocusedCells.set(tabId, cell);
      });
      
      cell.addEventListener('blur', (e) => {
        if (this.currentFocusedCells.get(tabId) === cell) {
          this.currentFocusedCells.set(tabId, null);
        }
      });
      
      cell.addEventListener('mousedown', (e) => {
        this.userInteracted.set(tabId, true);
        e.stopPropagation();
        cell.dataset.shouldFocus = 'true';
      });
      
      cell.addEventListener('click', (e) => {
        this.userInteracted.set(tabId, true);
        e.stopPropagation();
        this.currentFocusedCells.set(tabId, cell);
        cell.focus();
        
        // Simpler cursor placement logic
        if (e.target === cell) {
          const selection = window.getSelection();
          if (selection) {
            try {
              if (cell.textContent && cell.firstChild && cell.firstChild.nodeType === Node.TEXT_NODE) {
                const range = document.createRange();
                const textNode = cell.firstChild as Text;
                const offset = this.getOffsetAtPoint(textNode, e.clientX);
                range.setStart(textNode, offset);
                range.collapse(true);
                selection.removeAllRanges();
                selection.addRange(range);
              } else {
                const range = document.createRange();
                range.selectNodeContents(cell);
                range.collapse(true);
                selection.removeAllRanges();
                selection.addRange(range);
              }
            } catch (err) {
              cell.focus();
            }
          }
        }
        
        // Double-check focus remains
        setTimeout(() => {
          if (document.activeElement !== cell) {
            cell.focus();
          }
        }, 50);
      });
      
      row.appendChild(cell);
    });
    
    // Update data attributes to reflect new column count
    const columns = table.rows[0]?.cells.length || 0;
    container.setAttribute('data-columns', columns.toString());
  }
  
  /**
   * Remove a column from the spreadsheet
   */
  private static removeColumn(container: HTMLElement): void {
    const table = container.querySelector('table') as HTMLTableElement;
    if (!table || table.rows[0].cells.length <= 1) return; // Minimum 1 column
    
    // Remove the last cell from each row
    Array.from(table.rows).forEach(row => {
      row.deleteCell(row.cells.length - 1);
    });
    
    // Update data attributes to reflect new column count
    const columns = table.rows[0]?.cells.length || 0;
    container.setAttribute('data-columns', columns.toString());
  }
  
  /**
   * Add a new row to the spreadsheet
   */
  private static addRow(container: HTMLElement): void {
    const table = container.querySelector('table') as HTMLTableElement;
    if (!table) return;
    
    // Get the tab ID from the container
    const tabId = container.getAttribute('data-tab-id') || 'default';
    
    const rowIndex = table.rows.length;
    const columnCount = table.rows[0].cells.length;
    const newRow = table.insertRow();
    
    // Add cells to the new row
    for (let i = 0; i < columnCount; i++) {
      const cell = newRow.insertCell();
      cell.className = 'ga-spreadsheet-cell';
      cell.setAttribute('contenteditable', 'true');
      cell.dataset.rowIndex = rowIndex.toString();
      cell.dataset.colIndex = i.toString();
      
      // Add same event listeners as in createSpreadsheetElement
      cell.addEventListener('keydown', (e) => {
        this.userInteracted.set(tabId, true);
        this.handleCellKeydown(e);
      });
      
      // Add focus and blur events for tracking
      cell.addEventListener('focus', (e) => {
        this.currentFocusedCells.set(tabId, cell);
      });
      
      cell.addEventListener('blur', (e) => {
        if (this.currentFocusedCells.get(tabId) === cell) {
          this.currentFocusedCells.set(tabId, null);
        }
      });
      
      cell.addEventListener('mousedown', (e) => {
        this.userInteracted.set(tabId, true);
        e.stopPropagation();
        cell.dataset.shouldFocus = 'true';
      });
      
      cell.addEventListener('click', (e) => {
        this.userInteracted.set(tabId, true);
        e.stopPropagation();
        this.currentFocusedCells.set(tabId, cell);
        cell.focus();
        
        // Simpler cursor placement logic
        if (e.target === cell) {
          const selection = window.getSelection();
          if (selection) {
            try {
              if (cell.textContent && cell.firstChild && cell.firstChild.nodeType === Node.TEXT_NODE) {
                const range = document.createRange();
                const textNode = cell.firstChild as Text;
                const offset = this.getOffsetAtPoint(textNode, e.clientX);
                range.setStart(textNode, offset);
                range.collapse(true);
                selection.removeAllRanges();
                selection.addRange(range);
              } else {
                const range = document.createRange();
                range.selectNodeContents(cell);
                range.collapse(true);
                selection.removeAllRanges();
                selection.addRange(range);
              }
            } catch (err) {
              cell.focus();
            }
          }
        }
        
        // Double-check focus remains
        setTimeout(() => {
          if (document.activeElement !== cell) {
            cell.focus();
          }
        }, 50);
      });
    }
  }
  
  /**
   * Remove a row from the spreadsheet
   */
  private static removeRow(container: HTMLElement): void {
    const table = container.querySelector('table') as HTMLTableElement;
    if (!table || table.rows.length <= 1) return; // Minimum 1 row
    
    // Remove the last row
    table.deleteRow(table.rows.length - 1);
  }
  
  /**
   * Focus the first cell in the spreadsheet
   */
  private static focusFirstCell(spreadsheetElement: HTMLElement, tabId: string): void {
    const firstCell = spreadsheetElement.querySelector('td') as HTMLTableCellElement;
    if (firstCell) {
      
      this.currentFocusedCells.set(tabId, firstCell);
      firstCell.focus();
    
      // Double-check focus in case it gets lost
      setTimeout(() => {
        if (document.activeElement !== firstCell) {
          firstCell.focus();
        }
      }, 50);
    }
  }
  
  /**
   * Select the entire spreadsheet
   */
  private static selectSpreadsheet(spreadsheetElement: HTMLElement): void {
    // Get the tab ID from the container
    const tabId = spreadsheetElement.getAttribute('data-tab-id') || 'default';
    
    const selection = window.getSelection();
    if (selection) {
      // Clear any current cell focus
      if (this.currentFocusedCells.get(tabId) && document.activeElement === this.currentFocusedCells.get(tabId)) {
        this.currentFocusedCells.set(tabId, null);
      }
      
      const range = document.createRange();
      range.selectNode(spreadsheetElement);
      selection.removeAllRanges();
      selection.addRange(range);
    }
  }
  
  /**
   * Check if the element is a spreadsheet
   */
  public static isSpreadsheet(element: HTMLElement): boolean {
    return element.classList.contains('ga-spreadsheet-container');
  }
  
  /**
   * Get the current focused cell for a specific tab
   */
  public static getCurrentFocusedCell(tabId: string): HTMLTableCellElement | null {
    return this.currentFocusedCells.get(tabId) || null;
  }
  
  /**
   * Set user interaction state for a specific tab
   */
  public static setUserInteracted(tabId: string, value: boolean): void {
    this.userInteracted.set(tabId, value);
  }
  
  /**
   * Regenerate the unique ID for a spreadsheet
   * This is useful when we need to clone a spreadsheet
   */
  public static regenerateSpreadsheetId(spreadsheetElement: HTMLElement, newTabId?: string): void {
    const newId = `spreadsheet-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    spreadsheetElement.setAttribute('data-spreadsheet-id', newId);
    
    // Update tab ID if provided
    if (newTabId) {
      spreadsheetElement.setAttribute('data-tab-id', newTabId);
    }
  }
  
  /**
   * Serialize all spreadsheets in the content
   */
  public static serializeSpreadsheets(contentElement: HTMLElement): void {
    if (!contentElement) return;
    
    const spreadsheets = contentElement.querySelectorAll('.ga-spreadsheet-container');
    
    spreadsheets.forEach(spreadsheet => {
      const table = spreadsheet.querySelector('table');
      if (table) {
        // Set data attributes for rows and columns to help with deserialization
        spreadsheet.setAttribute('data-rows', table.rows.length.toString());
        spreadsheet.setAttribute('data-columns', table.rows[0]?.cells.length.toString() || '2');
        // Add a special attribute to mark this as a spreadsheet
        spreadsheet.setAttribute('data-spreadsheet', 'true');
        
        // Ensure spreadsheet has a unique ID
        if (!spreadsheet.hasAttribute('data-spreadsheet-id')) {
          const spreadsheetId = `spreadsheet-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
          spreadsheet.setAttribute('data-spreadsheet-id', spreadsheetId);
        }
        
        // Store cell content as data attributes
        for (let i = 0; i < table.rows.length; i++) {
          const row = table.rows[i];
          for (let j = 0; j < row.cells.length; j++) {
            const cell = row.cells[j];
            cell.setAttribute('data-content', cell.innerHTML);
          }
        }
      }
    });
  }
  
  /**
   * Deserialize all spreadsheets in the content
   */
  public static deserializeSpreadsheets(contentElement: HTMLElement, tabId: string): void {
    if (!contentElement) return;
    
    const spreadsheets = contentElement.querySelectorAll('.ga-spreadsheet-container');
    
    spreadsheets.forEach(spreadsheet => {
      // If this is just a serialized placeholder, recreate the full spreadsheet
      if (!spreadsheet.querySelector('.ga-spreadsheet-controls-inner')) {
        const rows = parseInt(spreadsheet.getAttribute('data-rows') || '2', 10);
        const columns = parseInt(spreadsheet.getAttribute('data-columns') || '2', 10);
        
        // Replace with a new fully functional spreadsheet
        const newSpreadsheet = this.createSpreadsheetElement(rows, columns, tabId);
        
        // Copy the spreadsheet ID if it exists
        const spreadsheetId = spreadsheet.getAttribute('data-spreadsheet-id');
        if (spreadsheetId) {
          newSpreadsheet.setAttribute('data-spreadsheet-id', spreadsheetId);
        }
        
        // Explicitly set the tab ID
        newSpreadsheet.setAttribute('data-tab-id', tabId);
        
        // Copy cell content from data attributes
        const oldTable = spreadsheet.querySelector('table');
        const newTable = newSpreadsheet.querySelector('table');
        
        if (oldTable && newTable) {
          for (let i = 0; i < rows; i++) {
            if (i < oldTable.rows.length && i < newTable.rows.length) {
              const oldRow = oldTable.rows[i];
              const newRow = newTable.rows[i];
              
              for (let j = 0; j < columns; j++) {
                if (j < oldRow.cells.length && j < newRow.cells.length) {
                  const oldCell = oldRow.cells[j];
                  const newCell = newRow.cells[j];
                  
                  // Copy content
                  const content = oldCell.getAttribute('data-content');
                  if (content) {
                    newCell.innerHTML = content;
                  }
                }
              }
            }
          }
        }
        // Replace the old spreadsheet with the new one
        spreadsheet.parentNode?.replaceChild(newSpreadsheet, spreadsheet);
      }
    });
  }
  
  /**
   * Refresh control handlers for all spreadsheets in the content
   * This is useful when switching tabs to ensure the add/remove buttons have fresh event handlers
   */
  public static refreshControlHandlers(contentElement: HTMLElement, tabId: string): void {
    if (!contentElement) return;
    
    const spreadsheets = contentElement.querySelectorAll('.ga-spreadsheet-container');
    
    spreadsheets.forEach(spreadsheet => {
      // Get the container reference
      const container = spreadsheet as HTMLElement;
      
      // Refresh column control buttons
      const addColumnBtn = container.querySelector('.ga-spreadsheet-column-controls .ga-spreadsheet-control-btn:nth-child(2)');
      const removeColumnBtn = container.querySelector('.ga-spreadsheet-column-controls .ga-spreadsheet-control-btn:nth-child(1)');
      
      // Refresh row control buttons
      const addRowBtn = container.querySelector('.ga-spreadsheet-row-controls .ga-spreadsheet-control-btn:nth-child(2)');
      const removeRowBtn = container.querySelector('.ga-spreadsheet-row-controls .ga-spreadsheet-control-btn:nth-child(1)');
      
      // Clear and reattach event listeners for column controls
      if (addColumnBtn) {
        const newAddColumnBtn = addColumnBtn.cloneNode(true) as HTMLElement;
        addColumnBtn.replaceWith(newAddColumnBtn);
        newAddColumnBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.addColumn(container);
        });
      }
      
      if (removeColumnBtn) {
        const newRemoveColumnBtn = removeColumnBtn.cloneNode(true) as HTMLElement;
        removeColumnBtn.replaceWith(newRemoveColumnBtn);
        newRemoveColumnBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.removeColumn(container);
        });
      }
      
      // Clear and reattach event listeners for row controls
      if (addRowBtn) {
        const newAddRowBtn = addRowBtn.cloneNode(true) as HTMLElement;
        addRowBtn.replaceWith(newAddRowBtn);
        newAddRowBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.addRow(container);
        });
      }
      
      if (removeRowBtn) {
        const newRemoveRowBtn = removeRowBtn.cloneNode(true) as HTMLElement;
        removeRowBtn.replaceWith(newRemoveRowBtn);
        newRemoveRowBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.removeRow(container);
        });
      }
    });
  }
  
  /**
   * Clone all spreadsheets in the content and ensure each has a unique ID
   * This is useful when duplicating content between tabs
   */
  public static cloneSpreadsheets(contentElement: HTMLElement, newTabId: string): void {
    if (!contentElement) return;
    
    const spreadsheets = contentElement.querySelectorAll('.ga-spreadsheet-container');
    
    spreadsheets.forEach(spreadsheet => {
      // Generate a new unique ID for each spreadsheet
      const newId = `spreadsheet-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
      spreadsheet.setAttribute('data-spreadsheet-id', newId);
      
      // Update the tab ID to the new tab
      spreadsheet.setAttribute('data-tab-id', newTabId);
    });
  }
} 