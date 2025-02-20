// SaveButton component
// communicates with the NotesDB to save the note

import React, { useState } from 'react';
import { Note, DBProxy as NotesDB } from '../lib/DBProxy';
import { Attachment } from '../lib/Attachment';

interface SaveButtonProps {
  title: string;
  content: string;
  existingNoteId?: string;
  currentVersion?: number;
  tabId: string;
  attachments?: Attachment[];
  onSaveComplete?: (note: Note) => void;
  onVersionConflict?: () => void;
}

export const SaveButton: React.FC<SaveButtonProps> = ({
  title,
  content,
  existingNoteId,
  currentVersion,
  tabId,
  attachments,
  onSaveComplete,
  onVersionConflict
}) => {
  const [isSaving, setIsSaving] = useState(false);

  const handleSave = async () => {
    if (!title.trim() && !content.trim() && (!attachments || attachments.length === 0)) {
      console.log('[SaveButton] Aborting save - no content to save');
      return;
    }

    if (isSaving) {
      return;
    }

    setIsSaving(true);

    try {
      let note: Note;
      
      if (existingNoteId) {
        note = await NotesDB.updateNote(
          existingNoteId, 
          title, 
          content, 
          currentVersion,
          attachments
        );
      } else {
        note = await NotesDB.createNote(
          title, 
          content,
          attachments
        );
      }
      
      if (onSaveComplete) {
        onSaveComplete(note);
      }
    } catch (error) {
      console.error('[SaveButton] Save operation failed:', error);
      
      if (error instanceof Error) {
        if (error.message === 'Note not found') {
          alert('Unable to update note: Note not found');
        } else if (error.message === 'Version conflict - note was modified elsewhere') {
          if (onVersionConflict) {
            onVersionConflict();
          } else {
            alert('This note was modified elsewhere. Please refresh and try again.');
          }
        } else {
          alert('Error saving note. Please try again.');
        }
      }
    } finally {
      setIsSaving(false);
    }
  };

  // Determine button title based on operation type
  const buttonTitle = existingNoteId ? 'Update Note' : 'Save Note';

  return (
    <button 
      className={`save-button ${isSaving ? 'saving' : ''}`}
      onClick={handleSave}
      title={buttonTitle}
      disabled={isSaving}
    >
      {isSaving ? (
        // Loading spinner icon
        <svg className="spinner" viewBox="0 0 24 24" fill="none" stroke="currentColor">
          <path d="M12 2v4m0 12v4M4.93 4.93l2.83 2.83m8.48 8.48l2.83 2.83M2 12h4m12 0h4M4.93 19.07l2.83-2.83m8.48-8.48l2.83-2.83" />
        </svg>
      ) : (
        // Regular save icon
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
          <polyline points="17 21 17 13 7 13 7 21" />
          <polyline points="7 3 7 8 15 8" />
        </svg>
      )}
    </button>
  );
};
