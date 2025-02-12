import React, { useState } from 'react';
import '../styles/attachment-menu.css';

interface AttachmentMenuProps {
  isOpen: boolean;
  onClose: () => void;
  onFileUpload: (file: File) => Promise<void>;
  onImageUpload: (image: File) => Promise<void>;
  onUrlCapture: () => Promise<void>;
}

export const AttachmentMenu: React.FC<AttachmentMenuProps> = ({
  isOpen,
  onClose,
  onFileUpload,
  onImageUpload,
  onUrlCapture
}) => {
  const [isLoading, setIsLoading] = useState(false);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    setIsLoading(true);
    try {
      await onFileUpload(file);
      onClose();
    } catch (error) {
      console.error('Failed to upload file:', error);
      alert('Failed to upload file. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    if (!file.type.startsWith('image/')) {
      alert('Please select an image file.');
      return;
    }
    
    setIsLoading(true);
    try {
      await onImageUpload(file);
      onClose();
    } catch (error) {
      console.error('Failed to upload image:', error);
      alert('Failed to upload image. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleUrlCapture = async () => {
    setIsLoading(true);
    try {
      await onUrlCapture();
      onClose();
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
          <label className="attachment-option">
            <input
              type="file"
              onChange={handleFileUpload}
              disabled={isLoading}
              style={{ display: 'none' }}
            />
            <span className="icon">📎</span>
            <span className="label">Upload File</span>
          </label>

          <label className="attachment-option">
            <input
              type="file"
              accept="image/*"
              onChange={handleImageUpload}
              disabled={isLoading}
              style={{ display: 'none' }}
            />
            <span className="icon">🖼️</span>
            <span className="label">Upload Image</span>
          </label>

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