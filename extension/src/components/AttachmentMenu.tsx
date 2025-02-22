import React, { useState } from 'react';
import '../styles/components/attachment-menu.css';

interface AttachmentMenuProps {
  isOpen: boolean;
  onClose: () => void;
  onUrlCapture: (url: string) => Promise<void>;
}

export const AttachmentMenu: React.FC<AttachmentMenuProps> = ({
  isOpen,
  onClose,
  onUrlCapture
}) => {
  const [isLoading, setIsLoading] = useState(false);

  const handleUrlCapture = async () => {
    setIsLoading(true);
    try {
      const response = await new Promise<{ success: boolean; url?: string; error?: string }>((resolve) => {
        chrome.runtime.sendMessage({ type: 'CAPTURE_URL' }, (result) => {
          resolve(result || { success: false, error: 'No response' });
        });
      });

      if (response.success && response.url) {
        await onUrlCapture(response.url);
        onClose();
      } else {
        throw new Error(response.error || 'Failed to capture URL');
      }
    } catch (error) {
      console.error('Failed to capture URL:', error);
      alert('Failed to capture URL. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="attachment-menu">
      <div className="attachment-menu-content">
        <button 
          className="close-btn"
          onClick={onClose}
          disabled={isLoading}
        >
          ×
        </button>
        
        <div className="attachment-options">
          <button
            className="attachment-option"
            onClick={handleUrlCapture}
            disabled={isLoading}
          >
            <span className="icon">🔗</span>
            <span className="label">Capture URL</span>
          </button>
        </div>

        {isLoading && (
          <div className="loading-indicator">
            <span className="spinner"></span>
          </div>
        )}
      </div>
    </div>
  );
}; 