import React, { useState, useEffect } from 'react';
import TabManager from './TabManager';
import { SaveButton } from './SaveButton';
import { ActionButton } from './ActionButton';
import Menu from './Menu';
import { ThemeManager } from '../UI/component';
import '../styles/components/components.css';
import { NotesManager } from './NotesManager';
import { Note } from '../lib/DBProxy';
import { AttachmentMenu } from './AttachmentMenu';
import { DBProxy as NotesDB } from '../lib/DBProxy';
import { Attachment } from '../lib/Attachment';
import { TabManagerRef } from './TabManager';

const Popup: React.FC = () => {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [activeNote, setActiveNote] = useState<{
    tabId: string;
    title: string;
    content: string;
    id?: string;
    version?: number;
    syncStatus?: 'pending' | 'synced';
  }>({
    tabId: 'new',
    title: '',
    content: '',
  });
  const [isNotesManagerOpen, setIsNotesManagerOpen] = useState(false);
  const [isAttachmentMenuOpen, setIsAttachmentMenuOpen] = useState(false);
  
  // Initialize theme when component mounts
  useEffect(() => {
    const savedTheme = ThemeManager.getSavedTheme();
    ThemeManager.setTheme(savedTheme);

    // Add beforeunload handler
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (hasUnsavedChanges) {
        e.preventDefault();
        e.returnValue = '';
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [hasUnsavedChanges]);

  const handleUnsavedChanges = (status: boolean) => {
    setHasUnsavedChanges(status);
  };

  const handleContentChange = (
    tabId: string, 
    title: string, 
    content: string, 
    version?: number,
    noteId?: string
  ) => {
    setActiveNote(prev => ({ 
      ...prev,
      tabId, 
      title, 
      content,
      id: noteId,
      version,
      syncStatus: 'pending'
    }));
  };

  const handleEditNote = (note: Note) => {
    // TabManager will handle creating new tab and setting content
    if (tabManagerRef.current) {
      tabManagerRef.current.addTab(note);
    }
    setIsNotesManagerOpen(false);
  };

  const handleClose = () => {
    if (hasUnsavedChanges) {
      if (window.confirm('You have unsaved changes. Are you sure you want to close?')) {
        window.close();
      }
    } else {
      window.close();
    }
  };

  // Create ref for TabManager to access its methods
  const tabManagerRef = React.useRef<TabManagerRef | null>(null);

  const handleUrlCapture = async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab.url) return;

      // Create pending attachment instead of saving to DB
      const pendingAttachment: Attachment = {
        type: "url",
        id: Date.now(), // Temporary ID
        url: tab.url,
        createdAt: new Date().toISOString(),
        syncStatus: 'pending'
      };

      // Update TabManager state with pending attachment
      if (tabManagerRef.current) {
        tabManagerRef.current.addPendingAttachment(activeNote.tabId, pendingAttachment);
      }

    } catch (error) {
      console.error('Failed to capture URL:', error);
      throw error;
    }
  };

  const handleNoteDelete = (noteId: string) => {
    // Reset activeNote state if the deleted note was active
    if (activeNote.id === noteId) {
      setActiveNote({
        tabId: 'new',
        title: '',
        content: '',
      });
    }
  };

  return (
    <div className="popup-container">
      <div className="header">
        <div className="header-left">
          <ActionButton 
            type="edit" 
            onClick={() => setIsNotesManagerOpen(true)} 
            title="View Notes" 
          />
        </div>
        <div className="header-right">
          <ActionButton type="menu" onClick={() => setIsMenuOpen(true)} title="Menu" />
          <ActionButton 
            type="close" 
            onClick={handleClose}
            title="Close"
            hasUnsavedChanges={hasUnsavedChanges}
          />
        </div>
      </div>
      <div className="content">
        <TabManager 
          ref={tabManagerRef}
          onChangeStatus={handleUnsavedChanges}
          onContentChange={handleContentChange}
        />
      </div>
      <div className="footer">
        <div className="footer-left">
          <button 
            className="attachment-upload-btn"
            title="Add attachment"
            onClick={() => setIsAttachmentMenuOpen(true)}
            disabled={!activeNote.tabId}
          >
            <span className="icon">📎</span>
          </button>
          <AttachmentMenu
            isOpen={isAttachmentMenuOpen}
            onClose={() => setIsAttachmentMenuOpen(false)}
            onUrlCapture={handleUrlCapture}
          />
        </div>
        <SaveButton 
          title={activeNote.title}
          content={activeNote.content}
          existingNoteId={activeNote.id}
          currentVersion={activeNote.version}
          tabId={activeNote.tabId}
          attachments={tabManagerRef.current?.getActiveTab()?.attachments}
          onSaveComplete={(savedNote) => {
            const currentTabId = activeNote.tabId;
            setHasUnsavedChanges(false);
            setActiveNote(prev => ({
              ...prev,
              id: savedNote.id,
              version: savedNote.version,
              title: savedNote.title || prev.title,
              syncStatus: 'synced',
              tabId: prev.tabId
            }));
            
            if (tabManagerRef.current) {
              tabManagerRef.current.updateTabWithId(currentTabId, savedNote);
            }
          }}
        />
      </div>
      <Menu isOpen={isMenuOpen} onClose={() => setIsMenuOpen(false)} />
      <NotesManager 
        isOpen={isNotesManagerOpen}
        onClose={() => setIsNotesManagerOpen(false)}
        onEditNote={handleEditNote}
        activeNoteId={activeNote.id}
        onNoteDelete={handleNoteDelete}
        tabManagerRef={tabManagerRef}
      />
    </div>
  );
};

export default Popup; 