const version = chrome.runtime.getManifest().version;
document.documentElement.setAttribute('data-actunime-sync', version);
