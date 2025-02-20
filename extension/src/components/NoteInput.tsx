import React from 'react';
import { Attachment } from '../lib/Attachment';
import { AttachmentOperation } from './AttachmentOperation';

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
  const handleTitleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onTitleChange(e.target.value);
  };

  const handleContentChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    onContentChange(e.target.value);
  };

  const formatFileSize = (size?: number): string => {
    if (!size) return '';
    const units = ['B', 'KB', 'MB', 'GB'];
    let value = size;
    let unitIndex = 0;
    while (value >= 1024 && unitIndex < units.length - 1) {
      value /= 1024;
      unitIndex++;
    }
    return `${Math.round(value * 10) / 10} ${units[unitIndex]}`;
  };

  const formatDate = (dateStr: string): string => {
    return new Date(dateStr).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  return (
    <div className="note-container">
      <input
        type="text"
        className="note-title-input"
        placeholder="Note title (optional)"
        value={title}
        onChange={handleTitleChange}
      />
      <textarea 
        className="note-input"
        placeholder="Start typing your note..."
        value={content}
        onChange={handleContentChange}
      />
      {attachments && attachments.length > 0 && (
        <div className="attachments-section">
          <div className="attachments-header">
            <span className="attachments-title">
              Attachments ({attachments.length})
            </span>
          </div>
          <div className="attachments-grid">
            {attachments.map((attachment) => (
              <AttachmentOperation
                key={attachment.id}
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