import { useState, forwardRef, useImperativeHandle, useEffect, useRef } from 'react';
import NoteInput from './NoteInput';
import { Note, DBProxy as NotesDB } from '../lib/DBProxy';
import { Attachment } from '../lib/Attachment';
import '../styles/components/tab-manager.css';
import { v4 as uuidv4 } from 'uuid';
import { TabCacheManager, Tab as CacheTab, TabCache } from '../lib/TabCacheManager';

interface Tab {
  id: string;
  title: string;
  content: string;
  attachments?: Attachment[];
  isNew: boolean;
  version?: number;
  createdAt?: string;
  updatedAt?: string;
  syncStatus: 'pending' | 'synced';
  noteId?: string;
  lastEdited: string;
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
  
  handleSave: (tabId: string, note: Note) => Promise<void>;
}

interface TabManagerCache {
  tabs: Tab[];
  activeTabId: string;
}

const CACHE_KEY = 'tabManager_cache';

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

  // Load cache on mount
  useEffect(() => {
    const loadCache = async () => {
      try {
        const cache = await TabCacheManager.initCache();
        if (cache && cache.tabs.length > 0) {
          setTabs(cache.tabs);
          setActiveTabId(cache.activeTabId);
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
        const cache: TabCache = {
          tabs,
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
    }
  }, [tabs, activeTabId]);

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

  const addTab = (note?: Note) => {
    const newTab = {
      id: note?.id || `new-${uuidv4()}`,
      title: note?.title || '',
      content: note?.content || '',
      version: note?.version,
      noteId: note?.id, // Track noteId separately
      isNew: !note,
      syncStatus: note ? 'synced' as const : 'pending' as const,
      lastEdited: new Date().toISOString()
    };
    
    setTabs(prev => [...prev, newTab]);
    setActiveTabId(newTab.id);
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
      // First check if note is already open
      const existingTab = tabs.find(tab => 
        tab.id === note.id || tab.noteId === note.id
      );
      
      if (existingTab) {
        setActiveTabId(existingTab.id);
        return;
      }

      // Look for an empty tab to reuse
      const emptyTab = tabs.find(tab => 
        tab.isNew && 
        !tab.title && 
        !tab.content && 
        !tab.noteId
      );

      if (emptyTab) {
        // Reuse the empty tab
        setTabs(prevTabs => prevTabs.map(tab =>
          tab.id === emptyTab.id ? {
            ...tab,
            title: note.title,
            content: note.content,
            attachments: note.attachments,
            isNew: false,
            version: note.version,
            createdAt: note.createdAt,
            updatedAt: note.updatedAt,
            syncStatus: 'synced' as const,
            noteId: note.id
          } : tab
        ));
        setActiveTabId(emptyTab.id);
      } else {
        // Create new tab if no empty tab available
        const tabId = note.id === 'new' ? `new-${uuidv4()}` : note.id;
        const newTab: Tab = {
          id: tabId,
          title: note.title,
          content: note.content,
          attachments: note.attachments,
          isNew: note.id === 'new',
          version: note.version,
          createdAt: note.createdAt,
          updatedAt: note.updatedAt,
          syncStatus: 'synced' as const,
          noteId: note.id,
          lastEdited: new Date().toISOString()
        };
        setTabs(prevTabs => [...prevTabs, newTab]);
        setActiveTabId(tabId);
      }
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
        attachments: activeTab.attachments
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
    handleSave: async (tabId: string, note: Note) => {
      await handleSave(tabId, note);
    }
  }));

  const handleTabClick = (tabId: string) => {
    setActiveTabId(tabId);
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
          
        updateTabState(tabId, {
          attachments: updatedNote.attachments,
          version: updatedNote.version,
          syncStatus: 'synced' as const
        });
      } else {
        // Just update the tab state with the new attachment
        setTabs(updatedCache.tabs);
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
    
    setTabs(updatedCache.tabs);

    // Update parent components about the change
    const updatedTab = updatedCache.tabs.find(t => t.id === tabId);
    if (updatedTab) {
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
      let savedNote: Note;
      
      if (!tab.noteId) {
        savedNote = await NotesDB.createNote(
          tab.title,
          tab.content,
          tab.attachments
        );
      } else {
        savedNote = await NotesDB.updateNote(
          tab.noteId,
          tab.title,
          tab.content,
          tab.version,
          tab.attachments
        );
      }

      setTabs(prevTabs => prevTabs.map(t => 
        t.id === tabId ? {
          ...t,
          noteId: savedNote.id,
          version: savedNote.version,
          attachments: savedNote.attachments,
          syncStatus: 'synced' as const
        } : t
      ));

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

  return (
    <div className="tab-manager">
      <div className="tab-list">
        {tabs.map(tab => (
          <div 
            key={tab.id}
            className={`tab ${activeTabId === tab.id ? 'active' : ''}`}
            onClick={() => handleTabClick(tab.id)}
          >
            <span>{tab.isNew ? 'New Note' : (tab.title || 'Untitled')}</span>
            <button 
              className="close-tab"
              onClick={(e) => {
                e.stopPropagation();
                closeTab(tab.id);
              }}
            >
              ×
            </button>
          </div>
        ))}
        <button 
          className="new-tab-button"
          onClick={() => addTab()}
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
              </div>
              <NoteInput
                title={activeTab.title}
                content={activeTab.content}
                attachments={activeTab.attachments}
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
    </div>
  );
});

export default TabManager; 