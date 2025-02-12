import { v4 as uuidv4 } from 'uuid';

export interface NoteAttachment {
  type: 'image' | 'url' | 'file';
  url: string;
  title?: string;
  size?: number;
  mimeType?: string;
  thumbnailUrl?: string;
  createdAt: string;
}

export interface Note {
  id: string;
  title: string;
  content: string;
  createdAt: string;
  updatedAt: string;
  version: number;
  attachments?: NoteAttachment[];
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

  static async createNote(title: string, content: string): Promise<Note> {
    const db = await this.getDB();
    const timestamp = formatTimestamp();
    const newNote: Note = {
      id: uuidv4(),
      title: title.trim() || 'Untitled Note',
      content: content.trim(),
      createdAt: timestamp,
      updatedAt: timestamp,
      version: 1,
      syncStatus: 'pending'
    };

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.add(newNote);

      request.onsuccess = () => resolve(newNote);
      request.onerror = () => reject(request.error);
    });
  }

  static async updateNote(
    id: string,
    title: string,
    content: string,
    expectedVersion?: number
  ): Promise<Note> {
    const existingNote = await this.getNote(id);
    if (!existingNote) {
      throw new Error('Note not found');
    }

    if (expectedVersion !== undefined && existingNote.version !== expectedVersion) {
      throw new Error('Version conflict - note was modified elsewhere');
    }

    const updatedNote: Note = {
      ...existingNote,
      title: title.trim() || existingNote.title,
      content: content.trim(),
      updatedAt: formatTimestamp(),
      version: existingNote.version + 1,
      syncStatus: 'pending'
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

  static async addAttachment(noteId: string, attachment: NoteAttachment): Promise<Note> {
    const note = await this.getNote(noteId);
    if (!note) {
      throw new Error('Note not found');
    }

    const updatedNote: Note = {
      ...note,
      attachments: [
        ...(note.attachments || []),
        { ...attachment, createdAt: formatTimestamp() }
      ],
      updatedAt: formatTimestamp(),
      version: note.version + 1,
      syncStatus: 'pending'
    };

    return this.updateNote(noteId, updatedNote.title, updatedNote.content, note.version);
  }

  static async removeAttachment(noteId: string, attachmentUrl: string): Promise<Note> {
    const note = await this.getNote(noteId);
    if (!note || !note.attachments) {
      throw new Error('Note or attachment not found');
    }

    const updatedNote: Note = {
      ...note,
      attachments: note.attachments.filter(a => a.url !== attachmentUrl),
      updatedAt: formatTimestamp(),
      version: note.version + 1,
      syncStatus: 'pending'
    };

    return this.updateNote(noteId, updatedNote.title, updatedNote.content, note.version);
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