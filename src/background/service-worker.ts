// Tripwire service worker.
//
// The run loop deliberately does NOT live here: MV3 service workers are killed
// after ~30s of idle, so the side panel hosts test execution. This worker only
// handles lifecycle chores and, in a later phase, chrome.alarms-scheduled runs.

chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((err) => console.error("sidePanel.setPanelBehavior failed", err));

chrome.runtime.onMessage.addListener((message: { type?: string }) => {
  if (message?.type === "tripwire:open-full-tab") {
    void chrome.tabs.create({ url: chrome.runtime.getURL("tab.html") });
  }
});

// Phase 5 (scheduling) will register chrome.alarms handlers here and act as
// the fallback runner when no panel is open.
export {};
