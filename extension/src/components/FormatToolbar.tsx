import React, { useEffect, useRef, useState } from 'react';
import { TextFormatter } from '../lib/TextFormatter';
import { ListFormatter } from '../lib/ListFormatter';
import { SpreadsheetFormatter } from '../lib/SpreadsheetFormatter';
import '../styles/components/format-toolbar.css';
import '../styles/components/list-formatting.css';
import '../styles/components/spreadsheet.css';

// Toolbar options
const FORMATTING_OPTIONS = [
  {
    name: 'Bold',
    icon: '𝐁',
    command: 'bold'
  },
  {
    name: 'Italic',
    icon: '𝐈',
    command: 'italic'
  },
  {
    name: 'Underline',
    icon: '𝑈',
    command: 'underline'
  }
];

// List formatting options
const LIST_OPTIONS = [
  {
    name: 'Bulleted List',
    icon: '•',
    command: 'bulletedList'
  },
  {
    name: 'Numbered List',
    icon: '1.',
    command: 'numberedList'
  }
];

interface FormatToolbarProps {
  contentRef: React.RefObject<HTMLDivElement>;
  onFormatChange?: (event?: { type: string, isEmpty?: boolean }) => void;
  standalone?: boolean; // New prop to control rendering style
}

const FormatToolbar: React.FC<FormatToolbarProps> = ({ contentRef, onFormatChange, standalone = false }) => {
  const [formatState, setFormatState] = useState<Record<string, string | boolean>>({});
  const [listFormatState, setListFormatState] = useState<{
    bulletedList: boolean;
    numberedList: boolean;
  }>({
    bulletedList: false,
    numberedList: false
  });
  const [isContinuousFormatting, setIsContinuousFormatting] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);
  const [showFormatPopup, setShowFormatPopup] = useState(false);
  const [showListPopup, setShowListPopup] = useState(false);
  
  // Refs for popup positioning and click outside detection
  const formatButtonRef = useRef<HTMLButtonElement>(null);
  const listButtonRef = useRef<HTMLButtonElement>(null);
  const spreadsheetButtonRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const listPopupRef = useRef<HTMLDivElement>(null);
  
  // Save selection for other operations
  const lastSelectionRef = useRef<Range | null>(null);
  
  // Helper to save current selection
  const saveSelection = () => {
    const selection = window.getSelection();
    if (selection && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      lastSelectionRef.current = range.cloneRange();
    }
  };
  
  // Helper to restore the selection
  const restoreSelection = (): boolean => {
    if (!lastSelectionRef.current) {
      return false;
    }
    
    try {
      const selection = window.getSelection();
      if (selection) {
        selection.removeAllRanges();
        selection.addRange(lastSelectionRef.current.cloneRange());
        
        
        return true;
      }
    } catch (e) {}
    return false;
  };
  
  // Initialize TextFormatter with content element when it's available
  useEffect(() => {
    if (contentRef.current && !isInitialized) {
      TextFormatter.initialize(contentRef.current);
      setIsInitialized(true);
    }
  }, [contentRef, isInitialized]);
  
  // Handle selection changes to update format state
  useEffect(() => {
    const handleSelectionChange = () => {
      if (!contentRef.current) {
        return;
      }
      
      const selection = window.getSelection();
      if (!selection) {
        return;
      }
      
      // Check if selection is within our content area
      if (selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        
        // Enhanced selection detection - check both direct containment and parent node
        const isInContent = contentRef.current.contains(range.commonAncestorContainer) || 
                            (range.commonAncestorContainer.nodeType === Node.TEXT_NODE && 
                             contentRef.current.contains(range.commonAncestorContainer.parentNode));
        
        if (!isInContent) {
          return;
        }
        
        // Check if we're in a spreadsheet cell
        const inSpreadsheetCell = 
          (range.commonAncestorContainer as Element)?.closest?.('.ga-spreadsheet-cell') ||
          (range.commonAncestorContainer.parentElement as Element)?.closest?.('.ga-spreadsheet-cell');
        
        if (inSpreadsheetCell) {
          return;
        }
        
        // Save valid selection for later use
        lastSelectionRef.current = range.cloneRange();
        
        // Update format state from selection
        const newFormatState = TextFormatter.updateFormatsFromSelection();
        setFormatState(newFormatState);
        
        // Update list format state
        const newListFormatState = ListFormatter.getListFormatState();
        setListFormatState(newListFormatState);
        
        // Update continuous formatting state
        const isContinuous = TextFormatter.getContinuousFormatting();
        setIsContinuousFormatting(isContinuous);
      }
    };
    
    // Update on initial render and when selection changes
    handleSelectionChange();
    
    document.addEventListener('selectionchange', handleSelectionChange);
    return () => {
      document.removeEventListener('selectionchange', handleSelectionChange);
    };
  }, [contentRef]);
  
  // Handle click outside to close popups
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      // Handle format popup
      if (
        popupRef.current && 
        !popupRef.current.contains(event.target as Node) &&
        formatButtonRef.current && 
        !formatButtonRef.current.contains(event.target as Node)
      ) {
        setShowFormatPopup(false);
      }
      
      // Handle list popup
      if (
        listPopupRef.current && 
        !listPopupRef.current.contains(event.target as Node) &&
        listButtonRef.current && 
        !listButtonRef.current.contains(event.target as Node)
      ) {
        setShowListPopup(false);
      }
    };
    
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);
  
  // Direct execCommand functionality that works
  const applyFormatDirectly = (command: string) => {
    if (!contentRef.current) {
      return false;
    }
    
    // Focus the content element
    contentRef.current.focus();
    
    // Get current selection
    const selection = window.getSelection();
    if (!selection) {
      return false;
    }
    
    // Apply the format directly using execCommand
    try {
      const result = document.execCommand(command, false);
      
      // Update content after command
      if (contentRef.current) {
        const formattedContent = TextFormatter.getFormattedContent(contentRef.current);
        
        // Notify parent of format change
        if (onFormatChange) {
          onFormatChange();
        }
      }
      
      return result;
    } catch (error) {
      return false;
    }
  };
  
  // Handle formatting option click
  const handleFormatClick = (command: string) => {
    if (!contentRef.current) {
      return;
    }
    
    // Save current selection before applying format
    saveSelection();
    
    // Focus the content area if not already focused
    if (document.activeElement !== contentRef.current) {
      contentRef.current.focus();
      
      // Give browser a moment to establish focus
      setTimeout(() => {
        // Restore selection if needed
        if (lastSelectionRef.current) {
          restoreSelection();
          
          // Now apply the format
          const success = TextFormatter.applyFormat(command);
          
          // Update our state to reflect the new active formats
          const newFormatState = TextFormatter.getActiveFormats();
          setFormatState(newFormatState);
          
          // Update continuous formatting state
          const isContinuous = TextFormatter.getContinuousFormatting();
          setIsContinuousFormatting(isContinuous);
          
          // Notify parent of format change
          if (onFormatChange) {
            onFormatChange();
          }
        } else {
          // Apply the format anyway
          const success = TextFormatter.applyFormat(command);
          
          // Update our state to reflect the new active formats
          const newFormatState = TextFormatter.getActiveFormats();
          setFormatState(newFormatState);
          
          // Update continuous formatting state
          const isContinuous = TextFormatter.getContinuousFormatting();
          setIsContinuousFormatting(isContinuous);
          
          // Notify parent of format change
          if (onFormatChange) {
            onFormatChange();
          }
        }
      }, 10);
      
      return;
    }
    
    // If already focused, restore selection if needed
    if (lastSelectionRef.current) {
      restoreSelection();
    }
    
    // Apply the format
    const success = TextFormatter.applyFormat(command);

    // Update our state to reflect the new active formats
    const newFormatState = TextFormatter.getActiveFormats();
    setFormatState(newFormatState);
    
    // Update continuous formatting state
    const isContinuous = TextFormatter.getContinuousFormatting();
    setIsContinuousFormatting(isContinuous);
    
    // Notify parent of format change
    if (onFormatChange) {
      onFormatChange();
    }
    
    // Keep popup open for continued formatting
  };
  
  // Handle list formatting option click
  const handleListFormatClick = (command: string) => {
    if (!contentRef.current) {
      return;
    }
    
    // Save current selection before applying format
    saveSelection();
    
    // Focus the content area if not already focused
    if (document.activeElement !== contentRef.current) {
      contentRef.current.focus();
      
      // Give browser a moment to establish focus
      setTimeout(() => {
        // Restore selection if needed
        if (lastSelectionRef.current) {
          restoreSelection();
          
          // Apply the list format based on command
          applyListFormat(command);
        } else {
          // Apply the list format anyway
          applyListFormat(command);
        }
      }, 10);
      
      return;
    }
    
    // If already focused, restore selection if needed
    if (lastSelectionRef.current) {
      restoreSelection();
    }
    
    // Apply the list format
    applyListFormat(command);
    
    // Close the list popup after applying format
    setShowListPopup(false);
  };
  
  // Add a helper method to apply list formatting
  const applyListFormat = (command: string) => {
    let success = false;
    
    // Get the current list state to check if we're converting between list types
    const currentListState = ListFormatter.getListFormatState();
    
    // Apply the appropriate list format
    if (command === 'bulletedList') {
      success = ListFormatter.formatBulletedList();
    } else if (command === 'numberedList') {
      success = ListFormatter.formatNumberedList();
    }
    
    // Update list format state
    const newListFormatState = ListFormatter.getListFormatState();
    setListFormatState(newListFormatState);
    
    // Notify parent of format change
    if (onFormatChange) {
      onFormatChange();
    }
  };
  
  // Handle clearing all formatting
  const handleClearFormatting = () => {
    if (!contentRef.current) {
      return;
    }
    
    // Save current selection before clearing format
    saveSelection();
    
    // Focus the content area if not already focused
    if (document.activeElement !== contentRef.current) {
      contentRef.current.focus();
      
      // Give browser a moment to establish focus
      setTimeout(() => {
        // Restore selection if needed
        if (lastSelectionRef.current) {
          restoreSelection();
          
          // Clear formatting
          const success = TextFormatter.clearFormatting();
          
          // Also clear list formatting if present
          const listState = ListFormatter.getListFormatState();
          if (listState.bulletedList || listState.numberedList) {
            ListFormatter.removeListFormatting();
          }
          
          // Reset our state
          setFormatState({});
          setIsContinuousFormatting(false);
          setListFormatState({
            bulletedList: false,
            numberedList: false
          });
          
          // Notify parent of format change
          if (onFormatChange) {
            onFormatChange();
          }
        } else {
          // Clear formatting anyway
          const success = TextFormatter.clearFormatting();
          
          // Also clear list formatting if present
          const listState = ListFormatter.getListFormatState();
          if (listState.bulletedList || listState.numberedList) {
            ListFormatter.removeListFormatting();
          }
          
          // Reset our state
          setFormatState({});
          setIsContinuousFormatting(false);
          setListFormatState({
            bulletedList: false,
            numberedList: false
          });
          
          // Notify parent of format change
          if (onFormatChange) {
            onFormatChange();
          }
        }
        
        // Close popups after clearing
        setShowFormatPopup(false);
        setShowListPopup(false);
      }, 10);
      
      return;
    }
    
    // If already focused, restore selection if needed
    if (lastSelectionRef.current) {
      restoreSelection();
    }
    
    // Clear formatting
    const success = TextFormatter.clearFormatting();
    
    // Also clear list formatting if present
    const listState = ListFormatter.getListFormatState();
    if (listState.bulletedList || listState.numberedList) {
      ListFormatter.removeListFormatting();
    }
    
    // Reset our state
    setFormatState({});
    setIsContinuousFormatting(false);
    setListFormatState({
      bulletedList: false,
      numberedList: false
    });
    
    // Notify parent of format change
    if (onFormatChange) {
      onFormatChange();
    }
    
    // Close popups after clearing
    setShowFormatPopup(false);
    setShowListPopup(false);
  };
  
  // Toggle format popup
  const toggleFormatPopup = () => {
    setShowFormatPopup(prev => !prev);
    // Close list popup if open
    if (showListPopup) {
      setShowListPopup(false);
    }
  };
  
  // Toggle list popup
  const toggleListPopup = () => {
    setShowListPopup(prev => !prev);
    // Close format popup if open
    if (showFormatPopup) {
      setShowFormatPopup(false);
    }
  };
  
  // Check if any formatting is active
  const hasActiveFormatting = Object.values(formatState).some(value => !!value);
  
  // Check if any list formatting is active
  const hasActiveListFormatting = Object.values(listFormatState).some(value => !!value);
  
  // Direct button click handler that works
  const directButtonClickHandler = (e: Event) => {
    const button = e.currentTarget as HTMLButtonElement;
    
    // Prevent default behavior and stop propagation
    e.preventDefault();
    e.stopPropagation();
    
    
    // Notify SpreadsheetFormatter of user interaction
    SpreadsheetFormatter.setUserInteracted(true);
    
    // Apply formatting directly based on button title
    if (button.title === 'Bold') {
      applyFormatDirectly('bold');
    } else if (button.title === 'Italic') {
      applyFormatDirectly('italic');
    } else if (button.title === 'Underline') {
      applyFormatDirectly('underline');
    } else if (button.title === 'Clear Formatting') {
      applyFormatDirectly('removeFormat');
      setShowFormatPopup(false);
      setShowListPopup(false);
    } else if (button.title === 'Bulleted List') {
      ListFormatter.formatBulletedList();
      setShowListPopup(false);
    } else if (button.title === 'Numbered List') {
      ListFormatter.formatNumberedList();
      setShowListPopup(false);
    }
  };
  
  const directButtonMouseDownHandler = (e: Event) => {
    // Prevent default behavior and stop propagation to avoid losing focus
    e.preventDefault();
    e.stopPropagation();
    
    // Notify SpreadsheetFormatter of user interaction
    SpreadsheetFormatter.setUserInteracted(true);
  };
  
  // Add direct DOM event listeners when popup is shown
  useEffect(() => {
    if (showFormatPopup && popupRef.current) {
      const node = popupRef.current;
      
      // Add direct DOM event listeners to detect clicks
      const buttons = node.querySelectorAll('button');
      buttons.forEach((button) => {
        // Remove any existing listeners first to avoid duplicates
        button.removeEventListener('click', directButtonClickHandler);
        button.removeEventListener('mousedown', directButtonMouseDownHandler);
        
        // Add new listeners
        button.addEventListener('click', directButtonClickHandler);
        button.addEventListener('mousedown', directButtonMouseDownHandler);
      });
    }
    
    return () => {
      // Clean up event listeners when popup is hidden
      if (popupRef.current) {
        const buttons = popupRef.current.querySelectorAll('button');
        buttons.forEach(button => {
          button.removeEventListener('click', directButtonClickHandler);
          button.removeEventListener('mousedown', directButtonMouseDownHandler);
        });
      }
    };
  }, [showFormatPopup]);
  
  // Add direct DOM event listeners for list popup
  useEffect(() => {
    if (showListPopup && listPopupRef.current) {
      const node = listPopupRef.current;
      
      // Add direct DOM event listeners to detect clicks
      const buttons = node.querySelectorAll('button');
      buttons.forEach((button) => {
        // Remove any existing listeners first to avoid duplicates
        button.removeEventListener('click', directButtonClickHandler);
        button.removeEventListener('mousedown', directButtonMouseDownHandler);
        
        // Add new listeners
        button.addEventListener('click', directButtonClickHandler);
        button.addEventListener('mousedown', directButtonMouseDownHandler);
      });
    }
    
    return () => {
      // Clean up event listeners when popup is hidden
      if (listPopupRef.current) {
        const buttons = listPopupRef.current.querySelectorAll('button');
        buttons.forEach(button => {
          button.removeEventListener('click', directButtonClickHandler);
          button.removeEventListener('mousedown', directButtonMouseDownHandler);
        });
      }
    };
  }, [showListPopup]);
  
  // Handle spreadsheet button click (placeholder for future implementation)
  const handleSpreadsheetClick = () => {
    if (!contentRef.current) {
      return;
    }
    
    // Notify SpreadsheetFormatter of user interaction
    SpreadsheetFormatter.setUserInteracted(true);
    
    // Save current selection before applying format
    saveSelection();
    

    // Focus the content area if not already focused
    if (document.activeElement !== contentRef.current) {
      contentRef.current.focus();
      
      // Give browser a moment to establish focus
      setTimeout(() => {
        // Restore selection if needed
        if (lastSelectionRef.current) {
          const restored = restoreSelection();

          // Insert spreadsheet at selection
          const success = SpreadsheetFormatter.insertSpreadsheet();
          
          // Make sure to serialize the spreadsheet immediately after insertion
          // This ensures the spreadsheet data is captured in the content
          if (success && contentRef.current) {
            setTimeout(() => {
              if (contentRef.current) {
                SpreadsheetFormatter.serializeSpreadsheets(contentRef.current);
              }
              
              // Notify parent of format change with explicit spreadsheet flag
              if (onFormatChange) {
                // Use a special event object to indicate this is a spreadsheet insertion
                onFormatChange({
                  type: 'spreadsheet-insert',
                  isEmpty: true
                });
              }
            }, 50);
          } else {
            // Notify parent of format change anyway
            if (onFormatChange) {
              onFormatChange();
            }
          }
        } else {
          // Insert spreadsheet anyway
          const success = SpreadsheetFormatter.insertSpreadsheet();
          
          // Make sure to serialize the spreadsheet immediately after insertion
          if (success && contentRef.current) {
            setTimeout(() => {
              if (contentRef.current) {
                SpreadsheetFormatter.serializeSpreadsheets(contentRef.current);
              }
              
              // Notify parent of format change with explicit spreadsheet flag
              if (onFormatChange) {
                // Use a special event object to indicate this is a spreadsheet insertion
                onFormatChange({
                  type: 'spreadsheet-insert',
                  isEmpty: true
                });
              }
            }, 50);
          } else {
            // Notify parent of format change anyway
            if (onFormatChange) {
              onFormatChange();
            }
          }
        }
      }, 10);
      
      return;
    }
    
    // If already focused, restore selection if needed
    if (lastSelectionRef.current) {
      const restored = restoreSelection();
    }
    
    // Insert spreadsheet
    const success = SpreadsheetFormatter.insertSpreadsheet();
    
    // Make sure to serialize the spreadsheet immediately after insertion
    if (success && contentRef.current) {
      setTimeout(() => {
        if (contentRef.current) {
          SpreadsheetFormatter.serializeSpreadsheets(contentRef.current);
        }
        
        // Notify parent of format change with explicit spreadsheet flag
        if (onFormatChange) {
          // Use a special event object to indicate this is a spreadsheet insertion
          onFormatChange({
            type: 'spreadsheet-insert',
            isEmpty: true
          });
        }
      }, 50);
    } else {
      // Notify parent of format change anyway
      if (onFormatChange) {
        onFormatChange();
      }
    }
  };
  
  // Render just the buttons if standalone mode is enabled
  if (standalone) {
    return (
      <div className="format-toolbar-standalone">
        {/* Main format button (Aa) */}
        <button
          ref={formatButtonRef}
          className={`format-button format-main-button ${hasActiveFormatting ? 'has-active-format' : ''}`}
          title="Text Formatting"
          onClick={toggleFormatPopup}
        >
          Aa
        </button>
        
        {/* List format button */}
        <button
          ref={listButtonRef}
          className={`format-button list-button ${hasActiveListFormatting ? 'has-active-format' : ''}`}
          title="List Formatting"
          onClick={toggleListPopup}
        >
          ≡
        </button>
        
        {/* Spreadsheet button */}
        <button
          ref={spreadsheetButtonRef}
          className="format-button spreadsheet-button"
          title="Spreadsheet"
          onClick={handleSpreadsheetClick}
        >
          ⊞
        </button>
        
        {/* Format popup */}
        {showFormatPopup && (
          <div 
            className="format-popup" 
            ref={popupRef}
          >
            {/* Formatting options */}
            <div className="format-popup-buttons">
              {FORMATTING_OPTIONS.map((option) => (
                <button
                  key={option.name}
                  className={`format-popup-button ${formatState[option.command] ? 'active' : ''}`}
                  title={option.name}
                  onClick={(e) => {
                    e.stopPropagation(); // Try to prevent the popup from closing
                    handleFormatClick(option.command);
                  }}
                >
                  <span className="icon">{option.icon}</span>
                  <span className="label">{option.name}</span>
                </button>
              ))}
              <button
                className="format-popup-button clear-format-button"
                title="Clear Formatting"
                onClick={(e) => {
                  e.stopPropagation(); // Try to prevent the popup from closing
                  handleClearFormatting();
                }}
              >
                <span className="icon">✕</span>
                <span className="label">Clear</span>
              </button>
            </div>
          </div>
        )}
        
        {/* List popup */}
        {showListPopup && (
          <div 
            className="list-popup" 
            ref={listPopupRef}
          >
            {/* List formatting options */}
            {LIST_OPTIONS.map((option) => (
              <button
                key={option.name}
                className={`list-popup-button ${listFormatState[option.command as keyof typeof listFormatState] ? 'active' : ''}`}
                title={option.name}
                onClick={(e) => {
                  e.stopPropagation(); // Try to prevent the popup from closing
                  handleListFormatClick(option.command);
                }}
              >
                <span className="icon">{option.icon}</span>
                <span className="label">{option.name}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }
  
  // Regular toolbar rendering
  return (
    <div className="format-toolbar">
      {/* Main format button (Aa) */}
      <button
        ref={formatButtonRef}
        className={`format-button format-main-button ${hasActiveFormatting ? 'has-active-format' : ''}`}
        title="Text Formatting"
        onClick={toggleFormatPopup}
      >
        Aa
      </button>
      
      {/* List format button */}
      <button
        ref={listButtonRef}
        className={`format-button list-button ${hasActiveListFormatting ? 'has-active-format' : ''}`}
        title="List Formatting"
        onClick={toggleListPopup}
      >
        ≡
      </button>
      
      {/* Spreadsheet button */}
      <button
        ref={spreadsheetButtonRef}
        className="format-button spreadsheet-button"
        title="Spreadsheet"
        onClick={handleSpreadsheetClick}
      >
        ⊞
      </button>
      
      {/* Format popup */}
      {showFormatPopup && (
        <div 
          className="format-popup" 
          ref={popupRef}
        >
          {/* Formatting options */}
          <div className="format-popup-buttons">
            {FORMATTING_OPTIONS.map((option) => (
              <button
                key={option.name}
                className={`format-popup-button ${formatState[option.command] ? 'active' : ''}`}
                title={option.name}
                onClick={(e) => {
                  e.stopPropagation(); // Try to prevent the popup from closing
                  handleFormatClick(option.command);
                }}
              >
                <span className="icon">{option.icon}</span>
                <span className="label">{option.name}</span>
              </button>
            ))}
            <button
              className="format-popup-button clear-format-button"
              title="Clear Formatting"
              onClick={(e) => {
                e.stopPropagation(); // Try to prevent the popup from closing
                handleClearFormatting();
              }}
            >
              <span className="icon">✕</span>
              <span className="label">Clear</span>
            </button>
          </div>
        </div>
      )}
      
      {/* List popup */}
      {showListPopup && (
        <div 
          className="list-popup" 
          ref={listPopupRef}
        >
          {/* List formatting options */}
          {LIST_OPTIONS.map((option) => (
            <button
              key={option.name}
              className={`list-popup-button ${listFormatState[option.command as keyof typeof listFormatState] ? 'active' : ''}`}
              title={option.name}
              onClick={(e) => {
                e.stopPropagation(); // Try to prevent the popup from closing
                handleListFormatClick(option.command);
              }}
            >
              <span className="icon">{option.icon}</span>
              <span className="label">{option.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default FormatToolbar; 