import React from 'react';
import { NoteAttachment } from '../lib/notesDB';

interface NoteInputProps {
  // Core note data only
  title: string;
  content: string;
  attachments?: NoteAttachment[];
  noteId?: string;
  // Simple change handlers
  onTitleChange: (title: string) => void;
  onContentChange: (content: string) => void;
  onAttachmentAdd?: (attachment: NoteAttachment) => void;
  onAttachmentRemove?: (attachmentUrl: string) => void;
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
            <span className="attachments-title">Attachments ({attachments.length})</span>
          </div>
          <div className="attachments-grid">
            {attachments.map((attachment, index) => (
              <div key={index} className={`attachment-card ${attachment.type}`}>
                <div className="attachment-preview">
                  {attachment.type === 'image' && (
                    <img 
                      src={attachment.url} 
                      alt={attachment.title || 'Image attachment'} 
                      className="image-preview"
                    />
                  )}
                  {attachment.type === 'url' && (
                    <div className="url-preview">
                      <span className="url-icon">🔗</span>
                    </div>
                  )}
                  {attachment.type === 'file' && (
                    <div className="file-preview">
                      <span className="file-icon">📄</span>
                    </div>
                  )}
                </div>
                <div className="attachment-info">
                  <div className="attachment-title">
                    {attachment.title || attachment.url}
                  </div>
                  <div className="attachment-metadata">
                    {attachment.size && (
                      <span className="file-size">{formatFileSize(attachment.size)}</span>
                    )}
                    <span className="attachment-date">
                      {formatDate(attachment.createdAt)}
                    </span>
                  </div>
                  {onAttachmentRemove && (
                    <button 
                      className="remove-attachment"
                      onClick={() => onAttachmentRemove(attachment.url)}
                    >
                      Remove
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default NoteInput; 