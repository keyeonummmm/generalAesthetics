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
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  const handleClick = () => {
    if (attachment.url) {
      window.open(attachment.url, '_blank');
    }
  };

  const handleMenuClick = (e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent opening URL when clicking menu
    setIsMenuOpen(!isMenuOpen);
  };

  const handleRemove = (e: React.MouseEvent) => {
    e.stopPropagation();
    onRemove(attachment);
  };

  return (
    <div className={`attachment-item ${isPending ? 'pending' : ''}`}>
      <a href={attachment.url} target="_blank" rel="noopener noreferrer">
        {attachment.url}
      </a>
      {isPending && <span className="pending-badge">Pending</span>}
      <button onClick={handleRemove}>Remove</button>
    </div>
  );
}; 