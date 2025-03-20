import React, { useState, forwardRef, useImperativeHandle, useEffect, useRef } from 'react';
import NoteInput from './NoteInput';
import { Note, DBProxy as NotesDB } from '../lib/DBProxy';
import { Attachment } from '../lib/Attachment';
import '../styles/components/tab-manager.css';
import { v4 as uuidv4 } from 'uuid';
import { TabCacheManager, Tab as CacheTab, TabCache, AttachmentReference } from '../lib/TabCacheManager';
import { TabAssociationManager } from '../lib/TabAssociationManager';
import { SpreadsheetFormatter } from '../lib/SpreadsheetFormatter';
import { TextFormatter } from '../lib/TextFormatter';

interface Tab {
  id: string;
  title: string;
  content: string;
  isRichText?: boolean; // Add flag to indicate rich text content
  attachments?: AttachmentReference[];
  loadedAttachments?: Attachment[]; // New field to store loaded attachments
  isNew: boolean;
  version?: number;
  createdAt?: string;
  updatedAt?: string;
  syncStatus: 'pending' | 'synced';
  noteId?: string;
  lastEdited: string;
  pinned?: boolean; // Add pinned property to support tab pinning
  attachmentSectionExpanded?: boolean; // Track if attachment section is expanded
  spreadsheetData?: boolean; // Add flag to indicate the tab contains spreadsheet data
}

interface TabManagerProps {
  onChangeStatus: (hasUnsavedChanges: boolean) => void;
  onContentChange: (tabId: string, title: string, content: string, version?: number, noteId?: string) => void;
  onContentRefChange?: (contentRef: React.RefObject<HTMLDivElement> | null) => void;
}

export interface TabManagerRef {
  addTab: (note: Note) => void;
  updateTab: (note: Note) => void;
  removeTabByNoteId: (noteId: string) => Promise<void>;
  getActiveTab: () => {
    id: string;
    title: string;
    content: string;
    version?: number;
    noteId?: string;
    attachments?: Attachment[];
  } | null;
  updateTabContent: (id: string, title: string, content: string) => void;
  removeTabContent: (noteId: string) => Promise<void>;
  updateTabWithId: (tabId: string, note: Note) => void;
  isNoteOpenInAnyTab: (noteId: string) => boolean;
  addPendingAttachment: (tabId: string, attachment: Attachment) => void;
  pinTab: (tabId: string) => Promise<void>;
  unpinTab: (tabId: string) => Promise<void>;
  isPinned: (tabId: string) => boolean;
  syncCache: () => Promise<void>;
  
  handleSave: (tabId: string, note: Note) => Promise<void>;
  setAttachmentSectionExpanded: (tabId: string, isExpanded: boolean) => void;
  isAttachmentSectionExpanded: (tabId: string) => boolean;
}

interface TabManagerCache {
  tabs: Tab[];
  activeTabId: string;
}

const CACHE_KEY = 'tabManager_cache';

// Add ConfirmationDialog component
interface ConfirmationDialogProps {
  isOpen: boolean;
  tabId: string;
  tabTitle: string;
  onConfirm: (tabId: string) => void;
  onCancel: (tabId: string) => void;
  onClose: () => void;
}

const ConfirmationDialog: React.FC<ConfirmationDialogProps> = ({
  isOpen,
  tabId,
  tabTitle,
  onConfirm,
  onCancel,
  onClose
}) => {
  if (!isOpen) return null;

  // Use a more specific title based on tab title
  const displayTitle = tabTitle.trim() ? tabTitle : 'Untitled Note';

  return (
    <div className="confirmation-dialog-backdrop">
      <div className="confirmation-dialog">
        <div className="confirmation-dialog-header">
          <h3>Unsaved Changes</h3>
          <button className="close-dialog" onClick={onClose}>×</button>
        </div>
        <div className="confirmation-dialog-content">
          <p>You have unsaved changes in "{displayTitle}".</p>
          <p>Would you like to save before closing?</p>
        </div>
        <div className="confirmation-dialog-actions">
          <button 
            className="dialog-btn cancel-btn" 
            onClick={() => onCancel(tabId)}
          >
            Close Without Saving
          </button>
          <button 
            className="dialog-btn confirm-btn" 
            onClick={() => onConfirm(tabId)}
          >
            Save & Close
          </button>
        </div>
      </div>
    </div>
  );
};

const TabManager = forwardRef<TabManagerRef, TabManagerProps>(({
  onChangeStatus,
  onContentChange,
  onContentRefChange
}, ref) => {
  const [tabs, setTabs] = useState<Tab[]>(() => {
    const initialTab: Tab = { 
      id: `new-${uuidv4()}`, 
      title: '', 
      content: '', 
      isNew: true, 
      syncStatus: 'pending' as const,
      lastEdited: new Date().toISOString(),
      attachmentSectionExpanded: false // Default to collapsed
    };
    return [initialTab];
  });

  const [activeTabId, setActiveTabId] = useState<string>('');
  const [loadingAttachments, setLoadingAttachments] = useState(false);
  
  // Create a single shared contentRef at the top level
  const contentRef = useRef<HTMLDivElement>(null);
  
  // Create a map to track tab-specific state
  const tabContentRefsMap = useRef<Map<string, { 
    initialized: boolean 
  }>>(new Map());
  
  // Add state for confirmation dialog
  const [confirmationState, setConfirmationState] = useState<{
    isOpen: boolean;
    tabId: string;
    hasUnsavedChanges: boolean;
  }>({
    isOpen: false,
    tabId: '',
    hasUnsavedChanges: false
  });

  // Expose the content ref to the parent component when active tab changes
  useEffect(() => {
    if (onContentRefChange) {
      onContentRefChange(contentRef);
    }
    
    return () => {
      if (onContentRefChange) {
        onContentRefChange(null);
      }
    };
  }, [activeTabId, onContentRefChange]);

  // Load cache on mount
  useEffect(() => {
    const loadCache = async () => {
      try {
        const cache = await TabCacheManager.initCache();
        if (cache && cache.tabs.length > 0) {
          // Get pinned tabs
          const pinnedTabs = TabCacheManager.getPinnedTabs(cache);
          
          // Set tabs from cache
          setTabs(cache.tabs);
          
          // Prioritize pinned tabs when setting the active tab
          if (pinnedTabs.length > 0) {
            // Sort pinned tabs by creation time (newest first)
            const sortedPinnedTabs = pinnedTabs.sort((a, b) => 
              new Date(b.lastEdited).getTime() - new Date(a.lastEdited).getTime()
            );
            
            // Set the first pinned tab as active
            setActiveTabId(sortedPinnedTabs[0].id);
            
            // Load attachments for the active pinned tab
            if (sortedPinnedTabs[0].attachments && sortedPinnedTabs[0].attachments.length > 0) {
              loadAttachmentsForTab(sortedPinnedTabs[0].id);
            }
          } else {
            // No pinned tabs, use the active tab from cache
            setActiveTabId(cache.activeTabId);
            
            // Load attachments for the active tab
            const activeTab = cache.tabs.find(tab => tab.id === cache.activeTabId);
            if (activeTab && activeTab.attachments && activeTab.attachments.length > 0) {
              loadAttachmentsForTab(activeTab.id);
            }
          }
        } else {
          // Ensure there's always at least one tab
          const initialTab: Tab = { 
            id: `new-${uuidv4()}`, 
            title: '', 
            content: '', 
            isNew: true, 
            syncStatus: 'pending' as const,
            lastEdited: new Date().toISOString(),
            attachmentSectionExpanded: false // Default to collapsed
          };
          setTabs([initialTab]);
          setActiveTabId(initialTab.id);
        }
      } catch (error) {
        console.error('Failed to load tab cache:', error);
        // Fallback to ensure there's always a tab
        const initialTab: Tab = { 
          id: `new-${uuidv4()}`, 
          title: '', 
          content: '', 
          isNew: true, 
          syncStatus: 'pending' as const,
          lastEdited: new Date().toISOString(),
          attachmentSectionExpanded: false // Default to collapsed
        };
        setTabs([initialTab]);
        setActiveTabId(initialTab.id);
      }
    };
    
    loadCache();
  }, []);

  // Save cache when tabs or activeTabId changes
  useEffect(() => {
    const saveCache = async () => {
      if (tabs.length && activeTabId) {
        // Don't save loadedAttachments to the cache
        const tabsForCache = tabs.map(tab => {
          const { loadedAttachments, ...tabWithoutLoadedAttachments } = tab;
          return tabWithoutLoadedAttachments;
        });
        
        const cache: TabCache = {
          tabs: tabsForCache as any, // Type assertion needed due to the mapping
          activeTabId,
          lastUpdated: new Date().toISOString()
        };
        await TabCacheManager.saveCache(cache);
      }
    };
    
    saveCache();
  }, [tabs, activeTabId]);

  // Add ref to track the last saved note ID
  const lastSavedNoteRef = useRef<{[key: string]: string}>({});

  useEffect(() => {
    const cache: TabManagerCache = {
      tabs,
      activeTabId
    };
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  }, [tabs, activeTabId]);

  // Effect to sync content when tabs or activeTabId changes
  useEffect(() => {
    const activeTab = tabs.find(tab => tab.id === activeTabId);
    if (activeTab) {
      onContentChange(
        activeTab.id,
        activeTab.title,
        activeTab.content,
        activeTab.version,
        activeTab.noteId
      );
      
      // Load attachments for the active tab if they're not already loaded
      if (activeTab.attachments && activeTab.attachments.length > 0 && !activeTab.loadedAttachments) {
        loadAttachmentsForTab(activeTab.id);
      }
      
      // Initialize SpreadsheetFormatter for this tab if needed
      if (contentRef.current) {
        // Set up tab-specific state in the contentRefsMap
        if (!tabContentRefsMap.current.has(activeTab.id)) {
          tabContentRefsMap.current.set(activeTab.id, { initialized: false });
        }
        
        const tabState = tabContentRefsMap.current.get(activeTab.id);
        
        // If spreadsheet data exists and the tab needs initialization
        if (activeTab.spreadsheetData && contentRef.current) {
          // Initialize and deserialize spreadsheets with tab-specific state
          if (!tabState?.initialized) {
            // Initialize the formatter specifically for this tab
            SpreadsheetFormatter.initialize(contentRef.current, activeTab.id);
            
            // Mark this tab as initialized
            tabContentRefsMap.current.set(activeTab.id, { initialized: true });
          }
          
          // Deserialize spreadsheets for this tab
          setTimeout(() => {
            if (contentRef.current) {
              // Use tab-specific deserialization
              SpreadsheetFormatter.deserializeSpreadsheets(contentRef.current, activeTab.id);
              
              // Refresh control handlers to ensure buttons work
              SpreadsheetFormatter.refreshControlHandlers(contentRef.current, activeTab.id);
            }
          }, 100);
        } else if (contentRef.current && !tabState?.initialized) {
          // Initialize the formatter even if no spreadsheet data yet
          SpreadsheetFormatter.initialize(contentRef.current, activeTab.id);
          tabContentRefsMap.current.set(activeTab.id, { initialized: true });
        }
      }
    }
  }, [tabs, activeTabId]);

  // Function to load attachments for a specific tab
  const loadAttachmentsForTab = async (tabId: string) => {
    const tab = tabs.find(tab => tab.id === tabId);
    if (!tab) {
      console.error(`Cannot load attachments: Tab ${tabId} not found`);
      return;
    }
    
    if (!tab.attachments || tab.attachments.length === 0) {
      return;
    }
    
    // Skip if attachments are already loaded and match the expected count
    if (tab.loadedAttachments && tab.loadedAttachments.length === tab.attachments.length) {
      return;
    }
    
    setLoadingAttachments(true);
    
    try {
      // First try to load from cache
      const loadedAttachments = await TabCacheManager.loadAttachmentsForTab(tab);
      
      // If we couldn't load all attachments from cache and this is a saved note,
      // try loading them from the database
      if (loadedAttachments.length < tab.attachments.length && tab.noteId) {
        try {
          // Get the full note with attachments from the database
          const fullNote = await NotesDB.getNote(tab.noteId);
          
          if (fullNote && fullNote.attachments && fullNote.attachments.length > 0) {
            // If we found attachments in the database, update the cache with them
            const currentCache = await TabCacheManager.initCache();
            if (currentCache) {
              for (const attachment of fullNote.attachments) {
                // Only add if it has the required data and isn't already loaded
                if ((attachment.screenshotData || attachment.url) && 
                    !loadedAttachments.some(a => a.id === attachment.id)) {
                  await TabCacheManager.addAttachmentToTab(currentCache, tabId, attachment);
                }
              }
              
              // After updating the cache, try loading again
              const reloadedAttachments = await TabCacheManager.loadAttachmentsForTab(tab);
              
              if (reloadedAttachments.length > loadedAttachments.length) {
                // Use the reloaded attachments
                setTabs(prevTabs => prevTabs.map(t => {
                  if (t.id === tabId) {
                    return { ...t, loadedAttachments: reloadedAttachments };
                  }
                  return t;
                }));
                
                return;
              }
            }
          } else {
          }
        } catch (error) {
          console.error(`Failed to load attachments from database for note ${tab.noteId}:`, error);
        }
      }
      
      // Update the tab with loaded attachments
      setTabs(prevTabs => prevTabs.map(t => {
        if (t.id === tabId) {
          return { ...t, loadedAttachments };
        }
        return t;
      }));
      
      // If we didn't load all attachments, log a warning
      if (loadedAttachments.length < tab.attachments.length) {
        console.warn(
          `Warning: Only loaded ${loadedAttachments.length} of ${tab.attachments.length} attachments for tab ${tabId}. ` +
          `Some attachments may be missing from the cache.`
        );
      }
    } catch (error) {
      console.error(`Failed to load attachments for tab ${tabId}:`, error);
    } finally {
      setLoadingAttachments(false);
    }
  };

  const handleSaveComplete = (tabId: string, savedNote: Note) => {
    setTabs(prevTabs => prevTabs.map(tab =>
      tab.id === tabId ? {
        ...tab,
        noteId: savedNote.id,
        title: savedNote.title,
        content: savedNote.content,
        version: savedNote.version,
        createdAt: savedNote.createdAt,
        updatedAt: savedNote.updatedAt,
        syncStatus: 'synced' as const,
        isNew: false
      } : tab
    ));

    // Update active tab ID if needed
    if (activeTabId === tabId) {
      onContentChange(
        tabId,
        savedNote.title,
        savedNote.content,
        savedNote.version,
        savedNote.id
      );
    }
  };

  const confirmCloseTab = async (tabId: string) => {
    
    const tab = tabs.find(tab => tab.id === tabId);
    if (!tab) return;
    
    // Check if the tab is completely clean (new tab with no content, title, noteId, or attachments)
    const isCleanTab = tab.isNew && 
                       !tab.noteId && 
                       !tab.title.trim() && 
                       !tab.content.trim() && 
                       (!tab.attachments || tab.attachments.length === 0) &&
                       tab.syncStatus === 'pending';
    
    if (isCleanTab) {
      closeTab(tabId);
      return;
    }
    
    // For tabs with a noteId but no changes, also skip confirmation
    if (tab.noteId && tab.syncStatus === 'synced') {
      try {
        const savedNote = await NotesDB.getNote(tab.noteId);
        if (savedNote) {
          // Compare titles and content to see if there are changes
          const titleChanged = tab.title !== savedNote.title;
          const contentChanged = tab.content !== savedNote.content;
          
          // If nothing has changed, close without confirmation
          if (!titleChanged && !contentChanged) {
            closeTab(tabId);
            return;
          }
        }
      } catch (error) {
        console.error('Error checking for changes:', error);
        // Continue with normal confirmation flow if we can't check
      }
    }
    
    // Check if the tab has unsaved changes
    let hasUnsavedChanges = tab.syncStatus === 'pending';
    
    // If the tab has a noteId, also check if content has changed compared to the saved note
    if (tab.noteId && !hasUnsavedChanges) {
      try {
        const savedNote = await NotesDB.getNote(tab.noteId);
        if (savedNote) {
          // Compare titles and content to see if there are changes
          const titleChanged = tab.title !== savedNote.title;
          const contentChanged = tab.content !== savedNote.content;
          
          // If either has changed, there are unsaved changes
          hasUnsavedChanges = titleChanged || contentChanged;
          
          if (hasUnsavedChanges) {
          }
        }
      } catch (error) {
        console.error('Error checking for unsaved changes:', error);
        // If we can't check, assume there are changes
        hasUnsavedChanges = true;
      }
    }
    
    if (hasUnsavedChanges) {
      // Show confirmation dialog
      setConfirmationState({
        isOpen: true,
        tabId,
        hasUnsavedChanges: true
      });
    } else {
      // No unsaved changes, close the tab immediately
      closeTab(tabId);
    }
  };
  
  const handleSaveAndClose = async (tabId: string) => {
    const tab = tabs.find(t => t.id === tabId);
    if (!tab) return;
    
    try {
      // Check if we have attachments to save
      let attachmentsToSave: Attachment[] = [];
      
      if (tab.attachments && tab.attachments.length > 0) {
        if (tab.loadedAttachments && tab.loadedAttachments.length === tab.attachments.length) {
          // Use already loaded attachments
          attachmentsToSave = tab.loadedAttachments;
        } else {
          // Load attachments from cache
          attachmentsToSave = await TabCacheManager.loadAttachmentsForTab(tab);
        }
      }
      
      
      let savedNote: Note;
      
      if (!tab.noteId) {
        // Create a new note
        savedNote = await NotesDB.createNote(
          tab.title,
          tab.content,
          attachmentsToSave
        );
      } else {
        // Update existing note
        savedNote = await NotesDB.updateNote(
          tab.noteId,
          tab.title,
          tab.content,
          tab.version,
          attachmentsToSave
        );
      }
      
      // Update the tab with saved note data to mark it as synced
      setTabs(prevTabs => prevTabs.map(t => {
        if (t.id === tabId) {
          return {
            ...t,
            noteId: savedNote.id,
            version: savedNote.version,
            syncStatus: 'synced' as const
          };
        }
        return t;
      }));
      
      // Close the tab after saving
      closeTab(tabId);
    } catch (error) {
      console.error('Failed to save note before closing tab:', error);
      // Ask if they want to close without saving
      if (confirm('Failed to save note. Close tab without saving?')) {
        closeTab(tabId);
      }
    } finally {
      // Reset confirmation state
      setConfirmationState({
        isOpen: false,
        tabId: '',
        hasUnsavedChanges: false
      });
    }
  };
  
  const handleCloseWithoutSaving = (tabId: string) => {
    closeTab(tabId);
    
    // Reset confirmation state
    setConfirmationState({
      isOpen: false,
      tabId: '',
      hasUnsavedChanges: false
    });
  };

  const closeTab = async (tabId: string) => {
    
    // Get the tab before we remove it
    const tabToClose = tabs.find(tab => tab.id === tabId);
    if (!tabToClose) {
      console.warn(`Tab ${tabId} not found for closing`);
      return;
    }
    
    // Clean up SpreadsheetFormatter resources for this tab
    SpreadsheetFormatter.cleanup(tabId);
    
    // Remove tab from our tab content refs map
    tabContentRefsMap.current.delete(tabId);
    
    // Get current cache
    const currentCache = await TabCacheManager.initCache();
    if (!currentCache) return;
    
    // If the tab has a noteId, we need to handle it specially
    // We want to remove the tab but not delete the note's attachments from storage
    // since they might be needed by other tabs or in the future
    if (tabToClose.noteId) {
      
      // Check if this note is open in any other tabs
      const otherTabsWithSameNote = tabs.filter(
        tab => tab.noteId === tabToClose.noteId && tab.id !== tabId
      );
    }
    
    // Use TabCacheManager to remove the tab and clean up its attachments
    const updatedCache = await TabCacheManager.removeTab(currentCache, tabId);
    
    // If no tabs remain, create a new empty tab
    if (updatedCache.tabs.length === 0) {
      const newTabId = `new-${uuidv4()}`;
      const newTab: Tab = { 
        id: newTabId, 
        title: '', 
        content: '', 
        isNew: true,
        syncStatus: 'pending' as const,
        lastEdited: new Date().toISOString(),
        pinned: false, // Explicitly set to false to ensure new tabs are never pinned
        attachmentSectionExpanded: false // Default to collapsed for all new tabs
      };
      
      // Update the cache with the new tab
      updatedCache.tabs = [newTab];
      updatedCache.activeTabId = newTabId;
      await TabCacheManager.saveCache(updatedCache);
      
      setTabs([newTab]);
      setActiveTabId(newTabId);
      onContentChange(
        newTabId,
        '',
        '',
        undefined,
        undefined
      );
      
      // Only clean up orphaned attachments, not all caches
      await TabCacheManager.cleanupOrphanedAttachments();
    } else if (updatedCache.tabs.length === 1 && updatedCache.tabs[0].id.startsWith('new-')) {
      // If there's only one tab left and it's a new tab, clean up orphaned attachments
      // but don't clear all caches to preserve the tab's state
      await TabCacheManager.cleanupOrphanedAttachments();
      
      setTabs(updatedCache.tabs);
      setActiveTabId(updatedCache.activeTabId);
    } else {
      // Normal case - update tabs and active tab
      setTabs(updatedCache.tabs);
      
      // Update active tab if needed
      if (activeTabId === tabId) {
        setActiveTabId(updatedCache.activeTabId);
        const newActiveTab = updatedCache.tabs.find(t => t.id === updatedCache.activeTabId);
        if (newActiveTab) {
          onContentChange(
            newActiveTab.id,
            newActiveTab.title,
            newActiveTab.content,
            newActiveTab.version,
            newActiveTab.noteId
          );
        }
      }
    }

    // Clean up tab associations when a tab is closed
    await TabAssociationManager.cleanupTabAssociations(tabId);
  };

  const addTab = (note?: Note, forceNew: boolean = false) => {
    // Check if this note is already open in a tab
    const existingTab = tabs.find(tab => 
      (note && (tab.id === note.id || tab.noteId === note.id))
    );

    if (existingTab) {
      // If the note is already open, just set it as active
      setActiveTabId(existingTab.id);
      
      // Associate this tab with the current page
      updateTabAssociations(existingTab.id);
      
      // Ensure attachments are loaded if they exist but aren't loaded yet
      if (note && 
          note.attachments && 
          note.attachments.length > 0 && 
          (!existingTab.loadedAttachments || existingTab.loadedAttachments.length < note.attachments.length)) {
        setTimeout(() => {
          loadAttachmentsForTab(existingTab.id);
        }, 0);
      }
      return;
    }

    // Only look for empty tabs to reuse if forceNew is false
    if (!forceNew) {
      // Look for an empty tab that can be reused
      const emptyTabIndex = tabs.findIndex(tab => 
        tab.isNew && !tab.title && !tab.content && !tab.noteId && (!tab.attachments || tab.attachments.length === 0)
      );
      
      if (emptyTabIndex >= 0) {
        // Reuse an empty tab
        const updatedTabs = [...tabs];
        const tabToUpdate = updatedTabs[emptyTabIndex];
        
        if (note) {
          // Before updating, clone the content to ensure spreadsheet isolation
          let clonedContent = note.content;
          
          // If the content has spreadsheets, we need to create a DOM element,
          // clone the spreadsheets, and then get the content back
          if (note.content && note.content.includes('ga-spreadsheet')) {
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = note.content;
            SpreadsheetFormatter.cloneSpreadsheets(tempDiv, tabToUpdate.id);
            clonedContent = tempDiv.innerHTML;
          }
          
          // Update the empty tab with the note's details
          updatedTabs[emptyTabIndex] = {
            ...tabToUpdate,
            title: note.title,
            content: clonedContent,
            attachments: note.attachments,
            isNew: false,
            version: note.version,
            noteId: note.id,
            syncStatus: 'synced', // Explicitly set to synced for notes from DB
            lastEdited: new Date().toISOString(),
            pinned: false, // Ensure the tab is not pinned by default
            attachmentSectionExpanded: false // Default to collapsed for loaded notes
          };
        }
        
        setTabs(updatedTabs);
        setActiveTabId(tabToUpdate.id);
        
        // Associate the tab with the current page
        updateTabAssociations(tabToUpdate.id);
        
        // Explicitly load attachments for the tab if it has any
        if (note && note.attachments && note.attachments.length > 0) {
          // Use setTimeout to ensure the tab state is updated before loading attachments
          setTimeout(() => {
            loadAttachmentsForTab(tabToUpdate.id);
          }, 100); // Slightly longer timeout to ensure state is fully updated
        }
        
        return;
      }
    }

    // Create a new tab
    const newTabId = note ? `tab-${note.id}` : `new-${uuidv4()}`;
    
    // Check if the note contains spreadsheet data
    let hasSpreadsheet = false;
    let clonedContent = note ? note.content : '';
    
    // If the content has spreadsheets, we need to deep clone the content to ensure
    // each tab has its own spreadsheet instances with unique IDs
    if (note && note.content) {
      // Check for spreadsheet using robust detection
      hasSpreadsheet = note.content.includes('ga-spreadsheet-container') || 
                      /<div[^>]*class=[^>]*ga-spreadsheet[^>]*>|data-rows|data-columns|data-spreadsheet="true"/.test(note.content);
      
      // If we have spreadsheets, clone the content to ensure unique IDs
      if (hasSpreadsheet) {
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = note.content;
        SpreadsheetFormatter.cloneSpreadsheets(tempDiv, newTabId);
        clonedContent = tempDiv.innerHTML;
      }
    }
    
    const newTab: Tab = {
      id: newTabId,
      title: note ? note.title : '',
      content: clonedContent,
      attachments: note ? note.attachments : undefined,
      isNew: !note,
      version: note ? note.version : undefined,
      noteId: note ? note.id : undefined,
      syncStatus: note ? 'synced' : 'pending',
      lastEdited: new Date().toISOString(),
      pinned: false, // Ensure new tabs are never pinned by default
      attachmentSectionExpanded: false, // Default to collapsed for all new tabs
      spreadsheetData: hasSpreadsheet // Set spreadsheet data flag based on detection
    };

    setTabs((prevTabs) => {
      const updatedTabs = [...prevTabs, newTab];
      return updatedTabs;
    });
    
    setActiveTabId(newTabId);
    
    // Mark this tab as needing initialization 
    tabContentRefsMap.current.set(newTabId, { initialized: false });
    
    // Associate the new tab with the current page
    updateTabAssociations(newTabId);
    
    // Explicitly load attachments for the new tab if it has any
    if (note && note.attachments && note.attachments.length > 0) {
      // Use setTimeout to ensure the tab state is updated before loading attachments
      setTimeout(() => {
        loadAttachmentsForTab(newTabId);
      }, 100); // Slightly longer timeout to ensure state is fully updated
    }
  };

  const updateTab = (note: Note) => {
    setTabs(prev => prev.map(tab => {
      // Match by either tab.id or tab.noteId
      if (tab.id === note.id || tab.noteId === note.id) {
        return {
          ...tab,
          noteId: note.id, // Always update noteId
          title: note.title,
          content: note.content,
          version: note.version,
          syncStatus: 'synced' as const
        };
      }
      return tab;
    }));
  };

  const removeTabContent = async (noteId: string) => {
    // First, clean up all attachments for this note ID
    if (noteId) {
      await TabCacheManager.cleanupAttachmentsForNote(noteId);
    }
    
    // Find all tabs associated with this noteId
    const tabsToUpdate = tabs.filter(tab => tab.noteId === noteId || tab.id === noteId);
    
    if (tabsToUpdate.length === 0) {
      return;
    }
    
    // Process each tab
    for (const tab of tabsToUpdate) {
      if (tab.id === activeTabId) {
        // For active tab: Clear content but keep the tab
        // Check if the tab was pinned before
        const wasPinned = tab.pinned;
        if (wasPinned) {
        }
        
        // Update the tab state to clear content and references
        setTabs(prevTabs => prevTabs.map(t => {
          if (t.id === tab.id) {
            return {
              ...t,
              title: '',
              content: '',
              noteId: undefined, // Clear the noteId
              version: undefined,
              attachments: undefined, // Clear attachment references
              loadedAttachments: undefined, // Clear loaded attachments
              isNew: true,
              syncStatus: 'pending' as const,
              lastEdited: new Date().toISOString(),
              pinned: false, // Always reset pinned status
              attachmentSectionExpanded: false // Reset attachment section expanded state
            };
          }
          return t;
        }));
        
        // Notify parent of changes
        onContentChange(
          activeTabId,
          '',
          '',
          undefined,
          undefined
        );
      } else {
        // For inactive tabs: Remove them completely
        // Use closeTab which properly cleans up the tab
        await closeTab(tab.id);
      }
    }
    
    // Clean up any orphaned attachments
    await TabCacheManager.cleanupOrphanedAttachments();
  };

  const removeTabByNoteId = async (noteId: string) => {
    // First, clean up all attachments for this note ID
    if (noteId) {
      await TabCacheManager.cleanupAttachmentsForNote(noteId);
    }
    
    // Find all tabs associated with this noteId
    const tabsToRemove = tabs.filter(tab => tab.noteId === noteId);
    
    if (tabsToRemove.length === 0) {
      return;
    }
    
    // Process each tab
    for (const tab of tabsToRemove) {
      await closeTab(tab.id);
    }
    
    // Clean up any orphaned attachments
    await TabCacheManager.cleanupOrphanedAttachments();
  };
  
  useImperativeHandle(ref, () => ({
    addTab: (note: Note) => {
      // Use the component-level addTab function for consistency
      // We don't force new tabs when opening notes, so forceNew=false
      addTab(note, false);
    },
    updateTab: (savedNote: Note) => {
      setTabs(prevTabs => prevTabs.map(tab =>
        tab.id === activeTabId ? {
          ...tab,
          id: savedNote.id,
          title: savedNote.title,
          content: savedNote.content,
          version: savedNote.version,
          createdAt: savedNote.createdAt,
          updatedAt: savedNote.updatedAt,
          syncStatus: 'synced' as const,
          isNew: false,
          // Preserve the current attachment section expanded state
          attachmentSectionExpanded: tab.attachmentSectionExpanded
        } : tab
      ));

      if (activeTabId.startsWith('new-')) {
        setActiveTabId(savedNote.id);
      }
    },
    getActiveTab: () => {
      const activeTab = tabs.find(tab => tab.id === activeTabId);
      if (!activeTab) return null;
      
      return {
        id: activeTab.id,
        title: activeTab.title,
        content: activeTab.content,
        version: activeTab.version,
        noteId: activeTab.noteId,
        attachments: activeTab.loadedAttachments
      };
    },
    updateTabContent: (id: string, title: string, content: string) => {
      updateTabState(id, {
        title,
        content,
        syncStatus: 'pending' as const
      });
    },
    removeTabContent: async (noteId: string) => {
      await removeTabContent(noteId);
    },
    removeTabByNoteId: async (noteId: string) => {
      await removeTabByNoteId(noteId);
    },
    updateTabWithId: (tabId: string, note: Note) => {
      // If the note content contains spreadsheets, we need to ensure spreadsheet IDs are preserved
      // We can't just replace the content directly if the tab already has spreadsheets
      const tab = tabs.find(t => t.id === tabId);
      
      if (tab) {
        let clonedContent = note.content;
        let hasSpreadsheet = note.content.includes('ga-spreadsheet-container');
        
        // Use more robust detection if simple check doesn't find spreadsheets
        if (!hasSpreadsheet) {
          hasSpreadsheet = /<div[^>]*class=[^>]*ga-spreadsheet[^>]*>|data-rows|data-columns|data-spreadsheet="true"/.test(note.content);
        }
        
        // If the tab already had spreadsheet data, preserve that information
        if (tab.spreadsheetData) {
          hasSpreadsheet = true;
        }
        
        // If we're updating a tab that didn't previously have a noteId, 
        // or if we're changing to a different note, clone the spreadsheets
        if ((!tab.noteId && note.id) || (tab.noteId && tab.noteId !== note.id)) {
          if (hasSpreadsheet) {
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = note.content;
            SpreadsheetFormatter.cloneSpreadsheets(tempDiv, tabId);
            clonedContent = tempDiv.innerHTML;
          }
        }
        
        // Check if this is a new note or an update to an existing note
        const isNewNote = !tab.noteId && note.id;
        
        setTabs(prevTabs => prevTabs.map(t => {
          if (t.id === tabId) {
            return {
              ...t,
              noteId: note.id,
              title: note.title,
              content: clonedContent,
              version: note.version,
              attachments: note.attachments,
              isNew: false,
              syncStatus: 'synced' as const,
              spreadsheetData: hasSpreadsheet,
              // For new notes, set attachmentSectionExpanded to false
              // For existing notes, preserve the current state
              attachmentSectionExpanded: isNewNote ? false : t.attachmentSectionExpanded
            };
          }
          return t;
        }));
        
        // Schedule deserialization for the updated tab if it contains spreadsheet data
        if (contentRef.current && tabId === activeTabId && hasSpreadsheet) {
          setTimeout(() => {
            if (contentRef.current) {
              SpreadsheetFormatter.deserializeSpreadsheets(contentRef.current, tabId);
            }
          }, 100);
        }
      }
    },
    isNoteOpenInAnyTab: (noteId: string) => {
      return tabs.some(tab => tab.noteId === noteId || tab.id === noteId);
    },
    addPendingAttachment: async (tabId: string, attachment: Attachment) => {
      // Get current cache
      const currentCache = await TabCacheManager.initCache();
      if (!currentCache) return;
      
      // Use TabCacheManager to add the attachment
      const updatedCache = await TabCacheManager.addAttachmentToTab(
        currentCache,
        tabId,
        attachment
      );
      
      // Update tabs state and set attachment section to expanded
      // This is a user-initiated attachment addition, so we should expand the section
      const tab = tabs.find(t => t.id === tabId);
      if (tab) {
        // Use updateTabState to ensure all necessary updates happen
        updateTabState(tabId, {
          attachments: updatedCache.tabs.find(t => t.id === tabId)?.attachments,
          loadedAttachments: [...(tab.loadedAttachments || []), attachment],
          attachmentSectionExpanded: true // Explicitly expand when adding attachment
        });
      } else {
        // Fallback if tab not found
        setTabs(updatedCache.tabs);
      }
    },
    pinTab: async (tabId: string) => {
      await handlePinTab(tabId);
    },
    unpinTab: async (tabId: string) => {
      await handleUnpinTab(tabId);
    },
    isPinned: (tabId: string) => {
      const tab = tabs.find(tab => tab.id === tabId);
      return tab?.pinned === true;
    },
    syncCache: async () => {
      await syncCache();
    },
    handleSave: async (tabId: string, note: Note) => {
      await handleSave(tabId, note);
    },
    setAttachmentSectionExpanded: (tabId: string, isExpanded: boolean) => {
      handleAttachmentSectionExpandedChange(tabId, isExpanded);
    },
    isAttachmentSectionExpanded: (tabId: string) => {
      const tab = tabs.find(tab => tab.id === tabId);
      return tab?.attachmentSectionExpanded === true;
    }
  }));

  const handleTabClick = (tabId: string) => {
    // Don't do anything if we're already on this tab
    if (tabId === activeTabId) return;
    
    // First, serialize any spreadsheets in the current active tab if it exists
    const currentActiveTab = tabs.find(tab => tab.id === activeTabId);
    if (currentActiveTab && contentRef.current) {
      // Before serializing, ensure all spreadsheets have the current tab ID
      const spreadsheets = contentRef.current.querySelectorAll('.ga-spreadsheet-container');
      spreadsheets.forEach(spreadsheet => {
        spreadsheet.setAttribute('data-tab-id', activeTabId);
      });
      
      // Serialize spreadsheets before switching tabs
      SpreadsheetFormatter.serializeSpreadsheets(contentRef.current);
      
      // Update the tab content with serialized spreadsheet data
      const formattedContent = TextFormatter.getFormattedContent(contentRef.current);
      if (formattedContent !== currentActiveTab.content) {
        updateTabState(currentActiveTab.id, {
          content: formattedContent,
          syncStatus: 'pending'
        }, false, false);
      }
      
      // Explicitly clean up resources for the active tab
      SpreadsheetFormatter.cleanup(activeTabId);
    }
    
    setActiveTabId(tabId);
    
    // Associate this tab with the current page
    updateTabAssociations(tabId);
    
    // Load attachments for the tab when it becomes active
    const tab = tabs.find(tab => tab.id === tabId);
    if (tab && tab.attachments && tab.attachments.length > 0 && !tab.loadedAttachments) {
      loadAttachmentsForTab(tabId);
    }
    
    // Schedule deserialization of spreadsheets after the tab content is rendered
    setTimeout(() => {
      if (contentRef.current && tab) {
        // Always initialize the formatter for this tab to ensure a clean state
        SpreadsheetFormatter.initialize(contentRef.current, tabId);
        tabContentRefsMap.current.set(tabId, { initialized: true });
        
        // Deserialize any spreadsheets in the tab
        if (tab.spreadsheetData) {
          SpreadsheetFormatter.deserializeSpreadsheets(contentRef.current, tabId);
          
          // Refresh control handlers to ensure buttons work
          SpreadsheetFormatter.refreshControlHandlers(contentRef.current, tabId);
        }
      }
    }, 100);
  };

  // Function to update tab associations
  const updateTabAssociations = async (tabId: string) => {
    try {
      // Send a message to the background script to associate this tab with the current page
      chrome.runtime.sendMessage({ 
        type: 'ASSOCIATE_TAB',
        tabId
      }, (response: { success: boolean, error?: string } | undefined) => {
        if (response && response.success) {
        } else {
          console.error(`Failed to associate tab ${tabId} with current page:`, response?.error);
          
          // Fall back to direct association
          TabAssociationManager.associateTabWithCurrentPage(tabId)
            .then(() => TabAssociationManager.updateGlobalActiveTab(tabId))
            .catch(err => console.error(`Failed to associate tab ${tabId} with current page (fallback):`, err));
        }
      });
    } catch (error) {
      console.error(`Failed to update associations for tab ${tabId}:`, error);
    }
  };
  
  // Unified tab update function
  const updateTabState = (
    tabId: string, 
    updates: Partial<Tab>,
    shouldNotifyChange = true,
    shouldUpdateAssociations = true // New parameter to control association updates
  ) => {
    setTabs(prevTabs => prevTabs.map(tab =>
      tab.id === tabId ? { 
        ...tab, 
        ...updates,
        lastEdited: new Date().toISOString(), // Always update the lastEdited time
        noteId: tab.noteId // Preserve the existing noteId
      } : tab
    ));

    if (shouldNotifyChange) {
      const updatedTab = tabs.find(tab => tab.id === tabId);
      if (updatedTab) {
        onContentChange(
          tabId,
          updatedTab.title,
          updatedTab.content,
          updatedTab.version,
          updatedTab.noteId
        );
      }
    }
    
    // Update the tab associations when content is changed
    if (shouldUpdateAssociations) {
      updateTabAssociations(tabId);
    }
  };

  // Update handlers using unified update function
  const handleTitleChange = (tabId: string, title: string) => {
    updateTabState(tabId, {
      title,
      syncStatus: 'pending'
    });
  };
  
  const handleContentChange = (tabId: string, content: string) => {
    // Determine if content is rich text (contains HTML tags)
    const isRichText = /<[a-z][\s\S]*>/i.test(content);
    
    // Check if content contains spreadsheet data using robust detection
    let hasSpreadsheet = content.includes('ga-spreadsheet-container');
    
    // If not found, use a more robust detection using regex
    if (!hasSpreadsheet) {
      // Look for spreadsheet-related structure even if it's an empty spreadsheet
      hasSpreadsheet = /<div[^>]*class=[^>]*ga-spreadsheet[^>]*>|data-rows|data-columns|data-spreadsheet="true"/.test(content);
    }
    
    // If the tab already had spreadsheet data, preserve that information
    const existingTab = tabs.find(tab => tab.id === tabId);
    if (existingTab?.spreadsheetData && content.trim().length > 0) {
      // If we previously had spreadsheet data and there's still content, 
      // preserve the spreadsheetData flag unless we're certain it's gone
      hasSpreadsheet = true;
    }
    
    updateTabState(tabId, {
      content,
      isRichText,
      syncStatus: 'pending',
      // Store flag indicating this tab contains spreadsheet data
      spreadsheetData: hasSpreadsheet
    });
  };

  // Handle attachment operations
  const handleAttachmentAdd = async (tabId: string, attachment: Attachment) => {
    const tab = tabs.find(t => t.id === tabId);
    if (!tab) return;

    try {
      // First, add the attachment to the tab cache
      const currentCache = await TabCacheManager.initCache();
      if (!currentCache) return;
      
      const updatedCache = await TabCacheManager.addAttachmentToTab(
        currentCache,
        tabId,
        attachment
      );
      
      // If the tab has a noteId, also update it in the database
      if (tab.noteId) {
        const updatedNote = await NotesDB.addAttachment(
          tab.noteId,
          attachment.url || '', 
          tab.title, 
          attachment.screenshotData,
          attachment.screenshotType);
          
        // Update tab state with the new attachment references from the cache
        // and add the full attachment to loadedAttachments
        const updatedTab = updatedCache.tabs.find(t => t.id === tabId);
        if (updatedTab) {
          updateTabState(tabId, {
            attachments: updatedTab.attachments,
            loadedAttachments: [...(tab.loadedAttachments || []), attachment],
            version: updatedNote.version,
            syncStatus: 'synced',
            attachmentSectionExpanded: true // Explicitly expand when adding attachment
          });
        }
      } else {
        // Just update the tab state with the new attachment references
        // and add the full attachment to loadedAttachments
        const updatedTab = updatedCache.tabs.find(t => t.id === tabId);
        if (updatedTab) {
          updateTabState(tabId, {
            attachments: updatedTab.attachments,
            loadedAttachments: [...(tab.loadedAttachments || []), attachment],
            attachmentSectionExpanded: true // Explicitly expand when adding attachment
          });
        }
      }
      
      // No need to call TabAssociationManager methods here as updateTabState already does that
    } catch (error) {
      console.error('Failed to add attachment:', error);
    }
  };

  const handleAttachmentRemove = async (tabId: string, attachment: Attachment) => { 
    if (!attachment.id) return;
    
    // Get current cache
    const currentCache = await TabCacheManager.initCache();
    if (!currentCache) return;
    
    // Use TabCacheManager to remove the attachment
    const updatedCache = await TabCacheManager.removeAttachmentFromTab(
      currentCache,
      tabId,
      attachment.id.toString()
    );
    
    // Update tabs with new attachment references and remove from loadedAttachments
    const updatedTab = updatedCache.tabs.find(t => t.id === tabId);
    if (updatedTab) {
      updateTabState(tabId, {
        attachments: updatedTab.attachments,
        loadedAttachments: (tabs.find(t => t.id === tabId)?.loadedAttachments || [])
          .filter(a => a.id !== attachment.id)
      }, true);
      
      // No need to call TabAssociationManager methods here as updateTabState already does that
    }
  };

  const handleSave = async (tabId: string, note: Note) => {
    const tab = tabs.find(t => t.id === tabId);
    if (!tab) return;

    try {
      // Ensure spreadsheets are serialized before saving
      if (contentRef.current && activeTabId === tabId) {
        SpreadsheetFormatter.serializeSpreadsheets(contentRef.current);
        
        // Get the updated content with serialized spreadsheets
        const updatedContent = TextFormatter.getFormattedContent(contentRef.current);
        
        // Update the tab content if needed
        if (updatedContent !== tab.content) {
          // Use the updated content for saving
          note.content = updatedContent;
          
          // Also update the tab content
          setTabs(prevTabs => prevTabs.map(t => {
            if (t.id === tabId) {
              return { ...t, content: updatedContent };
            }
            return t;
          }));
        }
      }

      // Load full attachments if they're not already loaded
      let attachmentsToSave: Attachment[] = [];
      
      if (tab.attachments && tab.attachments.length > 0) {
        if (tab.loadedAttachments && tab.loadedAttachments.length === tab.attachments.length) {
          // Use already loaded attachments
          attachmentsToSave = tab.loadedAttachments;
        } else {
          // Load attachments from cache
          attachmentsToSave = await TabCacheManager.loadAttachmentsForTab(tab);
        }
      }

      // Determine if content is rich text (contains HTML tags)
      const isRichText = /<[a-z][\s\S]*>/i.test(tab.content);
      
      // Check if content contains spreadsheet data using robust detection
      let hasSpreadsheet = tab.content.includes('ga-spreadsheet-container');
      
      // If not found, use a more robust detection using regex
      if (!hasSpreadsheet) {
        // Look for spreadsheet-related structure even if it's an empty spreadsheet
        hasSpreadsheet = /<div[^>]*class=[^>]*ga-spreadsheet[^>]*>|data-rows|data-columns|data-spreadsheet="true"/.test(tab.content);
      }
      
      // If the tab already had spreadsheet data, preserve that information
      if (tab.spreadsheetData) {
        hasSpreadsheet = true;
      }

      let savedNote: Note;
      
      if (!tab.noteId) {
        savedNote = await NotesDB.createNote(
          tab.title,
          tab.content,
          attachmentsToSave
        );
      } else {
        savedNote = await NotesDB.updateNote(
          tab.noteId,
          tab.title,
          tab.content,
          tab.version,
          attachmentsToSave
        );
      }

      // Update the tab with both attachment references and full attachment data
      setTabs(prevTabs => prevTabs.map(t => {
        if (t.id === tabId) {
          // Create a new tab object with updated properties
          const updatedTab = {
            ...t,
            noteId: savedNote.id,
            version: savedNote.version,
            isRichText: savedNote.isRichText, // Update isRichText flag
            spreadsheetData: hasSpreadsheet, // Set spreadsheet data flag
            syncStatus: 'synced' as const,
            // Preserve the current attachment section expanded state
            attachmentSectionExpanded: t.attachmentSectionExpanded
          };
          
          // If we have attachment data, update both references and full data
          if (savedNote.attachments && savedNote.attachments.length > 0) {
            // Store both the attachment references and the full attachment data
            updatedTab.attachments = savedNote.attachments;
            updatedTab.loadedAttachments = attachmentsToSave;
            
            // Also update the cache with the full attachment data
            setTimeout(async () => {
              try {
                const currentCache = await TabCacheManager.initCache();
                if (currentCache) {
                  // Use the TabCacheManager to update the cache with the full attachment data
                  for (const attachment of attachmentsToSave) {
                    // Add each attachment to the tab in the cache
                    await TabCacheManager.addAttachmentToTab(currentCache, tabId, attachment);
                  }
                  
                  // Verify all attachments were cached
                  const verifiedAttachments = await TabCacheManager.loadAttachmentsForTab({
                    ...updatedTab,
                    id: tabId,
                    attachments: savedNote.attachments || []
                  });
                  
                }
              } catch (error) {
                console.error(`Failed to cache attachments for note ${savedNote.id}:`, error);
              }
            }, 0);
          } else {
            // No attachments, clear both references and full data
            updatedTab.attachments = [];
            updatedTab.loadedAttachments = [];
          }
          
          return updatedTab;
        }
        return t;
      }));
      return savedNote;
    } catch (error) {
      console.error('Failed to handle save:', error);
      throw error;
    }
  };

  // Add methods to pin and unpin tabs
  const handlePinTab = async (tabId: string) => {
    // Get current cache
    const currentCache = await TabCacheManager.initCache();
    if (!currentCache) return;
    
    // Use TabCacheManager to pin the tab (this will now unpin any other pinned tabs)
    const updatedCache = await TabCacheManager.pinTab(currentCache, tabId);
    
    // Update the tabs state with the updated tabs (one pinned, others unpinned)
    setTabs(updatedCache.tabs);
    
    // Set the pinned tab as active
    setActiveTabId(tabId);
  };
  
  const handleUnpinTab = async (tabId: string) => {
    // Get current cache
    const currentCache = await TabCacheManager.initCache();
    if (!currentCache) return;
    
    // Use TabCacheManager to unpin the tab
    const updatedCache = await TabCacheManager.unpinTab(currentCache, tabId);
    
    // Update the tabs state with the unpinned tab
    setTabs(updatedCache.tabs);
  };

  // Add a function to check if a tab is pinned
  const isPinned = (tabId: string): boolean => {
    const tab = tabs.find(tab => tab.id === tabId);
    return tab?.pinned === true;
  };

  // Add a function to sort tabs with pinned tabs first
  const sortTabs = (tabs: Tab[]): Tab[] => {
    // Return tabs in their original order (creation order)
    // We no longer sort by pinned status, we just use CSS to highlight pinned tabs
    return [...tabs];
  };

  // Add a method to synchronize the cache
  const syncCache = async () => {
    try {
      // Send a message to the background script to sync tabs
      chrome.runtime.sendMessage({ 
        type: 'SYNC_TABS'
      }, async (response: { success: boolean, syncedCache?: TabCache, error?: string }) => {
        if (response && response.success && response.syncedCache) {
          const syncedCache = response.syncedCache;
          
          // Update the tabs state with the synchronized cache
          setTabs(syncedCache.tabs);
          
          // Update the active tab ID
          setActiveTabId(syncedCache.activeTabId);
          
          // Load attachments for the active tab
          const activeTab = syncedCache.tabs.find(tab => tab.id === syncedCache.activeTabId);
          if (activeTab && activeTab.attachments && activeTab.attachments.length > 0) {
            loadAttachmentsForTab(activeTab.id);
          }
          
          // Deserialize spreadsheets for the active tab if it has spreadsheet data
          if (activeTab && activeTab.spreadsheetData) {
            setTimeout(() => {
              if (contentRef.current) {
                // Initialize if needed
                if (!tabContentRefsMap.current.has(activeTab.id)) {
                  SpreadsheetFormatter.initialize(contentRef.current, activeTab.id);
                  tabContentRefsMap.current.set(activeTab.id, { initialized: true });
                }
                
                SpreadsheetFormatter.deserializeSpreadsheets(contentRef.current, activeTab.id);
                
                // Refresh control handlers to ensure buttons work
                SpreadsheetFormatter.refreshControlHandlers(contentRef.current, activeTab.id);
              }
            }, 100);
          }
        } else {
          console.error('Failed to sync tabs via background script:', response?.error);
          
          // Fall back to direct synchronization
          const syncedCache = await TabCacheManager.syncCache();
          
          if (syncedCache) {
            // Update the tabs state with the synchronized cache
            setTabs(syncedCache.tabs);
            
            // Update the active tab ID
            setActiveTabId(syncedCache.activeTabId);
            
            // Load attachments for the active tab
            const activeTab = syncedCache.tabs.find(tab => tab.id === syncedCache.activeTabId);
            if (activeTab && activeTab.attachments && activeTab.attachments.length > 0) {
              loadAttachmentsForTab(activeTab.id);
            }
            
            // Deserialize spreadsheets for the active tab if it has spreadsheet data
            if (activeTab && activeTab.spreadsheetData) {
              setTimeout(() => {
                if (contentRef.current) {
                  // Initialize if needed
                  if (!tabContentRefsMap.current.has(activeTab.id)) {
                    SpreadsheetFormatter.initialize(contentRef.current, activeTab.id);
                    tabContentRefsMap.current.set(activeTab.id, { initialized: true });
                  }
                  
                  SpreadsheetFormatter.deserializeSpreadsheets(contentRef.current, activeTab.id);
                  
                  // Refresh control handlers to ensure buttons work
                  SpreadsheetFormatter.refreshControlHandlers(contentRef.current, activeTab.id);
                }
              }, 100);
            }
          }
        }
      });
    } catch (error) {
      console.error('Failed to synchronize cache:', error);
    }
  };

  // Add a method to handle visibility changes
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        // Send a message to the background script to sync tabs
        chrome.runtime.sendMessage({ 
          type: 'TAB_VISIBILITY_CHANGE',
          isVisible: true
        }, (response: { success: boolean, syncedCache?: TabCache, error?: string } | undefined) => {
          if (response && response.success) {
            syncCache();
          } else {
            console.error('Failed to sync tabs after visibility change:', response?.error);
          }
        });
      }
    };
    
    // Add event listener for visibility changes
    document.addEventListener('visibilitychange', handleVisibilityChange);
    
    // Synchronize cache on mount
    syncCache();
    
    // Clean up event listener on unmount
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  // Add a method to handle attachment section expanded state changes
  const handleAttachmentSectionExpandedChange = (tabId: string, isExpanded: boolean) => {
    setTabs(prevTabs => prevTabs.map(tab => {
      if (tab.id === tabId) {
        return {
          ...tab,
          attachmentSectionExpanded: isExpanded
        };
      }
      return tab;
    }));
  };

  // Update renderActiveTab to use the top-level contentRef
  const renderActiveTab = () => {
    const activeTab = tabs.find(tab => tab.id === activeTabId);
    
    if (!activeTab) {
      return <div className="empty-state">No active tab</div>;
    }
    
    return (
      <NoteInput
        title={activeTab.title}
        content={activeTab.content}
        attachments={activeTab.loadedAttachments}
        noteId={activeTab.noteId}
        contentRef={contentRef} // Pass the ref to NoteInput
        tabId={activeTab.id} // Pass the tab ID to NoteInput for SpreadsheetFormatter
        onTitleChange={(title) => handleTitleChange(activeTab.id, title)}
        onContentChange={(content) => handleContentChange(activeTab.id, content)}
        onAttachmentAdd={(attachment) => handleAttachmentAdd(activeTab.id, attachment)}
        onAttachmentRemove={(attachment) => handleAttachmentRemove(activeTab.id, attachment)}
        isAttachmentSectionExpanded={activeTab.attachmentSectionExpanded}
        onAttachmentSectionExpandedChange={(isExpanded) => handleAttachmentSectionExpandedChange(activeTab.id, isExpanded)}
        onFormatChange={(event) => handleFormatChange(activeTab.id, event)}
      />
    );
  };

  // Add a new handler for format changes
  const handleFormatChange = (tabId: string, event?: { type: string, isEmpty?: boolean }) => {
    const tab = tabs.find(t => t.id === tabId);
    if (tab) {
      // Check if this is a spreadsheet insertion event
      const isSpreadsheetInsert = event?.type === 'spreadsheet-insert';
      
      if (isSpreadsheetInsert) {
        // For spreadsheet insertions, explicitly set the spreadsheetData flag
        updateTabState(tabId, { 
          syncStatus: 'pending',
          spreadsheetData: true // Always set to true for spreadsheet insertions
        });
      } else {
        // For other formatting changes, just update the sync status
        updateTabState(tabId, { syncStatus: 'pending' });
      }
      
      // Notify parent of changes
      onChangeStatus(true);
    }
  };

  return (
    <div className="tab-manager">
      <div className="tab-list">
        {tabs.map(tab => (
          <div 
            key={tab.id}
            className={`tab ${activeTabId === tab.id ? 'active' : ''} ${tab.pinned ? 'pinned' : ''} ${tab.syncStatus}`}
            onClick={() => handleTabClick(tab.id)}
          >
            {tab.pinned && <span className="pin-indicator" title="Pinned">📌</span>}
            <span>{tab.isNew ? 'New Note' : (tab.title || 'Untitled')}</span>
            <div className="tab-actions">
              <button 
                className="pin-tab"
                onClick={(e) => {
                  e.stopPropagation();
                  if (tab.pinned) {
                    handleUnpinTab(tab.id);
                  } else {
                    handlePinTab(tab.id);
                  }
                }}
                title={tab.pinned ? "Unpin tab" : "Pin tab"}
              >
                {tab.pinned ? "📌" : "📍"}
              </button>
              <button 
                className="close-tab"
                onClick={(e) => {
                  e.stopPropagation();
                  confirmCloseTab(tab.id);
                }}
              >
                ×
              </button>
            </div>
            <div className={`sync-indicator ${tab.syncStatus}`} title={`Status: ${tab.syncStatus}`}></div>
          </div>
        ))}
        <button 
          className="new-tab-button"
          onClick={() => addTab(undefined, true)}
          title="New Tab"
        >
          +
        </button>
      </div>
      <div className="tab-content">
        {renderActiveTab()}
      </div>
      
      {/* Add Confirmation Dialog */}
      <ConfirmationDialog
        isOpen={confirmationState.isOpen}
        tabId={confirmationState.tabId}
        tabTitle={tabs.find(tab => tab.id === confirmationState.tabId)?.title || ''}
        onConfirm={handleSaveAndClose}
        onCancel={handleCloseWithoutSaving}
        onClose={() => setConfirmationState({ isOpen: false, tabId: '', hasUnsavedChanges: false })}
      />
    </div>
  );
});

export default TabManager; 