import { v4 as uuidv4 } from 'uuid';
import { Attachment } from './Attachment';

export interface Note {
  id: string;
  title: string;
  content: string;
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

  private static async openDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => {
        reject(request.error);
      };
      
      request.onsuccess = () => {
        const db = request.result;
        db.onclose = () => {
          this.dbConnection = null;
        };
        resolve(db);
      };
      
      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
          store.createIndex('updatedAt', 'updatedAt');
        }
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
    const processedAttachments = attachments?.map(attachment => ({
      ...attachment,
      syncStatus: 'synced' as const
    })) || [];

    // Check if we have any content to save (title, content, or attachments)
    if (!title.trim() && !content.trim() && processedAttachments.length === 0) {
      throw new Error('Note must have either title, content, or attachments');
    }

    const newNote: Note = {
      id: uuidv4(),
      title: title.trim() || 'Untitled Note',
      content: content.trim(),
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
        console.log('Successfully created note with attachments:', newNote);
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

    // For updates, keep attachment status as is until save completes
    const processedAttachments = attachments?.map(attachment => ({
      ...attachment,
      // Only mark as synced if it's a new save operation
      syncStatus: attachment.syncStatus === 'pending' ? 'synced' as const : attachment.syncStatus
    })) || [];

    const updatedNote: Note = {
      ...existingNote,
      title: title.trim() || existingNote.title,
      content: content.trim(),
      updatedAt: formatTimestamp(),
      version: existingNote.version + 1,
      attachments: processedAttachments,
      syncStatus: 'synced' as const
    };

    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.put(updatedNote);

      request.onsuccess = () => resolve(updatedNote);
      request.onerror = () => reject(request.error);
    });
  }

  static async addAttachment(noteId: string, url: string, title: string | undefined): Promise<Note> {
    console.log('NotesDB.addAttachment called:', {
      noteId,
      url,
      title
    });

    const note = await this.getNote(noteId);
    if (!note) {
      throw new Error('Note not found');
    }

    console.log('Found note for attachment:', note);

    const attachment: Attachment = {
      type: "url",
      id: Date.now(),
      url,
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

    console.log('Saving updated note with attachment:', updatedNote);
    
    // Save to IndexedDB
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.put(updatedNote);

      request.onsuccess = () => {
        console.log('Successfully saved note with attachment');
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

  static async clearCache(): Promise<void> {
    localStorage.removeItem('tabManager_cache');
  }

  static async restoreFromCache(): Promise<Note[]> {
    const cached = localStorage.getItem('tabManager_cache');
    if (!cached) return [];
    return JSON.parse(cached);
  }
}