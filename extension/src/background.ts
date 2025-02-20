// Background script for the extension
console.log('Background script initialized');

// Track which tabs have the content script loaded
const loadedTabs = new Set<number>();

// Listen for extension installation
chrome.runtime.onInstalled.addListener(() => {
  console.log('Extension installed');
});

// Listen for content script connection
chrome.runtime.onConnect.addListener((port) => {
  if (port.name === 'content-script') {
    const tabId = port.sender?.tab?.id;
    if (tabId) {
      loadedTabs.add(tabId);
      
      port.onDisconnect.addListener(() => {
        loadedTabs.delete(tabId);
      });
    }
  }
});

// Handle browser action clicks with better error handling
chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id) return;

  try {
    if (!loadedTabs.has(tab.id)) {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content.js']
      });
      
      await chrome.scripting.insertCSS({
        target: { tabId: tab.id },
        files: ['content.css']
      });
      
      // Increased delay for more reliable initialization
      await new Promise(resolve => setTimeout(resolve, 200));
    }

    await chrome.tabs.sendMessage(tab.id, { type: 'toggleInterface' });
  } catch (error) {
    console.error('Failed to toggle interface:', error);
  }
});

import { NotesDB } from './lib/notesDB';

// Handle database operations
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'DB_OPERATION') {
    handleDBOperation(message, sendResponse);
    return true; // Keep message channel open for async response
  }
});

async function handleDBOperation(message: any, sendResponse: (response: any) => void) {
  try {
    const { method, params } = message;
    
    // Call the appropriate NotesDB method
    const result = await (NotesDB as any)[method](...params);
    
    sendResponse({ data: result });
  } catch (error) {
    console.error('DB operation failed:', error);
    sendResponse({ error: (error as Error).message });
  }
}

// Handle interface visibility messages
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'hideInterface' && sender.tab?.id) {
    // Use Chrome's messaging to tell content script to hide
    chrome.tabs.sendMessage(sender.tab.id, { type: 'toggleInterface' });
    sendResponse({ success: true });
  }
  return true; // Keep message channel open for async response
});

export {}; // Add this to make it a module 