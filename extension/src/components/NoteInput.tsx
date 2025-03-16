import React, { useEffect, useState, useRef, useCallback } from 'react';
import { Attachment } from '../lib/Attachment';
import { AttachmentOperation } from './AttachmentOperation';
import FormatToolbar from './FormatToolbar';
import { TextFormatter } from '../lib/TextFormatter';
import { ListFormatter } from '../lib/ListFormatter';
import '../styles/components/note-input.css';
import '../styles/components/list-formatting.css';

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
  onAttachmentSectionExpandedChange
}) => {
  const [isLoadingAttachments, setIsLoadingAttachments] = useState(false);
  const [isAttachmentSectionExpanded, setIsAttachmentSectionExpanded] = useState(propIsExpanded ?? false);
  const titleRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [lastSelectionRange, setLastSelectionRange] = useState<Range | null>(null);
  
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
      }
    }
  }, [title, content]);

  // Save selection when user clicks in the content area
  const saveSelection = useCallback(() => {
    if (!contentRef.current) return;
  
    const selection = window.getSelection();
    if (selection && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      
      // Only save if selection is within our content
      if (contentRef.current.contains(range.commonAncestorContainer)) {
        setLastSelectionRange(range.cloneRange());
      }
    }
  }, []);
  
  // Restore selection if needed
  const restoreSelection = useCallback(() => {
    if (!contentRef.current || !lastSelectionRange) return;
    
    const selection = window.getSelection();
    if (selection) {
      try {
        selection.removeAllRanges();
        selection.addRange(lastSelectionRange.cloneRange());
        return true;
      } catch (e) {
        console.error('[NoteInput] Error restoring selection:', e);
      }
    }
    return false;
  }, [lastSelectionRange]);

  // Keep track of selection changes
  useEffect(() => {
    const handleSelectionChange = () => {
      if (!contentRef.current) return;
      saveSelection();
    };
    
    document.addEventListener('selectionchange', handleSelectionChange);
    return () => {
      document.removeEventListener('selectionchange', handleSelectionChange);
    };
  }, [saveSelection]);

  const handleTitleInput = (e: React.FormEvent<HTMLDivElement>) => {
    if (titleRef.current) {
      const newTitle = titleRef.current.textContent || '';
      onTitleChange(newTitle);
    }
  };

  const handleContentInput = (e: React.FormEvent<HTMLDivElement>) => {
    if (contentRef.current) {
      // Get formatted content including HTML
      const formattedContent = TextFormatter.getFormattedContent(contentRef.current);
      onContentChange(formattedContent);
      
      // After content input, attempt to apply active formats
      // This ensures formatting is applied after manual editing or browser auto-correction
      setTimeout(() => {
        if (contentRef.current && contentRef.current.contains(document.activeElement)) {
          TextFormatter.applyActiveFormats();
        }
      }, 0);
    }
  };
  
  const handleFormatChange = () => {
    // When formatting is applied, we need to trigger content change
    if (contentRef.current) {
      const formattedContent = TextFormatter.getFormattedContent(contentRef.current);
      onContentChange(formattedContent);
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
    if (e.currentTarget === contentRef.current) {
      // Save selection on mouse down in content area
      saveSelection();
    }
  };
  
  const handleClick = (e: React.MouseEvent) => {
    if (e.currentTarget === contentRef.current) {
      // Ensure focus is in the content area
      contentRef.current.focus();
      
      // Save selection on click
      saveSelection();
    }
  };
  
  const handleFocus = (e: React.FocusEvent) => {
    // When focusing content area, restore last selection if possible
    if (e.currentTarget === contentRef.current) {
      restoreSelection();
    }
  };
  
  const handleBlur = (e: React.FocusEvent) => {
    // Save selection on blur
    if (e.currentTarget === contentRef.current) {
      saveSelection();
    }
  };

  // Determine if we should show the attachments panel
  const hasAttachments = attachments && attachments.length > 0;

  return (
    <div className="note-input-container">
      <div className={`note-content-section ${hasAttachments && !isAttachmentSectionExpanded ? 'with-collapsed-attachments' : ''}`}>
        {/* Add the formatting toolbar at the top */}
        <FormatToolbar 
          contentRef={contentRef}
          onFormatChange={handleFormatChange}
        />
        
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