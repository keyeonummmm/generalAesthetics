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
    
    // Clean up attachments if they exist
    if (tabToRemove?.attachments && tabToRemove.attachments.length > 0) {
      // Only clean up attachments for unsaved notes
      // If the tab has a noteId, it's a saved note and we should keep the attachments
      if (!tabToRemove.noteId) {
        // Convert attachment references to format expected by cleanupAttachments
        const attachmentsToCleanup = tabToRemove.attachments.map(ref => ({
          id: ref.id,
          type: ref.type,
          createdAt: ref.createdAt,
          syncStatus: ref.syncStatus
        } as Attachment));
        
        await this.cleanupAttachments(attachmentsToCleanup);
        console.log(`Cleaned up attachments for unsaved tab ${tabId}`);
      } else {
        console.log(`Preserving attachments for saved note ${tabToRemove.noteId} when closing tab ${tabId}`);
      }
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
} 