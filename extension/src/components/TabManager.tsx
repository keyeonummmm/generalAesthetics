import React, { useState, forwardRef, useImperativeHandle, useEffect, useRef } from 'react';
import NoteInput from './NoteInput';
import { Note, NoteAttachment, NotesDB } from '../lib/notesDB';
import '../styles/tab-manager.css';
import { v4 as uuidv4 } from 'uuid';

interface Tab {
  id: string;
  title: string;
  content: string;
  attachments?: NoteAttachment[];
  isNew: boolean;
  version?: number;
  createdAt?: string;
  updatedAt?: string;
  syncStatus: 'pending' | 'synced';
  noteId?: string;
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
  } | null;
  updateTabContent: (id: string, title: string, content: string) => void;
  removeTabContent: (noteId: string) => void;
  updateTabWithId: (tabId: string, note: Note) => void;
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
    const cached = localStorage.getItem(CACHE_KEY);
    if (cached) {
      try {
        const parsedCache: TabManagerCache = JSON.parse(cached);
        if (Array.isArray(parsedCache.tabs) && parsedCache.tabs.length > 0) {
          return parsedCache.tabs as Tab[];
        }
      } catch (e) {
        console.error('Failed to parse tab cache:', e);
      }
    }
    const initialTab: Tab = { id: `new-${uuidv4()}`, title: '', content: '', isNew: true, syncStatus: 'pending' as const };
    return [initialTab];
  });

  const [activeTabId, setActiveTabId] = useState(() => {
    const cached = localStorage.getItem(CACHE_KEY);
    if (cached) {
      try {
        const parsedCache: TabManagerCache = JSON.parse(cached);
        if (Array.isArray(parsedCache.tabs) && 
            parsedCache.tabs.length > 0 && 
            parsedCache.activeTabId &&
            parsedCache.tabs.some(tab => tab.id === parsedCache.activeTabId)) {
          return parsedCache.activeTabId;
        }
      } catch (e) {
        console.error('Failed to parse tab cache for activeTabId:', e);
      }
    }
    return tabs[0].id;
  });

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
        noteId: savedNote.id,  // Explicitly set the noteId
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
        savedNote.id  // Pass the noteId
      );
    }
  };

  const closeTab = (tabId: string) => {
    const tabToClose = tabs.find(tab => tab.id === tabId);
    if (!tabToClose) return;

    const newTabs = tabs.filter(tab => tab.id !== tabId);
    
    if (newTabs.length === 0) {
      const newTabId = `new-${uuidv4()}`;
      newTabs.push({ 
        id: newTabId, 
        title: '', 
        content: '', 
        isNew: true,
        syncStatus: 'pending' as const
      });
    }
    
    setTabs(newTabs);
    
    if (activeTabId === tabId) {
      setActiveTabId(newTabs[0].id);
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
      syncStatus: note ? 'synced' as const : 'pending' as const
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
    setTabs(prevTabs => {
      return prevTabs.map(tab => {
        if (tab.noteId === noteId || tab.id === noteId) {
          // Create a cleaned version of the tab
          const cleanedTab: Tab = {
            id: tab.id, // Keep the original tab ID
            title: tab.title, // Keep the title for reference
            content: tab.content, // Keep the content
            isNew: true, // Mark as new since it's no longer linked to a note
            syncStatus: 'pending' as const,
          };

          // If this is the active tab, notify parent of changes
          if (tab.id === activeTabId) {
            onContentChange(
              cleanedTab.id,
              cleanedTab.title,
              cleanedTab.content,
              undefined, // version is now undefined
              undefined  // noteId is now undefined
            );
          }

          return cleanedTab;
        }
        return tab;
      });
    });
  };

  const removeTabByNoteId = (noteId: string) => {
    // First clean the content of any tabs with this noteId
    removeTabContent(noteId);
    
    // Then proceed with normal tab removal if needed
    setTabs(prevTabs => {
      const isActiveTab = prevTabs.some(tab => 
        (tab.noteId === noteId || tab.id === noteId) && tab.id === activeTabId
      );
      
      const newTabs = prevTabs.filter(tab => 
        tab.noteId !== noteId && tab.id !== noteId
      );
      
      if (newTabs.length === 0) {
        const newTabId = `new-${uuidv4()}`;
        const newTab: Tab = { 
          id: newTabId, 
          title: '', 
          content: '', 
          isNew: true,
          syncStatus: 'pending' as const
        };
        newTabs.push(newTab);
        
        if (isActiveTab) {
          setActiveTabId(newTabId);
          onContentChange(newTabId, '', '', undefined, undefined);
        }
      } else if (isActiveTab) {
        setActiveTabId(newTabs[0].id);
        const firstTab = newTabs[0];
        onContentChange(
          firstTab.id,
          firstTab.title,
          firstTab.content,
          firstTab.version,
          firstTab.noteId
        );
      }
      
      return newTabs;
    });
  };

  useImperativeHandle(ref, () => ({
    addTab: (note: Note) => {
      // Check for existing tab by both id and noteId
      const existingTab = tabs.find(tab => 
        tab.id === note.id || tab.noteId === note.id
      );
      
      if (existingTab) {
        setActiveTabId(existingTab.id); // Use existing tab's id
      } else {
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
          syncStatus: 'synced' as const, // Set as synced since it's from database
          noteId: note.id
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
      return activeTab ? {
        id: activeTab.id,
        title: activeTab.title,
        content: activeTab.content,
        version: activeTab.version,
        noteId: activeTab.noteId // Use the stored noteId
      } : null;
    },
    updateTabContent: (tabId: string, title: string, content: string) => {
      setTabs(prev => prev.map(tab => {
        if (tab.id === tabId) {
          return {
            ...tab,
            title,
            content,
            noteId: tab.noteId, // Preserve the noteId
            syncStatus: 'pending' as const
          };
        }
        return tab;
      }));
      
      const tab = tabs.find(t => t.id === tabId);
      if (onContentChange) {
        // Pass the tracked note ID
        onContentChange(
          tabId, 
          title, 
          content, 
          tab?.version,
          tab?.noteId
        );
      }

      setActiveTabId(tabId);
    },
    removeTabByNoteId: (noteId: string) => {
      removeTabByNoteId(noteId);
    },
    removeTabContent,
    updateTabWithId: (tabId: string, note: Note) => {
      setTabs(prevTabs => prevTabs.map(tab => {
        if (tab.id === tabId) {
          return {
            ...tab,
            noteId: note.id,
            title: note.title,
            content: note.content,
            version: note.version,
            isNew: false,
            syncStatus: 'synced' as const
          };
        }
        return tab;
      }));
    },
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
          updatedTab.noteId // Pass the noteId in content change
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
  const handleAttachmentAdd = async (tabId: string, attachment: NoteAttachment) => {
    const tab = tabs.find(t => t.id === tabId);
    if (!tab?.noteId) return;

    try {
      const updatedNote = await NotesDB.addAttachment(tab.noteId, attachment);
      updateTabState(tabId, {
        attachments: updatedNote.attachments,
        version: updatedNote.version,
        syncStatus: 'synced' as const
      });
    } catch (error) {
      console.error('Failed to add attachment:', error);
    }
  };

  const handleAttachmentRemove = async (tabId: string, attachmentUrl: string) => {
    const tab = tabs.find(t => t.id === tabId);
    if (!tab?.noteId) return;

    try {
      const updatedNote = await NotesDB.removeAttachment(tab.noteId, attachmentUrl);
      updateTabState(tabId, {
        attachments: updatedNote.attachments,
        version: updatedNote.version,
        syncStatus: 'synced' as const
      });
    } catch (error) {
      console.error('Failed to remove attachment:', error);
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
                onAttachmentRemove={(url) => handleAttachmentRemove(activeTab.id, url)}
              />
            </div>
          );
        })()}
      </div>
    </div>
  );
});

export default TabManager; 