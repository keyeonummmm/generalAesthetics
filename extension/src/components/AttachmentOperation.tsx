import React, { useState } from 'react';
import { Attachment } from '../lib/Attachment';
import '../styles/components/attachment-operation.css';

interface AttachmentOperationProps {
  attachment: Attachment;
  onRemove: (attachment: Attachment) => void;
  isPending?: boolean;
}

export const AttachmentOperation: React.FC<AttachmentOperationProps> = ({
  attachment,
  onRemove,
  isPending
}) => {
  const [isImageLoaded, setIsImageLoaded] = useState(false);
  const [isImageLoading, setIsImageLoading] = useState(false);

  const handleClick = () => {
    if (attachment.type === 'url' && attachment.url) {
      window.open(attachment.url, '_blank');
    } else if (attachment.type === 'screenshot') {
      if (attachment.screenshotData) {
        // Open screenshot in new tab
        const win = window.open();
        if (win) {
          win.document.write(`<img src="${attachment.screenshotData}" />`);
        }
      } else if (attachment.metadata?.isLazyLoaded && !isImageLoaded && !isImageLoading) {
        // Trigger lazy loading of the full image
        setIsImageLoading(true);
        // This would typically call a function to load the full image data
        // For now, we'll just show a loading indicator
        setTimeout(() => {
          setIsImageLoading(false);
          setIsImageLoaded(true);
        }, 1000);
      }
    }
  };

  const handleRemove = (e: React.MouseEvent) => {
    e.stopPropagation();
    onRemove(attachment);
  };

  // Function to truncate URL to max 20 characters
  const truncateUrl = (url: string | undefined) => {
    if (!url) return '';
    // Remove protocol and www
    let cleanUrl = url.replace(/^(https?:\/\/)?(www\.)?/, '');
    // Truncate to 20 chars
    if (cleanUrl.length > 20) {
      return cleanUrl.substring(0, 17) + '...';
    }
    return cleanUrl;
  };

  return (
    <div className="attachment-item" onClick={handleClick}>
      {attachment.type === 'url' ? (
        <div className="url-preview">
          <div className="url-icon">
            {/* Use favicon if available, otherwise show a generic icon */}
            {attachment.url && (
              <img 
                src={`https://www.google.com/s2/favicons?domain=${new URL(attachment.url).hostname}`} 
                alt="favicon" 
                className="favicon"
                onError={(e) => {
                  // If favicon fails to load, show a generic icon
                  (e.target as HTMLImageElement).style.display = 'none';
                }}
              />
            )}
          </div>
          <span className="url-text" title={attachment.url}>
            {truncateUrl(attachment.url)}
          </span>
          <button className="remove-btn" onClick={handleRemove}>×</button>
        </div>
      ) : (
        <div className="screenshot-preview">
          {isImageLoading ? (
            <div className="loading-indicator">Loading...</div>
          ) : (
            <img 
              src={attachment.thumbnailData || attachment.screenshotData} 
              alt="Screenshot" 
              className={`thumbnail ${attachment.thumbnailData && !isImageLoaded ? 'is-thumbnail' : ''}`}
            />
          )}
          <button className="remove-btn" onClick={handleRemove}>×</button>
        </div>
      )}
    </div>
  );
}; 