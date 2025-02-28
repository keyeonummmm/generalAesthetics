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

  return (
    <div className={`attachment-item ${isPending ? 'pending' : ''}`} onClick={handleClick}>
      {attachment.type === 'url' ? (
        <a href={attachment.url} target="_blank" rel="noopener noreferrer">
          {attachment.url}
        </a>
      ) : (
        <div className="screenshot-preview">
          {isImageLoading ? (
            <div className="loading-indicator">Loading full image...</div>
          ) : (
            <img 
              src={attachment.thumbnailData || attachment.screenshotData} 
              alt="Screenshot" 
              className={`thumbnail ${attachment.thumbnailData && !isImageLoaded ? 'is-thumbnail' : ''}`}
            />
          )}
          <span className="screenshot-type">
            {attachment.screenshotType === 'full' ? 'Full Page' : 'Visible Area'}
            {attachment.metadata && (
              <span className="screenshot-info">
                {attachment.metadata.width && attachment.metadata.height 
                  ? ` (${attachment.metadata.width}×${attachment.metadata.height})` 
                  : ''}
                {attachment.metadata.compressionRatio > 1 
                  ? ` • ${attachment.metadata.compressionRatio.toFixed(1)}× compressed` 
                  : ''}
              </span>
            )}
          </span>
        </div>
      )}
      {isPending && <span className="pending-badge">Pending</span>}
      <button onClick={handleRemove}>Remove</button>
    </div>
  );
}; 