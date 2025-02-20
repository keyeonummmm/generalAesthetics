// ActionButton.tsx
// This component is responsible for the behavior of the edit, menu, and close buttons, 
// preventing windows from closing by clicking on areas outside the plugin.

import React from 'react';
import { shadowRootRef, updateInterfaceVisibility } from '../content';

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
  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (type === 'close' && shadowRootRef) {
      if (hasUnsavedChanges) {
        if (window.confirm('You have unsaved changes. Are you sure you want to hide?')) {
          const appContainer = shadowRootRef.querySelector('.ga-notes-container');
          if (appContainer instanceof HTMLElement) {
            appContainer.style.display = 'none';
            updateInterfaceVisibility(false);
          }
        }
      } else {
        const appContainer = shadowRootRef.querySelector('.ga-notes-container');
        if (appContainer instanceof HTMLElement) {
          appContainer.style.display = 'none';
          updateInterfaceVisibility(false);
        }
      }
    }

    onClick();
  };

  return (
    <button 
      type="button"
      className="icon-button" 
      onClick={handleClick}
      title={title}
    >
      {getIcon(type)}
    </button>
  );
};
