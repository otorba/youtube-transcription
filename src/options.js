// The settings page, shown as the toolbar popup and as the extension's options page.
(() => {
  'use strict';

  const KEY = 'timestamps';
  const checkbox = document.getElementById(KEY);

  chrome.storage.local.get({ [KEY]: false }).then((stored) => {
    checkbox.checked = stored[KEY];
  });
  checkbox.addEventListener('change', () => chrome.storage.local.set({ [KEY]: checkbox.checked }));
})();
