import { Note } from './notesDB';
import { Attachment } from './Attachment';

// Re-export types from notesDB
export type { Note, Attachment };

export class DBProxy {
  private static async sendMessage<T>(method: string, params: any[]): Promise<T> {
    try {
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
    return this.sendMessage('createNote', [title, content, attachments]);
  }

  static async updateNote(
    id: string,
    title: string,
    content: string,
    expectedVersion?: number,
    attachments?: Attachment[]
  ): Promise<Note> {
    return this.sendMessage('updateNote', [id, title, content, expectedVersion, attachments]);
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