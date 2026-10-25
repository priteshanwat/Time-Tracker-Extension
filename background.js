const STORAGE_KEY = "timeTrackerData";

// Show a badge on the toolbar icon while a task is running / paused.
function updateBadge(active) {
  if (!active) {
    chrome.action.setBadgeText({ text: "" });
    return;
  }

  const paused = active.state === "paused";
  chrome.action.setBadgeText({ text: paused ? "II" : "●" });
  chrome.action.setBadgeBackgroundColor({
    color: paused ? "#f59e0b" : "#16a34a"
  });
}

async function refreshBadge() {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  updateBadge(result[STORAGE_KEY]?.active || null);
}

chrome.runtime.onInstalled.addListener(refreshBadge);
chrome.runtime.onStartup.addListener(refreshBadge);

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes[STORAGE_KEY]) return;
  updateBadge(changes[STORAGE_KEY].newValue?.active || null);
});
