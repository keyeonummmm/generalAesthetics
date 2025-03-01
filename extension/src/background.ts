const loadedTabs = new Set<number>();

// Listen for extension installation
chrome.runtime.onInstalled.addListener(() => {
  console.log('Extension installed');
  
  // Start the background sync service
  startBackgroundSyncService();
});

// Background sync service
let syncIntervalId: number | null = null;
const SYNC_INTERVAL = 30000; // 30 seconds
let lastSyncTime = 0;
const MIN_SYNC_INTERVAL = 5000; // Minimum 5 seconds between syncs

function startBackgroundSyncService() {
  if (syncIntervalId !== null) {
    // Service already running
    return;
  }
  
  console.log('Starting background sync service');
  
  // Perform initial sync
  performBackgroundSync();
  
  // Set up periodic sync
  syncIntervalId = setInterval(performBackgroundSync, SYNC_INTERVAL) as unknown as number;
}

function stopBackgroundSyncService() {
  if (syncIntervalId === null) {
    // Service not running
    return;
  }
  
  console.log('Stopping background sync service');
  clearInterval(syncIntervalId);
  syncIntervalId = null;
}

async function performBackgroundSync() {
  try {
    // Throttle syncs to prevent rapid successive syncs
    const now = Date.now();
    if (now - lastSyncTime < MIN_SYNC_INTERVAL) {
      console.log(`Background sync: Throttling sync (last sync was ${(now - lastSyncTime) / 1000}s ago)`);
      return;
    }
    lastSyncTime = now;
    
    console.log('Background sync: Checking for updates...');
    
    // Import TabCacheManager dynamically to avoid circular dependencies
    const { TabCacheManager } = await import('./lib/TabCacheManager');
    
    // Validate and repair the cache if needed
    const validatedCache = await TabCacheManager.validateAndRepairCache();
    if (!validatedCache) {
      console.error('Background sync: Failed to validate cache');
      return;
    }
    
    // Create a backup periodically (every 10 syncs)
    const lastBackupTime = localStorage.getItem('lastBackupTime');
    if (!lastBackupTime || now - parseInt(lastBackupTime) > 10 * SYNC_INTERVAL) {
      await TabCacheManager.createBackup(validatedCache, 'periodic_backup');
      localStorage.setItem('lastBackupTime', now.toString());
      console.log('Background sync: Created periodic backup');
    }
    
    // Sync the cache to ensure consistency
    const syncedCache = await TabCacheManager.syncCache();
    if (!syncedCache) {
      console.warn('Background sync: No cache to sync');
      return;
    }
    
    // Synchronize attachment data
    await synchronizeAttachments(syncedCache);
    
    // Clean up orphaned attachments periodically (every 5 syncs)
    const lastCleanupTime = localStorage.getItem('lastAttachmentCleanupTime');
    if (!lastCleanupTime || now - parseInt(lastCleanupTime) > 5 * SYNC_INTERVAL) {
      await cleanupOrphanedAttachments();
      localStorage.setItem('lastAttachmentCleanupTime', now.toString());
      console.log('Background sync: Cleaned up orphaned attachments');
    }
    
    // Only broadcast if we actually made changes
    if (syncedCache.lastUpdated !== validatedCache.lastUpdated) {
      // Broadcast a message to all content scripts to notify them of the sync
      chrome.runtime.sendMessage({
        type: 'BACKGROUND_SYNC_COMPLETED',
        timestamp: new Date().toISOString()
      }).catch(error => {
        // Ignore errors from no receivers
        if (!error.message.includes('Could not establish connection')) {
          console.error('Background sync: Failed to broadcast sync completion:', error);
        }
      });
      
      console.log('Background sync: Completed with changes');
    } else {
      console.log('Background sync: Completed (no changes needed)');
    }
  } catch (error) {
    console.error('Background sync: Failed:', error);
  }
}

// New function to synchronize attachment data
async function synchronizeAttachments(cache: any) {
  try {
    if (!cache || !cache.tabs || cache.tabs.length === 0) {
      return;
    }
    
    console.log('Background sync: Synchronizing attachment data...');
    const { TabCacheManager } = await import('./lib/TabCacheManager');
    
    // Get all storage keys
    const allStorage = await chrome.storage.local.get(null);
    const allKeys = Object.keys(allStorage);
    
    // Get all attachment references from all tabs
    const attachmentRefs: Set<number> = new Set();
    for (const tab of cache.tabs) {
      if (tab.attachments && tab.attachments.length > 0) {
        for (const attachment of tab.attachments) {
          if (attachment.id) {
            attachmentRefs.add(attachment.id);
          }
        }
      }
    }
    
    console.log(`Background sync: Found ${attachmentRefs.size} attachment references to check`);
    
    // Check if each attachment exists in storage
    const missingAttachments: number[] = [];
    for (const attachmentId of attachmentRefs) {
      // Use the same prefix as in TabCacheManager
      const key = `attachment_${attachmentId}`;
      if (!allKeys.includes(key)) {
        missingAttachments.push(attachmentId);
      }
    }
    
    if (missingAttachments.length > 0) {
      console.warn(`Background sync: Found ${missingAttachments.length} missing attachments`, missingAttachments);
      
      // Remove references to missing attachments from tabs
      let cacheUpdated = false;
      const updatedTabs = cache.tabs.map((tab: any) => {
        if (tab.attachments && tab.attachments.length > 0) {
          const filteredAttachments = tab.attachments.filter((attachment: any) => 
            !missingAttachments.includes(attachment.id)
          );
          
          if (filteredAttachments.length !== tab.attachments.length) {
            cacheUpdated = true;
            return {
              ...tab,
              attachments: filteredAttachments
            };
          }
        }
        return tab;
      });
      
      if (cacheUpdated) {
        const updatedCache = {
          ...cache,
          tabs: updatedTabs,
          lastUpdated: new Date().toISOString()
        };
        
        await TabCacheManager.saveCache(updatedCache);
        console.log('Background sync: Updated cache to remove references to missing attachments');
      }
    } else {
      console.log('Background sync: All attachment references are valid');
    }
  } catch (error) {
    console.error('Background sync: Failed to synchronize attachments:', error);
  }
}

// Function to clean up orphaned attachments
async function cleanupOrphanedAttachments() {
  try {
    console.log('Background sync: Cleaning up orphaned attachments...');
    const { TabCacheManager } = await import('./lib/TabCacheManager');
    
    // Get all storage keys
    const allStorage = await chrome.storage.local.get(null);
    const allKeys = Object.keys(allStorage);
    
    // Get the current cache
    const cache = await TabCacheManager.initCache();
    if (!cache) {
      console.warn('Background sync: No cache found when cleaning up orphaned attachments');
      return;
    }
    
    // Get all valid attachment IDs from all tabs
    const validAttachmentIds = new Set<number>();
    for (const tab of cache.tabs) {
      if (tab.attachments && tab.attachments.length > 0) {
        for (const attachment of tab.attachments) {
          if (attachment.id) {
            validAttachmentIds.add(attachment.id);
          }
        }
      }
    }
    
    // Find orphaned attachment keys
    const attachmentPrefix = 'attachment_';
    const orphanedAttachmentKeys: string[] = [];
    
    for (const key of allKeys) {
      if (key.startsWith(attachmentPrefix)) {
        const idStr = key.substring(attachmentPrefix.length);
        const id = parseInt(idStr, 10);
        
        if (!isNaN(id) && !validAttachmentIds.has(id)) {
          orphanedAttachmentKeys.push(key);
        }
      }
    }
    
    if (orphanedAttachmentKeys.length > 0) {
      console.log(`Background sync: Found ${orphanedAttachmentKeys.length} orphaned attachments to clean up`);
      
      // Remove orphaned attachments from storage
      await chrome.storage.local.remove(orphanedAttachmentKeys);
      console.log(`Background sync: Removed ${orphanedAttachmentKeys.length} orphaned attachments`);
    } else {
      console.log('Background sync: No orphaned attachments found');
    }
  } catch (error) {
    console.error('Background sync: Failed to clean up orphaned attachments:', error);
  }
}

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

    await chrome.tabs.sendMessage(tab.id, { type: 'toggleInterface' });
  } catch (error) {
    console.error('Failed to toggle interface:', error);
  }
});

import { NotesDB } from './lib/notesDB';

// Consolidated message handling
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'CAPTURE_URL') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const url = tabs[0]?.url;
      sendResponse({ success: !!url, url, error: url ? undefined : 'No URL found' });
    });
    return true; // Keep message channel open for async response
  }

  if (message.type === 'CAPTURE_SCREENSHOT') {
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
  
  // Handle manual sync request from content script
  if (message.type === 'REQUEST_SYNC') {
    (async () => {
      try {
        await performBackgroundSync();
        sendResponse({ success: true });
      } catch (error) {
        console.error('Failed to perform manual sync:', error);
        sendResponse({ success: false, error: (error as Error).message });
      }
    })();
    return true;
  }
  
  // Handle conflict resolution request
  if (message.type === 'RESOLVE_CONFLICT') {
    (async () => {
      try {
        const { TabCacheManager } = await import('./lib/TabCacheManager');
        const cache = await TabCacheManager.initCache();
        
        if (!cache) {
          throw new Error('No cache found');
        }
        
        const { tabId, resolution } = message;
        let updatedCache;
        
        switch (resolution) {
          case 'keep_local':
            updatedCache = await TabCacheManager.resolveConflictByKeepingLocal(cache, tabId);
            break;
          case 'keep_remote':
            // Find the remote tab from the conflict info
            const localTab = cache.tabs.find((tab: any) => tab.id === tabId);
            if (!localTab || !localTab.conflictInfo) {
              throw new Error('Conflict info not found');
            }
            
            // Get the remote cache to find the remote tab
            const result = await chrome.storage.local.get(TabCacheManager['CACHE_KEY']);
            const remoteCache = result[TabCacheManager['CACHE_KEY']];
            
            if (!remoteCache) {
              throw new Error('Remote cache not found');
            }
            
            const remoteTab = remoteCache.tabs.find((tab: any) => tab.id === tabId);
            if (!remoteTab) {
              throw new Error('Remote tab not found');
            }
            
            updatedCache = await TabCacheManager.resolveConflictByKeepingRemote(cache, tabId, remoteTab);
            break;
          case 'create_new':
            updatedCache = await TabCacheManager.resolveConflictByCreatingNewTab(cache, tabId);
            break;
          default:
            throw new Error(`Unknown resolution type: ${resolution}`);
        }
        
        // Broadcast the resolution to all content scripts
        chrome.runtime.sendMessage({
          type: 'CONFLICT_RESOLVED',
          tabId,
          resolution,
          timestamp: new Date().toISOString()
        }).catch(error => {
          // Ignore errors from no receivers
          if (!error.message.includes('Could not establish connection')) {
            console.error('Failed to broadcast conflict resolution:', error);
          }
        });
        
        sendResponse({ success: true, updatedCache });
      } catch (error) {
        console.error('Failed to resolve conflict:', error);
        sendResponse({ success: false, error: (error as Error).message });
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
  // Stop the background sync service
  stopBackgroundSyncService();
  
  // Get all tabs where our content script is running
  const tabs = Array.from(loadedTabs);
  
  // Send hide message to all active content scripts
  for (const tabId of tabs) {
    try {
      await chrome.tabs.sendMessage(tabId, { type: 'hideInterface' });
    } catch (error) {
      console.error(`Failed to hide interface in tab ${tabId}:`, error);
    }
  }
});

console.log('Background script initialized successfully');

export {}; // Keep module format 