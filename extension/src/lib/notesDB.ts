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
    console.log('NotesDB: Getting database connection');
    if (this.dbConnection) {
      console.log('NotesDB: Returning existing connection');
      return this.dbConnection;
    }
    console.log('NotesDB: Opening new connection');
    this.dbConnection = await this.openDB();
    return this.dbConnection;
  }

  private static async openDB(): Promise<IDBDatabase> {
    console.log(`NotesDB: Opening database '${DB_NAME}' v${DB_VERSION}`);
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => {
        console.error('NotesDB: Failed to open database:', request.error);
        reject(request.error);
      };
      
      request.onsuccess = () => {
        console.log('NotesDB: Successfully opened database');
        const db = request.result;
        db.onclose = () => {
          console.log('NotesDB: Database connection closed');
          this.dbConnection = null;
        };
        resolve(db);
      };
      
      request.onupgradeneeded = (event) => {
        console.log('NotesDB: Upgrading database schema');
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          console.log('NotesDB: Creating notes store');
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
          store.createIndex('updatedAt', 'updatedAt');
        }
      };
    });
  }

  static async getNote(id: string): Promise<Note | null> {
    console.log(`NotesDB: Getting note with id: ${id}`);
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(id);

      request.onsuccess = () => {
        const note = request.result;
        console.log(`NotesDB: Retrieved note:`, note || 'Note not found');
        resolve(note || null);
      };
      request.onerror = () => {
        console.error(`NotesDB: Failed to get note ${id}:`, request.error);
        reject(request.error);
      };
    });
  }

  static async getAllNotes(): Promise<Note[]> {
    console.log('NotesDB: Getting all notes');
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.getAll();

      request.onsuccess = () => {
        console.log(`NotesDB: Retrieved ${request.result.length} notes`);
        resolve(request.result);
      };
      request.onerror = () => {
        console.error('NotesDB: Failed to get all notes:', request.error);
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
    console.log('NotesDB: Creating new note', { title, contentLength: content.length });
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
    console.log('NotesDB: New note object:', newNote);

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.add(newNote);

      request.onsuccess = () => {
        console.log('NotesDB: Successfully created note:', newNote.id);
        resolve(newNote);
      };
      request.onerror = () => {
        console.error('NotesDB: Failed to create note:', request.error);
        reject(request.error);
      };
    });
  }

  static async updateNote(
    id: string,
    title: string,
    content: string,
    expectedVersion?: number
  ): Promise<Note> {
    console.log('NotesDB: Updating note', { 
      id, 
      title, 
      contentLength: content.length,
      expectedVersion 
    });

    const existingNote = await this.getNote(id);
    if (!existingNote) {
      console.error('NotesDB: Note not found for update:', id);
      throw new Error('Note not found');
    }

    console.log('NotesDB: Existing note:', {
      id: existingNote.id,
      version: existingNote.version,
      expectedVersion
    });

    if (expectedVersion !== undefined && existingNote.version !== expectedVersion) {
      console.error('NotesDB: Version conflict', {
        current: existingNote.version,
        expected: expectedVersion
      });
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

    console.log('NotesDB: Saving updated note:', {
      id: updatedNote.id,
      newVersion: updatedNote.version,
      oldVersion: existingNote.version
    });

    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.put(updatedNote);

      request.onsuccess = () => {
        console.log('NotesDB: Successfully updated note:', updatedNote.id);
        resolve(updatedNote);
      };
      request.onerror = () => {
        console.error('NotesDB: Failed to update note:', request.error);
        reject(request.error);
      };
    });
  }

  static async addAttachment(noteId: string, attachment: NoteAttachment): Promise<Note> {
    console.log('NotesDB: Adding attachment', { noteId, attachment });
    const note = await this.getNote(noteId);
    if (!note) {
      console.error('NotesDB: Note not found for attachment:', noteId);
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

    console.log('NotesDB: Updating note with new attachment:', {
      noteId,
      attachmentCount: updatedNote.attachments?.length
    });

    return this.updateNote(noteId, updatedNote.title, updatedNote.content, note.version);
  }

  static async removeAttachment(noteId: string, attachmentUrl: string): Promise<Note> {
    console.log('NotesDB: Removing attachment', { noteId, attachmentUrl });
    const note = await this.getNote(noteId);
    if (!note || !note.attachments) {
      console.error('NotesDB: Note or attachments not found:', noteId);
      throw new Error('Note or attachment not found');
    }

    const updatedNote: Note = {
      ...note,
      attachments: note.attachments.filter(a => a.url !== attachmentUrl),
      updatedAt: formatTimestamp(),
      version: note.version + 1,
      syncStatus: 'pending'
    };

    console.log('NotesDB: Updating note after attachment removal:', {
      noteId,
      oldAttachmentCount: note.attachments.length,
      newAttachmentCount: updatedNote.attachments!.length
    });

    return this.updateNote(noteId, updatedNote.title, updatedNote.content, note.version);
  }

  static async closeConnection(): Promise<void> {
    console.log('NotesDB: Closing database connection');
    if (this.dbConnection) {
      this.dbConnection.close();
      this.dbConnection = null;
      console.log('NotesDB: Database connection closed');
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