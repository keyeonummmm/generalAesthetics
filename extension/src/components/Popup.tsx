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
import { shadowRootRef, hideExtensionUI, showExtensionUI } from '../content';
import { processImage, ImageProcessingOptions } from '../lib/imageProcessor';
import { createLazyLoadableImage } from '../lib/imageProcessor';

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
  const [isLoading, setIsLoading] = useState(false);
  
  // Initialize theme when component mounts
  useEffect(() => {
    ThemeManager.setTheme(ThemeManager.getCurrentTheme());

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
    if (tabManagerRef.current) {
      tabManagerRef.current.addTab(note);
    }
    setIsNotesManagerOpen(false);
  };

  const handleUrlCapture = async () => {
    try {
      const response = await new Promise<{ success: boolean; url?: string; error?: string }>((resolve) => {
        chrome.runtime.sendMessage({ type: 'CAPTURE_URL' }, (result) => {
          resolve(result || { success: false, error: 'No response' });
        });
      });

      if (!response.success || !response.url) {
        throw new Error(response.error || 'Failed to capture URL');
      }

      // Create pending attachment with the received URL
      const pendingAttachment: Attachment = {
        type: "url",
        id: Date.now(), // Temporary ID
        url: response.url,
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

  const handleScreenshotCapture = async (type: 'visible' | 'full') => {
    try {
      // Show loading indicator
      setIsLoading(true);
      
      // Hide the extension UI before capture using the global function
      await hideExtensionUI();
      
      const response = await new Promise<{ success: boolean; screenshotData?: string; error?: string }>((resolve) => {
        const timeoutId = setTimeout(() => {
          resolve({ success: false, error: 'Capture timeout' });
        }, 30000); // 30 second timeout

        chrome.runtime.sendMessage(
          { type: 'CAPTURE_SCREENSHOT', screenshotType: type },
          (result) => {
            clearTimeout(timeoutId);
            resolve(result || { success: false, error: 'No response' });
          }
        );
      });
      
      // Show UI again using the global function
      await showExtensionUI();

      if (!response.success || !response.screenshotData) {
        throw new Error(response.error || 'Failed to capture screenshot');
      }
      
      // Process the image through our WebP conversion and compression pipeline
      const processingOptions = {
        format: 'webp' as const,
        quality: 85,
        progressive: true
      };
      
      // Process the image (convert to WebP, compress, and generate thumbnail)
      const processedImage = await processImage(response.screenshotData, processingOptions);
      
      // Get image dimensions
      const img = new Image();
      img.src = response.screenshotData;
      await new Promise(resolve => {
        img.onload = resolve;
      });
      
      // Create a lazy-loadable version with thumbnail
      const lazyLoadable = await createLazyLoadableImage(response.screenshotData);
      
      // Create attachment with thumbnail and metadata
      const attachment: Attachment = {
        type: 'screenshot',
        id: Date.now(),
        screenshotData: processedImage.dataUrl,
        thumbnailData: processedImage.thumbnailUrl,
        screenshotType: type,
        createdAt: new Date().toISOString(),
        syncStatus: 'pending',
        metadata: {
          format: processedImage.format,
          originalSize: processedImage.originalSize,
          processedSize: processedImage.processedSize,
          compressionRatio: processedImage.compressionRatio,
          width: img.width,
          height: img.height,
          isLazyLoaded: true
        }
      };
      
      // Add the attachment to the active tab
      await tabManagerRef.current?.addPendingAttachment(activeNote.tabId, attachment);
      
      // Hide loading indicator
      setIsLoading(false);
    } catch (error) {
      console.error('Screenshot capture failed:', error);
      setIsLoading(false);
      alert('Failed to capture screenshot. Please try again.');
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

  const tabManagerRef = React.useRef<TabManagerRef | null>(null);

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
            onClick={() => {}}
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
            onScreenshotCapture={handleScreenshotCapture}
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