import React, { useState } from 'react';
import '../styles/components/attachment-menu.css';

interface AttachmentMenuProps {
  isOpen: boolean;
  onClose: () => void;
  onUrlCapture: (url: string) => Promise<void>;
  onScreenshotCapture: (type: 'visible' | 'full') => Promise<void>;
}

export const AttachmentMenu: React.FC<AttachmentMenuProps> = ({
  isOpen,
  onClose,
  onUrlCapture,
  onScreenshotCapture
}) => {
  const [isLoading, setIsLoading] = useState(false);
  const [captureType, setCaptureType] = useState<'url' | 'screenshot' | null>(null);

  const handleUrlCapture = async () => {
    setIsLoading(true);
    setCaptureType('url');
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
      setCaptureType(null);
    }
  };

  const handleScreenshotCapture = async (type: 'visible' | 'full') => {
    setIsLoading(true);
    setCaptureType('screenshot');
    try {
      await onScreenshotCapture(type);
      onClose();
    } catch (error) {
      console.error('Failed to capture screenshot:', error);
      alert('Failed to capture screenshot. Please try again.');
    } finally {
      setIsLoading(false);
      setCaptureType(null);
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

          <button
            className="attachment-option"
            onClick={() => handleScreenshotCapture('visible')} // capture full visiable area
            disabled={isLoading}
          >
            <span className="icon">📷</span>
            <span className="label">Capture full page</span>
          </button>

          <button
            className="attachment-option"
            onClick={() => handleScreenshotCapture('full')} //capture 
            disabled={isLoading}
          >
            <span className="icon">📸</span>
            <span className="label">Capture section</span>
          </button>
        </div>

        {isLoading && (
          <div className="loading-indicator">
            <span className="spinner"></span>
            <span className="loading-text">
              {captureType === 'url' ? 'Capturing URL...' : 'Taking screenshot...'}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}; 