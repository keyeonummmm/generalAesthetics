import React from 'react';
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
  const handleClick = () => {
    if (attachment.type === 'url' && attachment.url) {
      window.open(attachment.url, '_blank');
    } else if (attachment.type === 'screenshot' && attachment.screenshotData) {
      // Open screenshot in new tab
      const win = window.open();
      if (win) {
        win.document.write(`<img src="${attachment.screenshotData}" />`);
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
          <img 
            src={attachment.screenshotData} 
            alt="Screenshot" 
            className="thumbnail"
          />
          <span className="screenshot-type">
            {attachment.screenshotType === 'full' ? 'Full Page' : 'Visible Area'}
          </span>
        </div>
      )}
      {isPending && <span className="pending-badge">Pending</span>}
      <button onClick={handleRemove}>Remove</button>
    </div>
  );
}; 