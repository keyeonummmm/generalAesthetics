// NoteInput.tsx
// This component is responsible for the note input field.
// Check if the note has unsaved changes and if so, show a warning before closing the popup.

import React from 'react';
import { Note } from '../lib/notesDB';

interface NoteInputProps {
  // Core note data
  note: {
    id?: string;
    title: string;
    content: string;
    attachments?: Note['attachments'];
    // Add metadata fields
    version?: number;
    createdAt?: string;
    updatedAt?: string;
    syncStatus?: 'pending' | 'synced';
  };
  // Simple change handlers
  onTitleChange: (title: string) => void;
  onContentChange: (content: string) => void;
  onSaveComplete?: (note: Note) => void;
  // Optional tab identifier for rendering
  tabId?: string;
}

const NoteInput: React.FC<NoteInputProps> = ({
  note,
  onTitleChange,
  onContentChange,
  onSaveComplete,
  tabId
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
    <div className="note-container" data-tab-id={tabId}>
      <div className="note-metadata">
        {note.version && <span className="version">v{note.version}</span>}
        {note.syncStatus && (
          <span className={`sync-status ${note.syncStatus}`}>
            {note.syncStatus}
          </span>
        )}
      </div>
      <input
        type="text"
        className="note-title-input"
        placeholder="Note title (optional)"
        value={note.title}
        onChange={handleTitleChange}
      />
      <textarea 
        className="note-input"
        placeholder="Start typing your note..."
        value={note.content}
        onChange={handleContentChange}
      />
      {note.attachments && note.attachments.length > 0 && (
        <div className="attachments-section">
          <div className="attachments-header">
            <span className="attachments-title">Attachments ({note.attachments.length})</span>
            <button className="add-attachment-btn" title="Add attachment" disabled>
              <span className="icon">+</span>
            </button>
          </div>
          <div className="attachments-grid">
            {note.attachments.map((attachment, index) => (
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
                  <div className="attachment-actions">
                    <button className="action-btn view-btn" title="View" disabled>
                      <span className="icon">👁️</span>
                    </button>
                    <button className="action-btn copy-btn" title="Copy link" disabled>
                      <span className="icon">📋</span>
                    </button>
                    <button className="action-btn delete-btn" title="Remove" disabled>
                      <span className="icon">🗑️</span>
                    </button>
                  </div>
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