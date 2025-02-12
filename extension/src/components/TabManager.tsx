import React, { useState, forwardRef, useImperativeHandle } from 'react';
import NoteInput from './NoteInput';
import { Note } from '../lib/notesDB';
import '../styles/tab-manager.css';

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

const TabManager = forwardRef<TabManagerRef, TabManagerProps>(({
  onChangeStatus,
  onContentChange,
}, ref) => {
  const [tabs, setTabs] = useState<Tab[]>([
    { id: 'new', title: '', content: '', isNew: true }
  ]);
  const [activeTabId, setActiveTabId] = useState('new');

  useImperativeHandle(ref, () => ({
    addTab: (note: Note) => {
      const existingTab = tabs.find(tab => tab.id === note.id);
      
      if (existingTab) {
        setActiveTabId(note.id);
      } else {
        if (note.id === 'new' && tabs.some(tab => tab.id === 'new')) {
          setActiveTabId('new');
          return;
        }

        const newTab: Tab = {
          id: note.id,
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
        setActiveTabId(note.id);
      }
    },
    updateTab: (savedNote: Note) => {
      setTabs(prevTabs => prevTabs.map(tab =>
        (tab.id === savedNote.id || (tab.isNew && tab.id === 'new')) ? {
          ...tab,
          id: savedNote.id,
          title: savedNote.title,
          content: savedNote.content,
          version: savedNote.version,
          createdAt: savedNote.createdAt,
          updatedAt: savedNote.updatedAt,
          syncStatus: 'synced',
          isNew: false
        } : tab
      ));

      if (activeTabId === 'new') {
        setActiveTabId(savedNote.id);
      }
    }
  }));

  const closeTab = (tabId: string) => {
    if (tabs.length === 1) return;
    const newTabs = tabs.filter(tab => tab.id !== tabId);
    setTabs(newTabs);
    if (activeTabId === tabId) {
      setActiveTabId(newTabs[0].id);
    }
  };

  const handleTabClick = (tabId: string) => {
    setActiveTabId(tabId);
  };

  const handleTitleChange = (tabId: string, title: string) => {
    setTabs(prevTabs => prevTabs.map(tab =>
      tab.id === tabId ? { ...tab, title } : tab
    ));
    onContentChange(tabId, title, tabs.find(tab => tab.id === tabId)?.content || '', tabs.find(tab => tab.id === tabId)?.version, tabs.find(tab => tab.id === tabId)?.id);
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
    onContentChange(
      tabId, 
      currentTab?.title || '', 
      content,
      currentTab?.version,
      currentTab?.isNew ? undefined : currentTab?.id
    );
  };

  const handleSaveComplete = (tabId: string, savedNote: Note) => {
    setTabs(prevTabs => prevTabs.map(tab =>
      (tab.id === tabId || (tab.isNew && tab.id === 'new')) ? {
        ...tab,
        id: savedNote.id,
        title: savedNote.title,
        content: savedNote.content,
        version: savedNote.version,
        createdAt: savedNote.createdAt,
        updatedAt: savedNote.updatedAt,
        syncStatus: 'synced',
        isNew: false
      } : tab
    ));

    if (tabId === 'new') {
      setActiveTabId(savedNote.id);
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
            {tabs.length > 1 && (
              <button 
                className="close-tab"
                onClick={(e) => {
                  e.stopPropagation();
                  closeTab(tab.id);
                }}
              >
                ×
              </button>
            )}
          </div>
        ))}
      </div>
      <div className="tab-content">
        {tabs.map(tab => (
          activeTabId === tab.id && (
            <NoteInput
              key={tab.id}
              tabId={tab.id}
              note={{
                id: tab.id === 'new' ? undefined : tab.id,
                title: tab.title,
                content: tab.content,
                attachments: tab.attachments,
                version: tab.version,
                createdAt: tab.createdAt,
                updatedAt: tab.updatedAt,
                syncStatus: tab.syncStatus
              }}
              onTitleChange={(title) => handleTitleChange(tab.id, title)}
              onContentChange={(content) => handleContentChange(tab.id, content)}
              onSaveComplete={(savedNote) => handleSaveComplete(tab.id, savedNote)}
            />
          )
        ))}
      </div>
    </div>
  );
});

export default TabManager; 