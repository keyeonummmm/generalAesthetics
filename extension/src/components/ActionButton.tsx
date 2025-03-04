import React from 'react';
import '../styles/components/ActionButton.css';

interface ActionButtonProps {
  type: 'edit' | 'menu' | 'close';
  onClick: () => void;
  title?: string;
  hasUnsavedChanges?: boolean;
}

export const ActionButton: React.FC<ActionButtonProps> = ({ 
  type, 
  onClick, 
  title,
  hasUnsavedChanges
}) => {
  const getIcon = () => {
    switch (type) {
      case 'edit':
        return '📝';
      case 'menu':
        return '☰';
      case 'close':
        return hasUnsavedChanges ? '⚠️' : '✕';
      default:
        return '';
    }
  };

  const getClassName = () => {
    let className = 'action-button';
    if (type === 'close' && hasUnsavedChanges) {
      className += ' warning';
    }
    return className;
  };

  return (
    <button 
      className={getClassName()}
      onClick={onClick}
      title={title}
      aria-label={title}
    >
      <span className="icon">{getIcon()}</span>
    </button>
  );
};
