import { TabCacheManager, TabCache } from './TabCacheManager';

/**
 * SyncService handles synchronization of tab cache data across multiple browser tabs
 * using both periodic background checks and event-based immediate updates
 */
export class SyncService {
  private static syncInterval: number | null = null;
  private static lastKnownUpdate: string = '';
  private static isListeningForMessages: boolean = false;
  
  /**
   * Starts the background synchronization service
   * @param onCacheUpdated Callback function to run when cache updates are detected
   * @param checkIntervalMs Milliseconds between checks (default: 30 seconds)
   */
  public static startSyncService(
    onCacheUpdated: (cache: TabCache) => void,
    checkIntervalMs: number = 30000
  ) {
    // Stop any existing interval
    this.stopSyncService();
    
    // Check initially
    this.checkForUpdates(onCacheUpdated);
    
    // Set up periodic checking
    this.syncInterval = window.setInterval(() => {
      this.checkForUpdates(onCacheUpdated);
    }, checkIntervalMs);
    
    // Start listening for immediate update messages if not already
    if (!this.isListeningForMessages) {
      this.setupMessageListener(onCacheUpdated);
    }
    
    console.log(`SyncService started with ${checkIntervalMs}ms interval`);
  }
  
  /**
   * Stops the background synchronization service
   */
  public static stopSyncService() {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
      console.log('SyncService stopped');
    }
  }
  
  /**
   * Sets up message listener for immediate updates from other instances
   */
  private static setupMessageListener(onCacheUpdated: (cache: TabCache) => void) {
    if (this.isListeningForMessages) return;
    
    chrome.runtime.onMessage.addListener((message) => {
      if (message.type === 'REFRESH_CACHE') {
        console.log('Received immediate cache refresh request');
        // If the timestamp is newer than our last update, refresh
        if (!this.lastKnownUpdate || message.timestamp > this.lastKnownUpdate) {
          this.lastKnownUpdate = message.timestamp;
          this.checkForUpdates(onCacheUpdated, true);
        }
      }
    });
    
    this.isListeningForMessages = true;
    console.log('SyncService message listener established');
  }
  
  /**
   * Checks for updates in the cache
   * @param onCacheUpdated Callback function for cache updates
   * @param force Force the callback even if no update detected
   */
  private static async checkForUpdates(
    onCacheUpdated: (cache: TabCache) => void,
    force: boolean = false
  ) {
    try {
      const currentCache = await TabCacheManager.initCache();
      if (!currentCache) return;
      
      // If this is the first check, the cache has been updated since last check, or force=true
      if (force || !this.lastKnownUpdate || currentCache.lastUpdated > this.lastKnownUpdate) {
        console.log('Cache update detected, refreshing data');
        this.lastKnownUpdate = currentCache.lastUpdated;
        onCacheUpdated(currentCache);
      }
    } catch (error) {
      console.error('Error checking for cache updates:', error);
    }
  }
  
  /**
   * Call this when we make local changes to avoid unnecessary updates
   * @param timestamp The timestamp of the last update we made
   */
  public static updateLastKnownUpdate(timestamp: string) {
    this.lastKnownUpdate = timestamp;
  }
  
  /**
   * Triggers an immediate cache sync across all extension instances
   */
  public static async triggerSync() {
    try {
      const cache = await TabCacheManager.initCache();
      if (cache) {
        // Update our local last known update time
        this.lastKnownUpdate = cache.lastUpdated;
        
        // Notify background script to broadcast the update
        chrome.runtime.sendMessage({ 
          type: 'CACHE_UPDATED',
          timestamp: cache.lastUpdated
        });
      }
    } catch (error) {
      console.error('Failed to trigger sync:', error);
    }
  }
}
