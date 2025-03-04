export interface PositionScale {
  x: number;
  y: number;
  width: number;
  height: number;
  scale: number;
}

// In-memory storage for position data, keyed by tab ID
const positionCache: Map<number, PositionScale> = new Map();

/**
 * PositionScaleManager handles caching of position and scale settings for the extension UI
 * on different tabs. Each tab has its own unique position and scale settings that are
 * cleared when the tab is closed.
 */
export class PositionScaleManager {
  // Default position and scale settings - positioned in the top-right corner like Chrome's default popup
  public static DEFAULT_POSITION: PositionScale = {
    x: window.innerWidth - 420, // 20px from right edge
    y: 5, // Below the browser toolbar
    width: 400,
    height: 600,
    scale: 1
  };
  
  /**
   * Get the default position based on current window size
   */
  public static getDefaultPosition(): PositionScale {
    return {
      x: window.innerWidth - 420, // 20px from right edge
      y: 5, // Below the browser toolbar
      width: 400,
      height: 600,
      scale: 1
    };
  }
  
  private static currentTabId: number = -1;
  
  /**
   * Initialize the tab ID
   */
  public static async initTabId(): Promise<number> {
    if (this.currentTabId !== -1) {
      return this.currentTabId;
    }
    
    try {
      const response = await chrome.runtime.sendMessage({ type: 'getTabId' });
      this.currentTabId = response.tabId;
      return this.currentTabId;
    } catch (error) {
      console.error('Failed to get tab ID:', error);
      // Use a temporary ID if we can't get the real one
      this.currentTabId = Date.now();
      return this.currentTabId;
    }
  }
  
  /**
   * Clear the current tab ID (used when tab is closed)
   */
  public static clearTabId(): void {
    this.currentTabId = -1;
  }
  
  /**
   * Get position and scale settings for the current tab
   */
  public static async getPositionForCurrentTab(): Promise<PositionScale> {
    const tabId = await this.initTabId();
    return positionCache.get(tabId) || this.getDefaultPosition();
  }
  
  /**
   * Update position and scale settings for the current tab
   */
  public static async updatePositionForCurrentTab(position: PositionScale): Promise<void> {
    const tabId = await this.initTabId();
    positionCache.set(tabId, position);
  }
  
  /**
   * Clear position and scale settings for the current tab
   */
  public static async clearPositionForCurrentTab(): Promise<void> {
    const tabId = await this.initTabId();
    positionCache.delete(tabId);
  }
  
  /**
   * Clear all position and scale settings
   * This is mainly for testing/debugging purposes
   */
  public static clearAllPositions(): void {
    positionCache.clear();
  }
  
  /**
   * Reset position and scale to default for current tab
   */
  public static async resetToDefault(): Promise<PositionScale> {
    await this.clearPositionForCurrentTab();
    return this.getDefaultPosition();
  }
}