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

// Handle browser action clicks
chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id) return;

  try {
    if (!loadedTabs.has(tab.id)) {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content.js']
      });
    }

    // Use the same message type that's used by the close button
    await chrome.tabs.sendMessage(tab.id, { type: 'toggleInterface' });
    console.log('Sent toggleInterface message to tab', tab.id);
  } catch (error) {
    console.error('Failed to toggle interface:', error);
  }
});

import { NotesDB } from './lib/notesDB';
import { TabCacheManager } from './lib/TabCacheManager';
import { TabAssociationManager } from './lib/TabAssociationManager';
import { PositionScaleManager } from './lib/PositionScaleManager';

// Consolidated message handling
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'CAPTURE_URL') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const url = tabs[0]?.url;
      sendResponse({ success: !!url, url, error: url ? undefined : 'No URL found' });
    });
    return true; // Keep message channel open for async response
  }
  
  if (message.type === 'SYNC_TABS') {
    // Sync tabs across pages
    TabCacheManager.syncCache()
      .then(syncedCache => {
        sendResponse({ success: true, syncedCache });
      })
      .catch(error => {
        console.error('Failed to sync tabs:', error);
        sendResponse({ success: false, error: error.message });
      });
    return true; // Keep message channel open for async response
  }
  
  if (message.type === 'TAB_VISIBILITY_CHANGE' && message.isVisible) {
    // Handle tab becoming visible
    TabCacheManager.syncCache()
      .then(syncedCache => {
        sendResponse({ success: true, syncedCache });
      })
      .catch(error => {
        console.error('Failed to sync tabs on visibility change:', error);
        sendResponse({ success: false, error: error.message });
      });
    return true; // Keep message channel open for async response
  }
  
  if (message.type === 'ASSOCIATE_TAB') {
    const { tabId } = message;
    if (tabId) {
      TabAssociationManager.associateTabWithCurrentPage(tabId)
        .then(() => {
          TabAssociationManager.updateGlobalActiveTab(tabId)
            .then(() => {
              sendResponse({ success: true });
            })
            .catch(error => {
              console.error('Failed to update global active tab:', error);
              sendResponse({ success: false, error: error.message });
            });
        })
        .catch(error => {
          console.error('Failed to associate tab with page:', error);
          sendResponse({ success: false, error: error.message });
        });
      return true; // Keep message channel open for async response
    }
  }

  if (message.type === 'CAPTURE_SCREENSHOT') {
    // First hide the UI in all tabs
    chrome.tabs.query({}, (tabs) => {
      tabs.forEach(tab => {
        if (tab.id) {
          chrome.tabs.sendMessage(tab.id, { type: 'HIDE_EXTENSION_UI' })
            .catch(error => console.error('Failed to send hide UI message:', error));
        }
      });
    });
    
    // Wait a moment to ensure UI is hidden
    setTimeout(() => {
      (async () => {
        try {
          console.log('Background: Starting screenshot capture:', message.screenshotType);
          
          if (message.screenshotType === 'visible') {
            // Use PNG format for better quality and to avoid JPEG artifacts
            // Our image processor will handle the conversion and compression
            const captureData = await chrome.tabs.captureVisibleTab(
              chrome.windows.WINDOW_ID_CURRENT,
              { format: 'png' }
            );
            console.log('Background: Visible capture successful');
            sendResponse({ success: true, screenshotData: captureData });
          } else if (message.screenshotType === 'full') {
            console.log('Background: Initializing section capture');
            const activeTab = await chrome.tabs.query({ active: true, currentWindow: true });
            if (!activeTab[0]?.id) {
              throw new Error('No active tab found');
            }

            await chrome.scripting.executeScript({
              target: { tabId: activeTab[0].id },
              func: () => {
                const event = new CustomEvent('init-screenshot-selection');
                document.dispatchEvent(event);
              }
            });

            chrome.runtime.onMessage.addListener(function listener(msg) {
              if (msg.type === 'SELECTION_CAPTURE') {
                chrome.runtime.onMessage.removeListener(listener);
                sendResponse({ success: true, screenshotData: msg.data });
              } else if (msg.type === 'SELECTION_CAPTURE_ERROR') {
                chrome.runtime.onMessage.removeListener(listener);
                sendResponse({ success: false, error: msg.error });
              }
            });
          }
        } catch (error) {
          console.error('Background: Screenshot capture failed:', error);
          sendResponse({ 
            success: false, 
            error: error instanceof Error ? error.message : 'Unknown error'
          });
        }
      })();
    }, 100);
    
    return true;
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

  if (message.type === 'CAPTURE_VISIBLE_TAB' && sender.tab?.id) {
    (async () => {
      try {
        console.log('Background: Capturing visible tab area');
        // Use PNG format for better quality and to avoid JPEG artifacts
        const captureData = await chrome.tabs.captureVisibleTab(
          chrome.windows.WINDOW_ID_CURRENT,
          { format: 'png' }
        );
        console.log('Background: Area capture successful');
        sendResponse({ success: true, captureData });
      } catch (error) {
        console.error('Background: Area capture failed:', error);
        sendResponse({ 
          success: false, 
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    })();
    return true;
  }

  if (message.type === 'HIDE_EXTENSION_UI') {
    // Handle this asynchronously
    broadcastToActiveTabs({ type: 'HIDE_EXTENSION_UI' })
      .then(results => {
        console.log(`Sent hide UI message to ${results.length} tabs`, 
          `(${results.filter(r => r.success).length} successful)`);
        sendResponse({ success: true, results });
      })
      .catch(error => {
        console.error('Failed to broadcast hide UI message:', error);
        sendResponse({ success: false, error: String(error) });
      });
    return true;
  }
  
  if (message.type === 'SHOW_EXTENSION_UI') {
    // Handle this asynchronously
    broadcastToActiveTabs({ type: 'SHOW_EXTENSION_UI' })
      .then(results => {
        console.log(`Sent show UI message to ${results.length} tabs`, 
          `(${results.filter(r => r.success).length} successful)`);
      });
    sendResponse({ success: true });
    return true;
  }
  
  if (message.type === 'resetPosition') {
    // Forward the message to the active tab
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.id) {
        chrome.tabs.sendMessage(tabs[0].id, { type: 'resetPosition' })
          .then(response => {
            sendResponse(response);
          })
          .catch(error => {
            console.error('Failed to send reset position message:', error);
            sendResponse({ success: false, error: error.message });
          });
      } else {
        sendResponse({ success: false, error: 'No active tab found' });
      }
    });
    return true;
  }

  if (message.type === 'getTabId') {
    if (sender.tab && sender.tab.id) {
      sendResponse({ tabId: sender.tab.id });
    } else {
      sendResponse({ tabId: -1, error: 'Could not determine tab ID' });
    }
    return true;
  }

  // Handle resize-related messages
  if (message.type === 'saveResizeState') {
    // Use a promise-based approach since we're in a non-async listener
    (async () => {
      try {
        // Forward the resize state to the appropriate tab
        const tabId = message.tabId || (sender.tab ? sender.tab.id : null);
        if (tabId) {
          // Store the resize state in the background script
          const result = await sendMessageToTab(tabId, {
            type: 'updateResizeState',
            position: message.position,
            operationType: message.operationType || 'none'
          });
          sendResponse({ success: true, result });
        } else {
          sendResponse({ success: false, error: 'No tab ID provided' });
        }
      } catch (error) {
        console.error('Error handling resize state:', error);
        sendResponse({ success: false, error: String(error) });
      }
    })();
    return true;
  }

  // Handle position-only updates (for drag operations)
  if (message.type === 'savePositionOnly') {
    (async () => {
      try {
        const tabId = message.tabId || (sender.tab ? sender.tab.id : null);
        if (tabId) {
          const result = await sendMessageToTab(tabId, {
            type: 'updatePositionOnly',
            position: { x: message.position.x, y: message.position.y },
            operationType: 'dragging'
          });
          sendResponse({ success: true, result });
        } else {
          sendResponse({ success: false, error: 'No tab ID provided' });
        }
      } catch (error) {
        console.error('Error handling position update:', error);
        sendResponse({ success: false, error: String(error) });
      }
    })();
    return true;
  }

  // Handle dimensions-only updates (for resize operations)
  if (message.type === 'saveDimensionsOnly') {
    (async () => {
      try {
        const tabId = message.tabId || (sender.tab ? sender.tab.id : null);
        if (tabId) {
          const result = await sendMessageToTab(tabId, {
            type: 'updateDimensionsOnly',
            dimensions: { width: message.dimensions.width, height: message.dimensions.height },
            operationType: 'resizing'
          });
          sendResponse({ success: true, result });
        } else {
          sendResponse({ success: false, error: 'No tab ID provided' });
        }
      } catch (error) {
        console.error('Error handling dimensions update:', error);
        sendResponse({ success: false, error: String(error) });
      }
    })();
    return true;
  }

  // Handle operation locking
  if (message.type === 'lockOperation') {
    (async () => {
      try {
        const tabId = message.tabId || (sender.tab ? sender.tab.id : null);
        if (tabId) {
          const result = await sendMessageToTab(tabId, {
            type: 'lockOperation',
            operation: message.operation
          });
          sendResponse({ success: true, result });
        } else {
          sendResponse({ success: false, error: 'No tab ID provided' });
        }
      } catch (error) {
        console.error('Error handling operation lock:', error);
        sendResponse({ success: false, error: String(error) });
      }
    })();
    return true;
  }

  // Handle operation release
  if (message.type === 'releaseOperation') {
    (async () => {
      try {
        const tabId = message.tabId || (sender.tab ? sender.tab.id : null);
        if (tabId) {
          const result = await sendMessageToTab(tabId, {
            type: 'releaseOperation'
          });
          sendResponse({ success: true, result });
        } else {
          sendResponse({ success: false, error: 'No tab ID provided' });
        }
      } catch (error) {
        console.error('Error handling operation release:', error);
        sendResponse({ success: false, error: String(error) });
      }
    })();
    return true;
  }
});

async function handleDBOperation(message: any, sendResponse: (response: any) => void) {
  try {
    const { method, params } = message;
    const result = await (NotesDB as any)[method](...params);
    sendResponse({ data: result });
  } catch (error) {
    console.error('DB operation failed:', error);
    sendResponse({ error: (error as Error).message });
  }
}

// Handle extension suspension
chrome.runtime.onSuspend.addListener(async () => {
  // Get all tabs where our content script is running
  const tabs = Array.from(loadedTabs);
  
  // Send hide message to all active content scripts with timeout
  const promises = tabs.map(tabId => {
    // Set a timeout to avoid hanging
    const timeoutPromise = new Promise<{success: false, error: string}>((resolve) => 
      setTimeout(() => resolve({ success: false, error: 'Timeout' }), 1000)
    );
    
    // Use our helper
    return Promise.race([
      sendMessageToTab(tabId, { type: 'hideInterface' }), 
      timeoutPromise
    ]);
  });
  
  // Wait for all promises to resolve
  await Promise.all(promises);
});

// Listen for tab removal to clean up position cache
chrome.tabs.onRemoved.addListener(async (tabId) => {
  try {
    console.log(`Tab removed: ${tabId}`);
    try {
      chrome.runtime.sendMessage({ 
        type: 'clearPositionForTab', 
        tabId 
      });
    } catch (error) {}
    
    // Also handle any tab associations if needed
    const associations = await TabAssociationManager.initAssociations();
    const pageUrls = Object.keys(associations.pageToTab).filter(
      pageUrl => associations.pageToTab[pageUrl] === tabId.toString()
    );
  } catch (error) {
    console.error('Error handling tab removal:', error);
  }
});

console.log('Background script initialized successfully');

// Helper function to safely send messages to tabs
async function sendMessageToTab(tabId: number, message: any) {
  if (!loadedTabs.has(tabId)) {
    return { success: false, error: 'Tab not loaded' };
  }
  
  try {
    // Add a timeout to prevent hanging message sends
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Message send timeout')), 5000);
    });
    
    const messagePromise = chrome.tabs.sendMessage(tabId, message);
    
    // Race the message send against the timeout
    const response = await Promise.race([messagePromise, timeoutPromise]);
    return { success: true, response };
  } catch (error) {
    console.log(`Failed to send message to tab ${tabId}:`, error);
    // If connection fails, remove from loaded tabs
    loadedTabs.delete(tabId);
    return { success: false, error: String(error) };
  }
}

// Helper function to send messages to all active tabs
async function broadcastToActiveTabs(message: any) {
  const tabs = await chrome.tabs.query({});
  const results = [];
  
  for (const tab of tabs) {
    const tabId = tab.id;
    if (tabId !== undefined && loadedTabs.has(tabId)) {
      results.push(await sendMessageToTab(tabId, message));
    }
  }
  
  return results;
}

export {}; // Keep module format 