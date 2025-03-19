import React, { useEffect, useState, useRef, useCallback } from 'react';
import { Attachment } from '../lib/Attachment';
import { AttachmentOperation } from './AttachmentOperation';
import { TextFormatter } from '../lib/TextFormatter';
import { ListFormatter } from '../lib/ListFormatter';
import { SpreadsheetFormatter } from '../lib/SpreadsheetFormatter';
import '../styles/components/note-input.css';
import '../styles/components/list-formatting.css';
import '../styles/components/spreadsheet.css';

interface NoteInputProps {
  // Core note data only
  title: string;
  content: string;
  attachments?: Attachment[];
  noteId?: string;
  // Simple change handlers
  onTitleChange: (title: string) => void;
  onContentChange: (content: string) => void;
  onAttachmentAdd: (attachment: Attachment) => void;
  onAttachmentRemove: (attachment: Attachment) => void;
  // Attachment section expanded state
  isAttachmentSectionExpanded?: boolean;
  onAttachmentSectionExpandedChange?: (isExpanded: boolean) => void;
  // Format change handler
  onFormatChange?: (event?: { type: string, isEmpty?: boolean }) => void;
  // Add contentRef prop
  contentRef?: React.RefObject<HTMLDivElement>;
}

const NoteInput: React.FC<NoteInputProps> = ({
  title,
  content,
  attachments,
  onTitleChange,
  onContentChange,
  onAttachmentAdd,
  onAttachmentRemove,
  isAttachmentSectionExpanded: propIsExpanded,
  onAttachmentSectionExpandedChange,
  onFormatChange,
  contentRef: externalContentRef
}) => {
  const [isLoadingAttachments, setIsLoadingAttachments] = useState(false);
  const [isAttachmentSectionExpanded, setIsAttachmentSectionExpanded] = useState(propIsExpanded ?? false);
  const titleRef = useRef<HTMLDivElement>(null);
  // Use external ref if provided, otherwise create our own
  const contentRef = externalContentRef || useRef<HTMLDivElement>(null);
  const [lastSelectionRange, setLastSelectionRange] = useState<Range | null>(null);
  const [isInteractingWithSpreadsheet, setIsInteractingWithSpreadsheet] = useState(false);
  
  // Sync with prop value when it changes
  useEffect(() => {
    if (propIsExpanded !== undefined && propIsExpanded !== isAttachmentSectionExpanded) {
      setIsAttachmentSectionExpanded(propIsExpanded);
    }
  }, [propIsExpanded]);

  // Handle lazy loading of attachments if needed
  useEffect(() => {
    const loadLazyAttachments = async () => {
      if (!attachments || attachments.length === 0) return;
      
      // Check if any attachments need to be lazy loaded
      const needsLazyLoading = attachments.some(
        attachment => attachment.metadata?.isLazyLoaded && !attachment.screenshotData
      );
      
      if (needsLazyLoading) {
        setIsLoadingAttachments(true);
        try {
          // In a real implementation, this would load the full attachment data
          // For now, we'll just simulate a delay
          await new Promise(resolve => setTimeout(resolve, 1000));
        } finally {
          setIsLoadingAttachments(false);
        }
      }
    };
    
    loadLazyAttachments();
  }, [attachments]);

  // Update the contenteditable divs when props change
  useEffect(() => {
    if (titleRef.current) {
      // For title, we still use textContent as it should remain plain text
      if (titleRef.current.textContent !== title) {
        titleRef.current.textContent = title;
      }
    }
    
    if (contentRef.current) {
      // For content, we use innerHTML to preserve formatting
      // Only update if the content has changed to avoid cursor position issues
      if (contentRef.current.innerHTML !== content) {
        TextFormatter.setFormattedContent(contentRef.current, content);
        
        // Initialize spreadsheets after setting content
        setTimeout(() => {
          if (contentRef.current) {
            SpreadsheetFormatter.deserializeSpreadsheets(contentRef.current);
          }
        }, 0);
      }
    }
  }, [title, content]);

  // Initialize formatters when contentRef is available
  useEffect(() => {
    if (contentRef.current) {
      // Initialize TextFormatter
      TextFormatter.initialize(contentRef.current);
      
      // Initialize SpreadsheetFormatter
      SpreadsheetFormatter.initialize(contentRef.current);
    }
  }, [contentRef.current]);

  // Save selection when user clicks in the content area
  const saveSelection = useCallback(() => {
    if (!contentRef.current) return;
  
    const selection = window.getSelection();
    if (selection && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      
      // Only save if selection is within our content
      if (contentRef.current.contains(range.commonAncestorContainer)) {
        // Don't save selection if it's within a spreadsheet cell
        const cell = (range.commonAncestorContainer as Element)?.closest?.('.ga-spreadsheet-cell') ||
                    (range.commonAncestorContainer.parentElement as Element)?.closest?.('.ga-spreadsheet-cell');
      }
    }
  }, []);
  
  // Restore selection if needed
  const restoreSelection = useCallback(() => {
    if (!contentRef.current || !lastSelectionRange) return false;
    
    // Check if we're currently interacting with a spreadsheet
    if (isInteractingWithSpreadsheet) {
      return false;
    }
    
    // Check if a cell is already focused
    const focusedCell = SpreadsheetFormatter.getCurrentFocusedCell();
    if (focusedCell && document.activeElement === focusedCell) {
      return false;
    }
    
    const selection = window.getSelection();
    if (selection) {
      try {
        selection.removeAllRanges();
        selection.addRange(lastSelectionRange.cloneRange());
        return true;
      } catch (e) {}
    }
    return false;
  }, [lastSelectionRange, isInteractingWithSpreadsheet]);

  // Keep track of selection changes
  useEffect(() => {
    const handleSelectionChange = () => {
      if (!contentRef.current) return;
      
      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0) return;
      
      const range = selection.getRangeAt(0);
      
      // Check if selection is inside a spreadsheet cell
      const cell = (range.commonAncestorContainer as Element)?.closest?.('.ga-spreadsheet-cell') ||
                  (range.commonAncestorContainer.parentElement as Element)?.closest?.('.ga-spreadsheet-cell');
      
      if (cell) {
        setIsInteractingWithSpreadsheet(true);
        
        // Tell the SpreadsheetFormatter that user has interacted
        SpreadsheetFormatter.setUserInteracted(true);
      } else if (contentRef.current.contains(range.commonAncestorContainer)) {
        // Selection is in content area but not in a cell
        saveSelection();
        
        // If we were interacting with a spreadsheet before, we're not anymore
        if (isInteractingWithSpreadsheet) {
          setIsInteractingWithSpreadsheet(false);
        }
      }
    };
    
    document.addEventListener('selectionchange', handleSelectionChange);
    return () => {
      document.removeEventListener('selectionchange', handleSelectionChange);
    };
  }, [saveSelection, isInteractingWithSpreadsheet]);

  const handleTitleInput = (e: React.FormEvent<HTMLDivElement>) => {
    if (titleRef.current) {
      const newTitle = titleRef.current.textContent || '';
      onTitleChange(newTitle);
    }
  };

  const handleContentInput = (e: React.FormEvent<HTMLDivElement>) => {
    if (contentRef.current) {
      
      // Check if input is happening in a spreadsheet cell
      const target = e.target as Node;
      const cell = (target as Element)?.closest?.('.ga-spreadsheet-cell') ||
                  (target.parentElement as Element)?.closest?.('.ga-spreadsheet-cell');
      
      if (cell) {
        // Tell the SpreadsheetFormatter that user has interacted
        SpreadsheetFormatter.setUserInteracted(true);
        
        // Even for spreadsheet cell edits, we should serialize and update the content
        // This ensures changes in spreadsheet cells are captured in the tab cache
        setTimeout(() => {
          if (contentRef.current) {
            // Serialize any spreadsheets in the content
            SpreadsheetFormatter.serializeSpreadsheets(contentRef.current);
            
            // Get formatted content including HTML
            const formattedContent = TextFormatter.getFormattedContent(contentRef.current);
            onContentChange(formattedContent);
          }
        }, 0);
        
        return;
      }
      
      // Serialize any spreadsheets in the content before getting formatted content
      SpreadsheetFormatter.serializeSpreadsheets(contentRef.current);
      
      // Get formatted content including HTML
      const formattedContent = TextFormatter.getFormattedContent(contentRef.current);
      onContentChange(formattedContent);
      
      // After content input, attempt to apply active formats
      // This ensures formatting is applied after manual editing or browser auto-correction
      setTimeout(() => {
        if (contentRef.current && contentRef.current.contains(document.activeElement)) {
          // Don't apply text formatting if we're in a spreadsheet cell
          if (!isInteractingWithSpreadsheet) {
            TextFormatter.applyActiveFormats();
          }
        }
      }, 0);
    }
  };
  
  const handleFormatChange = (event?: { type: string, isEmpty?: boolean }) => {
    // When formatting is applied, we need to trigger content change
    if (contentRef.current) {
      // Check if this is a spreadsheet insertion event
      const isSpreadsheetInsert = event?.type === 'spreadsheet-insert';
      
      // First, serialize any spreadsheets to ensure they're captured in the content
      if (isSpreadsheetInsert) {
        SpreadsheetFormatter.serializeSpreadsheets(contentRef.current);
      }
      
      // Get formatted content including HTML
      const formattedContent = TextFormatter.getFormattedContent(contentRef.current);
      onContentChange(formattedContent);
      
      // Call the parent's format change handler if provided
      if (onFormatChange) {
        onFormatChange(event);
      }
    }
  };
  
  const toggleAttachmentSection = () => {
    const newExpandedState = !isAttachmentSectionExpanded;
    setIsAttachmentSectionExpanded(newExpandedState);
    
    // Notify parent component of the change
    if (onAttachmentSectionExpandedChange) {
      onAttachmentSectionExpandedChange(newExpandedState);
    }
  };
  
  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Set user interacted flag for SpreadsheetFormatter
    SpreadsheetFormatter.setUserInteracted(true);
    
    // Check if we're in a spreadsheet cell
    const target = e.target as Element;
    const cell = target.closest('.ga-spreadsheet-cell');
    
    if (cell) {
      return;
    }
    
    // Don't handle special keys for formatting
    if (e.ctrlKey || e.metaKey || e.altKey) {
      return;
    }
    
    // Don't apply formatting in the title
    if (e.currentTarget === titleRef.current) {
      return;
    }
    
    // Special handling for Enter key in lists
    if (e.key === 'Enter' && contentRef.current) {
      // Check if we're in a list
      const listState = ListFormatter.getListFormatState();
      if (listState.bulletedList || listState.numberedList) {
        // Check if the current list item is empty and cursor is at the end
        if (ListFormatter.isCurrentListItemEmpty() && ListFormatter.isCursorAtEndOfListItem()) {
          // Exit the list
          e.preventDefault(); // Prevent default Enter behavior
          ListFormatter.exitList();
          
          // Update the content
          if (contentRef.current) {
            const formattedContent = TextFormatter.getFormattedContent(contentRef.current);
            onContentChange(formattedContent);
          }
          
          return;
        }
        return;
      }
    }
    
    // Special handling for Tab key in lists for indentation
    if (e.key === 'Tab' && contentRef.current) {
      const listState = ListFormatter.getListFormatState();
      if (listState.bulletedList || listState.numberedList) {
        // Prevent default tab behavior
        e.preventDefault();
        
        // Apply indentation based on whether Shift is pressed
        if (e.shiftKey) {
          // Outdent (decrease indentation)
          document.execCommand('outdent', false);
        } else {
          // Indent (increase indentation)
          document.execCommand('indent', false);
        }
        
        // Update the content
        if (contentRef.current) {
          const formattedContent = TextFormatter.getFormattedContent(contentRef.current);
          onContentChange(formattedContent);
        }
        
        return;
      }
    }
  };
  
  // Handle "after" key events to apply formatting once text has been inserted
  const handleKeyUp = (e: React.KeyboardEvent) => {
    if (!contentRef.current) return;
    
    // Check if we're in a spreadsheet cell
    const target = e.target as Element;
    const cell = target.closest('.ga-spreadsheet-cell');

    // Ignore special keys and title input
    if (e.ctrlKey || e.metaKey || e.altKey || e.currentTarget === titleRef.current) {
      return;
    }
    
    // Apply formatting after text has been inserted
    // Only for character keys and Enter key
    const isChar = e.key.length === 1;
    const isEnter = e.key === 'Enter';
    
    if ((isChar || isEnter) && contentRef.current) {
      // Apply formatting
      TextFormatter.applyActiveFormats();
      
      // Also update the formatted content
      const formattedContent = TextFormatter.getFormattedContent(contentRef.current);
      onContentChange(formattedContent);
    }
  };
  
  // Handle paste events
  const handlePaste = (e: React.ClipboardEvent) => {
    // Set user interacted flag for SpreadsheetFormatter
    SpreadsheetFormatter.setUserInteracted(true);
    
    // Check if we're pasting into a spreadsheet cell
    const target = e.target as Element;
    const cell = target.closest('.ga-spreadsheet-cell');
    
    // Don't handle paste in title (only plain text)
    if (e.currentTarget === titleRef.current) {
      e.preventDefault();
      const text = e.clipboardData.getData('text/plain');
      document.execCommand('insertText', false, text);
      return;
    }
    
    // For content, handle rich text pasting
    if (e.currentTarget === contentRef.current) {
      
      // Let the default paste happen, but then apply active formats
      setTimeout(() => {
        
        // Apply active formats to the pasted content if in continuous formatting mode
        TextFormatter.applyActiveFormats();
        
        // Update the formatted content
        if (contentRef.current) {
          const formattedContent = TextFormatter.getFormattedContent(contentRef.current);
          onContentChange(formattedContent);
        }
      }, 0);
    }
  };
  
  const handleMouseDown = (e: React.MouseEvent) => {
    // Set user interacted flag for SpreadsheetFormatter
    SpreadsheetFormatter.setUserInteracted(true);
    
    if (e.currentTarget === contentRef.current) {
      // Check if the event target is a spreadsheet cell or within it
      const target = e.target as HTMLElement;
      const cell = target.closest('.ga-spreadsheet-cell');
      
      // For other elements, proceed with normal selection handling
      
      // If we were interacting with a spreadsheet before, we're not anymore
      if (isInteractingWithSpreadsheet) {
        setIsInteractingWithSpreadsheet(false);
      }
      
      saveSelection();
    }
  };
  
  const handleClick = (e: React.MouseEvent) => {
    // Set user interacted flag for SpreadsheetFormatter
    SpreadsheetFormatter.setUserInteracted(true);
    
    if (e.currentTarget === contentRef.current) {
      // Check if the event target is a spreadsheet cell or within it
      const target = e.target as HTMLElement;
      const cell = target.closest('.ga-spreadsheet-cell');
      const container = target.closest('.ga-spreadsheet-container');
      

      if (container) {
        setIsInteractingWithSpreadsheet(true);
        return;
      }

      // If we were interacting with a spreadsheet before, we're not anymore
      if (isInteractingWithSpreadsheet) {
        setIsInteractingWithSpreadsheet(false);
      }
      
      contentRef.current.focus();
      
      // Save selection on click
      saveSelection();
    }
  };
  
  const handleFocus = (e: React.FocusEvent) => {
    // When focusing content area, restore last selection if possible
    if (e.currentTarget === contentRef.current) {
      // Don't restore selection if focus is moving to a spreadsheet cell
      const activeElement = document.activeElement;
      if (activeElement && activeElement.classList.contains('ga-spreadsheet-cell')) {
        return;
      }
      
      
      // Only restore selection if we're not interacting with a spreadsheet
      if (!isInteractingWithSpreadsheet) {
        restoreSelection();
      }
    }
  };
  
  const handleBlur = (e: React.FocusEvent) => {
    // Save selection on blur, unless we're moving focus to a spreadsheet cell
    if (e.currentTarget === contentRef.current) {
      const relatedTarget = e.relatedTarget as HTMLElement;
      
      
      // Check if the new active element is a spreadsheet cell
      if (relatedTarget && relatedTarget.classList.contains('ga-spreadsheet-cell')) {
        // Set the interacting flag
        setIsInteractingWithSpreadsheet(true);
        return;
      }
      
      // If we're not moving to a spreadsheet cell, save selection
      if (!isInteractingWithSpreadsheet) {
        saveSelection();
      }
    }
  };

  // Determine if we should show the attachments panel
  const hasAttachments = attachments && attachments.length > 0;

  return (
    <div className="note-input-container">
      <div className={`note-content-section ${hasAttachments && !isAttachmentSectionExpanded ? 'with-collapsed-attachments' : ''}`}>
        <div 
          ref={titleRef}
          className="title-input-seamless"
          contentEditable
          onInput={handleTitleInput}
          onKeyDown={handleKeyDown}
          onKeyUp={handleKeyUp}
          onPaste={handlePaste}
          onMouseDown={handleMouseDown}
          onClick={handleClick}
          onFocus={handleFocus}
          onBlur={handleBlur}
          data-placeholder="Title"
          suppressContentEditableWarning
        ></div>
        
        <div 
          ref={contentRef}
          className="content-input-seamless"
          contentEditable
          onInput={handleContentInput}
          onKeyDown={handleKeyDown}
          onKeyUp={handleKeyUp}
          onPaste={handlePaste}
          onMouseDown={handleMouseDown}
          onClick={handleClick}
          onFocus={handleFocus}
          onBlur={handleBlur}
          data-placeholder="Content goes here..."
          suppressContentEditableWarning
        ></div>
      </div>
      
      {hasAttachments && (
        <div className={`attachments-section ${isAttachmentSectionExpanded ? 'expanded' : 'collapsed'}`}>
          <div className="attachments-header">
            <button 
              className="toggle-attachments-btn" 
              onClick={toggleAttachmentSection}
              title={isAttachmentSectionExpanded ? "Hide attachments" : "Show attachments"}
            >
              {isAttachmentSectionExpanded ? '▶' : '◀'}
            </button>
          </div>
          
          {isAttachmentSectionExpanded && (
            <>
              {isLoadingAttachments && (
                <div className="attachments-loading">
                  Loading...
                </div>
              )}
              <div className="attachments-list">
                {attachments.map((attachment, index) => (
                  <AttachmentOperation
                    key={`${attachment.id}-${index}`}
                    attachment={attachment}
                    onRemove={onAttachmentRemove}
                    isPending={attachment.syncStatus === 'pending'}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default NoteInput; 