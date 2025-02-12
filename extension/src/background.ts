// Background script for the extension
console.log('Background script initialized');

// Listen for extension installation
chrome.runtime.onInstalled.addListener(() => {
  console.log('Extension installed');
});

export {}; // Add this to make it a module 