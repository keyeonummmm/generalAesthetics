import { Note } from './notesDB';
import { Attachment } from './Attachment';
import { v4 as uuidv4 } from 'uuid';

// Re-export types from notesDB
export type { Note, Attachment };

export class DBProxy {
  private static async sendMessage<T>(method: string, params: any[]): Promise<T> {
    try {
      // Check for large attachments in params
      if (method === 'createNote' || method === 'updateNote') {
        const attachments = params.find(param => Array.isArray(param) && param.length > 0 && param[0].type);
        
        if (attachments) {
          // Log attachment sizes to help debug
          let totalSize = 0;
          attachments.forEach((attachment: any, index: number) => {
            let attachmentSize = 0;
            if (attachment.screenshotData) {
              attachmentSize += attachment.screenshotData.length;
            }
            if (attachment.thumbnailData) {
              attachmentSize += attachment.thumbnailData.length;
            }
            totalSize += attachmentSize;
          });
          // Chrome message size limit is around 64MB, but we should warn if getting close
          if (totalSize > 50 * 1024 * 1024) {
            console.warn('DBProxy: Warning - Large attachment data may exceed message size limits');
          }
        }
      }
      
      const response = await chrome.runtime.sendMessage({
        type: 'DB_OPERATION',
        method,
        params
      });
      
      if (response.error) {
        throw new Error(response.error);
      }
      
      return response.data;
    } catch (error) {
      console.error(`DBProxy ${method} failed:`, error);
      throw error;
    }
  }

  static async getNote(id: string): Promise<Note | null> {
    return this.sendMessage('getNote', [id]);
  }

  static async getAllNotes(): Promise<Note[]> {
    return this.sendMessage('getAllNotes', []);
  }

  static async deleteNote(id: string): Promise<void> {
    return this.sendMessage('deleteNote', [id]);
  }

  static async createNote(
    title: string,
    content: string,
    attachments?: Attachment[]
  ): Promise<Note> {
    // Determine if content is rich text (contains HTML tags)
    const isRichText = /<[a-z][\s\S]*>/i.test(content);
    
    return this.sendMessage('createNote', [title, content, attachments]);
  }

  static async updateNote(
    id: string,
    title: string,
    content: string,
    version?: number,
    attachments?: Attachment[]
  ): Promise<Note> {
    // Determine if content is rich text (contains HTML tags)
    const isRichText = /<[a-z][\s\S]*>/i.test(content);
    
    return this.sendMessage('updateNote', [id, title, content, version, attachments]);
  }

  static async addAttachment(noteId: string,
    url: string,
    title: string | undefined,
    screenshotData?: string,
    screenshotType?: 'visible' | 'full'
  ): Promise<Note> {
    return this.sendMessage('addAttachment', [noteId, url, title, screenshotData, screenshotType]);
  }

  static async removeAttachment(noteId: string, attachmentId: number): Promise<Note> {
    return this.sendMessage('removeAttachment', [noteId, attachmentId]);
  }
} 