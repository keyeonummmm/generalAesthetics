import { Attachment } from './Attachment';

// Define interfaces for our cache structure
export interface Tab {
  id: string;
  title: string;
  content: string;
  attachments?: AttachmentReference[];
  isNew: boolean;
  version?: number;
  createdAt?: string;
  updatedAt?: string;
  syncStatus: 'pending' | 'synced';
  noteId?: string;
  lastEdited: string;
  pinned?: boolean;
  // Add fields for conflict detection and version tracking
  localVersion: number; // Incremented on each local change
  lastSyncedVersion?: number; // The version when last synced
  instanceId?: string; // Unique ID for the browser instance
  hasConflict?: boolean; // Flag to indicate if this tab has a conflict
  conflictInfo?: ConflictInfo; // Information about the conflict
}

// Interface for storage change listener callbacks
export interface StorageChangeEvent {
  oldCache?: TabCache;
  newCache?: TabCache;
  instanceId?: string;
  conflicts?: Tab[];
}

export type StorageChangeListener = (event: StorageChangeEvent) => void;

// New interface for tracking conflict information
export interface ConflictInfo {
  originalTabId: string; // ID of the original tab
  conflictingTabId: string; // ID of the conflicting tab
  timestamp: string; // When the conflict was detected
  instanceId: string; // ID of the instance that detected the conflict
  resolved: boolean; // Whether the conflict has been resolved
}

export interface AttachmentReference {
  id: number;
  type: "url" | "screenshot";
  url?: string;
  screenshotType?: 'visible' | 'full';
  createdAt: string;
  syncStatus: 'pending' | 'synced';
  // We don't store the actual data in the reference
  // Only metadata needed for display and identification
}

export interface TabCache {
  tabs: Tab[];
  activeTabId: string;
  lastUpdated: string;
  instanceId?: string; // Add instance ID to track which instance made changes
  backupTimestamp?: string; // When the last backup was made
}

/**
 * TabCacheManager handles all caching operations for tabs and their attachments.
 * It ensures that attachment data is properly cleaned up when tabs are closed.
 * It implements lazy loading for attachments to optimize memory usage.
 */
export class TabCacheManager {
  private static readonly CACHE_KEY = 'tabCache';
  private static readonly ATTACHMENT_PREFIX = 'attachment_';
  private static readonly BACKUP_PREFIX = 'tabCache_backup_';
  private static readonly MAX_RETRIES = 3;
  private static readonly RETRY_DELAY = 500; // ms
  private static readonly INSTANCE_ID = crypto.randomUUID(); // Unique ID for this browser instance
  private static storageChangeListeners: Set<StorageChangeListener> = new Set();
  private static isOwnUpdate = false;
  private static lastUpdateTimestamp = 0;
  private static readonly UPDATE_DEBOUNCE_TIME = 500; // ms
  private static lastProcessedUpdate: string | null = null;

  /**
   * Initialize the cache from storage
   */
  public static async initCache(): Promise<TabCache | null> {
    try {
      const result = await chrome.storage.local.get(this.CACHE_KEY);
      const cache = result[this.CACHE_KEY] || null;
      
      // If cache exists but doesn't have an instanceId, add one
      if (cache && !cache.instanceId) {
        cache.instanceId = this.INSTANCE_ID;
        await this.saveCache(cache);
      }
      
      return cache;
    } catch (error) {
      console.error('Failed to initialize tab cache:', error);
      return null;
    }
  }

  /**
   * Save the current cache state to storage
   */
  public static async saveCache(cache: TabCache, retryCount = 0): Promise<void> {
    try {
      // Mark this as our own update to avoid handling our own changes
      this.isOwnUpdate = true;
      
      // Add instance ID and update timestamp
      const updatedCache = {
        ...cache,
        instanceId: this.INSTANCE_ID,
        lastUpdated: new Date().toISOString()
      };
      
      await chrome.storage.local.set({
        [this.CACHE_KEY]: updatedCache
      });
      
      // Set a timeout to reset isOwnUpdate flag after storage event has been processed
      setTimeout(() => {
        this.isOwnUpdate = false;
      }, 100);
    } catch (error) {
      console.error('Failed to save tab cache:', error);
      this.isOwnUpdate = false; // Reset flag on error
      
      // Implement retry mechanism
      if (retryCount < this.MAX_RETRIES) {
        console.log(`Retrying save cache (attempt ${retryCount + 1} of ${this.MAX_RETRIES})...`);
        setTimeout(() => {
          this.saveCache(cache, retryCount + 1);
        }, this.RETRY_DELAY);
      } else {
        console.error(`Failed to save cache after ${this.MAX_RETRIES} attempts`);
        // Create a backup of the failed cache
        this.createBackup(cache, 'save_failed');
      }
    }
  }

  /**
   * Create a backup of the current cache
   */
  public static async createBackup(cache: TabCache, reason: string): Promise<void> {
    try {
      const timestamp = new Date().toISOString();
      const backupKey = `${this.BACKUP_PREFIX}${timestamp}`;
      
      await chrome.storage.local.set({
        [backupKey]: {
          ...cache,
          backupTimestamp: timestamp,
          backupReason: reason
        }
      });
      
      console.log(`Created cache backup: ${backupKey}`);
      
      // Clean up old backups (keep only the last 5)
      this.cleanupOldBackups();
    } catch (error) {
      console.error('Failed to create cache backup:', error);
    }
  }

  /**
   * Clean up old backups, keeping only the most recent ones
   */
  private static async cleanupOldBackups(maxBackups = 5): Promise<void> {
    try {
      // Get all keys from storage
      const allStorage = await chrome.storage.local.get(null);
      if (!allStorage) {
        console.warn('No storage found when cleaning up old backups');
        return;
      }
      
      const allKeys = Object.keys(allStorage);
      
      // Filter for backup keys
      const backupKeys = allKeys
        .filter(key => key.startsWith(this.BACKUP_PREFIX))
        .sort((a, b) => b.localeCompare(a)); // Sort newest first
      
      // Remove old backups
      if (backupKeys.length > maxBackups) {
        const keysToRemove = backupKeys.slice(maxBackups);
        await chrome.storage.local.remove(keysToRemove);
        console.log(`Removed ${keysToRemove.length} old cache backups`);
      }
    } catch (error) {
      console.error('Failed to clean up old backups:', error);
    }
  }

  /**
   * Restore a cache from a backup
   */
  public static async restoreFromBackup(backupKey: string): Promise<TabCache | null> {
    try {
      const result = await chrome.storage.local.get(backupKey);
      const backup = result[backupKey];
      
      if (!backup) {
        console.error(`Backup ${backupKey} not found`);
        return null;
      }
      
      // Restore the backup to the main cache
      await this.saveCache(backup);
      console.log(`Restored cache from backup: ${backupKey}`);
      
      return backup;
    } catch (error) {
      console.error(`Failed to restore from backup ${backupKey}:`, error);
      return null;
    }
  }

  /**
   * List all available backups
   */
  public static async listBackups(): Promise<{key: string, timestamp: string, reason: string}[]> {
    try {
      // Get all keys from storage
      const allStorage = await chrome.storage.local.get(null);
      if (!allStorage) {
        console.warn('No storage found when listing backups');
        return [];
      }
      
      const allKeys = Object.keys(allStorage);
      
      // Filter for backup keys and extract metadata
      const backups = allKeys
        .filter(key => key.startsWith(this.BACKUP_PREFIX))
        .map(key => ({
          key,
          timestamp: allStorage[key].backupTimestamp || 'unknown',
          reason: allStorage[key].backupReason || 'unknown'
        }))
        .sort((a, b) => b.timestamp.localeCompare(a.timestamp)); // Sort newest first
      
      return backups;
    } catch (error) {
      console.error('Failed to list backups:', error);
      return [];
    }
  }

  /**
   * Register a listener for storage changes
   * This allows components to react to changes made in other tabs
   */
  public static registerStorageChangeListener(listener: StorageChangeListener): void {
    // Add the listener to our set
    this.storageChangeListeners.add(listener);
    
    // If this is the first listener, set up the chrome storage listener
    if (this.storageChangeListeners.size === 1) {
      this.initStorageChangeListener();
      console.log('Storage change listener registered');
    }
  }

  /**
   * Unregister a storage change listener
   */
  public static unregisterStorageChangeListener(listener: StorageChangeListener): void {
    // Remove the listener from our set
    this.storageChangeListeners.delete(listener);
    
    // If there are no more listeners, remove the chrome storage listener
    if (this.storageChangeListeners.size === 0) {
      chrome.storage.onChanged.removeListener(this.handleStorageChange);
      console.log('Storage change listener unregistered');
    }
  }

  /**
   * Initialize the storage change listener
   */
  private static initStorageChangeListener(): void {
    // Remove any existing listeners to prevent duplicates
    chrome.storage.onChanged.removeListener(this.handleStorageChange);
    
    // Add the listener
    chrome.storage.onChanged.addListener(this.handleStorageChange);
    console.log('Storage change listener initialized');
  }

  /**
   * Handle storage changes from other contexts
   */
  private static handleStorageChange = (
    changes: {[key: string]: chrome.storage.StorageChange},
    areaName: string
  ): void => {
    // Only care about local storage changes
    if (areaName !== 'local') return;
    
    // Check if our cache key changed
    if (changes[this.CACHE_KEY]) {
      const newValue = changes[this.CACHE_KEY].newValue;
      const oldValue = changes[this.CACHE_KEY].oldValue;
      
      // Skip if this is our own update
      if (this.isOwnUpdate) {
        console.log('Ignoring own update to cache');
        return;
      }
      
      // Implement debouncing to prevent rapid successive updates
      const now = Date.now();
      if (now - this.lastUpdateTimestamp < this.UPDATE_DEBOUNCE_TIME) {
        console.log('Debouncing rapid cache update');
        return;
      }
      this.lastUpdateTimestamp = now;
      
      // Check if we've already processed this exact update
      const updateHash = JSON.stringify(newValue?.lastUpdated);
      if (updateHash === this.lastProcessedUpdate) {
        console.log('Ignoring duplicate cache update');
        return;
      }
      this.lastProcessedUpdate = updateHash;
      
      console.log('Cache changed externally, checking for conflicts...');
      this.handleExternalCacheUpdate(newValue, oldValue);
    }
  };

  /**
   * Handle external cache updates and detect conflicts
   */
  private static async handleExternalCacheUpdate(
    newCache: TabCache | undefined, 
    oldCache: TabCache | undefined
  ): Promise<void> {
    if (!newCache) {
      console.warn('External update with empty cache, ignoring');
      return;
    }
    
    try {
      // Get our current cache
      const result = await chrome.storage.local.get(this.CACHE_KEY);
      const currentCache = result[this.CACHE_KEY];
      
      if (!currentCache) {
        console.warn('No local cache found when handling external update');
        return;
      }
      
      // Check for conflicts
      const conflicts = this.detectConflicts(currentCache, newCache);
      
      // Notify all registered listeners
      this.storageChangeListeners.forEach(listener => {
        try {
          listener({
            oldCache: oldCache,
            newCache: newCache,
            instanceId: newCache?.instanceId,
            conflicts: conflicts.length > 0 ? conflicts : undefined
          });
        } catch (error) {
          console.error('Error in storage change listener:', error);
        }
      });
    } catch (error) {
      console.error('Error handling external cache update:', error);
    }
  }

  /**
   * Detect conflicts between local and remote tabs
   */
  public static detectConflicts(localCache: TabCache, remoteCache: TabCache): Tab[] {
    const conflictingTabs: Tab[] = [];
    
    // Skip if either cache is null
    if (!localCache || !remoteCache) return conflictingTabs;
    
    // Check each local tab for conflicts with remote tabs
    for (const localTab of localCache.tabs) {
      // Find matching remote tab by ID
      const remoteTab = remoteCache.tabs.find(tab => tab.id === localTab.id);
      
      // Skip if no matching remote tab
      if (!remoteTab) continue;
      
      // Check for conflicts
      const hasConflict = this.isTabInConflict(localTab, remoteTab);
      
      if (hasConflict) {
        console.log(`Conflict detected for tab ${localTab.id}:`, {
          localVersion: localTab.localVersion,
          remoteVersion: remoteTab.localVersion,
          localLastEdited: localTab.lastEdited,
          remoteLastEdited: remoteTab.lastEdited
        });
        
        // Mark the local tab as having a conflict
        localTab.hasConflict = true;
        localTab.conflictInfo = {
          originalTabId: localTab.id,
          conflictingTabId: remoteTab.id,
          timestamp: new Date().toISOString(),
          instanceId: remoteCache.instanceId || 'unknown',
          resolved: false
        };
        
        conflictingTabs.push(localTab);
      }
    }
    
    return conflictingTabs;
  }

  /**
   * Check if two tabs are in conflict
   */
  private static isTabInConflict(localTab: Tab, remoteTab: Tab): boolean {
    // If either tab doesn't have version tracking, we can't detect conflicts
    if (localTab.localVersion === undefined || remoteTab.localVersion === undefined) {
      return false;
    }
    
    // If the local tab has been synced and its last synced version matches the remote version,
    // there's no conflict
    if (localTab.lastSyncedVersion !== undefined && 
        localTab.lastSyncedVersion === remoteTab.localVersion) {
      return false;
    }
    
    // If the content is identical, there's no conflict regardless of versions
    if (localTab.title === remoteTab.title && localTab.content === remoteTab.content) {
      return false;
    }
    
    // If both tabs have been modified since their last sync, there's a potential conflict
    const localModified = localTab.localVersion !== localTab.lastSyncedVersion;
    const remoteModified = remoteTab.localVersion !== remoteTab.lastSyncedVersion;
    
    if (localModified && remoteModified) {
      // Check if the modifications were made at significantly different times
      // (more than 5 minutes apart)
      const localTime = new Date(localTab.lastEdited).getTime();
      const remoteTime = new Date(remoteTab.lastEdited).getTime();
      const timeDiff = Math.abs(localTime - remoteTime);
      
      // If the edits were made close together, it's more likely to be a conflict
      if (timeDiff < 5 * 60 * 1000) {
        return true;
      }
      
      // If the edits were made far apart, the newer one probably has the latest changes
      // But we still flag it as a conflict if the content differs significantly
      return this.contentDifferenceIsSignificant(localTab, remoteTab);
    }
    
    return false;
  }

  /**
   * Check if the content difference between two tabs is significant
   */
  private static contentDifferenceIsSignificant(tab1: Tab, tab2: Tab): boolean {
    // Simple length-based heuristic
    const titleDiff = Math.abs(tab1.title.length - tab2.title.length);
    const contentDiff = Math.abs(tab1.content.length - tab2.content.length);
    
    // If the difference is more than 20% of the content, consider it significant
    const titleThreshold = Math.max(tab1.title.length, tab2.title.length) * 0.2;
    const contentThreshold = Math.max(tab1.content.length, tab2.content.length) * 0.2;
    
    return titleDiff > titleThreshold || contentDiff > contentThreshold;
  }

  /**
   * Resolve a conflict by creating a new tab with the conflicting content
   */
  public static async resolveConflictByCreatingNewTab(
    cache: TabCache, 
    conflictingTabId: string
  ): Promise<TabCache> {
    // Find the conflicting tab
    const conflictingTab = cache.tabs.find(tab => tab.id === conflictingTabId);
    if (!conflictingTab || !conflictingTab.conflictInfo) {
      console.error(`Cannot resolve conflict: Tab ${conflictingTabId} not found or has no conflict info`);
      return cache;
    }
    
    // Create a new tab with the conflicting content
    const newTabId = `conflict-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
    const newTab: Tab = {
      ...conflictingTab,
      id: newTabId,
      title: `${conflictingTab.title} (Conflict)`,
      hasConflict: false,
      conflictInfo: undefined,
      localVersion: 0,
      lastSyncedVersion: 0,
      lastEdited: new Date().toISOString()
    };
    
    // Mark the original tab's conflict as resolved
    const updatedTabs = cache.tabs.map(tab => {
      if (tab.id === conflictingTabId) {
        return {
          ...tab,
          hasConflict: false,
          conflictInfo: {
            ...tab.conflictInfo!,
            resolved: true
          }
        };
      }
      return tab;
    });
    
    // Add the new tab
    updatedTabs.push(newTab);
    
    // Update the cache
    const updatedCache = {
      ...cache,
      tabs: updatedTabs,
      lastUpdated: new Date().toISOString()
    };
    
    await this.saveCache(updatedCache);
    return updatedCache;
  }

  /**
   * Resolve a conflict by keeping the local version
   */
  public static async resolveConflictByKeepingLocal(
    cache: TabCache, 
    conflictingTabId: string
  ): Promise<TabCache> {
    // Find the conflicting tab
    const conflictingTab = cache.tabs.find(tab => tab.id === conflictingTabId);
    if (!conflictingTab || !conflictingTab.conflictInfo) {
      console.error(`Cannot resolve conflict: Tab ${conflictingTabId} not found or has no conflict info`);
      return cache;
    }
    
    // Mark the conflict as resolved and update the version
    const updatedTabs = cache.tabs.map(tab => {
      if (tab.id === conflictingTabId) {
        return {
          ...tab,
          hasConflict: false,
          conflictInfo: {
            ...tab.conflictInfo!,
            resolved: true
          },
          // Increment the version to ensure it's higher than the remote
          localVersion: tab.localVersion + 1,
          lastSyncedVersion: tab.localVersion + 1
        };
      }
      return tab;
    });
    
    // Update the cache
    const updatedCache = {
      ...cache,
      tabs: updatedTabs,
      lastUpdated: new Date().toISOString()
    };
    
    await this.saveCache(updatedCache);
    return updatedCache;
  }

  /**
   * Resolve a conflict by keeping the remote version
   */
  public static async resolveConflictByKeepingRemote(
    cache: TabCache, 
    conflictingTabId: string,
    remoteTab: Tab
  ): Promise<TabCache> {
    // Find the conflicting tab
    const conflictingTab = cache.tabs.find(tab => tab.id === conflictingTabId);
    if (!conflictingTab || !conflictingTab.conflictInfo) {
      console.error(`Cannot resolve conflict: Tab ${conflictingTabId} not found or has no conflict info`);
      return cache;
    }
    
    // Update the tab with the remote content and mark the conflict as resolved
    const updatedTabs = cache.tabs.map(tab => {
      if (tab.id === conflictingTabId) {
        return {
          ...remoteTab,
          hasConflict: false,
          conflictInfo: {
            ...tab.conflictInfo!,
            resolved: true
          },
          lastSyncedVersion: remoteTab.localVersion
        };
      }
      return tab;
    });
    
    // Update the cache
    const updatedCache = {
      ...cache,
      tabs: updatedTabs,
      lastUpdated: new Date().toISOString()
    };
    
    await this.saveCache(updatedCache);
    return updatedCache;
  }

  /**
   * Validate the cache structure and repair if needed
   */
  public static async validateAndRepairCache(): Promise<TabCache | null> {
    try {
      const cache = await this.initCache();
      
      // If no cache exists, create a new one
      if (!cache) {
        console.log('No cache found, creating a new one');
        const newCache: TabCache = {
          tabs: [],
          activeTabId: '',
          lastUpdated: new Date().toISOString(),
          instanceId: this.INSTANCE_ID
        };
        await this.saveCache(newCache);
        return newCache;
      }
      
      let needsRepair = false;
      const repairedCache = { ...cache };
      
      // Check if required fields exist
      if (!repairedCache.tabs) {
        console.warn('Cache missing tabs array, repairing');
        repairedCache.tabs = [];
        needsRepair = true;
      }
      
      if (!repairedCache.lastUpdated) {
        console.warn('Cache missing lastUpdated timestamp, repairing');
        repairedCache.lastUpdated = new Date().toISOString();
        needsRepair = true;
      }
      
      if (!repairedCache.instanceId) {
        console.warn('Cache missing instanceId, repairing');
        repairedCache.instanceId = this.INSTANCE_ID;
        needsRepair = true;
      }
      
      // Check if activeTabId is valid
      if (repairedCache.activeTabId && 
          repairedCache.tabs.length > 0 && 
          !repairedCache.tabs.some(tab => tab.id === repairedCache.activeTabId)) {
        console.warn('Cache has invalid activeTabId, repairing');
        repairedCache.activeTabId = repairedCache.tabs[0].id;
        needsRepair = true;
      }
      
      // Check each tab for required fields
      const repairedTabs = repairedCache.tabs.map(tab => {
        const repairedTab = { ...tab };
        let tabNeedsRepair = false;
        
        // Check required fields
        if (!repairedTab.id) {
          console.warn('Tab missing id, repairing');
          repairedTab.id = `repaired-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
          tabNeedsRepair = true;
        }
        
        if (repairedTab.title === undefined) {
          console.warn(`Tab ${repairedTab.id} missing title, repairing`);
          repairedTab.title = '';
          tabNeedsRepair = true;
        }
        
        if (repairedTab.content === undefined) {
          console.warn(`Tab ${repairedTab.id} missing content, repairing`);
          repairedTab.content = '';
          tabNeedsRepair = true;
        }
        
        if (repairedTab.syncStatus === undefined) {
          console.warn(`Tab ${repairedTab.id} missing syncStatus, repairing`);
          repairedTab.syncStatus = 'pending';
          tabNeedsRepair = true;
        }
        
        if (repairedTab.lastEdited === undefined) {
          console.warn(`Tab ${repairedTab.id} missing lastEdited, repairing`);
          repairedTab.lastEdited = new Date().toISOString();
          tabNeedsRepair = true;
        }
        
        if (repairedTab.localVersion === undefined) {
          console.warn(`Tab ${repairedTab.id} missing localVersion, repairing`);
          repairedTab.localVersion = 0;
          tabNeedsRepair = true;
        }
        
        return tabNeedsRepair ? repairedTab : tab;
      });
      
      if (repairedTabs.some(tab => tab !== cache.tabs.find(t => t.id === tab.id))) {
        repairedCache.tabs = repairedTabs;
        needsRepair = true;
      }
      
      // Save the repaired cache if needed
      if (needsRepair) {
        console.log('Cache repaired, saving changes');
        await this.saveCache(repairedCache);
      } else {
        console.log('Cache validation passed, no repairs needed');
      }
      
      return repairedCache;
    } catch (error) {
      console.error('Failed to validate and repair cache:', error);
      
      // Try to restore from the most recent backup
      try {
        const backups = await this.listBackups();
        if (backups.length > 0) {
          console.log('Attempting to restore from most recent backup');
          return await this.restoreFromBackup(backups[0].key);
        }
      } catch (backupError) {
        console.error('Failed to restore from backup:', backupError);
      }
      
      return null;
    }
  }

  /**
   * Convert a full attachment to an attachment reference for storage in the tab cache
   */
  private static createAttachmentReference(attachment: Attachment): AttachmentReference {
    return {
      id: attachment.id,
      type: attachment.type,
      url: attachment.url,
      screenshotType: attachment.screenshotType,
      createdAt: attachment.createdAt,
      syncStatus: attachment.syncStatus
    };
  }

  /**
   * Load the full attachment data from storage
   */
  public static async loadAttachment(attachmentId: number): Promise<Attachment | null> {
    try {
      const key = `${this.ATTACHMENT_PREFIX}${attachmentId}`;
      console.log(`Attempting to load attachment with ID ${attachmentId} using key ${key}`);
      
      const result = await chrome.storage.local.get(key);
      
      if (!result[key]) {
        console.warn(`Attachment ${attachmentId} not found in cache`);
        return null;
      }
      
      console.log(`Successfully loaded attachment ${attachmentId} from cache`);
      return result[key];
    } catch (error) {
      console.error(`Failed to load attachment ${attachmentId}:`, error);
      return null;
    }
  }

  /**
   * Load all attachments for a tab
   */
  public static async loadAttachmentsForTab(tab: Tab): Promise<Attachment[]> {
    if (!tab.attachments || tab.attachments.length === 0) {
      console.log(`Tab ${tab.id} has no attachment references to load`);
      return [];
    }

    console.log(`Attempting to load ${tab.attachments.length} attachments for tab ${tab.id}`);
    const attachments: Attachment[] = [];
    const failedAttachments: number[] = [];
    
    for (const reference of tab.attachments) {
      try {
        if (!reference.id) {
          console.warn(`Skipping attachment reference with no ID in tab ${tab.id}`);
          continue;
        }
        
        const attachment = await this.loadAttachment(reference.id);
        if (attachment) {
          attachments.push(attachment);
        } else {
          failedAttachments.push(reference.id);
        }
      } catch (error) {
        console.error(`Error loading attachment ${reference.id} for tab ${tab.id}:`, error);
        failedAttachments.push(reference.id);
      }
    }
    
    if (failedAttachments.length > 0) {
      console.warn(`Failed to load ${failedAttachments.length} attachments for tab ${tab.id}:`, failedAttachments);
    }
    
    console.log(`Successfully loaded ${attachments.length} of ${tab.attachments.length} attachments for tab ${tab.id}`);
    return attachments;
  }

  /**
   * Add or update a tab in the cache
   */
  public static async updateTab(cache: TabCache, tab: Tab): Promise<TabCache> {
    const updatedTabs = [...cache.tabs];
    const existingTabIndex = updatedTabs.findIndex(t => t.id === tab.id);
    
    if (existingTabIndex >= 0) {
      updatedTabs[existingTabIndex] = tab;
    } else {
      updatedTabs.push(tab);
    }

    const updatedCache = {
      ...cache,
      tabs: updatedTabs,
      lastUpdated: new Date().toISOString()
    };

    await this.saveCache(updatedCache);
    return updatedCache;
  }

  /**
   * Remove a tab from the cache and clean up its attachments
   */
  public static async removeTab(cache: TabCache, tabId: string): Promise<TabCache> {
    // Find the tab to be removed
    const tabToRemove = cache.tabs.find(tab => tab.id === tabId);
    if (!tabToRemove) {
      console.warn(`Tab ${tabId} not found in cache for removal`);
      return cache;
    }
    
    console.log(`Removing tab ${tabId} from cache`, {
      hasNoteId: !!tabToRemove.noteId,
      attachmentCount: tabToRemove.attachments?.length || 0
    });
    
    // Clean up attachments if they exist
    if (tabToRemove?.attachments && tabToRemove.attachments.length > 0) {
      // Check if this is a saved note and if any other tabs reference this note
      const isSharedNote = tabToRemove.noteId && cache.tabs.some(
        tab => tab.id !== tabId && tab.noteId === tabToRemove.noteId
      );
      
      if (isSharedNote) {
        // If this is a saved note and other tabs reference it, preserve the attachments
        console.log(`Preserving attachments for note ${tabToRemove.noteId} as it's referenced by other tabs`);
      } else if (tabToRemove.noteId) {
        // If this is a saved note but no other tabs reference it, we still preserve attachments
        // as they might be needed when the note is opened again
        console.log(`Preserving attachments for saved note ${tabToRemove.noteId}`);
      } else {
        // If this is an unsaved note, clean up its attachments
        console.log(`Cleaning up attachments for unsaved tab ${tabId}`);
        
        // Convert attachment references to format expected by cleanupAttachments
        const attachmentsToCleanup = tabToRemove.attachments.map(ref => ({
          id: ref.id,
          type: ref.type,
          createdAt: ref.createdAt,
          syncStatus: ref.syncStatus
        } as Attachment));
        
        await this.cleanupAttachments(attachmentsToCleanup);
      }
    }
    
    // Remove the tab from the cache
    const updatedTabs = cache.tabs.filter(tab => tab.id !== tabId);
    
    // Update the active tab if necessary
    let activeTabId = cache.activeTabId;
    if (activeTabId === tabId && updatedTabs.length > 0) {
      activeTabId = updatedTabs[0].id;
    }
    
    const updatedCache = {
      ...cache,
      tabs: updatedTabs,
      activeTabId,
      lastUpdated: new Date().toISOString()
    };
    
    await this.saveCache(updatedCache);
    return updatedCache;
  }

  /**
   * Clean up attachment data from storage
   */
  private static async cleanupAttachments(attachments: Attachment[]): Promise<void> {
    try {
      // For each attachment, remove its data from storage
      for (const attachment of attachments) {
        if (attachment.id) {
          // Remove the attachment data from storage
          await chrome.storage.local.remove(`${this.ATTACHMENT_PREFIX}${attachment.id}`);
          console.log(`Cleaned up attachment: ${attachment.id}`);
        }
      }
    } catch (error) {
      console.error('Failed to clean up attachments:', error);
    }
  }

  /**
   * Add an attachment to a tab
   */
  public static async addAttachmentToTab(
    cache: TabCache, 
    tabId: string, 
    attachment: Attachment
  ): Promise<TabCache> {
    console.log(`Adding attachment to tab ${tabId}:`, {
      attachmentId: attachment.id,
      type: attachment.type,
      hasScreenshotData: !!attachment.screenshotData,
      hasThumbnailData: !!attachment.thumbnailData
    });
    
    const updatedTabs = [...cache.tabs];
    const tabIndex = updatedTabs.findIndex(tab => tab.id === tabId);
    
    if (tabIndex < 0) {
      console.error(`Cannot add attachment: Tab ${tabId} not found in cache`);
      return cache;
    }
    
    const tab = updatedTabs[tabIndex];
    
    // Check if this attachment already exists in the tab to prevent duplication
    if (tab.attachments && tab.attachments.some(a => a.id === attachment.id)) {
      console.log(`Attachment ${attachment.id} already exists in tab ${tabId}, skipping duplicate addition`);
      return cache;
    }
    
    // Create a reference to store in the tab
    const attachmentReference = this.createAttachmentReference(attachment);
    const attachmentRefs = [...(tab.attachments || []), attachmentReference];
    
    updatedTabs[tabIndex] = {
      ...tab,
      attachments: attachmentRefs,
      syncStatus: 'pending' as const
    };
    
    // Store the full attachment data separately
    if (attachment.id) {
      try {
        const key = `${this.ATTACHMENT_PREFIX}${attachment.id}`;
        console.log(`Storing attachment ${attachment.id} in cache with key ${key}`);
        
        await chrome.storage.local.set({
          [key]: attachment
        });
        
        // Verify the attachment was stored correctly
        const result = await chrome.storage.local.get(key);
        if (!result[key]) {
          console.error(`Failed to verify attachment ${attachment.id} was stored in cache`);
        } else {
          console.log(`Successfully stored and verified attachment ${attachment.id} in cache`);
        }
      } catch (error) {
        console.error(`Failed to store attachment ${attachment.id} in cache:`, error);
      }
    } else {
      console.error('Cannot store attachment without an ID');
    }
    
    const updatedCache = {
      ...cache,
      tabs: updatedTabs,
      lastUpdated: new Date().toISOString()
    };
    
    await this.saveCache(updatedCache);
    return updatedCache;
  }

  /**
   * Remove an attachment from a tab
   */
  public static async removeAttachmentFromTab(
    cache: TabCache, 
    tabId: string, 
    attachmentId: string
  ): Promise<TabCache> {
    const updatedTabs = [...cache.tabs];
    const tabIndex = updatedTabs.findIndex(tab => tab.id === tabId);
    
    if (tabIndex >= 0) {
      const tab = updatedTabs[tabIndex];
      
      if (tab.attachments) {
        // Find the attachment reference to remove
        const attachmentToRemove = tab.attachments.find(a => a.id?.toString() === attachmentId);
        
        // Remove the attachment reference from the tab
        const updatedAttachments = tab.attachments.filter(a => a.id?.toString() !== attachmentId);
        
        updatedTabs[tabIndex] = {
          ...tab,
          attachments: updatedAttachments,
          syncStatus: 'pending' as const
        };
        
        // Clean up the attachment data if we found a reference
        if (attachmentToRemove) {
          await this.cleanupAttachments([attachmentToRemove as Attachment]);
        }
        
        const updatedCache = {
          ...cache,
          tabs: updatedTabs,
          lastUpdated: new Date().toISOString()
        };
        
        await this.saveCache(updatedCache);
        return updatedCache;
      }
    }
    
    return cache;
  }

  /**
   * Clear all tab and attachment caches
   * Only cleans up orphaned attachments and preserves active tab attachments and pinned tabs
   */
  public static async clearAllCaches(): Promise<void> {
    try {
      // Get the current cache
      const cache = await this.initCache();
      
      if (cache) {
        // Get pinned tab and active tab
        const pinnedTabs = this.getPinnedTabs(cache);
        const pinnedTab = pinnedTabs.length > 0 ? pinnedTabs[0] : null; // Should be at most one
        const activeTab = cache.tabs.find(tab => tab.id === cache.activeTabId);
        
        // Clean up orphaned attachments but preserve active tab and pinned tab attachments
        await this.cleanupOrphanedAttachments();
        
        // Don't remove the tab cache completely, just update it to keep the active tab and pinned tab
        const tabsToKeep = [];
        
        // Add pinned tab if it exists
        if (pinnedTab) {
          tabsToKeep.push(pinnedTab);
        }
        
        // Add active tab if it's not already included (as the pinned tab)
        if (activeTab && (!pinnedTab || activeTab.id !== pinnedTab.id)) {
          tabsToKeep.push(activeTab);
        }
        
        if (tabsToKeep.length > 0) {
          // Determine which tab should be active
          // Prioritize the pinned tab
          let newActiveTabId = cache.activeTabId;
          if (pinnedTab) {
            newActiveTabId = pinnedTab.id;
          }
          
          const updatedCache: TabCache = {
            tabs: tabsToKeep,
            activeTabId: newActiveTabId,
            lastUpdated: new Date().toISOString()
          };
          await this.saveCache(updatedCache);
          console.log('Cache cleared successfully while preserving pinned tab and active tab data');
        } else {
          // If no tabs to keep, clear the cache
          await chrome.storage.local.remove(this.CACHE_KEY);
          console.log('No tabs to preserve, cache cleared completely');
        }
      }
    } catch (error) {
      console.error('Failed to clear caches:', error);
    }
  }

  /**
   * Get all attachment IDs currently in use by any tab
   */
  public static getActiveAttachmentIds(cache: TabCache): string[] {
    const attachmentIds: string[] = [];
    
    for (const tab of cache.tabs) {
      if (tab.attachments) {
        for (const attachment of tab.attachments) {
          if (attachment.id) {
            attachmentIds.push(attachment.id.toString());
          }
        }
      }
    }
    
    return attachmentIds;
  }

  /**
   * Clean up orphaned attachments (attachments not associated with any tab)
   */
  public static async cleanupOrphanedAttachments(): Promise<void> {
    try {
      console.log('Starting orphaned attachment cleanup...');
      
      // Get all keys from storage
      const allStorage = await chrome.storage.local.get(null);
      const allKeys = Object.keys(allStorage);
      
      // Filter for attachment keys
      const attachmentKeys = allKeys.filter(key => key.startsWith(this.ATTACHMENT_PREFIX));
      console.log(`Found ${attachmentKeys.length} total attachment keys in storage`);
      
      // Get the current cache to find active attachment IDs
      const cache = await this.initCache();
      const activeAttachmentIds: string[] = [];
      
      if (cache) {
        // Collect all attachment IDs currently in use
        for (const tab of cache.tabs) {
          if (tab.attachments) {
            for (const attachment of tab.attachments) {
              if (attachment.id) {
                const key = `${this.ATTACHMENT_PREFIX}${attachment.id}`;
                activeAttachmentIds.push(key);
                console.log(`Active attachment found: ${key} in tab ${tab.id}`);
              }
            }
          }
        }
        console.log(`Found ${activeAttachmentIds.length} active attachments across all tabs`);
      } else {
        console.warn('No cache found, all attachments will be considered orphaned');
      }
      
      // Find orphaned attachment keys (those not in active use)
      const orphanedKeys = attachmentKeys.filter(key => !activeAttachmentIds.includes(key));
      
      // Remove orphaned attachments
      if (orphanedKeys.length > 0) {
        console.log(`Found ${orphanedKeys.length} orphaned attachments to clean up:`, orphanedKeys);
        
        // Remove in batches to avoid potential issues with large numbers of keys
        const BATCH_SIZE = 20;
        for (let i = 0; i < orphanedKeys.length; i += BATCH_SIZE) {
          const batch = orphanedKeys.slice(i, i + BATCH_SIZE);
          await chrome.storage.local.remove(batch);
          console.log(`Cleaned up batch of ${batch.length} orphaned attachments`);
        }
        
        console.log(`Successfully cleaned up ${orphanedKeys.length} orphaned attachments`);
      } else {
        console.log('No orphaned attachments found');
      }
      
      // Verify cleanup
      const afterCleanup = await chrome.storage.local.get(null);
      const remainingAttachmentKeys = Object.keys(afterCleanup).filter(key => 
        key.startsWith(this.ATTACHMENT_PREFIX)
      );
      console.log(`After cleanup: ${remainingAttachmentKeys.length} attachment keys remain in storage`);
      
    } catch (error) {
      console.error('Failed to clean up orphaned attachments:', error);
    }
  }

  /**
   * Pin a tab in the cache
   * Pinned tabs will be shown first in the tab list and will be prioritized when opening the extension
   * Only one tab can be pinned at a time
   */
  public static async pinTab(cache: TabCache, tabId: string): Promise<TabCache> {
    const updatedTabs = [...cache.tabs];
    const tabIndex = updatedTabs.findIndex(tab => tab.id === tabId);
    
    if (tabIndex >= 0) {
      // First, unpin any previously pinned tabs
      updatedTabs.forEach((tab, index) => {
        if (tab.pinned) {
          updatedTabs[index] = {
            ...tab,
            pinned: false
          };
        }
      });
      
      // Set the pinned property to true for the selected tab
      updatedTabs[tabIndex] = {
        ...updatedTabs[tabIndex],
        pinned: true
      };
      
      // Set this tab as the active tab
      const updatedCache = {
        ...cache,
        tabs: updatedTabs,
        activeTabId: tabId,
        lastUpdated: new Date().toISOString()
      };
      
      await this.saveCache(updatedCache);
      return updatedCache;
    }
    
    return cache;
  }

  /**
   * Unpin a tab in the cache
   */
  public static async unpinTab(cache: TabCache, tabId: string): Promise<TabCache> {
    const updatedTabs = [...cache.tabs];
    const tabIndex = updatedTabs.findIndex(tab => tab.id === tabId);
    
    if (tabIndex >= 0) {
      // Set the pinned property to false
      updatedTabs[tabIndex] = {
        ...updatedTabs[tabIndex],
        pinned: false
      };
      
      const updatedCache = {
        ...cache,
        tabs: updatedTabs,
        lastUpdated: new Date().toISOString()
      };
      
      await this.saveCache(updatedCache);
      return updatedCache;
    }
    
    return cache;
  }

  /**
   * Get the first pinned tab from the cache, if any
   * This is used to determine which tab should be active when opening the extension
   */
  public static getPinnedTabs(cache: TabCache): Tab[] {
    return cache.tabs.filter((tab: Tab) => tab.pinned);
  }

  /**
   * Synchronize the cache across different pages
   * This ensures that changes made on one page are reflected on other pages
   */
  public static async syncCache(): Promise<TabCache | null> {
    try {
      console.log('Synchronizing tab cache...');
      
      // Get the latest cache
      const latestCache = await this.initCache();
      if (!latestCache) {
        console.error('Failed to initialize cache for sync');
        return null;
      }
      
      // Clean up duplicate attachments
      const cleanedCache = await this.cleanupDuplicateAttachments(latestCache);
      
      // Get all pinned tabs
      const pinnedTabs = this.getPinnedTabs(cleanedCache);
      
      // Ensure only one tab is pinned (in case there are multiple from older versions)
      if (pinnedTabs.length > 1) {
        console.log('Found multiple pinned tabs, keeping only the most recently edited one');
        
        // Sort pinned tabs by lastEdited (newest first)
        const sortedPinnedTabs = [...pinnedTabs].sort((a, b) => 
          new Date(b.lastEdited).getTime() - new Date(a.lastEdited).getTime()
        );
        
        // Keep only the first one pinned, unpin the rest
        cleanedCache.tabs = cleanedCache.tabs.map((tab: Tab) => {
          if (tab.pinned && tab.id !== sortedPinnedTabs[0].id) {
            return { ...tab, pinned: false };
          }
          return tab;
        });
        
        // Save the updated cache
        await this.saveCache(cleanedCache);
        console.log('Updated cache to ensure only one tab is pinned');
      }
      
      // Determine which tab should be active
      // Prioritize the pinned tab
      let newActiveTabId = cleanedCache.activeTabId;
      let needsUpdate = false;
      
      if (pinnedTabs.length > 0) {
        // Get the pinned tab (should be only one now)
        const pinnedTab = pinnedTabs[0];
        if (newActiveTabId !== pinnedTab.id) {
          newActiveTabId = pinnedTab.id;
          needsUpdate = true;
          console.log(`Setting pinned tab ${newActiveTabId} as active`);
        }
      }
      
      // Synchronize attachments
      await this.synchronizeAttachments(cleanedCache);
      
      // Update the active tab ID if needed
      if (needsUpdate) {
        cleanedCache.activeTabId = newActiveTabId;
        await this.saveCache(cleanedCache);
        console.log(`Updated active tab to ${newActiveTabId} in synchronized cache`);
      } else {
        console.log('No changes needed during sync, avoiding unnecessary save');
      }
      
      return cleanedCache;
    } catch (error) {
      console.error('Failed to synchronize tab cache:', error);
      return null;
    }
  }
  
  /**
   * Synchronize attachments across different instances of the extension
   * This ensures that attachment data is available to all instances
   */
  private static async synchronizeAttachments(cache: TabCache): Promise<void> {
    try {
      if (!cache || !cache.tabs || cache.tabs.length === 0) {
        return;
      }
      
      console.log('Synchronizing attachment data...');
      
      // Get all storage keys
      const allStorage = await chrome.storage.local.get(null);
      const allKeys = Object.keys(allStorage);
      
      // Get all attachment references from all tabs
      const attachmentRefs: Map<number, Tab> = new Map();
      const duplicateAttachmentIds: Set<number> = new Set();
      
      // First pass: identify duplicate attachment references
      for (const tab of cache.tabs) {
        if (tab.attachments && tab.attachments.length > 0) {
          // Check for duplicates within the same tab
          const seenIdsInTab = new Set<number>();
          
          for (const attachment of tab.attachments) {
            if (attachment.id) {
              if (seenIdsInTab.has(attachment.id)) {
                // Duplicate within the same tab
                duplicateAttachmentIds.add(attachment.id);
                console.warn(`Found duplicate attachment ${attachment.id} in tab ${tab.id}`);
              } else {
                seenIdsInTab.add(attachment.id);
              }
              
              if (attachmentRefs.has(attachment.id)) {
                // Duplicate across tabs
                duplicateAttachmentIds.add(attachment.id);
                console.warn(`Found duplicate attachment ${attachment.id} across tabs`);
              } else {
                attachmentRefs.set(attachment.id, tab);
              }
            }
          }
        }
      }
      
      console.log(`Found ${attachmentRefs.size} unique attachment references to check`);
      if (duplicateAttachmentIds.size > 0) {
        console.warn(`Found ${duplicateAttachmentIds.size} duplicate attachment references`);
      }
      
      // Check if each attachment exists in storage
      const missingAttachments: number[] = [];
      for (const attachmentId of attachmentRefs.keys()) {
        const key = `${this.ATTACHMENT_PREFIX}${attachmentId}`;
        if (!allKeys.includes(key)) {
          missingAttachments.push(attachmentId);
        }
      }
      
      // Determine if we need to update the cache
      let cacheUpdated = false;
      
      if (missingAttachments.length > 0 || duplicateAttachmentIds.size > 0) {
        console.warn(`Found ${missingAttachments.length} missing attachments and ${duplicateAttachmentIds.size} duplicates`);
        
        // Remove references to missing attachments and deduplicate references
        const updatedTabs = cache.tabs.map(tab => {
          if (tab.attachments && tab.attachments.length > 0) {
            // Filter out missing attachments and deduplicate
            const seenIds = new Set<number>();
            const filteredAttachments = tab.attachments.filter(attachment => {
              if (!attachment.id) return false;
              
              // Remove if missing or already seen (duplicate)
              if (missingAttachments.includes(attachment.id) || seenIds.has(attachment.id)) {
                return false;
              }
              
              // Keep this one and mark as seen
              seenIds.add(attachment.id);
              return true;
            });
            
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
          
          await this.saveCache(updatedCache);
          console.log('Updated cache to remove missing and duplicate attachment references');
        }
      } else {
        console.log('All attachment references are valid and unique');
      }
    } catch (error) {
      console.error('Failed to synchronize attachments:', error);
    }
  }

  /**
   * Clean up all attachments for a specific note ID
   * This is used when a note is deleted from the database
   */
  public static async cleanupAttachmentsForNote(noteId: string): Promise<void> {
    try {
      console.log(`Cleaning up attachments for deleted note ${noteId}...`);
      
      // Get the current cache
      const cache = await this.initCache();
      if (!cache) {
        console.warn('No cache found when cleaning up attachments for note');
        return;
      }
      
      // Find all tabs that reference this note
      const tabsWithNote = cache.tabs.filter(tab => tab.noteId === noteId);
      console.log(`Found ${tabsWithNote.length} tabs referencing note ${noteId}`);
      
      // Collect all attachment IDs from these tabs
      const attachmentIds: number[] = [];
      for (const tab of tabsWithNote) {
        if (tab.attachments) {
          for (const attachment of tab.attachments) {
            if (attachment.id && !attachmentIds.includes(attachment.id)) {
              attachmentIds.push(attachment.id);
            }
          }
        }
      }
      
      console.log(`Found ${attachmentIds.length} attachments to clean up for note ${noteId}`);
      
      // Remove each attachment from storage
      for (const attachmentId of attachmentIds) {
        const key = `${this.ATTACHMENT_PREFIX}${attachmentId}`;
        await chrome.storage.local.remove(key);
        console.log(`Removed attachment ${attachmentId} from storage for deleted note ${noteId}`);
      }
      
      // Update the tabs to remove references to the deleted note
      const updatedTabs = cache.tabs.map(tab => {
        if (tab.noteId === noteId) {
          // Check if the tab was pinned before
          const wasPinned = tab.pinned;
          if (wasPinned) {
            console.log(`Unpinning tab ${tab.id} as it's being reset due to note deletion`);
          }
          
          // Clear the noteId and attachments from the tab, and reset pinned status
          return {
            ...tab,
            noteId: undefined,
            attachments: undefined,
            syncStatus: 'pending' as const,
            pinned: false // Always reset pinned status
          };
        }
        return tab;
      });
      
      // Save the updated cache
      const updatedCache = {
        ...cache,
        tabs: updatedTabs,
        lastUpdated: new Date().toISOString()
      };
      await this.saveCache(updatedCache);
      
      console.log(`Successfully cleaned up attachments for deleted note ${noteId}`);
    } catch (error) {
      console.error(`Failed to clean up attachments for note ${noteId}:`, error);
    }
  }

  /**
   * Clean up duplicate attachments in the cache
   * This is a utility function to fix issues with duplicate attachments
   */
  public static async cleanupDuplicateAttachments(cache: TabCache): Promise<TabCache> {
    try {
      if (!cache || !cache.tabs || cache.tabs.length === 0) {
        return cache;
      }
      
      console.log('Cleaning up duplicate attachments in cache...');
      
      let cacheUpdated = false;
      const updatedTabs = cache.tabs.map(tab => {
        if (tab.attachments && tab.attachments.length > 0) {
          // Check for duplicates within the same tab
          const seenIds = new Set<number>();
          const uniqueAttachments = tab.attachments.filter(attachment => {
            if (!attachment.id) return false;
            
            if (seenIds.has(attachment.id)) {
              // This is a duplicate
              console.log(`Removing duplicate attachment ${attachment.id} from tab ${tab.id}`);
              return false;
            }
            
            // Keep this one and mark as seen
            seenIds.add(attachment.id);
            return true;
          });
          
          if (uniqueAttachments.length !== tab.attachments.length) {
            cacheUpdated = true;
            console.log(`Removed ${tab.attachments.length - uniqueAttachments.length} duplicate attachments from tab ${tab.id}`);
            return {
              ...tab,
              attachments: uniqueAttachments
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
        
        await this.saveCache(updatedCache);
        console.log('Updated cache to remove duplicate attachment references');
        return updatedCache;
      }
      
      return cache;
    } catch (error) {
      console.error('Failed to clean up duplicate attachments:', error);
      return cache;
    }
  }
} 