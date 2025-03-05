// Separate interfaces for position and dimensions
export interface Position {
  x: number;
  y: number;
}

export interface Dimensions {
  width: number;
  height: number;
}

// Combined interface that includes both
export interface PositionScale {
  x: number;
  y: number;
  width: number;
  height: number;
  scale: number;
}

// Operation type for state locking
export enum OperationType {
  NONE = 'none',
  DRAGGING = 'dragging',
  RESIZING = 'resizing'
}

// In-memory storage for position data, keyed by tab ID
const positionCache: Map<number, PositionScale> = new Map();

// State locking to prevent simultaneous operations
const operationLocks: Map<number, OperationType> = new Map();

/**
 * PositionScaleManager handles caching of position and scale settings for the extension UI
 * on different tabs. Each tab has its own unique position and scale settings that are
 * cleared when the tab is closed.
 */
export class PositionScaleManager {
  // Default position and scale settings - positioned in the top-right corner like Chrome's default popup
  public static DEFAULT_POSITION: PositionScale = {
    x: window.innerWidth - 320, // 20px from right edge
    y: 5, // Below the browser toolbar
    width: 300,
    height: 550,
    scale: 1
  };
  
  /**
   * Get the default position based on current window size
   */
  public static getDefaultPosition(): PositionScale {
    return {
      x: window.innerWidth - 320, // 20px from right edge
      y: 5, // Below the browser toolbar
      width: 300,
      height: 550,
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
   * Get only the position (x, y) for the current tab
   */
  public static async getPositionOnly(): Promise<Position> {
    const fullPosition = await this.getPositionForCurrentTab();
    return { x: fullPosition.x, y: fullPosition.y };
  }

  /**
   * Get only the dimensions (width, height) for the current tab
   */
  public static async getDimensionsOnly(): Promise<Dimensions> {
    const fullPosition = await this.getPositionForCurrentTab();
    return { width: fullPosition.width, height: fullPosition.height };
  }

  /**
   * Update only the position (x, y) for the current tab
   * This is used during drag operations
   */
  public static async updatePositionOnly(position: Position): Promise<void> {
    const tabId = await this.initTabId();
    const currentPosition = positionCache.get(tabId) || this.getDefaultPosition();
    
    positionCache.set(tabId, {
      ...currentPosition,
      x: position.x,
      y: position.y
    });
  }

  /**
   * Update only the dimensions (width, height) for the current tab
   * This is used during resize operations
   */
  public static async updateDimensionsOnly(dimensions: Dimensions): Promise<void> {
    const tabId = await this.initTabId();
    const currentPosition = positionCache.get(tabId) || this.getDefaultPosition();
    
    positionCache.set(tabId, {
      ...currentPosition,
      width: dimensions.width,
      height: dimensions.height
    });
  }

  /**
   * Lock an operation (drag or resize) to prevent concurrent modifications
   * Returns true if lock was acquired, false if already locked
   */
  public static async lockOperation(operation: OperationType): Promise<boolean> {
    const tabId = await this.initTabId();
    const currentOperation = operationLocks.get(tabId) || OperationType.NONE;
    
    // If already locked with a different operation, deny the lock
    if (currentOperation !== OperationType.NONE && currentOperation !== operation) {
      return false;
    }
    
    operationLocks.set(tabId, operation);
    return true;
  }

  /**
   * Release an operation lock
   */
  public static async releaseOperationLock(): Promise<void> {
    const tabId = await this.initTabId();
    operationLocks.set(tabId, OperationType.NONE);
  }

  /**
   * Get the current operation lock
   */
  public static async getCurrentOperation(): Promise<OperationType> {
    const tabId = await this.initTabId();
    return operationLocks.get(tabId) || OperationType.NONE;
  }
  
  /**
   * Clear position and scale settings for the current tab
   */
  public static async clearPositionForCurrentTab(): Promise<void> {
    const tabId = await this.initTabId();
    positionCache.delete(tabId);
    operationLocks.delete(tabId);
  }
  
  /**
   * Clear all position and scale settings
   * This is mainly for testing/debugging purposes
   */
  public static clearAllPositions(): void {
    positionCache.clear();
    operationLocks.clear();
  }
  
  /**
   * Reset position and scale to default for current tab
   */
  public static async resetToDefault(): Promise<PositionScale> {
    await this.clearPositionForCurrentTab();
    return this.getDefaultPosition();
  }
}