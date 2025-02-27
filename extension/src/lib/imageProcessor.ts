/**
 * Image Processing Pipeline
 * 
 * This module handles WebP conversion and image compression
 * while maintaining the original capture mechanism.
 */

export interface ImageProcessingOptions {
  format: 'webp' | 'jpeg' | 'png';
  quality: number; // 0-100
  maxWidth?: number; // Optional size constraints
  maxHeight?: number;
}

export interface ProcessedImage {
  dataUrl: string;
  format: string;
  originalSize: number;
  processedSize: number;
  compressionRatio: number;
}

const DEFAULT_OPTIONS: ImageProcessingOptions = {
  format: 'webp',
  quality: 85, // Good balance between quality and size
};

/**
 * Processes an image through the conversion and compression pipeline
 * 
 * @param imageDataUrl - The original image data URL
 * @param options - Processing options
 * @returns Promise with the processed image data
 */
export async function processImage(
  imageDataUrl: string,
  options: Partial<ImageProcessingOptions> = {}
): Promise<ProcessedImage> {
  console.log('ImageProcessor: Starting image processing');
  
  // Merge with default options
  const settings: ImageProcessingOptions = {
    ...DEFAULT_OPTIONS,
    ...options,
  };
  
  // Calculate original size (approximate from base64 data)
  const originalSize = calculateDataUrlSize(imageDataUrl);
  
  try {
    // Load the image
    const image = await loadImage(imageDataUrl);
    
    // Create canvas for processing
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    
    if (!ctx) {
      throw new Error('Failed to get canvas context');
    }
    
    // Apply size constraints if specified
    let width = image.width;
    let height = image.height;
    
    if (settings.maxWidth && width > settings.maxWidth) {
      const ratio = settings.maxWidth / width;
      width = settings.maxWidth;
      height = Math.floor(height * ratio);
    }
    
    if (settings.maxHeight && height > settings.maxHeight) {
      const ratio = settings.maxHeight / height;
      height = settings.maxHeight;
      width = Math.floor(width * ratio);
    }
    
    // Set canvas dimensions
    canvas.width = width;
    canvas.height = height;
    
    // Draw image to canvas (this step also allows for resizing)
    ctx.drawImage(image, 0, 0, width, height);
    
    // Convert to specified format
    let processedDataUrl: string;
    
    if (settings.format === 'webp') {
      processedDataUrl = canvas.toDataURL('image/webp', settings.quality / 100);
    } else if (settings.format === 'jpeg') {
      processedDataUrl = canvas.toDataURL('image/jpeg', settings.quality / 100);
    } else {
      // PNG doesn't use quality parameter in the same way
      processedDataUrl = canvas.toDataURL('image/png');
    }
    
    // Calculate processed size
    const processedSize = calculateDataUrlSize(processedDataUrl);
    
    console.log('ImageProcessor: Processing complete', {
      format: settings.format,
      quality: settings.quality,
      originalSize: `${(originalSize / 1024).toFixed(2)} KB`,
      processedSize: `${(processedSize / 1024).toFixed(2)} KB`,
      compressionRatio: (originalSize / processedSize).toFixed(2),
    });
    
    return {
      dataUrl: processedDataUrl,
      format: settings.format,
      originalSize,
      processedSize,
      compressionRatio: originalSize / processedSize,
    };
  } catch (error) {
    console.error('Image processing failed:', error);
    // Fall back to original image if processing fails
    return {
      dataUrl: imageDataUrl,
      format: 'original',
      originalSize,
      processedSize: originalSize,
      compressionRatio: 1,
    };
  }
}

/**
 * Helper function to load an image from a data URL
 */
function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = dataUrl;
  });
}

/**
 * Calculate the approximate size of a data URL in bytes
 */
function calculateDataUrlSize(dataUrl: string): number {
  // Remove the data URL prefix to get just the base64 data
  const base64 = dataUrl.split(',')[1];
  // Base64 represents 6 bits per character, so 4 characters = 3 bytes
  return Math.floor((base64.length * 3) / 4);
}

/**
 * Advanced compression for specific use cases where higher compression is needed
 * This uses more aggressive settings while trying to maintain acceptable quality
 */
export async function compressImageAggressively(
  imageDataUrl: string,
  targetSizeKB: number = 100
): Promise<ProcessedImage> {
  // Start with reasonable quality
  let quality = 80;
  let result = await processImage(imageDataUrl, { 
    format: 'webp', 
    quality,
    // Optionally reduce dimensions for very large images
    maxWidth: 1920,
    maxHeight: 1080
  });
  
  // If we're already under target size, return the result
  if (result.processedSize <= targetSizeKB * 1024) {
    return result;
  }
  
  // Try progressively lower quality settings until we hit target size
  // or reach minimum acceptable quality
  const MIN_QUALITY = 50;
  const QUALITY_STEP = 10;
  
  while (quality > MIN_QUALITY && result.processedSize > targetSizeKB * 1024) {
    quality -= QUALITY_STEP;
    result = await processImage(imageDataUrl, { format: 'webp', quality });
  }
  
  return result;
} 