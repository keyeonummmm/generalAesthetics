// ActionButton.tsx
// This component is responsible for the behavior of the edit, menu, and close buttons, 
// preventing windows from closing by clicking on areas outside the plugin.

import React, { useCallback, useEffect, useRef } from 'react';

type ButtonType = 'edit' | 'menu' | 'close';

interface ActionButtonProps {
  type: ButtonType;
  onClick: () => void;
  title: string;
  hasUnsavedChanges?: boolean;
}

const getIcon = (type: ButtonType) => {
  switch (type) {
    case 'edit':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
        </svg>
      );
    case 'menu':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M3 12h18M3 6h18M3 18h18"/>
        </svg>
      );
    case 'close':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M18 6L6 18M6 6l12 12"/>
        </svg>
      );
  }
};

export const ActionButton: React.FC<ActionButtonProps> = ({ 
  type, 
  onClick, 
  title,
  hasUnsavedChanges = false 
}) => {
  const retryTimeoutRef = useRef<number | null>(null);
  const retryCountRef = useRef(0);
  const MAX_RETRIES = 2;
  const RETRY_DELAY = 100; // ms

  const clearRetryTimeout = () => {
    if (retryTimeoutRef.current) {
      window.clearTimeout(retryTimeoutRef.current);
      retryTimeoutRef.current = null;
    }
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => clearRetryTimeout();
  }, []);

  const attemptToClose = useCallback((container: HTMLElement) => {
    try {
      container.style.display = 'none';
      // Dispatch event to notify other components
      window.dispatchEvent(new CustomEvent('ga-interface-hidden'));
      retryCountRef.current = 0; // Reset counter on success
      return true;
    } catch (error) {
      console.debug('Close attempt failed, will retry');
      return false;
    }
  }, []);

  const retryClose = useCallback((container: HTMLElement) => {
    clearRetryTimeout();

    // Check if container is still visible
    if (container.style.display !== 'none' && retryCountRef.current < MAX_RETRIES) {
      retryCountRef.current++;
      
      retryTimeoutRef.current = window.setTimeout(() => {
        // Only attempt to close if container is still visible
        if (container.style.display !== 'none') {
          attemptToClose(container);
          
          // If still not closed, schedule another retry
          if (container.style.display !== 'none' && retryCountRef.current < MAX_RETRIES) {
            retryClose(container);
          }
        }
      }, RETRY_DELAY * retryCountRef.current); // Increase delay with each retry
    }
  }, [attemptToClose]);

  const handleClose = useCallback((container: HTMLElement) => {
    // First attempt
    const closed = attemptToClose(container);
    
    // If first attempt failed, start retry mechanism
    if (!closed) {
      retryClose(container);
    }
  }, [attemptToClose, retryClose]);

  const handleClick = (e: React.MouseEvent) => {
    if (type === 'close') {
      const container = (e.target as HTMLElement)
        .closest('.ga-notes-container') as HTMLElement;
      
      if (container) {
        if (hasUnsavedChanges) {
          if (window.confirm('You have unsaved changes. Are you sure you want to hide?')) {
            handleClose(container);
          }
        } else {
          handleClose(container);
        }
      }
    }
    onClick();
  };

  return (
    <button 
      className="icon-button" 
      onClick={handleClick}
      title={title}
    >
      {getIcon(type)}
    </button>
  );
};
