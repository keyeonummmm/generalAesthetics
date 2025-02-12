import React, { useState, forwardRef, useImperativeHandle, useEffect } from 'react';
import NoteInput from './NoteInput';
import { Note } from '../lib/notesDB';
import '../styles/tab-manager.css';
import { v4 as uuidv4 } from 'uuid';

interface Tab {
  id: string;
  title: string;
  content: string;
  attachments?: Note['attachments'];
  isNew: boolean;
  version?: number;
  createdAt?: string;
  updatedAt?: string;
  syncStatus?: 'pending' | 'synced';
}

interface TabManagerProps {
  onChangeStatus: (hasUnsavedChanges: boolean) => void;
  onContentChange: (tabId: string, title: string, content: string, version?: number, noteId?: string) => void;
}

export interface TabManagerRef {
  addTab: (note: Note) => void;
  updateTab: (note: Note) => void;
}

const CACHE_KEY = 'tabManager_cache';

const TabManager = forwardRef<TabManagerRef, TabManagerProps>(({
  onChangeStatus,
  onContentChange,
}, ref) => {
  const [tabs, setTabs] = useState<Tab[]>(() => {
    const cached = localStorage.getItem(CACHE_KEY);
    return cached ? JSON.parse(cached) : [{ id: `new-${uuidv4()}`, title: '', content: '', isNew: true }];
  });

  useEffect(() => {
    localStorage.setItem(CACHE_KEY, JSON.stringify(tabs));
  }, [tabs]);

  const [activeTabId, setActiveTabId] = useState('new');

  const handleSaveComplete = (tabId: string, savedNote: Note) => {
    setTabs(prevTabs => prevTabs.map(tab =>
      tab.id === tabId ? {
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

    if (activeTabId === tabId) {
      setActiveTabId(savedNote.id);
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
        isNew: true 
      });
    }
    
    setTabs(newTabs);
    
    if (activeTabId === tabId) {
      setActiveTabId(newTabs[0].id);
    }
  };

  const addNewTab = () => {
    const newTabId = `new-${uuidv4()}`;
    const newTab = { 
      id: newTabId, 
      title: '', 
      content: '', 
      isNew: true 
    };
    setTabs(prevTabs => [...prevTabs, newTab]);
    setActiveTabId(newTabId);
  };

  useImperativeHandle(ref, () => ({
    addTab: (note: Note) => {
      const existingTab = tabs.find(tab => tab.id === note.id);
      
      if (existingTab) {
        setActiveTabId(note.id);
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
          syncStatus: note.syncStatus
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
    }
  }));

  const handleTabClick = (tabId: string) => {
    setActiveTabId(tabId);
  };

  const handleTitleChange = (tabId: string, title: string) => {
    setTabs(prevTabs => prevTabs.map(tab =>
      tab.id === tabId ? { ...tab, title } : tab
    ));
    
    const currentTab = tabs.find(tab => tab.id === tabId);
    if (!currentTab) return;

    const noteId = currentTab.isNew ? undefined : currentTab.id;
    
    onContentChange(
      tabId, 
      title, 
      currentTab.content, 
      currentTab.version,
      noteId
    );
  };

  const handleContentChange = (tabId: string, content: string) => {
    setTabs(prevTabs => prevTabs.map(tab =>
      tab.id === tabId ? { 
        ...tab, 
        content,
        syncStatus: 'pending' 
      } : tab
    ));

    const currentTab = tabs.find(tab => tab.id === tabId);
    if (!currentTab) return;

    const noteId = currentTab.isNew ? undefined : currentTab.id;
    
    onContentChange(
      tabId,
      currentTab.title,
      content,
      currentTab.version,
      noteId
    );
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
          onClick={addNewTab}
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
            <NoteInput
              key={activeTab.id}
              tabId={activeTab.id}
              note={{
                id: activeTab.id === 'new' ? undefined : activeTab.id,
                title: activeTab.title,
                content: activeTab.content,
                attachments: activeTab.attachments,
                version: activeTab.version,
                createdAt: activeTab.createdAt,
                updatedAt: activeTab.updatedAt,
                syncStatus: activeTab.syncStatus
              }}
              onTitleChange={(title) => handleTitleChange(activeTab.id, title)}
              onContentChange={(content) => handleContentChange(activeTab.id, content)}
              onSaveComplete={(savedNote) => handleSaveComplete(activeTab.id, savedNote)}
            />
          );
        })()}
      </div>
    </div>
  );
});

export default TabManager; 