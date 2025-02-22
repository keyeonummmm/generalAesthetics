// Background script for the extension
console.log('Background script initializing...');

// Ensure chrome APIs are available
if (!chrome?.tabs?.query) {
  console.error('Required chrome APIs not available');
  throw new Error('Required chrome APIs not available');
}

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

// Consolidate all message listeners into one
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('Background received message:', message, 'from sender:', sender);

  if (message.type === 'CAPTURE_URL') {
    try {
      console.log('Processing URL capture request');
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        try {
          console.log('Active tabs:', tabs);
          const url = tabs[0]?.url;
          if (url) {
            console.log('Sending URL:', url);
            sendResponse({ success: true, url: url });
          } else {
            console.log('No URL found');
            sendResponse({ success: false, error: 'No URL found' });
          }
        } catch (error) {
          console.error('Error processing tabs:', error);
          sendResponse({ success: false, error: 'Error processing tabs' });
        }
      });
      return true; // Keep the message channel open for async response
    } catch (error) {
      console.error('Error in URL capture:', error);
      sendResponse({ success: false, error: 'Error capturing URL' });
      return true;
    }
  }

  if (message.type === 'DB_OPERATION') {
    handleDBOperation(message, sendResponse);
    return true;
  }

  if (message.type === 'hideInterface' && sender.tab?.id) {
    chrome.tabs.sendMessage(sender.tab.id, { type: 'toggleInterface' });
    sendResponse({ success: true });
    return true;
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

console.log('Background script initialized successfully');

export {}; // Add this to make it a module 