// Runs in the isolated world, the only one with chrome.* APIs. Publishes the settings to the
// MAIN-world script (content.js) as data attributes on <html>, which both worlds share.
(() => {
  'use strict';

  const KEY = 'timestamps';
  const publish = (on) => {
    document.documentElement.dataset.ytctTimestamps = on ? '1' : '0';
  };

  chrome.storage.local.get({ [KEY]: false }).then((stored) => publish(stored[KEY]));
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[KEY]) publish(changes[KEY].newValue);
  });
})();
