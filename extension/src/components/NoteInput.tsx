import React, { useEffect, useState, useRef } from 'react';
import { Attachment } from '../lib/Attachment';
import { AttachmentOperation } from './AttachmentOperation';
import '../styles/components/note-input.css';

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
}

const NoteInput: React.FC<NoteInputProps> = ({
  title,
  content,
  attachments,
  onTitleChange,
  onContentChange,
  onAttachmentAdd,
  onAttachmentRemove
}) => {
  const [isLoadingAttachments, setIsLoadingAttachments] = useState(false);
  const titleRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  
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
    if (titleRef.current && titleRef.current.textContent !== title) {
      titleRef.current.textContent = title;
    }
    if (contentRef.current && contentRef.current.textContent !== content) {
      contentRef.current.textContent = content;
    }
  }, [title, content]);

  const handleTitleInput = (e: React.FormEvent<HTMLDivElement>) => {
    
    if (titleRef.current) {
      onTitleChange(titleRef.current.textContent || '');
    }
  };

  const handleContentInput = (e: React.FormEvent<HTMLDivElement>) => {
    
    if (contentRef.current) {
      onContentChange(contentRef.current.textContent || '');
    }
  };
  
  const handleKeyDown = (e: React.KeyboardEvent) => {};
  const handleMouseDown = (e: React.MouseEvent) => {};
  const handleClick = (e: React.MouseEvent) => {};
  const handleFocus = (e: React.FocusEvent) => {};
  const handleBlur = (e: React.FocusEvent) => {};

  return (
    <div className="note-input">
      <div 
        ref={titleRef}
        className="title-input-seamless"
        contentEditable
        onInput={handleTitleInput}
        onKeyDown={handleKeyDown}
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
        onMouseDown={handleMouseDown}
        onClick={handleClick}
        onFocus={handleFocus}
        onBlur={handleBlur}
        data-placeholder="Start typing your note here..."
        suppressContentEditableWarning
      ></div>
      
      {isLoadingAttachments && (
        <div className="attachments-loading">
          Loading attachments...
        </div>
      )}
      
      {attachments && attachments.length > 0 && (
        <div className="attachments-container">
          <h3>Attachments</h3>
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
        </div>
      )}
    </div>
  );
};

export default NoteInput; 