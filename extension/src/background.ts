const loadedTabs = new Set<number>();

// Listen for extension installation
chrome.runtime.onInstalled.addListener(() => {
  console.log('Extension installed');
});

// Listen for content script connection
chrome.runtime.onConnect.addListener((port) => {
  if (port.name === 'content-script') {
    const tabId = port.sender?.tab?.id;
    if (tabId) {
      loadedTabs.add(tabId);
      
      port.onDisconnect.addListener(() => {
        loadedTabs.delete(tabId);
      });
    }
  }
});

// Handle browser action clicks
chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id) return;

  try {
    if (!loadedTabs.has(tab.id)) {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content.js']
      });
      
      await chrome.scripting.insertCSS({
        target: { tabId: tab.id },
        files: ['content.css']
      });
    }

    await chrome.tabs.sendMessage(tab.id, { type: 'toggleInterface' });
  } catch (error) {
    console.error('Failed to toggle interface:', error);
  }
});

import { NotesDB } from './lib/notesDB';

// Consolidated message handling
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'CAPTURE_URL') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const url = tabs[0]?.url;
      sendResponse({ success: !!url, url, error: url ? undefined : 'No URL found' });
    });
    return true; // Keep message channel open for async response
  }

  if (message.type === 'CAPTURE_SCREENSHOT') {
    (async () => {
      try {
        console.log('Background: Starting screenshot capture:', message.screenshotType);
        
        if (message.screenshotType === 'visible') {
          const captureData = await chrome.tabs.captureVisibleTab(
            chrome.windows.WINDOW_ID_CURRENT,
            { format: 'jpeg', quality: 100 }
          );
          console.log('Background: Visible capture successful');
          sendResponse({ success: true, screenshotData: captureData });
        } else if (message.screenshotType === 'full') {
          console.log('Background: Initializing section capture');
          const activeTab = await chrome.tabs.query({ active: true, currentWindow: true });
          if (!activeTab[0]?.id) {
            throw new Error('No active tab found');
          }

          await chrome.scripting.executeScript({
            target: { tabId: activeTab[0].id },
            func: () => {
              const event = new CustomEvent('init-screenshot-selection');
              document.dispatchEvent(event);
            }
          });

          chrome.runtime.onMessage.addListener(function listener(msg) {
            if (msg.type === 'SELECTION_CAPTURE') {
              chrome.runtime.onMessage.removeListener(listener);
              sendResponse({ success: true, screenshotData: msg.data });
            } else if (msg.type === 'SELECTION_CAPTURE_ERROR') {
              chrome.runtime.onMessage.removeListener(listener);
              sendResponse({ success: false, error: msg.error });
            }
          });
        }
      } catch (error) {
        console.error('Background: Screenshot capture failed:', error);
        sendResponse({ 
          success: false, 
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    })();
    return true;
  }

  if (message.type === 'DB_OPERATION') {
    handleDBOperation(message, sendResponse);
    return true;
  }

  if (message.type === 'hideInterface' && sender.tab?.id) {
    chrome.tabs.sendMessage(sender.tab.id, { type: 'toggleInterface' });
    sendResponse({ success: true });
    return true;
  }

  if (message.type === 'CAPTURE_VISIBLE_TAB' && sender.tab?.id) {
    (async () => {
      try {
        console.log('Background: Capturing visible tab area');
        const captureData = await chrome.tabs.captureVisibleTab(
          chrome.windows.WINDOW_ID_CURRENT,
          { format: 'jpeg', quality: 100 }
        );
        console.log('Background: Area capture successful');
        sendResponse({ success: true, captureData });
      } catch (error) {
        console.error('Background: Area capture failed:', error);
        sendResponse({ 
          success: false, 
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    })();
    return true;
  }
});

async function handleDBOperation(message: any, sendResponse: (response: any) => void) {
  try {
    const { method, params } = message;
    const result = await (NotesDB as any)[method](...params);
    sendResponse({ data: result });
  } catch (error) {
    console.error('DB operation failed:', error);
    sendResponse({ error: (error as Error).message });
  }
}

async function captureFullPage(tabId: number): Promise<string> {
  // Get page dimensions
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => ({
      width: Math.max(
        document.documentElement.scrollWidth,
        document.documentElement.offsetWidth,
        document.documentElement.clientWidth
      ),
      height: Math.max(
        document.documentElement.scrollHeight,
        document.documentElement.offsetHeight,
        document.documentElement.clientHeight
      ),
      viewportHeight: window.innerHeight
    })
  });

  const dimensions = result as { width: number; height: number; viewportHeight: number };
  
  // Save original scroll position
  const [{ result: originalScroll }] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => window.scrollY
  });

  const captures: string[] = [];
  
  try {
    // Capture each viewport height section
    for (let y = 0; y < dimensions.height; y += dimensions.viewportHeight) {
      // Scroll to position
      await chrome.scripting.executeScript({
        target: { tabId },
        func: (scrollY) => window.scrollTo(0, scrollY),
        args: [y]
      });

      // Wait for scroll and repaint
      await new Promise(resolve => setTimeout(resolve, 150));

      // Capture visible area
      const dataUrl = await chrome.tabs.captureVisibleTab(
        chrome.windows.WINDOW_ID_CURRENT,
        { format: 'jpeg', quality: 100 }
      );
      captures.push(dataUrl);
    }

    // Restore original scroll position
    await chrome.scripting.executeScript({
      target: { tabId },
      func: (scrollY) => window.scrollTo(0, scrollY),
      args: [originalScroll || 0]
    });

    return await stitchCaptures(captures, dimensions.width, dimensions.height);
  } catch (error) {
    console.error('Full page capture failed:', error);
    throw error;
  }
}

async function stitchCaptures(
  captures: string[],
  width: number,
  height: number
): Promise<string> {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Failed to get canvas context');

  let y = 0;
  for (const dataUrl of captures) {
    const img = await createImageBitmap(await (await fetch(dataUrl)).blob());
    ctx.drawImage(img, 0, y);
    y += img.height;
  }

  return canvas.toDataURL('image/jpeg');
}

// Handle extension suspension
chrome.runtime.onSuspend.addListener(async () => {
  // Get all tabs where our content script is running
  const tabs = Array.from(loadedTabs);
  
  // Send hide message to all active content scripts
  for (const tabId of tabs) {
    try {
      await chrome.tabs.sendMessage(tabId, { type: 'hideInterface' });
    } catch (error) {
      console.error(`Failed to hide interface in tab ${tabId}:`, error);
    }
  }
});

console.log('Background script initialized successfully');

export {}; // Keep module format 