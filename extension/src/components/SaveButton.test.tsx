import React from 'react';
import { render, fireEvent, act, waitFor } from '@testing-library/react';
import { SaveButton } from './SaveButton';
import { v4 as uuidv4 } from 'uuid';

// Mock UUID generation for predictable testing
jest.mock('uuid', () => ({
  v4: jest.fn(() => 'test-uuid')
}));

// Mock IndexedDB
const mockIndexedDB = {
  db: null as IDBDatabase | null,
  stores: new Map<string, Map<string, any>>(),
};

// Test utilities
const createMockNote = (overrides = {}) => ({
  id: 'test-uuid',
  title: 'Test Note',
  content: 'Test Content',
  created_at: '2024-01-01T12:00',
  updated_at: '2024-01-01T12:00',
  sync_status: 'pending' as const,
  ...overrides
});

// Mock IndexedDB implementation
const setupIndexedDBMock = () => {
  const mockIDB = {
    open: jest.fn().mockImplementation(() => {
      const request = {
        result: {
          transaction: jest.fn().mockImplementation(() => {
            const transaction = {
              objectStore: jest.fn().mockImplementation(() => ({
                put: jest.fn().mockImplementation((note) => {
                  const request = {
                    onsuccess: null as any,
                    onerror: null as any
                  };
                  
                  // Store the note and trigger success
                  setTimeout(() => {
                    mockIndexedDB.stores.get('notes')?.set(note.id, note);
                    if (request.onsuccess) request.onsuccess();
                    if (transaction.oncomplete) transaction.oncomplete();
                  }, 0);
                  
                  return request;
                }),
                get: jest.fn().mockImplementation((id) => {
                  const request = {
                    result: mockIndexedDB.stores.get('notes')?.get(id),
                    onsuccess: null as any,
                    onerror: null as any
                  };
                  
                  setTimeout(() => {
                    if (request.onsuccess) request.onsuccess();
                  }, 0);
                  
                  return request;
                }),
                getAll: jest.fn().mockImplementation(() => {
                  const request = {
                    result: Array.from(mockIndexedDB.stores.get('notes')?.values() || []),
                    onsuccess: null as any,
                    onerror: null as any
                  };
                  
                  setTimeout(() => {
                    if (request.onsuccess) request.onsuccess();
                  }, 0);
                  
                  return request;
                })
              })),
              oncomplete: null as any
            };
            return transaction;
          }),
          close: jest.fn()
        },
        onerror: null as any,
        onsuccess: null as any,
        onupgradeneeded: null as any
      };

      // Trigger success callback
      setTimeout(() => {
        if (request.onsuccess) request.onsuccess();
      }, 0);

      return request;
    })
  };

  // @ts-ignore - Mocking global
  global.indexedDB = mockIDB;
  return mockIDB;
};

describe('SaveButton', () => {
  beforeEach(() => {
    mockIndexedDB.stores.clear();
    mockIndexedDB.stores.set('notes', new Map());
    setupIndexedDBMock();
    jest.clearAllMocks();
  });

  describe('New Note Creation', () => {
    it('should create a new note with provided title and content', async () => {
      const onSaveComplete = jest.fn();
      const { getByTitle } = render(
        <SaveButton
          title="Test Note"
          content="Test Content"
          onSaveComplete={onSaveComplete}
        />
      );

      await act(async () => {
        fireEvent.click(getByTitle('Save Note'));
      });

      await waitFor(() => {
        expect(onSaveComplete).toHaveBeenCalledWith(
          expect.objectContaining({
            id: 'test-uuid',
            title: 'Test Note',
            content: 'Test Content'
          })
        );
      });
    });

    it('should generate title for untitled notes', async () => {
      const onSaveComplete = jest.fn();
      const { getByTitle } = render(
        <SaveButton
          title=""
          content="Test Content"
          onSaveComplete={onSaveComplete}
        />
      );

      await act(async () => {
        fireEvent.click(getByTitle('Save Note'));
      });

      await waitFor(() => {
        expect(onSaveComplete).toHaveBeenCalledWith(
          expect.objectContaining({
            title: 'Untitled Note #1'
          })
        );
      });
    });

    it('should not save empty notes', async () => {
      const onSaveComplete = jest.fn();
      const { getByTitle } = render(
        <SaveButton
          title=""
          content=""
          onSaveComplete={onSaveComplete}
        />
      );

      await act(async () => {
        fireEvent.click(getByTitle('Save Note'));
      });

      expect(onSaveComplete).not.toHaveBeenCalled();
    });
  });

  describe('Existing Note Updates', () => {
    it('should update existing note while preserving created_at', async () => {
      const existingNote = createMockNote({
        created_at: '2024-01-01T10:00'
      });
      mockIndexedDB.stores.get('notes')?.set(existingNote.id, existingNote);

      const onSaveComplete = jest.fn();
      const { getByTitle } = render(
        <SaveButton
          title="Updated Title"
          content="Updated Content"
          existingNoteId={existingNote.id}
          onSaveComplete={onSaveComplete}
        />
      );

      await act(async () => {
        fireEvent.click(getByTitle('Save Note'));
      });

      await waitFor(() => {
        expect(onSaveComplete).toHaveBeenCalledWith(
          expect.objectContaining({
            id: existingNote.id,
            title: 'Updated Title',
            content: 'Updated Content',
            created_at: '2024-01-01T10:00'
          })
        );
      });
    });
  });

  describe('Error Handling', () => {
    it('should handle IndexedDB errors gracefully', async () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
      const mockIDB = setupIndexedDBMock();
      
      // Simulate IndexedDB error
      mockIDB.open.mockImplementation(() => {
        throw new Error('IndexedDB error');
      });

      const { getByTitle } = render(
        <SaveButton
          title="Test Note"
          content="Test Content"
        />
      );

      await act(async () => {
        fireEvent.click(getByTitle('Save Note'));
      });

      expect(consoleSpy).toHaveBeenCalledWith(
        'Error saving note:',
        expect.any(Error)
      );

      consoleSpy.mockRestore();
    });
  });
}); 