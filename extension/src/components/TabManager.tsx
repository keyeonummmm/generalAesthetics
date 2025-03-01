import { useState, forwardRef, useImperativeHandle, useEffect, useRef } from 'react';
import NoteInput from './NoteInput';
import { Note, DBProxy as NotesDB } from '../lib/DBProxy';
import { Attachment } from '../lib/Attachment';
import '../styles/components/tab-manager.css';
import { v4 as uuidv4 } from 'uuid';
import { TabCacheManager, Tab as CacheTab, TabCache, AttachmentReference } from '../lib/TabCacheManager';

interface Tab {
  id: string;
  title: string;
  content: string;
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
}

interface TabManagerProps {
  onChangeStatus: (hasUnsavedChanges: boolean) => void;
  onContentChange: (tabId: string, title: string, content: string, version?: number, noteId?: string) => void;
}

export interface TabManagerRef {
  addTab: (note: Note) => void;
  updateTab: (note: Note) => void;
  removeTabByNoteId: (noteId: string) => void;
  getActiveTab: () => {
    id: string;
    title: string;
    content: string;
    version?: number;
    noteId?: string;
    attachments?: Attachment[];
  } | null;
  updateTabContent: (id: string, title: string, content: string) => void;
  removeTabContent: (noteId: string) => void;
  updateTabWithId: (tabId: string, note: Note) => void;
  isNoteOpenInAnyTab: (noteId: string) => boolean;
  addPendingAttachment: (tabId: string, attachment: Attachment) => void;
  pinTab: (tabId: string) => Promise<void>;
  unpinTab: (tabId: string) => Promise<void>;
  isPinned: (tabId: string) => boolean;
  syncCache: () => Promise<void>;
  
  handleSave: (tabId: string, note: Note) => Promise<void>;
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
}, ref) => {
  const [tabs, setTabs] = useState<Tab[]>(() => {
    const initialTab: Tab = { 
      id: `new-${uuidv4()}`, 
      title: '', 
      content: '', 
      isNew: true, 
      syncStatus: 'pending' as const,
      lastEdited: new Date().toISOString()
    };
    return [initialTab];
  });

  const [activeTabId, setActiveTabId] = useState<string>('');
  const [loadingAttachments, setLoadingAttachments] = useState(false);
  
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
            lastEdited: new Date().toISOString()
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
          lastEdited: new Date().toISOString()
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
      console.log(`Tab ${tabId} has no attachments to load`);
      return;
    }
    
    // Skip if attachments are already loaded and match the expected count
    if (tab.loadedAttachments && tab.loadedAttachments.length === tab.attachments.length) {
      console.log(`Attachments for tab ${tabId} are already loaded (${tab.loadedAttachments.length} items)`);
      return;
    }
    
    console.log(`Loading ${tab.attachments.length} attachments for tab ${tabId}`);
    setLoadingAttachments(true);
    
    try {
      // First try to load from cache
      const loadedAttachments = await TabCacheManager.loadAttachmentsForTab(tab);
      
      // If we couldn't load all attachments from cache and this is a saved note,
      // try loading them from the database
      if (loadedAttachments.length < tab.attachments.length && tab.noteId) {
        console.log(`Not all attachments were found in cache for note ${tab.noteId}. Trying to load from database...`);
        
        try {
          // Get the full note with attachments from the database
          const fullNote = await NotesDB.getNote(tab.noteId);
          
          if (fullNote && fullNote.attachments && fullNote.attachments.length > 0) {
            console.log(`Found ${fullNote.attachments.length} attachments in database for note ${tab.noteId}`);
            
            // If we found attachments in the database, update the cache with them
            const currentCache = await TabCacheManager.initCache();
            if (currentCache) {
              for (const attachment of fullNote.attachments) {
                // Only add if it has the required data and isn't already loaded
                if ((attachment.screenshotData || attachment.url) && 
                    !loadedAttachments.some(a => a.id === attachment.id)) {
                  console.log(`Restoring attachment ${attachment.id} to cache for note ${tab.noteId}`);
                  await TabCacheManager.addAttachmentToTab(currentCache, tabId, attachment);
                }
              }
              
              // After updating the cache, try loading again
              const reloadedAttachments = await TabCacheManager.loadAttachmentsForTab(tab);
              
              if (reloadedAttachments.length > loadedAttachments.length) {
                console.log(`Successfully restored ${reloadedAttachments.length - loadedAttachments.length} attachments from database to cache`);
                
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
            console.log(`No attachments found in database for note ${tab.noteId}`);
          }
        } catch (error) {
          console.error(`Failed to load attachments from database for note ${tab.noteId}:`, error);
        }
      }
      
      console.log(`Successfully loaded ${loadedAttachments.length} attachments for tab ${tabId}`);
      
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
    console.log('Confirming tab close:', tabId);
    
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
      console.log('Tab is completely clean, closing without confirmation');
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
            console.log('Tab has no changes compared to saved note, closing without confirmation');
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
            console.log('Detected unsaved changes compared to saved note:', {
              titleChanged,
              contentChanged
            });
          }
        }
      } catch (error) {
        console.error('Error checking for unsaved changes:', error);
        // If we can't check, assume there are changes
        hasUnsavedChanges = true;
      }
    }
    
    if (hasUnsavedChanges) {
      console.log('Tab has unsaved changes, showing confirmation dialog');
      // Show confirmation dialog
      setConfirmationState({
        isOpen: true,
        tabId,
        hasUnsavedChanges
      });
    } else {
      console.log('No unsaved changes detected, closing tab immediately');
      // No unsaved changes, close immediately
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
          console.log('Loading attachments for save operation');
          attachmentsToSave = await TabCacheManager.loadAttachmentsForTab(tab);
        }
      }
      
      console.log('Saving note before closing tab:', {
        tabId,
        title: tab.title,
        hasAttachments: attachmentsToSave.length > 0,
        attachmentCount: attachmentsToSave.length
      });
      
      let savedNote: Note;
      
      if (!tab.noteId) {
        // Create a new note
        savedNote = await NotesDB.createNote(
          tab.title,
          tab.content,
          attachmentsToSave
        );
        console.log('Created new note before closing tab:', savedNote.id);
      } else {
        // Update existing note
        savedNote = await NotesDB.updateNote(
          tab.noteId,
          tab.title,
          tab.content,
          tab.version,
          attachmentsToSave
        );
        console.log('Updated note before closing tab:', savedNote.id);
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
      console.log('Note saved successfully, now closing tab:', tabId);
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
    console.log('Closing tab without saving:', tabId);
    closeTab(tabId);
    
    // Reset confirmation state
    setConfirmationState({
      isOpen: false,
      tabId: '',
      hasUnsavedChanges: false
    });
  };

  const closeTab = async (tabId: string) => {
    console.log('Closing tab:', tabId);
    
    // Get current cache
    const currentCache = await TabCacheManager.initCache();
    if (!currentCache) return;
    
    // Use TabCacheManager to remove the tab and clean up its attachments
    const updatedCache = await TabCacheManager.removeTab(currentCache, tabId);
    
    // If no tabs remain, create a new empty tab
    if (updatedCache.tabs.length === 0) {
      const newTabId = `new-${uuidv4()}`;
      console.log('Creating new empty tab:', newTabId);
      const newTab: Tab = { 
        id: newTabId, 
        title: '', 
        content: '', 
        isNew: true,
        syncStatus: 'pending' as const,
        lastEdited: new Date().toISOString()
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
      console.log('Only one new tab remains, cleaning up orphaned attachments');
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
  };

  const addTab = (note?: Note, forceNew: boolean = false) => {
    console.log('Adding tab for note:', note ? {
      id: note.id,
      title: note.title,
      hasAttachments: note.attachments && note.attachments.length > 0,
      attachmentCount: note.attachments?.length || 0
    } : 'new empty tab', 'forceNew:', forceNew);
    
    // Check if this note is already open in a tab
    const existingTab = tabs.find(tab => 
      (note && (tab.id === note.id || tab.noteId === note.id))
    );

    if (existingTab) {
      // If the note is already open, just set it as active
      console.log(`Note ${note?.id} is already open in tab ${existingTab.id}, setting as active`);
      setActiveTabId(existingTab.id);
      
      // Ensure attachments are loaded if they exist but aren't loaded yet
      if (note && 
          note.attachments && 
          note.attachments.length > 0 && 
          (!existingTab.loadedAttachments || existingTab.loadedAttachments.length < note.attachments.length)) {
        console.log(`Ensuring attachments are loaded for existing tab ${existingTab.id}`);
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
        console.log(`Reusing empty tab ${tabToUpdate.id} for note ${note?.id || 'new'}`);
        
        if (note) {
          // Update the empty tab with the note's details
          updatedTabs[emptyTabIndex] = {
            ...tabToUpdate,
            title: note.title,
            content: note.content,
            attachments: note.attachments,
            isNew: false,
            version: note.version,
            noteId: note.id,
            syncStatus: 'synced' as const, // Explicitly set to synced for notes from DB
            lastEdited: new Date().toISOString()
          };
        }
        
        setTabs(updatedTabs);
        setActiveTabId(tabToUpdate.id);
        
        // Explicitly load attachments for the tab if it has any
        if (note && note.attachments && note.attachments.length > 0) {
          console.log(`Note has ${note.attachments.length} attachments, scheduling load for tab ${tabToUpdate.id}`);
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
    console.log(`Creating new tab ${newTabId} for note ${note?.id || 'new'}`);
    
    const newTab: Tab = {
      id: newTabId,
      title: note ? note.title : '',
      content: note ? note.content : '',
      attachments: note ? note.attachments : undefined,
      isNew: !note,
      version: note ? note.version : undefined,
      noteId: note ? note.id : undefined,
      syncStatus: note ? 'synced' : 'pending',
      lastEdited: new Date().toISOString()
    };

    setTabs(prevTabs => [...prevTabs, newTab]);
    setActiveTabId(newTabId);
    
    // Explicitly load attachments for the new tab if it has any
    if (note && note.attachments && note.attachments.length > 0) {
      console.log(`New tab has ${note.attachments.length} attachments, scheduling load for tab ${newTabId}`);
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

  const removeTabContent = (noteId: string) => {
    console.log('removeTabContent called for noteId:', noteId);
    
    setTabs(prevTabs => {
      return prevTabs.map(tab => {
        if (tab.noteId === noteId || tab.id === noteId) {
          if (tab.id === activeTabId) {
            // For active tab: Clear content but keep the tab
            console.log('Cleaning content for active tab:', tab.id);
            return {
              ...tab,
              id: tab.id, // Keep existing tab ID
              title: '',
              content: '',
              noteId: undefined, // Clear the noteId
              version: undefined,
              attachments: undefined,
              isNew: true,
              syncStatus: 'pending' as const,
            };
          } else {
            // For inactive tabs: Remove them in a separate operation
            console.log('Marking inactive tab for removal:', tab.id);
            // Use setTimeout to avoid recursive loop
            setTimeout(() => {
              setTabs(current => current.filter(t => t.id !== tab.id));
            }, 0);
            return tab;
          }
        }
        return tab;
      });
    });

    // Notify parent of changes if it's the active tab
    const activeTab = tabs.find(tab => tab.id === activeTabId);
    if (activeTab && (activeTab.noteId === noteId || activeTab.id === noteId)) {
      onContentChange(
        activeTabId,
        '',
        '',
        undefined,
        undefined
      );
    }
  };

  const removeTabByNoteId = (noteId: string) => {
    const tabToRemove = tabs.find(tab => tab.noteId === noteId);
    if (tabToRemove) {
      closeTab(tabToRemove.id);
    }
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
          isNew: false
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
    removeTabContent,
    removeTabByNoteId,
    updateTabWithId: (tabId: string, note: Note) => {
      console.log('TabManager.updateTabWithId called:', {
        tabId,
        note,
        currentTabs: tabs
      });
      
      setTabs(prevTabs => {
        const updatedTabs = prevTabs.map(tab => {
          if (tab.id === tabId) {
            console.log('Updating tab:', {
              before: tab,
              after: {
                ...tab,
                noteId: note.id,
                title: note.title,
                content: note.content,
                version: note.version,
                attachments: note.attachments,
                isNew: false,
                syncStatus: 'synced'
              }
            });
            return {
              ...tab,
              noteId: note.id,
              title: note.title,
              content: note.content,
              version: note.version,
              attachments: note.attachments,
              isNew: false,
              syncStatus: 'synced' as const
            };
          }
          return tab;
        });
        console.log('Tabs after update:', updatedTabs);
        return updatedTabs;
      });
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
      
      setTabs(updatedCache.tabs);
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
    }
  }));

  const handleTabClick = (tabId: string) => {
    setActiveTabId(tabId);
    
    // Load attachments for the tab when it becomes active
    const tab = tabs.find(tab => tab.id === tabId);
    if (tab && tab.attachments && tab.attachments.length > 0 && !tab.loadedAttachments) {
      loadAttachmentsForTab(tabId);
    }
  };

  // Unified tab update function
  const updateTabState = (
    tabId: string, 
    updates: Partial<Tab>,
    shouldNotifyChange = true
  ) => {
    setTabs(prevTabs => prevTabs.map(tab =>
      tab.id === tabId ? { 
        ...tab, 
        ...updates,
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
  };

  // Update handlers using unified update function
  const handleTitleChange = (tabId: string, title: string) => {
    updateTabState(tabId, {
      title,
      syncStatus: 'pending' as const
    });
  };

  const handleContentChange = (tabId: string, content: string) => {
    updateTabState(tabId, {
      content,
      syncStatus: 'pending' as const
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
            syncStatus: 'synced' as const
          });
        }
      } else {
        // Just update the tab state with the new attachment references
        // and add the full attachment to loadedAttachments
        const updatedTab = updatedCache.tabs.find(t => t.id === tabId);
        if (updatedTab) {
          setTabs(prevTabs => prevTabs.map(t => 
            t.id === tabId ? { 
              ...t, 
              attachments: updatedTab.attachments,
              loadedAttachments: [...(t.loadedAttachments || []), attachment]
            } : t
          ));
        }
      }
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
      setTabs(prevTabs => prevTabs.map(t => {
        if (t.id === tabId) {
          return {
            ...t,
            attachments: updatedTab.attachments,
            loadedAttachments: (t.loadedAttachments || []).filter(a => a.id !== attachment.id)
          };
        }
        return t;
      }));
      
      // Update parent components about the change
      onContentChange(
        tabId,
        updatedTab.title,
        updatedTab.content,
        updatedTab.version,
        updatedTab.noteId
      );
    }
  };

  const handleSave = async (tabId: string, note: Note) => {
    const tab = tabs.find(t => t.id === tabId);
    if (!tab) return;

    try {
      // Load full attachments if they're not already loaded
      let attachmentsToSave: Attachment[] = [];
      
      if (tab.attachments && tab.attachments.length > 0) {
        if (tab.loadedAttachments && tab.loadedAttachments.length === tab.attachments.length) {
          // Use already loaded attachments
          attachmentsToSave = tab.loadedAttachments;
        } else {
          // Load attachments from cache
          console.log('Loading attachments for save operation');
          attachmentsToSave = await TabCacheManager.loadAttachmentsForTab(tab);
        }
      }
      
      console.log('Saving with attachments:', {
        count: attachmentsToSave.length,
        attachments: attachmentsToSave.map(a => ({
          id: a.id,
          type: a.type,
          hasScreenshotData: !!a.screenshotData,
          hasThumbnailData: !!a.thumbnailData,
          metadata: a.metadata
        }))
      });

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
            syncStatus: 'synced' as const
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
                  console.log(`Ensuring ${attachmentsToSave.length} attachments are cached for saved note ${savedNote.id}`);
                  
                  for (const attachment of attachmentsToSave) {
                    // Add each attachment to the tab in the cache
                    await TabCacheManager.addAttachmentToTab(currentCache, tabId, attachment);
                    console.log(`Cached attachment ${attachment.id} for note ${savedNote.id}`);
                  }
                  
                  // Verify all attachments were cached
                  const verifiedAttachments = await TabCacheManager.loadAttachmentsForTab({
                    ...updatedTab,
                    id: tabId,
                    attachments: savedNote.attachments || []
                  });
                  
                  console.log(`Verification: ${verifiedAttachments.length} of ${savedNote.attachments?.length || 0} attachments are in cache for note ${savedNote.id}`);
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

      console.log('Tab updated after save:', {
        tabId,
        noteId: savedNote.id,
        isNewNote: !tab.noteId,
        attachments: savedNote.attachments
      });

      return savedNote;
    } catch (error) {
      console.error('Failed to handle save:', error);
      throw error;
    }
  };

  // Add methods to pin and unpin tabs
  const handlePinTab = async (tabId: string) => {
    console.log('Pinning tab:', tabId);
    
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
    console.log('Unpinning tab:', tabId);
    
    // Get current cache
    const currentCache = await TabCacheManager.initCache();
    if (!currentCache) return;
    
    // Use TabCacheManager to unpin the tab
    const updatedCache = await TabCacheManager.unpinTab(currentCache, tabId);
    
    // Update the tabs state with the unpinned tab
    setTabs(updatedCache.tabs);
  };

  // Add a function to sort tabs with pinned tabs first
  const sortTabs = (tabs: Tab[]): Tab[] => {
    // Return tabs in their original order (creation order)
    // We no longer sort by pinned status, we just use CSS to highlight pinned tabs
    return [...tabs];
  };

  // Add a method to synchronize the cache
  const syncCache = async () => {
    console.log('Synchronizing cache...');
    
    try {
      // Use TabCacheManager to synchronize the cache
      const syncedCache = await TabCacheManager.syncCache();
      
      if (syncedCache) {
        console.log('Cache synchronized successfully:', {
          tabCount: syncedCache.tabs.length,
          activeTabId: syncedCache.activeTabId
        });
        
        // Update the tabs state with the synchronized cache
        setTabs(syncedCache.tabs);
        
        // Update the active tab ID
        setActiveTabId(syncedCache.activeTabId);
        
        // Load attachments for the active tab
        const activeTab = syncedCache.tabs.find(tab => tab.id === syncedCache.activeTabId);
        if (activeTab && activeTab.attachments && activeTab.attachments.length > 0) {
          loadAttachmentsForTab(activeTab.id);
        }
      }
    } catch (error) {
      console.error('Failed to synchronize cache:', error);
    }
  };

  // Add a method to handle visibility changes
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        console.log('Extension became visible, synchronizing cache...');
        syncCache();
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

  return (
    <div className="tab-manager">
      <div className="tab-list">
        {tabs.map(tab => (
          <div 
            key={tab.id}
            className={`tab ${activeTabId === tab.id ? 'active' : ''} ${tab.pinned ? 'pinned' : ''}`}
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
        {(() => {
          const activeTab = tabs.find(tab => tab.id === activeTabId);
          if (!activeTab) return null;
          
          return (
            <div className="tab-wrapper">
              <div className="tab-metadata">
                {activeTab.version && <span className="version">v{activeTab.version}</span>}
                <span className={`sync-status ${activeTab.syncStatus}`}>
                  {activeTab.syncStatus}
                </span>
                {loadingAttachments && <span className="loading-attachments">Loading attachments...</span>}
              </div>
              <NoteInput
                title={activeTab.title}
                content={activeTab.content}
                attachments={activeTab.loadedAttachments}
                noteId={activeTab.noteId}
                onTitleChange={(title) => handleTitleChange(activeTab.id, title)}
                onContentChange={(content) => handleContentChange(activeTab.id, content)}
                onAttachmentAdd={(attachment) => handleAttachmentAdd(activeTab.id, attachment)}
                onAttachmentRemove={(attachment) => handleAttachmentRemove(activeTab.id, attachment)}
              />
            </div>
          );
        })()}
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