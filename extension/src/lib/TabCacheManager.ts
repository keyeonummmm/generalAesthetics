import { Attachment } from './Attachment';
import { TabAssociationManager } from './TabAssociationManager';

// Define interfaces for our cache structure
export interface Tab {
  id: string;
  title: string;
  content: string;
  isRichText?: boolean;
  attachments?: AttachmentReference[];
  isNew: boolean;
  version?: number;
  createdAt?: string;
  updatedAt?: string;
  syncStatus: 'pending' | 'synced';
  noteId?: string;
  lastEdited: string;
  pinned?: boolean;
  spreadsheetData?: boolean;
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
}

/**
 * TabCacheManager handles all caching operations for tabs and their attachments.
 * It ensures that attachment data is properly cleaned up when tabs are closed.
 * It implements lazy loading for attachments to optimize memory usage.
 */
export class TabCacheManager {
  private static CACHE_KEY = 'tabCache';
  private static ATTACHMENT_PREFIX = 'attachment_';

  /**
   * Initialize the cache from storage
   */
  public static async initCache(): Promise<TabCache | null> {
    try {
      const result = await chrome.storage.local.get(this.CACHE_KEY);
      return result[this.CACHE_KEY] || null;
    } catch (error) {
      console.error('Failed to initialize tab cache:', error);
      return null;
    }
  }

  /**
   * Save the current cache state to storage
   */
  public static async saveCache(cache: TabCache): Promise<void> {
    try {
      await chrome.storage.local.set({
        [this.CACHE_KEY]: {
          ...cache,
          lastUpdated: new Date().toISOString()
        }
      });
    } catch (error) {
      console.error('Failed to save tab cache:', error);
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
      const result = await chrome.storage.local.get(key);
      
      if (!result[key]) {
        return null;
      }
      
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
      return [];
    }

    const attachments: Attachment[] = [];
    const failedAttachments: number[] = [];
    
    for (const reference of tab.attachments) {
      try {
        if (!reference.id) {
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
    return attachments;
  }

  /**
   * Add or update a tab in the cache
   */
  public static async updateTab(cache: TabCache, tab: Tab): Promise<TabCache> {
    const updatedTabs = [...cache.tabs];
    const existingTabIndex = updatedTabs.findIndex(t => t.id === tab.id);
    
    // Ensure spreadsheetData flag is preserved or updated correctly
    if (existingTabIndex >= 0) {
      // Check if the content has any spreadsheet data
      const hasSpreadsheetData = tab.content && (
        tab.content.includes('ga-spreadsheet-container') || 
        /<div[^>]*class=[^>]*ga-spreadsheet[^>]*>|data-rows|data-columns|data-spreadsheet="true"/.test(tab.content)
      );
      
      // If the tab previously had spreadsheet data, preserve the spreadsheetData flag
      if (updatedTabs[existingTabIndex].spreadsheetData) {
        tab.spreadsheetData = true;
      } else if (hasSpreadsheetData) {
        // If the new content has spreadsheet data, set the flag
        tab.spreadsheetData = true;
      }
      
      updatedTabs[existingTabIndex] = tab;
    } else {
      // For new tabs, check if the content has any spreadsheet data
      if (tab.content) {
        const hasSpreadsheetData = 
          tab.content.includes('ga-spreadsheet-container') || 
          /<div[^>]*class=[^>]*ga-spreadsheet[^>]*>|data-rows|data-columns|data-spreadsheet="true"/.test(tab.content);
        
        if (hasSpreadsheetData && tab.spreadsheetData !== true) {
          tab.spreadsheetData = true;
        }
      }
      
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
    
    // Clean up attachments if they exist
    if (tabToRemove?.attachments && tabToRemove.attachments.length > 0) {
      // Check if this is a saved note and if any other tabs reference this note
      const isSharedNote = tabToRemove.noteId && cache.tabs.some(
        tab => tab.id !== tabId && tab.noteId === tabToRemove.noteId
      );
      
      if (isSharedNote) {
        // If this is a saved note and other tabs reference it, preserve the attachments
      } else if (tabToRemove.noteId) {
        // If this is a saved note but no other tabs reference it, we still preserve attachments
        // as they might be needed when the note is opened again
      } else {
        // If this is an unsaved note, clean up its attachments
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
    const updatedTabs = [...cache.tabs];
    const tabIndex = updatedTabs.findIndex(tab => tab.id === tabId);
    
    if (tabIndex < 0) {
      console.error(`Cannot add attachment: Tab ${tabId} not found in cache`);
      return cache;
    }
    
    const tab = updatedTabs[tabIndex];
    
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
        await chrome.storage.local.set({
          [key]: attachment
        });
        
        // Verify the attachment was stored correctly
        const result = await chrome.storage.local.get(key);
        if (!result[key]) {
          console.error(`Failed to verify attachment ${attachment.id} was stored in cache`);
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
        } else {
          // If no tabs to keep, clear the cache
          await chrome.storage.local.remove(this.CACHE_KEY);
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
      // Get all keys from storage
      const allStorage = await chrome.storage.local.get(null);
      const allKeys = Object.keys(allStorage);
      
      // Filter for attachment keys
      const attachmentKeys = allKeys.filter(key => key.startsWith(this.ATTACHMENT_PREFIX));
      
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
              }
            }
          }
        }
      } else {
        console.warn('No cache found, all attachments will be considered orphaned');
      }
      
      // Find orphaned attachment keys (those not in active use)
      const orphanedKeys = attachmentKeys.filter(key => !activeAttachmentIds.includes(key));
      
      // Remove orphaned attachments
      if (orphanedKeys.length > 0) {

        // Remove in batches to avoid potential issues with large numbers of keys
        const BATCH_SIZE = 20;
        for (let i = 0; i < orphanedKeys.length; i += BATCH_SIZE) {
          const batch = orphanedKeys.slice(i, i + BATCH_SIZE);
          await chrome.storage.local.remove(batch);
        }
        
      } 
      // Verify cleanup
      const afterCleanup = await chrome.storage.local.get(null);
      const remainingAttachmentKeys = Object.keys(afterCleanup).filter(key => 
        key.startsWith(this.ATTACHMENT_PREFIX)
      );
      
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
      const timestamp = new Date().toISOString();
      
      // Set the pinned property to false and update lastEdited
      updatedTabs[tabIndex] = {
        ...updatedTabs[tabIndex],
        pinned: false,
        lastEdited: timestamp // Update lastEdited timestamp for recency-based selection
      };
      
      // Don't change the active tab here - this will be determined by the association system
      // after we update the association state in the component
      
      const updatedCache = {
        ...cache,
        tabs: updatedTabs,
        lastUpdated: timestamp
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
      // Get the current cache from storage
      const result = await chrome.storage.local.get(this.CACHE_KEY);
      const latestCache = result[this.CACHE_KEY];
      
      if (!latestCache) {
        return null;
      }
      
      // Get pinned tabs - should be at most one with our updated logic
      const pinnedTabs = latestCache.tabs.filter((tab: Tab) => tab.pinned);
      
      // Ensure only one tab is pinned (in case there are multiple from older versions)
      if (pinnedTabs.length > 1) {
        // Sort pinned tabs by lastEdited (newest first)
        const sortedPinnedTabs = [...pinnedTabs].sort((a, b) => 
          new Date(b.lastEdited).getTime() - new Date(a.lastEdited).getTime()
        );
        
        // Keep only the first one pinned, unpin the rest
        latestCache.tabs = latestCache.tabs.map((tab: Tab) => {
          if (tab.pinned && tab.id !== sortedPinnedTabs[0].id) {
            return { ...tab, pinned: false };
          }
          return tab;
        });
        
        // Save the updated cache
        await this.saveCache(latestCache);
      }
      
      // Check each tab to ensure spreadsheetData flag is properly set
      let requiresUpdate = false;
      latestCache.tabs = latestCache.tabs.map((tab: Tab) => {
        if (tab.content) {
          const hasSpreadsheetData = 
            tab.content.includes('ga-spreadsheet-container') || 
            /<div[^>]*class=[^>]*ga-spreadsheet[^>]*>|data-rows|data-columns|data-spreadsheet="true"/.test(tab.content);
            
          if (hasSpreadsheetData && tab.spreadsheetData !== true) {
            requiresUpdate = true;
            return { ...tab, spreadsheetData: true };
          }
        }
        return tab;
      });
      
      // If we updated any tabs, save the cache
      if (requiresUpdate) {
        await this.saveCache(latestCache);
      }
      
      // Determine which tab should be active based on the 3-layer priority system
      let newActiveTabId = latestCache.activeTabId;
      
      // Layer 1: Prioritize the pinned tab (highest priority)
      if (pinnedTabs.length > 0) {
        // Get the pinned tab (should be only one now)
        const pinnedTab = pinnedTabs[0];
        newActiveTabId = pinnedTab.id;
      } else {
        // Layer 2 & 3: Check for page-associated tab or use global active tab
        const associatedTabId = await TabAssociationManager.getActiveTabForCurrentPage(latestCache.tabs);
        if (associatedTabId) {
          newActiveTabId = associatedTabId;
          // Update the global active tab in TabAssociationManager
          await TabAssociationManager.updateGlobalActiveTab(associatedTabId);
        }
      }
      
      // Update the active tab ID if needed
      if (newActiveTabId !== latestCache.activeTabId) {
        latestCache.activeTabId = newActiveTabId;
        await this.saveCache(latestCache);
      }
      
      return latestCache;
    } catch (error) {
      console.error('Failed to synchronize tab cache:', error);
      return null;
    }
  }

  /**
   * Clean up all attachments for a specific note ID
   * This is used when a note is deleted from the database
   */
  public static async cleanupAttachmentsForNote(noteId: string): Promise<void> {
    try {
      // Get the current cache
      const cache = await this.initCache();
      if (!cache) {
        console.warn('No cache found when cleaning up attachments for note');
        return;
      }
      
      // Find all tabs that reference this note
      const tabsWithNote = cache.tabs.filter(tab => tab.noteId === noteId);
    
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
      
      // Remove each attachment from storage
      for (const attachmentId of attachmentIds) {
        const key = `${this.ATTACHMENT_PREFIX}${attachmentId}`;
        await chrome.storage.local.remove(key);
      }
      
      // Update the tabs to remove references to the deleted note
      const updatedTabs = cache.tabs.map(tab => {
        if (tab.noteId === noteId) {
          // Check if the tab was pinned before
          const wasPinned = tab.pinned;
          if (wasPinned) {
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
      
    } catch (error) {
      console.error(`Failed to clean up attachments for note ${noteId}:`, error);
    }
  }
} 