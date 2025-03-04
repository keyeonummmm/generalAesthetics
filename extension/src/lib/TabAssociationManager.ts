import { Tab } from './TabCacheManager';

/**
 * Association structure between tabs and pages
 */
export interface TabPageAssociation {
  // Map of page URLs to tab IDs
  pageToTab: Record<string, string>;
  // Map of tab IDs to an array of page URLs
  tabToPages: Record<string, string[]>;
  // The most recently active tab (globally)
  globalActiveTabId: string | null;
  // Last updated timestamp
  lastUpdated: string;
}

/**
 * Manages associations between tabs and browser pages
 */
export class TabAssociationManager {
  private static ASSOCIATION_KEY = 'tabPageAssociations';

  // Add a static debounce timer for global active tab updates
  private static globalActiveTabDebounceTimer: NodeJS.Timeout | null = null;
  private static globalActiveTabLastUpdated: string | null = null;

  /**
   * Initialize the association data structure
   */
  public static async initAssociations(): Promise<TabPageAssociation> {
    try {
      const result = await chrome.storage.local.get(this.ASSOCIATION_KEY);
      const associations = result[this.ASSOCIATION_KEY];
      
      if (associations) {
        return associations;
      }
      
      // Create a new association structure if none exists
      const newAssociations: TabPageAssociation = {
        pageToTab: {},
        tabToPages: {},
        globalActiveTabId: null,
        lastUpdated: new Date().toISOString()
      };
      
      await this.saveAssociations(newAssociations);
      return newAssociations;
    } catch (error) {
      console.error('Failed to initialize tab-page associations:', error);
      // Return a default empty structure
      return {
        pageToTab: {},
        tabToPages: {},
        globalActiveTabId: null,
        lastUpdated: new Date().toISOString()
      };
    }
  }

  /**
   * Save associations to storage
   */
  public static async saveAssociations(associations: TabPageAssociation): Promise<void> {
    try {
      associations.lastUpdated = new Date().toISOString();
      await chrome.storage.local.set({ [this.ASSOCIATION_KEY]: associations });
    } catch (error) {
      console.error('Failed to save tab-page associations:', error);
    }
  }

  /**
   * Get the current page URL (for association purposes)
   */
  public static async getCurrentPageUrl(): Promise<string> {
    try {
      // Get the current tab in the active window
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tabs.length > 0 && tabs[0].url) {
        // Use the hostname to associate with the domain, not the full URL
        const url = new URL(tabs[0].url);
        return url.hostname;
      }
      return 'unknown-page';
    } catch (error) {
      console.error('Failed to get current page URL:', error);
      return 'unknown-page';
    }
  }

  /**
   * Associate a tab with the current page
   */
  public static async associateTabWithCurrentPage(tabId: string): Promise<void> {
    try {
      const pageUrl = await this.getCurrentPageUrl();
      if (pageUrl === 'unknown-page') {
        console.log('Cannot associate tab with unknown page');
        return;
      }
      
      const associations = await this.initAssociations();
      
      // Check if this tab is already associated with this page - early return if yes
      if (associations.pageToTab[pageUrl] === tabId) {
        console.log(`Tab ${tabId} is already associated with page ${pageUrl}, no update needed`);
        return;
      }
      
      // Track if we need to save changes
      let needsSave = false;
      
      // If this page was previously associated with another tab,
      // remove the page from that tab's list of pages
      const previousTabId = associations.pageToTab[pageUrl];
      if (previousTabId && previousTabId !== tabId) {
        
        // Remove page from previous tab's list
        if (associations.tabToPages[previousTabId]) {
          associations.tabToPages[previousTabId] = associations.tabToPages[previousTabId].filter(p => p !== pageUrl);
          
          // Clean up empty arrays
          if (associations.tabToPages[previousTabId].length === 0) {
            delete associations.tabToPages[previousTabId];
          }
        }
      }
      
      // Update the pageToTab mapping
      associations.pageToTab[pageUrl] = tabId;
      
      // Update the tabToPages mapping
      if (!associations.tabToPages[tabId]) {
        associations.tabToPages[tabId] = [];
      }
      
      if (!associations.tabToPages[tabId].includes(pageUrl)) {
        associations.tabToPages[tabId].push(pageUrl);
      }
      
      await this.saveAssociations(associations);
    } catch (error) {
      console.error('Failed to associate tab with current page:', error);
    }
  }

  /**
   * Update the global active tab ID
   */
  public static async updateGlobalActiveTab(tabId: string): Promise<void> {
    try {
      if (!tabId) {
        console.error('Cannot update global active tab: Invalid tab ID');
        return;
      }
      
      const associations = await this.initAssociations();
      
      // Only update if the global active tab is changing
      if (associations.globalActiveTabId !== tabId) {
        associations.globalActiveTabId = tabId;
        await this.saveAssociations(associations);
      }
    } catch (error) {
      console.error('Failed to update global active tab:', error);
    }
  }

  /**
   * Get the tab ID that should be active for the current page based on hierarchy:
   * 1. Pinned tab (checked by the caller)
   * 2. Page-associated tab
   * 3. Global active tab
   */
  public static async getActiveTabForCurrentPage(tabs: Tab[]): Promise<string | null> {
    try {
      const pageUrl = await this.getCurrentPageUrl();
      const associations = await this.initAssociations();
      
      // First, check if there's a pinned tab - this will be handled by the caller
      const pinnedTab = tabs.find(tab => tab.pinned);
      if (pinnedTab) {
        return pinnedTab.id;
      }
      
      // Second, check if there's a tab associated with this page
      const associatedTabId = associations.pageToTab[pageUrl];
      if (associatedTabId) {
        // Make sure the tab still exists
        const tabExists = tabs.some(tab => tab.id === associatedTabId);
        if (tabExists) {
          // Update the global active tab without changing the page association
          if (associatedTabId !== associations.globalActiveTabId) {
            await this.updateGlobalActiveTab(associatedTabId);
          }
          
          return associatedTabId;
        } else {
          // Remove the association if the tab no longer exists
          delete associations.pageToTab[pageUrl];
          
          // Also remove the page from tabToPages mappings
          Object.keys(associations.tabToPages).forEach(tabId => {
            if (associations.tabToPages[tabId].includes(pageUrl)) {
              associations.tabToPages[tabId] = associations.tabToPages[tabId].filter(p => p !== pageUrl);
              
              // Clean up empty arrays
              if (associations.tabToPages[tabId].length === 0) {
                delete associations.tabToPages[tabId];
              }
            }
          });
          
          await this.saveAssociations(associations);
        }
      }
      
      // Third, use the global active tab
      if (associations.globalActiveTabId) {
        const globalActiveTab = tabs.find(tab => tab.id === associations.globalActiveTabId);
        if (globalActiveTab) {
          
          // Only automatically associate the global active tab with the current page
          // if it's a valid page and the user is actively interacting with the tab
          // (this association happens in updateTabAssociations, not here)
          
          // We don't automatically associate pages with tabs here to avoid unexpected behaviors
          // Instead, we return the global active tab ID without creating an association
          
          return associations.globalActiveTabId;
        } else {
          // Global active tab no longer exists, find the most recently edited tab
          associations.globalActiveTabId = null;
          await this.saveAssociations(associations);
        }
      }
      
      // If no suitable tab is found, get the most recently edited tab
      if (tabs.length > 0) {
        const sortedTabs = [...tabs].sort((a, b) => {
          return new Date(b.lastEdited).getTime() - new Date(a.lastEdited).getTime();
        });
        
        const mostRecentTab = sortedTabs[0];
        
        // Update the global active tab
        associations.globalActiveTabId = mostRecentTab.id;
        await this.saveAssociations(associations);
        
        return mostRecentTab.id;
      }
      
      // If no tabs at all, return null (caller should handle this case)
      return null;
    } catch (error) {
      console.error('Failed to get active tab for current page:', error);
      return null;
    }
  }

  /**
   * Clean up associations for a removed tab
   */
  public static async cleanupTabAssociations(tabId: string): Promise<void> {
    try {
      const associations = await this.initAssociations();
      
      // Remove tab from tabToPages mapping
      delete associations.tabToPages[tabId];
      
      // Remove tab from pageToTab mapping
      Object.keys(associations.pageToTab).forEach(pageUrl => {
        if (associations.pageToTab[pageUrl] === tabId) {
          delete associations.pageToTab[pageUrl];
        }
      });
      
      // Update global active tab if necessary
      if (associations.globalActiveTabId === tabId) {
        associations.globalActiveTabId = null;
      }
      
      await this.saveAssociations(associations);
    } catch (error) {
      console.error('Failed to clean up tab associations:', error);
    }
  }
} 