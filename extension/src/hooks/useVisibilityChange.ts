import { useState, useEffect } from 'react';

/**
 * Hook to track document visibility changes
 * Returns true when the document is visible, false when hidden
 */
export function useVisibilityChange(): boolean {
  const [isVisible, setIsVisible] = useState<boolean>(
    document.visibilityState === 'visible'
  );

  useEffect(() => {
    const handleVisibilityChange = () => {
      setIsVisible(document.visibilityState === 'visible');
    };

    // Add event listener
    document.addEventListener('visibilitychange', handleVisibilityChange);

    // Clean up
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  return isVisible;
} 