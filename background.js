chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.sync.get({dnfEnabled: true}, v => {
    chrome.storage.sync.set({dnfEnabled: v.dnfEnabled});
  });
});