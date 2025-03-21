import { v4 as uuidv4 } from 'uuid';
import { Attachment } from './Attachment';

export interface Note {
  id: string;
  title: string;
  content: string;
  isRichText?: boolean;
  createdAt: string;
  updatedAt: string;
  version: number;
  attachments?: Attachment[];
  syncStatus?: 'pending' | 'synced';
}

const DB_NAME = 'notesDB';
const STORE_NAME = 'notes';
const DB_VERSION = 1;

const formatTimestamp = (): string => {
  const now = new Date();
  return now.toISOString().slice(0, 16);
};

export class NotesDB {
  private static dbConnection: IDBDatabase | null = null;

  private static async getDB(): Promise<IDBDatabase> {
    if (this.dbConnection) {
      return this.dbConnection;
    }
    this.dbConnection = await this.openDB();
    return this.dbConnection;
  }

  private static async initializeStores(db: IDBDatabase) {
    if (!db.objectStoreNames.contains(STORE_NAME)) {
      const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      store.createIndex('updatedAt', 'updatedAt');
    }
  }

  private static async openDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION + 1); // Increment version for new store
      
      request.onerror = () => reject(request.error);
      
      request.onsuccess = () => {
        const db = request.result;
        db.onclose = () => {
          this.dbConnection = null;
        };
        resolve(db);
      };
      
      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        this.initializeStores(db);
      };
    });
  }

  static async getNote(id: string): Promise<Note | null> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(id);

      request.onsuccess = () => {
        resolve(request.result || null);
      };
      request.onerror = () => {
        reject(request.error);
      };
    });
  }

  static async getAllNotes(): Promise<Note[]> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.getAll();

      request.onsuccess = () => {
        resolve(request.result);
      };
      request.onerror = () => {
        reject(request.error);
      };
    });
  }

  static async deleteNote(id: string): Promise<void> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.delete(id);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  static async createNote(
    title: string, 
    content: string,
    attachments?: Attachment[]
  ): Promise<Note> {
    const db = await this.getDB();
    const timestamp = formatTimestamp();
    
    // Process attachments to ensure they have all required fields
    const processedAttachments = attachments?.map(attachment => {
      // Ensure all required fields are present
      const processedAttachment = {
        ...attachment,
        syncStatus: 'synced' as const,
        // Ensure ID is present
        id: attachment.id || Date.now(),
        // Ensure createdAt is present
        createdAt: attachment.createdAt || timestamp
      };      
      return processedAttachment;
    }) || [];

    // Check if we have any content to save (title, content, or attachments)
    if (!title.trim() && !content.trim() && processedAttachments.length === 0) {
      throw new Error('Note must have either title, content, or attachments');
    }

    // Determine if content is rich text (contains HTML tags)
    const isRichText = /<[a-z][\s\S]*>/i.test(content);

    const newNote: Note = {
      id: uuidv4(),
      title: title.trim() || 'Untitled Note',
      content: content.trim(),
      isRichText,
      createdAt: timestamp,
      updatedAt: timestamp,
      version: 1,
      attachments: processedAttachments,
      syncStatus: 'synced' as const
    };

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.add(newNote);

      request.onsuccess = () => {
        resolve(newNote);
      };
      request.onerror = () => {
        console.error('Failed to create note:', request.error);
        reject(request.error);
      };
    });
  }

  static async updateNote(
    id: string,
    title: string,
    content: string,
    expectedVersion?: number,
    attachments?: Attachment[]
  ): Promise<Note> {
    const existingNote = await this.getNote(id);
    if (!existingNote) {
      throw new Error('Note not found');
    }

    if (expectedVersion !== undefined && existingNote.version !== expectedVersion) {
      throw new Error('Version conflict - note was modified elsewhere');
    }

    const timestamp = formatTimestamp();
    
    // Process attachments to ensure they have all required fields
    const processedAttachments = attachments?.map(attachment => {
      // Ensure all required fields are present
      const processedAttachment = {
        ...attachment,
        // Only mark as synced if it's a new save operation
        syncStatus: attachment.syncStatus === 'pending' ? 'synced' as const : attachment.syncStatus,
        // Ensure ID is present
        id: attachment.id || Date.now(),
        // Ensure createdAt is present
        createdAt: attachment.createdAt || timestamp
      };
      return processedAttachment;
    }) || [];

    // Determine if content is rich text (contains HTML tags)
    const isRichText = /<[a-z][\s\S]*>/i.test(content);

    const updatedNote: Note = {
      ...existingNote,
      title: title.trim() || existingNote.title,
      content: content.trim(),
      isRichText,
      updatedAt: timestamp,
      version: existingNote.version + 1,
      attachments: processedAttachments,
      syncStatus: 'synced' as const
    };

    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.put(updatedNote);

      request.onsuccess = () => {
        console.log('Successfully updated note with attachments:', {
          noteId: updatedNote.id,
          attachmentCount: updatedNote.attachments?.length || 0
        });
        resolve(updatedNote);
      };
      request.onerror = () => {
        console.error('Failed to update note:', request.error);
        reject(request.error);
      };
    });
  }
  
  static async addAttachment(noteId: string,
    url: string,
    screenshotData?: string,
    screenshotType?: 'visible' | 'full'
  ): Promise<Note> {
    
    const note = await this.getNote(noteId);
    if (!note) {
      throw new Error('Note not found');
    }
    
    const attachment: Attachment = {
      type: "url",
      id: Date.now(),
      url,
      screenshotData,
      screenshotType,
      createdAt: formatTimestamp(),
      syncStatus: 'pending'
    };
    
    const updatedNote: Note = {
      ...note,
      attachments: [
        ...(note.attachments || []),
        attachment
      ],
      updatedAt: formatTimestamp(),
      version: note.version + 1,
      syncStatus: 'pending'
    };

    // Save to IndexedDB
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.put(updatedNote);

      request.onsuccess = () => {
        resolve(updatedNote);
      };
      request.onerror = () => {
        console.error('Failed to save note with attachment:', request.error);
        reject(request.error);
      };
    });
  }

  static async removeAttachment(noteId: string, attachmentId: number): Promise<Note> {
    const note = await this.getNote(noteId);
    if (!note) {
      throw new Error('Note not found');
    }

    // Make sure attachments array exists
    if (!note.attachments) {
      note.attachments = [];
      return note;
    }

    const updatedNote: Note = {
      ...note,
      attachments: note.attachments.filter(a => a.id !== attachmentId),
      updatedAt: formatTimestamp(),
      version: note.version + 1,
      syncStatus: 'pending'
    };

    // Use updateNote to save changes
    return this.updateNote(
      noteId, 
      updatedNote.title, 
      updatedNote.content, 
      note.version,
      updatedNote.attachments
    );
  }

  static async closeConnection(): Promise<void> {
    if (this.dbConnection) {
      this.dbConnection.close();
      this.dbConnection = null;
    }
  }
}