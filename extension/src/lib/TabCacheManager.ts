import { Attachment } from './Attachment';

// Define interfaces for our cache structure
export interface Tab {
  id: string;
  title: string;
  content: string;
  attachments?: Attachment[];
  isNew: boolean;
  version?: number;
  createdAt?: string;
  updatedAt?: string;
  syncStatus: 'pending' | 'synced';
  noteId?: string;
  lastEdited: string;
}

export interface TabCache {
  tabs: Tab[];
  activeTabId: string;
  lastUpdated: string;
}

/**
 * TabCacheManager handles all caching operations for tabs and their attachments.
 * It ensures that attachment data is properly cleaned up when tabs are closed.
 */
export class TabCacheManager {
  private static CACHE_KEY = 'tabCache';

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
    
    // Clean up attachments if they exist
    if (tabToRemove?.attachments && tabToRemove.attachments.length > 0) {
      await this.cleanupAttachments(tabToRemove.attachments);
    }
    
    // Remove the tab from the cache
    const updatedTabs = cache.tabs.filter(tab => tab.id !== tabId);
    
    // If no tabs remain, create a new empty tab
    if (updatedTabs.length === 0) {
      // This logic should match your application's requirements for creating a new tab
      // You might want to move this logic elsewhere depending on your architecture
    }
    
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
          await chrome.storage.local.remove(`attachment_${attachment.id}`);
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
    const updatedTabs = [...cache.tabs];
    const tabIndex = updatedTabs.findIndex(tab => tab.id === tabId);
    
    if (tabIndex >= 0) {
      const tab = updatedTabs[tabIndex];
      const attachments = [...(tab.attachments || []), attachment];
      
      updatedTabs[tabIndex] = {
        ...tab,
        attachments,
        syncStatus: 'pending' as const
      };
      
      // Store the attachment data
      if (attachment.id) {
        await chrome.storage.local.set({
          [`attachment_${attachment.id}`]: attachment
        });
      }
      
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
        // Find the attachment to remove
        const attachmentToRemove = tab.attachments.find(a => a.id?.toString() === attachmentId);
        
        // Remove the attachment from the tab
        const updatedAttachments = tab.attachments.filter(a => a.id?.toString() !== attachmentId);
        
        updatedTabs[tabIndex] = {
          ...tab,
          attachments: updatedAttachments,
          syncStatus: 'pending' as const
        };
        
        // Clean up the attachment data
        if (attachmentToRemove) {
          await this.cleanupAttachments([attachmentToRemove]);
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
   * Only cleans up orphaned attachments and preserves active tab attachments
   */
  public static async clearAllCaches(): Promise<void> {
    try {
      // Get the current cache
      const cache = await this.initCache();
      
      if (cache) {
        // Only clean up attachments for tabs that are being removed
        // We want to preserve attachments for the active tab
        const activeTab = cache.tabs.find(tab => tab.id === cache.activeTabId);
        
        // Clean up orphaned attachments but preserve active tab attachments
        await this.cleanupOrphanedAttachments();
        
        // Don't remove the tab cache completely, just update it to keep the active tab
        if (activeTab) {
          const updatedCache: TabCache = {
            tabs: [activeTab],
            activeTabId: activeTab.id,
            lastUpdated: new Date().toISOString()
          };
          await this.saveCache(updatedCache);
        } else {
          // If no active tab, clear the cache
          await chrome.storage.local.remove(this.CACHE_KEY);
        }
        
        console.log('Cache cleared successfully while preserving active tab data');
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
      const attachmentKeys = allKeys.filter(key => key.startsWith('attachment_'));
      
      // Get the current cache to find active attachment IDs
      const cache = await this.initCache();
      const activeAttachmentIds: string[] = [];
      
      if (cache) {
        // Collect all attachment IDs currently in use
        for (const tab of cache.tabs) {
          if (tab.attachments) {
            for (const attachment of tab.attachments) {
              if (attachment.id) {
                activeAttachmentIds.push(`attachment_${attachment.id}`);
              }
            }
          }
        }
      }
      
      // Find orphaned attachment keys (those not in active use)
      const orphanedKeys = attachmentKeys.filter(key => !activeAttachmentIds.includes(key));
      
      // Remove orphaned attachments
      if (orphanedKeys.length > 0) {
        await chrome.storage.local.remove(orphanedKeys);
        console.log(`Cleaned up ${orphanedKeys.length} orphaned attachments:`, orphanedKeys);
      } else {
        console.log('No orphaned attachments found');
      }
    } catch (error) {
      console.error('Failed to clean up orphaned attachments:', error);
    }
  }
} 