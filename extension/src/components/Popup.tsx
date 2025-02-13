import React, { useState, useEffect } from 'react';
import TabManager from './TabManager';
import { SaveButton } from './SaveButton';
import { ActionButton } from './ActionButton';
import Menu from './Menu';
import { ThemeManager } from '../UI/component';
import '../styles/components.css';
import { NotesManager } from './NotesManager';
import { Note } from '../lib/notesDB';
import { AttachmentMenu } from './AttachmentMenu';
import { NotesDB } from '../lib/notesDB';
import { NoteAttachment } from '../lib/notesDB';
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

  const handleFileUpload = async (file: File) => {
    try {
      if (tabManagerRef.current && activeNote.id) {
        const attachment: NoteAttachment = {
          type: 'file',
          url: URL.createObjectURL(file),
          title: file.name,
          size: file.size,
          mimeType: file.type,
          createdAt: new Date().toISOString()
        };
        
        await NotesDB.addAttachment(activeNote.id, attachment);
        // Update tab content after attachment is added
        if (tabManagerRef.current) {
          const updatedNote = await NotesDB.getNote(activeNote.id);
          if (updatedNote) {
            tabManagerRef.current.updateTab(updatedNote);
          }
        }
      }
    } catch (error) {
      console.error('Failed to upload file:', error);
      throw error;
    }
  };

  const handleImageUpload = async (image: File) => {
    try {
      if (tabManagerRef.current && activeNote.id) {
        const reader = new FileReader();
        reader.onload = async (e) => {
          const imageUrl = e.target?.result as string;
          
          const attachment: NoteAttachment = {
            type: 'image',
            url: imageUrl,
            title: image.name,
            size: image.size,
            mimeType: image.type,
            createdAt: new Date().toISOString()
          };
          
          if (!activeNote.id) {
            throw new Error('Cannot add attachment - note is not saved');
          }
          await NotesDB.addAttachment(activeNote.id, attachment);
          
          // Update content with image markdown
          const imageMarkdown = `\n![${image.name}](${imageUrl})\n`;
          handleContentChange(
            activeNote.tabId,
            activeNote.title,
            activeNote.content + imageMarkdown,
            activeNote.version,
            activeNote.id
          );
          
          // Update tab after attachment is added
          const updatedNote = await NotesDB.getNote(activeNote.id);
          if (updatedNote && tabManagerRef.current) {
            tabManagerRef.current.updateTab(updatedNote);
          }
        };
        reader.readAsDataURL(image);
      }
    } catch (error) {
      console.error('Failed to upload image:', error);
      throw error;
    }
  };

  const handleUrlCapture = async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab.url) return;

      const url = tab.url;
      const title = tab.title || url;
      const urlMarkdown = `\n[${title}](${url})\n`;
      
      const activeTab = tabManagerRef.current?.getActiveTab();
      if (!activeTab) return;

      // Update tab content directly, don't modify content in state update
      tabManagerRef.current?.updateTabContent(
        activeTab.id,
        activeTab.title,
        activeTab.content + urlMarkdown
      );

      // Don't add URL again in state update
      setActiveNote(prev => ({
        ...prev,
        syncStatus: 'pending' as const,
        id: prev.id,
        version: prev.version
      }));
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
            onFileUpload={handleFileUpload}
            onImageUpload={handleImageUpload}
            onUrlCapture={handleUrlCapture}
          />
        </div>
        <SaveButton 
          title={activeNote.title}
          content={activeNote.content}
          existingNoteId={activeNote.id}
          currentVersion={activeNote.version}
          tabId={activeNote.tabId}
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