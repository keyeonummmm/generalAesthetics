/**
 * Storage Analytics Module
 * 
 * Monitors and analyzes storage usage for the extension's IndexedDB,
 * focusing on Note objects and their components.
 */

import { Note, DBProxy as NotesDB } from './DBProxy';
import { Attachment } from './Attachment';

export interface NoteStorageStats {
  id: string;
  title: string;
  contentSize: number;
  attachmentsSize: number;
  totalSize: number;
  attachmentCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface AttachmentTypeStats {
  type: string;
  count: number;
  totalSize: number;
  averageSize: number;
}

export interface StorageStats {
  // General stats
  totalNotes: number;
  totalAttachments: number;
  totalStorageUsed: number;
  
  // Note stats
  averageNoteSize: number;
  largestNotes: NoteStorageStats[];
  recentlyModifiedNotes: NoteStorageStats[];
  
  // Content stats
  totalContentSize: number;
  averageContentSize: number;
  
  // Attachment stats
  totalAttachmentSize: number;
  attachmentsByType: AttachmentTypeStats[];
  
  // Image specific stats
  imageStats: {
    count: number;
    totalOriginalSize: number;
    totalProcessedSize: number;
    totalThumbnailSize: number;
    averageCompressionRatio: number;
    savedSpace: number;
    lazyLoadedCount: number;
  };
  
  // Metadata
  lastUpdated: string;
  estimatedRemainingStorage: number | null;
}

export class StorageAnalytics {
  private static instance: StorageAnalytics;
  private stats: StorageStats | null = null;
  private historyData: { date: string; totalSize: number }[] = [];
  
  // Storage quota constants (Chrome extension storage limits)
  private readonly ESTIMATED_QUOTA = 5 * 1024 * 1024; // 5MB for local storage (conservative estimate)
  
  private constructor() {
    // Private constructor for singleton
    this.loadHistoryData();
  }
  
  public static getInstance(): StorageAnalytics {
    if (!StorageAnalytics.instance) {
      StorageAnalytics.instance = new StorageAnalytics();
    }
    return StorageAnalytics.instance;
  }
  
  /**
   * Load historical storage data from local storage
   */
  private async loadHistoryData(): Promise<void> {
    try {
      const result = await chrome.storage.local.get('storageHistory');
      if (result.storageHistory) {
        this.historyData = result.storageHistory;
      }
    } catch (error) {
      console.error('Failed to load storage history:', error);
      this.historyData = [];
    }
  }
  
  /**
   * Save historical storage data to local storage
   */
  private async saveHistoryData(): Promise<void> {
    try {
      // Keep only the last 30 data points to avoid excessive storage
      const historyToSave = this.historyData.slice(-30);
      await chrome.storage.local.set({ storageHistory: historyToSave });
    } catch (error) {
      console.error('Failed to save storage history:', error);
    }
  }
  
  /**
   * Analyze storage usage of the entire IndexedDB
   * This should only be called when the user is on the monitoring page
   */
  public async analyzeStorage(): Promise<StorageStats> {
    console.log('StorageAnalytics: Starting comprehensive storage analysis');
    
    // Get all notes
    const notes = await NotesDB.getAllNotes();
    
    // Initialize counters and collectors
    let totalContentSize = 0;
    let totalAttachmentSize = 0;
    let totalAttachments = 0;
    let totalMetadataSize = 0;
    
    // Image specific stats
    let imageCount = 0;
    let totalOriginalSize = 0;
    let totalProcessedSize = 0;
    let totalThumbnailSize = 0;
    let totalCompressionRatio = 0;
    let lazyLoadedCount = 0;
    
    // Attachment type stats
    const attachmentTypeMap = new Map<string, { count: number; size: number }>();
    
    // Note stats for detailed analysis
    const noteStats: NoteStorageStats[] = [];
    
    // Analyze each note
    for (const note of notes) {
      // Calculate content size (2 bytes per character for UTF-16)
      const contentSize = (note.title.length + note.content.length) * 2;
      totalContentSize += contentSize;
      
      // Calculate metadata size (rough estimate)
      const metadataSize = JSON.stringify({
        id: note.id,
        createdAt: note.createdAt,
        updatedAt: note.updatedAt,
        version: note.version,
        syncStatus: note.syncStatus
      }).length * 2;
      totalMetadataSize += metadataSize;
      
      // Analyze attachments
      let noteAttachmentSize = 0;
      let noteAttachmentCount = 0;
      
      if (note.attachments && note.attachments.length > 0) {
        noteAttachmentCount = note.attachments.length;
        totalAttachments += noteAttachmentCount;
        
        for (const attachment of note.attachments) {
          // Track attachment by type
          const typeName = attachment.type || 'unknown';
          if (!attachmentTypeMap.has(typeName)) {
            attachmentTypeMap.set(typeName, { count: 0, size: 0 });
          }
          const typeStats = attachmentTypeMap.get(typeName)!;
          typeStats.count++;
          
          // Calculate attachment size
          let attachmentSize = 0;
          
          // For screenshots, calculate from data URL
          if (attachment.type === 'screenshot') {
            imageCount++;
            
            // Count lazy loaded images
            if (attachment.metadata?.isLazyLoaded) {
              lazyLoadedCount++;
            }
            
            // Calculate screenshot data size
            if (attachment.screenshotData) {
              attachmentSize += this.calculateDataUrlSize(attachment.screenshotData);
              totalProcessedSize += attachmentSize;
            }
            
            // Calculate thumbnail size if present
            if (attachment.thumbnailData) {
              const thumbnailSize = this.calculateDataUrlSize(attachment.thumbnailData);
              totalThumbnailSize += thumbnailSize;
              attachmentSize += thumbnailSize;
            }
            
            // If we have metadata about original size
            if (attachment.metadata?.originalSize) {
              totalOriginalSize += attachment.metadata.originalSize;
              totalCompressionRatio += attachment.metadata.compressionRatio || 1;
            } else {
              // Estimate if not available
              totalOriginalSize += attachmentSize;
              totalCompressionRatio += 1;
            }
          }
          
          // For URL attachments
          if (attachment.type === 'url' && attachment.url) {
            attachmentSize = attachment.url.length * 2; // UTF-16 encoding
          }
          
          // Add metadata size for the attachment
          attachmentSize += JSON.stringify({
            id: attachment.id,
            createdAt: attachment.createdAt,
            syncStatus: attachment.syncStatus,
            type: attachment.type
          }).length * 2;
          
          noteAttachmentSize += attachmentSize;
          totalAttachmentSize += attachmentSize;
          typeStats.size += attachmentSize;
        }
      }
      
      // Calculate total note size
      const totalNoteSize = contentSize + noteAttachmentSize + metadataSize;
      
      // Add to note stats
      noteStats.push({
        id: note.id,
        title: note.title || 'Untitled',
        contentSize,
        attachmentsSize: noteAttachmentSize,
        totalSize: totalNoteSize,
        attachmentCount: noteAttachmentCount,
        createdAt: note.createdAt,
        updatedAt: note.updatedAt
      });
    }
    
    // Sort notes by size and recency for reporting
    const largestNotes = [...noteStats].sort((a, b) => b.totalSize - a.totalSize).slice(0, 5);
    const recentlyModifiedNotes = [...noteStats].sort((a, b) => 
      new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    ).slice(0, 5);
    
    // Calculate averages
    const averageNoteSize = notes.length > 0 ? 
      (totalContentSize + totalAttachmentSize + totalMetadataSize) / notes.length : 0;
    const averageContentSize = notes.length > 0 ? totalContentSize / notes.length : 0;
    const averageCompressionRatio = imageCount > 0 ? totalCompressionRatio / imageCount : 1;
    
    // Convert attachment type map to array
    const attachmentsByType: AttachmentTypeStats[] = Array.from(attachmentTypeMap.entries())
      .map(([type, data]) => ({
        type,
        count: data.count,
        totalSize: data.size,
        averageSize: data.count > 0 ? data.size / data.count : 0
      }))
      .sort((a, b) => b.totalSize - a.totalSize);
    
    // Calculate total storage used (removed cache stats)
    const totalStorageUsed = totalContentSize + totalAttachmentSize + totalMetadataSize;
    
    // Calculate saved space from compression
    const savedSpace = totalOriginalSize - totalProcessedSize;
    
    // Create the stats object
    this.stats = {
      totalNotes: notes.length,
      totalAttachments,
      totalStorageUsed,
      
      averageNoteSize,
      largestNotes,
      recentlyModifiedNotes,
      
      totalContentSize,
      averageContentSize,
      
      totalAttachmentSize,
      attachmentsByType,
      
      imageStats: {
        count: imageCount,
        totalOriginalSize,
        totalProcessedSize,
        totalThumbnailSize,
        averageCompressionRatio,
        savedSpace,
        lazyLoadedCount
      },
      
      lastUpdated: new Date().toISOString(),
      estimatedRemainingStorage: this.ESTIMATED_QUOTA - totalStorageUsed
    };
    
    // Update history data
    this.historyData.push({
      date: new Date().toISOString().split('T')[0], // Just the date part
      totalSize: totalStorageUsed
    });
    await this.saveHistoryData();
    
    console.log('StorageAnalytics: Analysis complete', this.stats);
    return this.stats;
  }
  
  /**
   * Get the last computed stats without reanalyzing
   */
  public getLastStats(): StorageStats | null {
    return this.stats;
  }
  
  /**
   * Get historical storage data for trend analysis
   */
  public getHistoryData(): { date: string; totalSize: number }[] {
    return [...this.historyData];
  }
  
  /**
   * Calculate the approximate size of a data URL in bytes
   */
  private calculateDataUrlSize(dataUrl: string): number {
    // Remove the data URL prefix to get just the base64 data
    const base64 = dataUrl.split(',')[1];
    // Base64 represents 6 bits per character, so 4 characters = 3 bytes
    return Math.floor((base64.length * 3) / 4);
  }
  
  /**
   * Format bytes to human-readable format
   */
  public static formatBytes(bytes: number): string {
    if (bytes === 0) return '0 Bytes';
    
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }
  
  /**
   * Estimate storage usage for a new note before saving
   */
  public estimateNoteSize(title: string, content: string, attachments: Attachment[] = []): number {
    // Content size (2 bytes per character for UTF-16)
    const contentSize = (title.length + content.length) * 2;
    
    // Metadata size (rough estimate)
    const metadataSize = 200; // Approximate size for IDs, timestamps, etc.
    
    // Attachment size
    let attachmentSize = 0;
    for (const attachment of attachments) {
      if (attachment.type === 'screenshot' && attachment.screenshotData) {
        attachmentSize += this.calculateDataUrlSize(attachment.screenshotData);
      } else if (attachment.type === 'url' && attachment.url) {
        attachmentSize += attachment.url.length * 2;
      }
      // Add metadata for each attachment
      attachmentSize += 100; // Approximate size for attachment metadata
    }
    
    return contentSize + metadataSize + attachmentSize;
  }
  
  /**
   * Get storage usage by note ID
   */
  public async getNoteStorageUsage(noteId: string): Promise<NoteStorageStats | null> {
    const note = await NotesDB.getNote(noteId);
    if (!note) return null;
    
    // Calculate content size
    const contentSize = (note.title.length + note.content.length) * 2;
    
    // Calculate attachment size
    let attachmentSize = 0;
    const attachmentCount = note.attachments?.length || 0;
    
    if (note.attachments) {
      for (const attachment of note.attachments) {
        if (attachment.type === 'screenshot' && attachment.screenshotData) {
          attachmentSize += this.calculateDataUrlSize(attachment.screenshotData);
        } else if (attachment.type === 'url' && attachment.url) {
          attachmentSize += attachment.url.length * 2;
        }
      }
    }
    
    // Calculate metadata size
    const metadataSize = 200; // Approximate
    
    return {
      id: note.id,
      title: note.title || 'Untitled',
      contentSize,
      attachmentsSize: attachmentSize,
      totalSize: contentSize + attachmentSize + metadataSize,
      attachmentCount,
      createdAt: note.createdAt,
      updatedAt: note.updatedAt
    };
  }
} 