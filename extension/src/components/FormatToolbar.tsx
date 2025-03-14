import React, { useEffect, useRef, useState } from 'react';
import { TextFormatter } from '../lib/TextFormatter';
import '../styles/components/format-toolbar.css';

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

interface FormatToolbarProps {
  contentRef: React.RefObject<HTMLDivElement>;
  onFormatChange?: () => void;
}

const FormatToolbar: React.FC<FormatToolbarProps> = ({ contentRef, onFormatChange }) => {
  const [formatState, setFormatState] = useState<Record<string, string | boolean>>({});
  const [isContinuousFormatting, setIsContinuousFormatting] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);
  const [showFormatPopup, setShowFormatPopup] = useState(false);
  
  // Refs for popup positioning and click outside detection
  const formatButtonRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  
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
    } catch (e) {
      console.error('[FormatToolbar] Error restoring selection:', e);
    }
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
        
        // Save valid selection for later use
        lastSelectionRef.current = range.cloneRange();
        
        // Update format state from selection
        const newFormatState = TextFormatter.updateFormatsFromSelection();
        setFormatState(newFormatState);
        
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
  
  // Handle click outside to close popup
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        popupRef.current && 
        !popupRef.current.contains(event.target as Node) &&
        formatButtonRef.current && 
        !formatButtonRef.current.contains(event.target as Node)
      ) {
        setShowFormatPopup(false);
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
    
    // If no text is selected, insert some test text
    if (selection.toString().length === 0) {
      document.execCommand('insertText', false, 'Test formatting text');
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
      console.error(`Error executing command: ${command}`, error);
      return false;
    }
  };
  
  // Handle formatting option click
  const handleFormatClick = (command: string) => {
    if (!contentRef.current) {
      console.error('[FormatToolbar] No content element available');
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
  
  // Handle clearing all formatting
  const handleClearFormatting = () => {
    if (!contentRef.current) {
      console.error('[FormatToolbar] No content element available');
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
          
          // Reset our state
          setFormatState({});
          setIsContinuousFormatting(false);
          
          // Notify parent of format change
          if (onFormatChange) {
            onFormatChange();
          }
        } else {
          // Clear formatting anyway
          const success = TextFormatter.clearFormatting();
          
          // Reset our state
          setFormatState({});
          setIsContinuousFormatting(false);
          
          // Notify parent of format change
          if (onFormatChange) {
            onFormatChange();
          }
        }
        
        // Close popup after clearing
        setShowFormatPopup(false);
      }, 10);
      
      return;
    }
    
    // If already focused, restore selection if needed
    if (lastSelectionRef.current) {
      restoreSelection();
    }
    
    // Clear formatting
    const success = TextFormatter.clearFormatting();
    
    // Reset our state
    setFormatState({});
    setIsContinuousFormatting(false);
    
    // Notify parent of format change
    if (onFormatChange) {
      onFormatChange();
    }
    
    // Close popup after clearing
    setShowFormatPopup(false);
  };
  
  // Toggle format popup
  const toggleFormatPopup = () => {
    setShowFormatPopup(prev => !prev);
  };
  
  // Check if any formatting is active
  const hasActiveFormatting = Object.values(formatState).some(value => !!value);
  
  // Direct button click handler that works
  const directButtonClickHandler = (e: Event) => {
    const button = e.currentTarget as HTMLButtonElement;
    
    // Prevent default behavior and stop propagation
    e.preventDefault();
    e.stopPropagation();
    
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
    }
  };
  
  const directButtonMouseDownHandler = (e: Event) => {
    // Prevent default behavior and stop propagation to avoid losing focus
    e.preventDefault();
    e.stopPropagation();
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
      
      {/* Format popup */}
      {showFormatPopup && (
        <div 
          className="format-popup" 
          ref={popupRef}
        >
          {/* Formatting options */}
          {FORMATTING_OPTIONS.map((option) => (
            <button
              key={option.name}
              className={`format-popup-button ${formatState[option.command] ? 'active' : ''}`}
              title={option.name}
              onClick={(e) => {
                e.stopPropagation(); // Try to prevent the popup from closing
                handleFormatClick(option.command);
              }}
              style={{ position: 'relative', zIndex: 1000 }} // Ensure buttons are above other elements
            >
              {option.icon}
            </button>
          ))}
          
          {/* Clear formatting button */}
          <button
            className="format-popup-button clear-format-button"
            title="Clear Formatting"
            onClick={(e) => {
              e.stopPropagation(); // Try to prevent the popup from closing
              handleClearFormatting();
            }}
            style={{ position: 'relative', zIndex: 1000 }} // Ensure button is above other elements
          >
            Clear
          </button>
        </div>
      )}
    </div>
  );
};

export default FormatToolbar; 