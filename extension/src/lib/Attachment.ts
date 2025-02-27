export interface Attachment {
  type: "url" | "screenshot";
  id: number;
  url?: string;
  screenshotData?: string; // base64 encoded image data
  screenshotType?: 'visible' | 'full'; // type of screenshot
  createdAt: string;
  syncStatus: 'pending' | 'synced';
  metadata?: {
    format: string;
    originalSize: number;
    processedSize: number;
    compressionRatio: number;
  };
}
