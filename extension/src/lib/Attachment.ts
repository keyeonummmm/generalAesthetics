export interface Attachment {
  type: "url" | "screenshot";
  id: number;
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
  const { screenshotData, ...reference } = attachment;
  return reference;
}
