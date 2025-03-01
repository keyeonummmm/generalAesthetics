import { useState, forwardRef, useImperativeHandle, useEffect, useRef, useCallback } from 'react';
import NoteInput from './NoteInput';
import { Note, DBProxy as NotesDB } from '../lib/DBProxy';
import { Attachment, AttachmentManager } from '../lib/Attachment';
import '../styles/components/tab-manager.css';
import { v4 as uuidv4 } from 'uuid';
import { TabCacheManager, Tab as CacheTab, TabCache, AttachmentReference, StorageChangeEvent } from '../lib/TabCacheManager';
import { useVisibilityChange } from '../hooks/useVisibilityChange';

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
  // Add new fields for conflict detection and version tracking
  localVersion: number;
  lastSyncedVersion?: number;
  instanceId?: string;
  hasConflict?: boolean;
  conflictInfo?: {
    originalTabId: string;
    conflictingTabId: string;
    timestamp: string;
    instanceId: string;
    resolved: boolean;
  };
}

interface TabManagerProps {
  onChangeStatus: (hasUnsavedChanges: boolean) => void;
  onContentChange: (tabId: string, title: string, content: string, version?: number, noteId?: string) => void;
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
  syncCache: () => Promise<boolean>;
  
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
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-lg max-w-md w-full">
        <h3 className="text-lg font-medium mb-4 dark:text-white">Unsaved Changes</h3>
        <p className="mb-6 dark:text-gray-300">
          You have unsaved changes in "{displayTitle}". Would you like to save before closing?
        </p>
        <div className="flex justify-end space-x-3">
          <button
            onClick={() => onCancel(tabId)}
            className="px-4 py-2 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
          >
            Don't Save
          </button>
          <button
            onClick={() => onConfirm(tabId)}
            className="px-4 py-2 bg-blue-600 text-white hover:bg-blue-700 rounded"
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
      lastEdited: new Date().toISOString(),
      localVersion: 0
    };
    return [initialTab];
  });

  const [activeTabId, setActiveTabId] = useState<string>('');
  const [loadingAttachments, setLoadingAttachments] = useState(false);
  
  // Add state for confirmation dialog
  const [confirmationState, setConfirmationState] = useState<{
    isOpen: boolean;
    tabId: string;
    tabTitle: string;
    action: string;
  }>({
    isOpen: false,
    tabId: '',
    tabTitle: '',
    action: ''
  });

  // Add state for conflict handling
  const [showConflictDialog, setShowConflictDialog] = useState(false);
  const [conflictingTabs, setConflictingTabs] = useState<Tab[]>([]);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  // Track visibility changes to sync cache when tab becomes visible
  const isVisible = useVisibilityChange();

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
            localVersion: 0
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
          localVersion: 0
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
      const loadedAttachments = await TabCacheManager.loadAttachmentsForTab(tab as CacheTab);
      
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
              const reloadedAttachments = await TabCacheManager.loadAttachmentsForTab(tab as CacheTab);
              
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
    
    if (!tab) {
      console.warn(`Tab ${tabId} not found for confirmation`);
      return;
    }
    
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
      console.log('Tab is synced with no changes, closing without confirmation');
      closeTab(tabId);
      return;
    }
    
    // Check if there are unsaved changes
    const hasUnsavedChanges = tab.syncStatus === 'pending';
    
    if (hasUnsavedChanges) {
      console.log('Tab has unsaved changes, showing confirmation dialog');
      setConfirmationState({
        isOpen: true,
        tabId,
        tabTitle: tab.title || 'Untitled',
        action: 'close'
      });
    } else {
      console.log('Tab has no unsaved changes, closing without confirmation');
      closeTab(tabId);
    }
  };
  
  const handleSaveAndClose = async (tabId: string) => {
    const tab = tabs.find(t => t.id === tabId);
    if (!tab) return;
    
    try {
      // Save the tab first
      await handleSave(tabId, {
        id: tab.noteId || '',
        title: tab.title,
        content: tab.content,
        version: tab.version || 0,
        attachments: tab.loadedAttachments || [],
        createdAt: tab.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
      
      // Then close it
      await handleCloseWithoutSaving(tabId);
    } catch (error) {
      console.error('Failed to save and close tab:', error);
      // Show error message to user
      alert('Failed to save note before closing. Please try again.');
    }
  };
  
  const handleCloseWithoutSaving = (tabId: string) => {
    console.log('Closing tab without saving:', tabId);
    closeTab(tabId);
    
    // Reset confirmation state
    setConfirmationState({
      isOpen: false,
      tabId: '',
      tabTitle: '',
      action: ''
    });
  };

  const closeTab = async (tabId: string) => {
    console.log('Closing tab:', tabId);
    
    // Get the tab before we remove it
    const tabToClose = tabs.find(tab => tab.id === tabId);
    if (!tabToClose) {
      console.warn(`Tab ${tabId} not found for closing`);
      return;
    }
    
    // Check if the tab has unsaved changes
    if (tabToClose.syncStatus === 'pending') {
      // Show confirmation dialog
      setConfirmationState({
        isOpen: true,
        tabId,
        tabTitle: tabToClose.title || 'Untitled',
        action: 'close'
      });
      return;
    }
    
    // No unsaved changes, proceed with closing
    await handleCloseWithoutSaving(tabId);
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
            lastEdited: new Date().toISOString(),
            pinned: false, // Ensure the tab is not pinned by default
            localVersion: 0
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
      lastEdited: new Date().toISOString(),
      pinned: false, // Ensure new tabs are never pinned by default
      localVersion: 0
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

  const removeTabContent = async (noteId: string) => {
    console.log('removeTabContent called for noteId:', noteId);
    
    // First, clean up all attachments for this note ID
    if (noteId) {
      console.log(`Cleaning up attachments for note ${noteId}`);
      await TabCacheManager.cleanupAttachmentsForNote(noteId);
    }
    
    // Find all tabs associated with this noteId
    const tabsToUpdate = tabs.filter(tab => tab.noteId === noteId || tab.id === noteId);
    
    if (tabsToUpdate.length === 0) {
      console.log(`No tabs found for note ${noteId}`);
      return;
    }
    
    console.log(`Found ${tabsToUpdate.length} tabs associated with note ${noteId}`);
    
    // Process each tab
    for (const tab of tabsToUpdate) {
      if (tab.id === activeTabId) {
        // For active tab: Clear content but keep the tab
        console.log('Cleaning content for active tab:', tab.id);
        
        // Check if the tab was pinned before
        const wasPinned = tab.pinned;
        if (wasPinned) {
          console.log(`Unpinning tab ${tab.id} as it's being reset`);
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
              localVersion: 0
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
        console.log('Removing inactive tab:', tab.id);
        
        // Use closeTab which properly cleans up the tab
        await closeTab(tab.id);
      }
    }
    
    // Clean up any orphaned attachments
    await TabCacheManager.cleanupOrphanedAttachments();
  };

  const removeTabByNoteId = async (noteId: string) => {
    console.log('removeTabByNoteId called for noteId:', noteId);
    
    // First, clean up all attachments for this note ID
    if (noteId) {
      console.log(`Cleaning up attachments for note ${noteId}`);
      await TabCacheManager.cleanupAttachmentsForNote(noteId);
    }
    
    // Find all tabs associated with this noteId
    const tabsToRemove = tabs.filter(tab => tab.noteId === noteId);
    
    if (tabsToRemove.length === 0) {
      console.log(`No tabs found for note ${noteId}`);
      return;
    }
    
    console.log(`Found ${tabsToRemove.length} tabs associated with note ${noteId}`);
    
    // Process each tab
    for (const tab of tabsToRemove) {
      console.log(`Removing tab ${tab.id} for deleted note ${noteId}`);
      await closeTab(tab.id);
    }
    
    // Clean up any orphaned attachments
    await TabCacheManager.cleanupOrphanedAttachments();
  };

  // Expose methods to parent component
  useImperativeHandle(ref, () => ({
    addTab,
    updateTab,
    removeTabByNoteId,
    getActiveTab: () => {
      const tab = tabs.find(tab => tab.id === activeTabId);
      if (!tab) return null;
      
      return {
        id: tab.id,
        title: tab.title,
        content: tab.content,
        version: tab.version,
        noteId: tab.noteId,
        attachments: tab.loadedAttachments
      };
    },
    updateTabContent: (id, title, content) => {
      handleTitleChange(id, title);
      handleContentChange(id, content);
    },
    removeTabContent,
    updateTabWithId: (tabId, note) => {
      const tab = tabs.find(tab => tab.id === tabId);
      if (tab) {
        updateTabState(tabId, {
          title: note.title,
          content: note.content,
          version: note.version,
          noteId: note.id,
          syncStatus: 'synced',
          lastEdited: new Date().toISOString()
        });
      }
    },
    isNoteOpenInAnyTab: (noteId) => {
      return tabs.some(tab => tab.noteId === noteId);
    },
    addPendingAttachment: (tabId, attachment) => {
      handleAttachmentAdd(tabId, attachment);
    },
    pinTab: async (tabId) => {
      await handlePinTab(tabId);
    },
    unpinTab: async (tabId) => {
      await handleUnpinTab(tabId);
    },
    isPinned: (tabId) => {
      const tab = tabs.find(tab => tab.id === tabId);
      return tab ? !!tab.pinned : false;
    },
    syncCache,
    handleSave: async (tabId, note) => {
      await handleSave(tabId, note);
      // Return void to match the interface
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
      // Increment the localVersion when saving
      setTabs(prevTabs => prevTabs.map(t => {
        if (t.id === tabId) {
          return {
            ...t,
            localVersion: (t.localVersion || 0) + 1
          };
        }
        return t;
      }));
      
      // Load full attachments if they're not already loaded
      let attachmentsToSave: Attachment[] = [];
      
      if (tab.attachments && tab.attachments.length > 0) {
        if (tab.loadedAttachments && tab.loadedAttachments.length === tab.attachments.length) {
          // Use already loaded attachments
          attachmentsToSave = tab.loadedAttachments;
        } else {
          // Load attachments from cache
          console.log('Loading attachments for save operation');
          attachmentsToSave = await TabCacheManager.loadAttachmentsForTab(tab as CacheTab);
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
                  
                  // First, check if the tab already has these attachments to prevent duplication
                  const tabInCache = currentCache.tabs.find(t => t.id === tabId);
                  if (tabInCache) {
                    const existingAttachmentIds = new Set(
                      tabInCache.attachments?.map(a => a.id) || []
                    );
                    
                    // Only add attachments that don't already exist in the tab
                    for (const attachment of attachmentsToSave) {
                      if (attachment.id && !existingAttachmentIds.has(attachment.id)) {
                        await TabCacheManager.addAttachmentToTab(currentCache, tabId, attachment);
                        console.log(`Cached attachment ${attachment.id} for note ${savedNote.id}`);
                        existingAttachmentIds.add(attachment.id);
                      } else if (attachment.id) {
                        console.log(`Attachment ${attachment.id} already exists in tab ${tabId}, skipping duplicate caching`);
                      }
                    }
                  } else {
                    // Tab not found in cache, add all attachments
                    for (const attachment of attachmentsToSave) {
                      await TabCacheManager.addAttachmentToTab(currentCache, tabId, attachment);
                      console.log(`Cached attachment ${attachment.id} for note ${savedNote.id}`);
                    }
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
    try {
      console.log(`Pinning tab ${tabId}`);
      
      // First, unpin any previously pinned tabs
      const pinnedTabs = tabs.filter(tab => tab.pinned);
      for (const pinnedTab of pinnedTabs) {
        if (pinnedTab.id !== tabId) {
          console.log(`Unpinning previously pinned tab ${pinnedTab.id}`);
          // Update local state first for immediate UI feedback
          setTabs(prevTabs => prevTabs.map(tab => 
            tab.id === pinnedTab.id ? { ...tab, pinned: false } : tab
          ));
        }
      }
      
      // Pin the selected tab in local state
      setTabs(prevTabs => prevTabs.map(tab => 
        tab.id === tabId ? { ...tab, pinned: true } : tab
      ));
      
      // Update the cache
      const cache = await TabCacheManager.initCache();
      if (cache) {
        const updatedCache = await TabCacheManager.pinTab(cache, tabId);
        console.log(`Tab ${tabId} pinned successfully in cache`);
        
        // Sort tabs to ensure pinned tab appears first
        const sortedTabs = sortTabs([...tabs.map(tab => 
          tab.id === tabId ? { ...tab, pinned: true } : 
          pinnedTabs.some(pt => pt.id === tab.id) ? { ...tab, pinned: false } : tab
        )]);
        
        setTabs(sortedTabs);
        
        // Set this tab as the active tab
        setActiveTabId(tabId);
        
        // Request a sync to ensure other instances are updated
        await chrome.runtime.sendMessage({ type: 'REQUEST_SYNC' });
        
        // Verify the tab was actually pinned in the cache
        const refreshedCache = await TabCacheManager.initCache();
        const pinnedTab = refreshedCache?.tabs.find(t => t.pinned);
        if (pinnedTab?.id !== tabId) {
          console.warn(`Pin verification failed: Expected ${tabId} to be pinned, but found ${pinnedTab?.id || 'none'}`);
        } else {
          console.log(`Pin verification successful: Tab ${tabId} is pinned in cache`);
        }
      }
    } catch (error) {
      console.error(`Failed to pin tab ${tabId}:`, error);
    }
  };
  
  const handleUnpinTab = async (tabId: string) => {
    try {
      console.log(`Unpinning tab ${tabId}`);
      
      // Unpin the tab in local state first for immediate UI feedback
      setTabs(prevTabs => prevTabs.map(tab => 
        tab.id === tabId ? { ...tab, pinned: false } : tab
      ));
      
      // Update the cache
      const cache = await TabCacheManager.initCache();
      if (cache) {
        const updatedCache = await TabCacheManager.unpinTab(cache, tabId);
        console.log(`Tab ${tabId} unpinned successfully in cache`);
        
        // Sort tabs to update order
        const sortedTabs = sortTabs([...tabs.map(tab => 
          tab.id === tabId ? { ...tab, pinned: false } : tab
        )]);
        
        setTabs(sortedTabs);
        
        // Request a sync to ensure other instances are updated
        await chrome.runtime.sendMessage({ type: 'REQUEST_SYNC' });
        
        // Verify the tab was actually unpinned in the cache
        const refreshedCache = await TabCacheManager.initCache();
        const stillPinned = refreshedCache?.tabs.find(t => t.id === tabId && t.pinned);
        if (stillPinned) {
          console.warn(`Unpin verification failed: Tab ${tabId} is still pinned in cache`);
        } else {
          console.log(`Unpin verification successful: Tab ${tabId} is not pinned in cache`);
        }
      }
    } catch (error) {
      console.error(`Failed to unpin tab ${tabId}:`, error);
    }
  };

  const sortTabs = (tabs: Tab[]): Tab[] => {
    console.log('Sorting tabs with pinned tabs first');
    
    // Sort tabs with pinned tabs first, then by last edited time (newest first)
    return tabs.sort((a, b) => {
      // Pinned tabs come first
      if (a.pinned && !b.pinned) return -1;
      if (!a.pinned && b.pinned) return 1;
      
      // If both are pinned or both are not pinned, sort by last edited time
      const aTime = new Date(a.lastEdited).getTime();
      const bTime = new Date(b.lastEdited).getTime();
      return bTime - aTime; // Newest first
    });
  };

  // Effect to sync cache when visibility changes
  useEffect(() => {
    if (isVisible) {
      console.log('Tab became visible, syncing cache...');
      syncCache();
    }
  }, [isVisible]);

  // Register storage change listener for real-time sync
  useEffect(() => {
    // Track last sync time to prevent rapid successive syncs
    let lastSyncTime = 0;
    const MIN_SYNC_INTERVAL = 1000; // 1 second minimum between syncs
    
    // Handler for storage changes from other tabs/pages
    const handleStorageChange = (event: StorageChangeEvent) => {
      console.log('Storage change detected:', event);
      
      // Debounce rapid successive storage changes
      const now = Date.now();
      if (now - lastSyncTime < MIN_SYNC_INTERVAL) {
        console.log(`Debouncing storage change (last sync was ${(now - lastSyncTime)}ms ago)`);
        return;
      }
      lastSyncTime = now;
      
      // Skip if this is from our own instance
      if (event.instanceId === TabCacheManager['INSTANCE_ID']) {
        console.log('Ignoring storage change from our own instance');
        return;
      }
      
      // If there are conflicts, show the conflict resolution dialog
      if (event.conflicts && event.conflicts.length > 0) {
        console.log('Conflicts detected:', event.conflicts);
        setConflictingTabs(event.conflicts as Tab[]);
        setShowConflictDialog(true);
        return;
      }
      
      // Otherwise, just sync the cache
      syncCache();
    };
    
    // Register the listener
    TabCacheManager.registerStorageChangeListener(handleStorageChange);
    
    // Clean up on unmount
    return () => {
      TabCacheManager.unregisterStorageChangeListener(handleStorageChange);
    };
  }, []);
  
  /**
   * Synchronize the cache when the extension is closed
   * This ensures that changes made on one page are reflected on other pages
   */
  const syncCache = async () => {
    try {
      console.log('Syncing cache before extension close...');
      
      // Save any pending changes first
      const activeTab = tabs.find(tab => tab.id === activeTabId);
      if (activeTab && activeTab.syncStatus === 'pending') {
        console.log('Saving pending changes in active tab before sync');
        
        // Create a note object from the tab
        const note: Partial<Note> = {
          title: activeTab.title || 'Untitled',
          content: activeTab.content,
          version: activeTab.version || 0,
          createdAt: activeTab.createdAt || new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          attachments: activeTab.loadedAttachments
        };
        
        // Add id only if it exists
        if (activeTab.noteId) {
          note.id = activeTab.noteId;
        }
        
        // Save the note
        await handleSave(activeTab.id, note as Note);
      }
      
      // Clean up duplicate attachments
      const cache = await TabCacheManager.initCache();
      if (cache) {
        await TabCacheManager.cleanupDuplicateAttachments(cache);
      }
      
      // Request a sync from the background script
      await chrome.runtime.sendMessage({ type: 'REQUEST_SYNC' });
      console.log('Cache sync requested from background script');
      
      return true;
    } catch (error) {
      console.error('Failed to sync cache:', error);
      return false;
    }
  };

  // Handle conflict resolution
  const resolveConflict = async (tabId: string, resolution: 'keep-local' | 'keep-remote' | 'merge') => {
    try {
      // Find the conflicting tab
      const conflictingTab = conflictingTabs.find(tab => tab.id === tabId);
      
      if (!conflictingTab) {
        console.error(`Conflicting tab with ID ${tabId} not found`);
        return;
      }
      
      // Get the remote cache
      const remoteCache = await TabCacheManager.initCache();
      
      if (!remoteCache) {
        console.error('Remote cache not found during conflict resolution');
        return;
      }
      
      // Find the remote tab
      const remoteTab = remoteCache.tabs.find(tab => tab.id === tabId);
      
      if (!remoteTab) {
        console.error(`Remote tab with ID ${tabId} not found`);
        return;
      }
      
      // Resolve the conflict based on the selected resolution
      let resolvedTab: Tab;
      
      switch (resolution) {
        case 'keep-local':
          // Keep the local version
          resolvedTab = {
            ...conflictingTab,
            hasConflict: false,
            conflictInfo: {
              ...conflictingTab.conflictInfo!,
              resolved: true
            },
            localVersion: Math.max(conflictingTab.localVersion || 0, remoteTab.localVersion || 0) + 1
          };
          break;
          
        case 'keep-remote':
          // Keep the remote version
          resolvedTab = {
            ...remoteTab as Tab,
            hasConflict: false,
            conflictInfo: {
              ...conflictingTab.conflictInfo!,
              resolved: true
            },
            localVersion: Math.max(conflictingTab.localVersion || 0, remoteTab.localVersion || 0) + 1
          };
          break;
          
        case 'merge':
          // Simple merge strategy: concatenate content with a separator
          resolvedTab = {
            ...conflictingTab,
            content: `${conflictingTab.content}\n\n--- MERGED CONTENT ---\n\n${remoteTab.content}`,
            hasConflict: false,
            conflictInfo: {
              ...conflictingTab.conflictInfo!,
              resolved: true
            },
            localVersion: Math.max(conflictingTab.localVersion || 0, remoteTab.localVersion || 0) + 1
          };
          break;
        
        default:
          console.error(`Unknown resolution strategy: ${resolution}`);
          return;
      }
      
      // Update the tabs array
      setTabs(prevTabs => prevTabs.map(tab => 
        tab.id === resolvedTab.id ? resolvedTab : tab
      ));
      
      // Remove from conflicting tabs list
      setConflictingTabs(prev => prev.filter(tab => tab.id !== tabId));
      
      // If no more conflicts, hide the dialog
      if (conflictingTabs.length <= 1) {
        setShowConflictDialog(false);
      }
      
      // Save to cache
      const updatedCache: TabCache = {
        tabs: tabs.map(tab => tab.id === resolvedTab.id ? resolvedTab : tab) as CacheTab[],
        activeTabId,
        lastUpdated: new Date().toISOString()
      };
      
      await TabCacheManager.saveCache(updatedCache);
      
    } catch (error) {
      console.error('Failed to resolve conflict:', error);
    }
  };

  // Render conflict resolution dialog
  const renderConflictDialog = () => {
    if (!showConflictDialog || tabs.length === 0) {
      return null;
    }
    
    return (
      <div className="conflict-dialog">
        <h3>Conflicting Changes Detected</h3>
        <p>Changes to the following tabs were made in another window:</p>
        
        <ul>
          {conflictingTabs.map(tab => (
            <li key={tab.id}>
              <div>
                <strong>{tab.title}</strong>
                <p>Last edited locally: {new Date(tab.lastEdited).toLocaleString()}</p>
                {tab.conflictInfo && (
                  <p>Conflicting changes from: {new Date(tab.conflictInfo.timestamp).toLocaleString()}</p>
                )}
              </div>
              
              <div className="conflict-actions">
                <button onClick={() => resolveConflict(tab.id, 'keep-local')}>
                  Keep My Version
                </button>
                <button onClick={() => resolveConflict(tab.id, 'keep-remote')}>
                  Use Other Version
                </button>
                <button onClick={() => resolveConflict(tab.id, 'merge')}>
                  Merge Both
                </button>
              </div>
            </li>
          ))}
        </ul>
      </div>
    );
  };

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
        onClose={() => setConfirmationState({ isOpen: false, tabId: '', tabTitle: '', action: '' })}
      />
      
      {renderConflictDialog()}
    </div>
  );
});

export default TabManager; 