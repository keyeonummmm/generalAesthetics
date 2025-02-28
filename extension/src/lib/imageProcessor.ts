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
  progressive?: boolean; // Enable progressive loading for JPEG
  // New options for small image handling
  smallImageThreshold?: number; // Size in bytes below which special handling is applied
  skipCompressionThreshold?: number; // Size in bytes below which compression is skipped
}

export interface ProcessedImage {
  dataUrl: string;
  format: string;
  originalSize: number;
  processedSize: number;
  compressionRatio: number;
  thumbnailUrl?: string; // Thumbnail for preview
}

const DEFAULT_OPTIONS: ImageProcessingOptions = {
  format: 'webp',
  quality: 85, // Good balance between quality and size
  progressive: true, // Enable progressive loading by default
  smallImageThreshold: 5120, // 5KB threshold for small image handling
  skipCompressionThreshold: 1024, // 1KB threshold for skipping compression
};

const THUMBNAIL_SIZE = 200; // Maximum thumbnail dimension

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
  
  // For very small images, skip compression entirely
  const skipThreshold = settings.skipCompressionThreshold !== undefined 
    ? settings.skipCompressionThreshold 
    : DEFAULT_OPTIONS.skipCompressionThreshold!;
    
  if (originalSize <= skipThreshold) {
    console.log('ImageProcessor: Image too small, skipping compression', {
      originalSize: `${(originalSize / 1024).toFixed(2)} KB`,
      threshold: `${skipThreshold / 1024} KB`
    });
    
    // Still create a thumbnail for consistency
    const image = await loadImage(imageDataUrl);
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.drawImage(image, 0, 0);
      const thumbnailUrl = await createThumbnail(canvas, image.width, image.height);
      
      return {
        dataUrl: imageDataUrl, // Use original data
        format: 'original',
        originalSize,
        processedSize: originalSize,
        compressionRatio: 1,
        thumbnailUrl
      };
    }
  }
  
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
    
    // Generate thumbnail
    const thumbnailUrl = await createThumbnail(canvas, image.width, image.height);
    
    // Adjust quality based on image size for small images
    let adjustedQuality = settings.quality;
    
    const smallThreshold = settings.smallImageThreshold !== undefined 
      ? settings.smallImageThreshold 
      : DEFAULT_OPTIONS.smallImageThreshold!;
      
    if (originalSize < smallThreshold) {
      // For small images, use higher quality to prevent artifacts
      // Scale quality based on size (smaller = higher quality)
      const sizeRatio = originalSize / smallThreshold;
      adjustedQuality = Math.min(98, Math.max(settings.quality, Math.round(95 - (sizeRatio * 10))));
      console.log('ImageProcessor: Small image detected, adjusting quality', {
        originalQuality: settings.quality,
        adjustedQuality,
        originalSize: `${(originalSize / 1024).toFixed(2)} KB`
      });
    }
    
    // Try different formats and pick the best one
    const formatOptions = [
      { format: settings.format, quality: adjustedQuality },
      // For small images, also try PNG which might be better for simple graphics
      ...(originalSize < 3072 ? [{ format: 'png' as const, quality: 100 }] : []),
      // For very small images, also try JPEG
      ...(originalSize < 2048 ? [{ format: 'jpeg' as const, quality: 92 }] : [])
    ];
    
    let bestResult = {
      dataUrl: imageDataUrl,
      format: 'original',
      size: originalSize
    };
    
    // Try each format and find the smallest result
    for (const option of formatOptions) {
      let dataUrl: string;
      
      if (option.format === 'webp') {
        dataUrl = canvas.toDataURL('image/webp', option.quality / 100);
      } else if (option.format === 'jpeg') {
        if (settings.progressive && typeof createImageBitmap === 'function') {
          dataUrl = await createProgressiveJpeg(canvas, option.quality);
        } else {
          dataUrl = canvas.toDataURL('image/jpeg', option.quality / 100);
        }
      } else {
        // PNG doesn't use quality parameter in the same way
        dataUrl = canvas.toDataURL('image/png');
      }
      
      const size = calculateDataUrlSize(dataUrl);
      
      // Keep track of the smallest result
      if (size < bestResult.size) {
        bestResult = { dataUrl, format: option.format, size };
      }
    }
    
    // If all compressed versions are larger than original, use original
    if (bestResult.size >= originalSize) {
      console.log('ImageProcessor: All compressed versions larger than original, using original');
      bestResult = {
        dataUrl: imageDataUrl,
        format: 'original',
        size: originalSize
      };
    }
    
    console.log('ImageProcessor: Processing complete', {
      format: bestResult.format,
      originalSize: `${(originalSize / 1024).toFixed(2)} KB`,
      processedSize: `${(bestResult.size / 1024).toFixed(2)} KB`,
      compressionRatio: (originalSize / bestResult.size).toFixed(2),
      hasThumbnail: !!thumbnailUrl
    });
    
    return {
      dataUrl: bestResult.dataUrl,
      format: bestResult.format,
      originalSize,
      processedSize: bestResult.size,
      compressionRatio: originalSize / bestResult.size,
      thumbnailUrl
    };
  } catch (error) {
    console.error('Image processing failed:', error);
    // Fall back to original image if processing fails
    return {
      dataUrl: imageDataUrl,
      format: 'original',
      originalSize,
      processedSize: originalSize,
      compressionRatio: 1
    };
  }
}

/**
 * Create a thumbnail version of the image for preview purposes
 */
async function createThumbnail(
  canvas: HTMLCanvasElement,
  originalWidth: number,
  originalHeight: number
): Promise<string> {
  // Create a new canvas for the thumbnail
  const thumbnailCanvas = document.createElement('canvas');
  const ctx = thumbnailCanvas.getContext('2d');
  
  if (!ctx) {
    throw new Error('Failed to get thumbnail canvas context');
  }
  
  // Calculate thumbnail dimensions (maintaining aspect ratio)
  let thumbWidth = originalWidth;
  let thumbHeight = originalHeight;
  
  if (thumbWidth > thumbHeight) {
    if (thumbWidth > THUMBNAIL_SIZE) {
      thumbHeight = Math.floor(thumbHeight * (THUMBNAIL_SIZE / thumbWidth));
      thumbWidth = THUMBNAIL_SIZE;
    }
  } else {
    if (thumbHeight > THUMBNAIL_SIZE) {
      thumbWidth = Math.floor(thumbWidth * (THUMBNAIL_SIZE / thumbHeight));
      thumbHeight = THUMBNAIL_SIZE;
    }
  }
  
  // Set thumbnail canvas dimensions
  thumbnailCanvas.width = thumbWidth;
  thumbnailCanvas.height = thumbHeight;
  
  // Draw the image at thumbnail size
  ctx.drawImage(canvas, 0, 0, thumbWidth, thumbHeight);
  
  // Convert to WebP for best compression
  return thumbnailCanvas.toDataURL('image/webp', 60);
}

/**
 * Create a progressive JPEG using more advanced techniques
 * This is a fallback for browsers that support it
 */
async function createProgressiveJpeg(canvas: HTMLCanvasElement, quality: number): Promise<string> {
  try {
    // This is a simplified approach - in a real implementation,
    // you might use a library like jpeg-js or pica for better control
    const blob = await new Promise<Blob>((resolve) => {
      canvas.toBlob((blob) => {
        resolve(blob!);
      }, 'image/jpeg', quality / 100);
    });
    
    // Convert blob to data URL
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.readAsDataURL(blob);
    });
  } catch (error) {
    console.error('Failed to create progressive JPEG:', error);
    // Fall back to standard JPEG
    return canvas.toDataURL('image/jpeg', quality / 100);
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
  console.log('ImageProcessor: Starting aggressive compression');
  
  // Calculate original size
  const originalSize = calculateDataUrlSize(imageDataUrl);
  
  // If the image is already smaller than target size, just process it normally
  if (originalSize <= targetSizeKB * 1024) {
    return processImage(imageDataUrl, { 
      format: 'webp', 
      quality: 85
    });
  }
  
  // For very small images, don't compress aggressively
  if (originalSize < 5120) { // 5KB
    return processImage(imageDataUrl, {
      // For small images, try PNG which might be better for simple graphics
      format: originalSize < 3072 ? 'png' : 'webp',
      quality: 90,
      // Skip compression for tiny images
      skipCompressionThreshold: 1024
    });
  }
  
  // Load the image to get dimensions
  const image = await loadImage(imageDataUrl);
  
  // For large images, we might need to resize
  let resizeNeeded = false;
  let maxWidth = 1920;
  let maxHeight = 1080;
  
  // For very large images, be more aggressive with resizing
  if (originalSize > 500 * 1024) { // 500KB
    resizeNeeded = image.width > 1600 || image.height > 1200;
    maxWidth = 1600;
    maxHeight = 1200;
  }
  
  // For extremely large images, be even more aggressive
  if (originalSize > 1024 * 1024) { // 1MB
    resizeNeeded = image.width > 1280 || image.height > 960;
    maxWidth = 1280;
    maxHeight = 960;
  }
  
  // Start with reasonable quality
  let quality = 80;
  
  // Try with initial settings
  let result = await processImage(imageDataUrl, { 
    format: 'webp', 
    quality,
    maxWidth: resizeNeeded ? maxWidth : undefined,
    maxHeight: resizeNeeded ? maxHeight : undefined
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
    
    // Try WebP first
    result = await processImage(imageDataUrl, { 
      format: 'webp', 
      quality,
      maxWidth: resizeNeeded ? maxWidth : undefined,
      maxHeight: resizeNeeded ? maxHeight : undefined
    });
    
    // If still too large and quality is already low, try JPEG as a fallback
    if (quality <= 60 && result.processedSize > targetSizeKB * 1024) {
      const jpegResult = await processImage(imageDataUrl, { 
        format: 'jpeg', 
        quality: quality + 5, // JPEG needs slightly higher quality to look decent
        maxWidth: resizeNeeded ? maxWidth : undefined,
        maxHeight: resizeNeeded ? maxHeight : undefined
      });
      
      // Use JPEG if it's smaller
      if (jpegResult.processedSize < result.processedSize) {
        result = jpegResult;
      }
    }
  }
  
  // If we still couldn't reach target size, try more aggressive resizing
  if (result.processedSize > targetSizeKB * 1024 && (image.width > 800 || image.height > 600)) {
    result = await processImage(imageDataUrl, { 
      format: 'webp', 
      quality: Math.max(quality, 60),
      maxWidth: 800,
      maxHeight: 600
    });
  }
  
  console.log('ImageProcessor: Aggressive compression complete', {
    originalSize: `${(originalSize / 1024).toFixed(2)} KB`,
    finalSize: `${(result.processedSize / 1024).toFixed(2)} KB`,
    compressionRatio: result.compressionRatio.toFixed(2),
    targetReached: result.processedSize <= targetSizeKB * 1024
  });
  
  return result;
}

/**
 * Create a lazy-loadable version of an image with thumbnail and full image
 * This is useful for displaying a quick thumbnail while the full image loads
 */
export async function createLazyLoadableImage(
  imageDataUrl: string
): Promise<{thumbnail: string, fullImage: string}> {
  console.log('ImageProcessor: Creating lazy-loadable image');
  
  // Calculate original size
  const originalSize = calculateDataUrlSize(imageDataUrl);
  
  // For small images, don't create separate thumbnail
  if (originalSize < 10 * 1024) { // 10KB
    console.log('ImageProcessor: Image small enough, using same image for thumbnail and full');
    // Process the image with default settings
    const processed = await processImage(imageDataUrl, {
      format: 'webp',
      quality: 90,
      skipCompressionThreshold: 1024 // Skip compression for very small images
    });
    
    return {
      thumbnail: processed.dataUrl,
      fullImage: processed.dataUrl
    };
  }
  
  // For larger images, create a proper thumbnail and optimize the full image
  
  // First, load the image to get dimensions
  const image = await loadImage(imageDataUrl);
  
  // Create a thumbnail directly
  const thumbnailCanvas = document.createElement('canvas');
  const ctx = thumbnailCanvas.getContext('2d');
  
  if (!ctx) {
    throw new Error('Failed to get thumbnail canvas context');
  }
  
  // Calculate thumbnail dimensions (maintaining aspect ratio)
  let thumbWidth = image.width;
  let thumbHeight = image.height;
  const THUMBNAIL_SIZE = 200; // Maximum thumbnail dimension
  
  if (thumbWidth > thumbHeight) {
    if (thumbWidth > THUMBNAIL_SIZE) {
      thumbHeight = Math.floor(thumbHeight * (THUMBNAIL_SIZE / thumbWidth));
      thumbWidth = THUMBNAIL_SIZE;
    }
  } else {
    if (thumbHeight > THUMBNAIL_SIZE) {
      thumbWidth = Math.floor(thumbWidth * (THUMBNAIL_SIZE / thumbHeight));
      thumbHeight = THUMBNAIL_SIZE;
    }
  }
  
  // Set thumbnail canvas dimensions
  thumbnailCanvas.width = thumbWidth;
  thumbnailCanvas.height = thumbHeight;
  
  // Draw the image at thumbnail size
  ctx.drawImage(image, 0, 0, thumbWidth, thumbHeight);
  
  // Create an aggressively compressed thumbnail
  const thumbnailDataUrl = thumbnailCanvas.toDataURL('image/webp', 70);
  
  // Process the full image with appropriate settings based on size
  let fullImageOptions: Partial<ImageProcessingOptions> = {
    format: 'webp',
    quality: 85,
    progressive: true
  };
  
  // For very large images, apply more aggressive compression
  if (originalSize > 500 * 1024) { // 500KB
    fullImageOptions = {
      ...fullImageOptions,
      quality: 80,
      maxWidth: 1920,
      maxHeight: 1080
    };
  }
  
  // Process the full image
  const processed = await processImage(imageDataUrl, fullImageOptions);
  
  console.log('ImageProcessor: Lazy-loadable image created', {
    originalSize: `${(originalSize / 1024).toFixed(2)} KB`,
    fullImageSize: `${(processed.processedSize / 1024).toFixed(2)} KB`,
    thumbnailSize: `${(calculateDataUrlSize(thumbnailDataUrl) / 1024).toFixed(2)} KB`,
    dimensions: `${image.width}×${image.height}`,
    thumbnailDimensions: `${thumbWidth}×${thumbHeight}`
  });
  
  return {
    thumbnail: thumbnailDataUrl,
    fullImage: processed.dataUrl
  };
} 