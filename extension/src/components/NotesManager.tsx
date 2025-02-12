import React, { useState, useEffect } from 'react';
import { Note, NotesDB } from '../lib/notesDB';
import '../styles/notes-manager.css';

interface NotesManagerProps {
  isOpen: boolean;
  onClose: () => void;
  onEditNote: (note: Note) => void;
}

interface NoteItemProps {
  note: Note;
  onEdit: (note: Note) => void;
  onDelete: (id: string) => void;
}

const NoteItem: React.FC<NoteItemProps> = ({ note, onEdit, onDelete }) => {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const previewContent = note.content.slice(0, 50) + (note.content.length > 50 ? '...' : '');

  const handleDelete = () => {
    if (window.confirm('Are you sure you want to delete this note?')) {
      onDelete(note.id);
    }
  };

  return (
    <div className="note-item">
      <div 
        className="note-item-content"
        onClick={() => onEdit(note)}
      >
        <h3>{note.title}</h3>
        <p>{previewContent}</p>
        <small>{new Date(note.updatedAt).toLocaleDateString()}</small>
      </div>
      <div className="note-item-actions">
        <button 
          className="menu-button"
          onClick={() => setIsMenuOpen(!isMenuOpen)}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="1" />
            <circle cx="12" cy="5" r="1" />
            <circle cx="12" cy="19" r="1" />
          </svg>
        </button>
        {isMenuOpen && (
          <div className="menu-dropdown">
            <button onClick={handleDelete}>Delete</button>
          </div>
        )}
      </div>
    </div>
  );
};

export const NotesManager: React.FC<NotesManagerProps> = ({ 
  isOpen, 
  onClose,
  onEditNote
}) => {
  const [notes, setNotes] = useState<Note[]>([]);

  useEffect(() => {
    if (isOpen) {
      loadNotes();
    }
  }, [isOpen]);

  const loadNotes = async () => {
    try {
      const loadedNotes = await NotesDB.getAllNotes();
      const sortedNotes = loadedNotes.sort((a, b) => 
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      );
      setNotes(sortedNotes);
    } catch (error) {
      console.error('Error loading notes:', error);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await NotesDB.deleteNote(id);
      setNotes(notes.filter(note => note.id !== id));
    } catch (error) {
      console.error('Error deleting note:', error);
    }
  };

  const handleEdit = (note: Note) => {
    onEditNote(note);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="notes-manager-overlay">
      <div className="notes-manager">
        <div className="notes-manager-header">
          <h2>Your Notes</h2>
          <button className="close-button" onClick={onClose}>×</button>
        </div>
        <div className="notes-list">
          {notes.length === 0 ? (
            <div className="no-notes">No notes yet</div>
          ) : (
            notes.map(note => (
              <NoteItem
                key={note.id}
                note={note}
                onEdit={handleEdit}
                onDelete={handleDelete}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}; 