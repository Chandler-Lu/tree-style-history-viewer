// Listen for the extension's toolbar icon being clicked
chrome.action.onClicked.addListener((tab) => {
  // Define the URL of the history page within the extension
  const historyPageUrl = chrome.runtime.getURL("history.html");

  // Optional: Check if a history tab is already open and focus it
  chrome.tabs.query({ url: historyPageUrl }, (tabs) => {
    if (tabs.length > 0) {
      // If found, focus the first existing history tab
      chrome.tabs.update(tabs[0].id, { active: true });
      chrome.windows.update(tabs[0].windowId, { focused: true });
    } else {
      // Otherwise, create a new tab for the history page
      chrome.tabs.create({ url: historyPageUrl });
    }
  });
});
