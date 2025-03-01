export interface Attachment {
  type: "url" | "screenshot";
  id: number;
  tabId?: string; // ID of the tab this attachment belongs to
  url?: string;
  screenshotData?: string; // base64 encoded image data
  thumbnailData?: string; // thumbnail for preview (smaller version)
  screenshotType?: 'visible' | 'full'; // type of screenshot
  createdAt: string;
  syncStatus: 'pending' | 'synced';
  metadata?: {
    format: string;
    originalSize: number;
    processedSize: number;
    compressionRatio: number;
    width?: number;
    height?: number;
    isLazyLoaded?: boolean;
  };
}

/**
 * Creates a lightweight version of an attachment with minimal data
 * Useful for passing around references without the heavy data
 */
export function createAttachmentReference(attachment: Attachment): Omit<Attachment, 'screenshotData'> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { screenshotData, ...reference } = attachment;
  return reference;
}

/**
 * AttachmentManager handles all operations related to attachments
 * including saving, loading, and removing attachments from storage
 */
export class AttachmentManager {
  private static readonly ATTACHMENT_PREFIX = 'attachment_';
  
  /**
   * Save an attachment to storage and return a reference
   */
  public static async saveAttachment(attachment: Attachment): Promise<Omit<Attachment, 'screenshotData'>> {
    try {
      // Generate a storage key for this attachment
      const storageKey = `${this.ATTACHMENT_PREFIX}${attachment.id}`;
      
      // Save the attachment data to storage
      await chrome.storage.local.set({ [storageKey]: attachment });
      
      // Create and return a reference without the heavy data
      return createAttachmentReference(attachment);
    } catch (error) {
      console.error('Failed to save attachment:', error);
      throw error;
    }
  }
  
  /**
   * Load an attachment from storage by ID
   */
  public static async loadAttachment(id: number): Promise<Attachment | null> {
    try {
      const storageKey = `${this.ATTACHMENT_PREFIX}${id}`;
      const result = await chrome.storage.local.get(storageKey);
      
      return result[storageKey] || null;
    } catch (error) {
      console.error(`Failed to load attachment ${id}:`, error);
      return null;
    }
  }
  
  /**
   * Remove an attachment from storage
   */
  public static async removeAttachment(id: number): Promise<void> {
    try {
      const storageKey = `${this.ATTACHMENT_PREFIX}${id}`;
      await chrome.storage.local.remove(storageKey);
      console.log(`Removed attachment ${id}`);
    } catch (error) {
      console.error(`Failed to remove attachment ${id}:`, error);
      throw error;
    }
  }
  
  /**
   * Load multiple attachments by their IDs
   */
  public static async loadAttachments(ids: number[]): Promise<Attachment[]> {
    try {
      const attachments: Attachment[] = [];
      
      for (const id of ids) {
        const attachment = await this.loadAttachment(id);
        if (attachment) {
          attachments.push(attachment);
        }
      }
      
      return attachments;
    } catch (error) {
      console.error('Failed to load attachments:', error);
      return [];
    }
  }
}
