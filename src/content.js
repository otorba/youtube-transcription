// Runs in the page's MAIN world on youtube.com: the button in the watch page action row, the
// item in the "More actions" menu of a video card, the transcript request and the clipboard
// write. MAIN world is required to reach the player API and ytcfg; YouTube enforces Trusted
// Types, so the DOM is built with createElement/textContent only.
(() => {
  'use strict';

  const T = globalThis.__ytCopyTranscript;
  const LOG = '[copy-transcript]';
  // The like/dislike and Share group of the action row; the button goes right after it, as a
  // direct child of ytd-menu-renderer, which YouTube keeps across SPA navigation.
  const ANCHOR_SELECTOR = 'ytd-watch-metadata ytd-menu-renderer > #top-level-buttons-computed';
  // A video card (home, subscriptions, the watch page sidebar), its "More actions" button and
  // the list of the menu that button opens. YouTube keeps one list and refills it per card.
  const CARD_SELECTOR = 'yt-lockup-view-model';
  const CARD_MENU_BUTTON_SELECTOR = `${CARD_SELECTOR} .ytLockupMetadataViewModelMenuButton`;
  const MENU_LIST_SELECTOR = 'ytd-popup-container yt-list-view-model';
  const RESET_MS = 3000;
  const MENU_CLOSE_MS = 1000;
  const IDLE_LABEL = 'Copy transcript';
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const COPY_ICON =
    'M10 8h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-8a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2z M4 15V6a2 2 0 0 1 2-2h9';
  const CHECK_ICON = 'M5 12.5l4.5 4.5L19 7.5';
  const ALERT_ICON = 'M12 3a9 9 0 1 0 0 18a9 9 0 0 0 0-18z M12 7.5v6 M12 16.5v.01';
  const STATE_ICONS = {
    idle: COPY_ICON,
    busy: COPY_ICON,
    pending: COPY_ICON,
    copied: CHECK_ICON,
    none: ALERT_ICON,
    failed: ALERT_ICON,
  };

  const currentVideoId = () =>
    location.pathname === '/watch' ? new URLSearchParams(location.search).get('v') : null;

  // Set by settings-bridge.js from the extension settings.
  const withTimestamps = () => document.documentElement.dataset.ytctTimestamps === '1';

  // A <button> holding the state icon; returns the icon's path for the state changes.
  function addIcon(control) {
    const icon = document.createElementNS(SVG_NS, 'svg');
    icon.setAttribute('viewBox', '0 0 24 24');
    icon.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS(SVG_NS, 'path');
    icon.append(path);
    control.append(icon);
    return path;
  }

  // --- transcript source: innertube ----------------------------------------------------------

  async function innertube(endpoint, body, hl) {
    const context = window.ytcfg?.get?.('INNERTUBE_CONTEXT');
    if (!context) throw new Error('ytcfg INNERTUBE_CONTEXT is missing');
    const response = await fetch(`/youtubei/v1/${endpoint}?prettyPrint=false`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        context: hl ? { ...context, client: { ...context.client, hl } } : context,
        ...body,
      }),
    });
    if (!response.ok) throw new Error(`${endpoint} returned HTTP ${response.status}`);
    return response.json();
  }

  // The request YouTube's own "Show transcript" button sends. The transcript comes in the
  // language of context.client.hl when the video has a track in it, otherwise in the video's
  // default track; hl undefined keeps the interface language.
  async function fetchPanel(videoId, hl) {
    const panel = await innertube('get_panel', { panelId: T.PANEL_ID, params: T.buildParams(videoId) }, hl);
    return T.collectSegments(panel);
  }

  // For a video whose caption tracks are unknown. Returns null when it has no transcript: a
  // video without captions gets an empty response.
  async function loadDefaultSegments(videoId) {
    const segments = await fetchPanel(videoId);
    return segments.length ? segments : null;
  }

  // The spoken-language transcript, or null when the track list is empty.
  async function loadSpokenSegments(videoId, tracklist) {
    const track = T.pickTrack(tracklist);
    if (!track) return null;
    let segments;
    try {
      segments = await fetchPanel(videoId, track.languageCode);
    } catch (error) {
      // A caption language that is not a YouTube interface language (eo, ckb) gets HTTP 400.
      console.warn(LOG, `get_panel refused hl=${track.languageCode}, using the interface language:`, error);
      segments = await fetchPanel(videoId);
    }
    if (!segments.length) throw new Error('get_panel returned no segments');
    return segments;
  }

  // The player API returns the response of the video that is playing now, unlike
  // window.ytInitialPlayerResponse, which keeps the first video after SPA navigation.
  function playerResponseFor(videoId) {
    const response = document.getElementById('movie_player')?.getPlayerResponse?.();
    return response?.videoDetails?.videoId === videoId ? response : null;
  }

  async function loadPlayingVideo(videoId) {
    const playerResponse = playerResponseFor(videoId);
    if (!playerResponse) {
      console.warn(LOG, 'no player response for this video, using the interface language');
      return { segments: await loadDefaultSegments(videoId) };
    }
    const tracklist = playerResponse.captions?.playerCaptionsTracklistRenderer;
    return { details: playerResponse.videoDetails, segments: await loadSpokenSegments(videoId, tracklist) };
  }

  // A video that is not playing: a plain player request answers UNPLAYABLE with videoDetails
  // and no caption tracks, so the spoken language is unknown.
  async function loadCardVideo(videoId) {
    const [player, segments] = await Promise.all([
      innertube('player', { videoId }),
      loadDefaultSegments(videoId),
    ]);
    return { details: player.videoDetails, segments };
  }

  // --- copy ----------------------------------------------------------------------------------

  // The copy flow behind one control. videoId() names the control's video now, load(videoId)
  // resolves to { segments, details }, render(state, message) shows a state on the control.
  function createCopier({ videoId, load, render }) {
    let resetTimer = 0;
    // Transcript text fetched but not yet on the clipboard (the write was refused, see copy()).
    let pendingText = null;

    function setState(state, message, autoReset) {
      clearTimeout(resetTimer);
      render(state, message);
      if (autoReset) resetTimer = setTimeout(() => setState('idle', IDLE_LABEL), RESET_MS);
    }

    async function copy() {
      if (pendingText !== null) {
        // Second click: still inside the user gesture, so the write is allowed.
        await navigator.clipboard.writeText(pendingText);
        pendingText = null;
        setState('copied', 'Copied', true);
        return;
      }

      const id = videoId();
      setState('busy', 'Copying...');
      const { segments, details } = await load(id);
      if (videoId() !== id) return; // the control moved to another video, reset() already ran
      if (!segments) {
        setState('none', 'No transcript available', true);
        return;
      }

      const text = T.formatTranscript(segments, withTimestamps(), details);
      try {
        await navigator.clipboard.writeText(text);
        setState('copied', `Copied (${segments.length} lines)`, true);
      } catch (error) {
        // The click's transient activation expired during a slow fetch, or the tab lost focus.
        console.warn(LOG, 'clipboard write refused, waiting for a second click:', error);
        pendingText = text;
        setState('pending', 'Ready - click again to copy');
      }
    }

    return {
      click() {
        copy().catch((error) => {
          console.error(LOG, error);
          pendingText = null;
          setState('failed', 'Failed - see console', true);
        });
      },
      reset() {
        pendingText = null;
        setState('idle', IDLE_LABEL);
      },
    };
  }

  // --- watch page button ---------------------------------------------------------------------

  const button = document.createElement('button');
  button.id = 'ytct-button';
  button.type = 'button';
  const buttonIcon = addIcon(button);
  // Lives in <body>, not in the button: ytd-menu-renderer clips its overflow.
  const bubble = document.createElement('div');
  bubble.id = 'ytct-bubble';

  function showBubble(message) {
    const rect = button.getBoundingClientRect();
    bubble.textContent = message;
    bubble.style.left = `${rect.left + rect.width / 2 + window.scrollX}px`;
    bubble.style.top = `${rect.top + window.scrollY}px`;
    document.body.append(bubble);
  }

  const buttonCopier = createCopier({
    videoId: currentVideoId,
    load: loadPlayingVideo,
    // The message is the tooltip and the accessible name; outside idle and busy it is also
    // shown in a bubble above the button.
    render(state, message) {
      button.dataset.state = state;
      button.title = message;
      button.setAttribute('aria-label', message);
      if (state === 'idle' || state === 'busy') bubble.remove();
      else showBubble(message);
      buttonIcon.setAttribute('d', STATE_ICONS[state]);
      button.disabled = state === 'busy';
    },
  });
  button.addEventListener('click', buttonCopier.click);

  // YouTube renders the action row some time after the page (or the first watch page of the
  // session) loads, so the button is inserted when the row appears.
  const rowObserver = new MutationObserver(mountButton);

  function mountButton() {
    if (button.isConnected || !currentVideoId()) return;
    const anchor = document.querySelector(ANCHOR_SELECTOR);
    if (!anchor) return;
    anchor.after(button);
    rowObserver.disconnect();
  }

  function resetForPage() {
    buttonCopier.reset();
    if (button.isConnected || !currentVideoId()) return;
    rowObserver.observe(document.body, { childList: true, subtree: true });
    mountButton();
  }

  // --- video card menu item ------------------------------------------------------------------

  const menuItem = document.createElement('button');
  menuItem.id = 'ytct-menu-item';
  menuItem.type = 'button';
  menuItem.setAttribute('role', 'menuitem');
  const menuItemIcon = addIcon(menuItem);
  const menuItemLabel = document.createElement('span');
  menuItem.append(menuItemLabel);

  // The video of the card whose menu is open.
  let menuVideoId = null;
  let menuCloseTimer = 0;

  const menuCopier = createCopier({
    videoId: () => menuVideoId,
    load: loadCardVideo,
    // The menu stays open to show the result in the item, and closes after a copy.
    render(state, message) {
      clearTimeout(menuCloseTimer);
      menuItem.dataset.state = state;
      menuItemLabel.textContent = message;
      menuItemIcon.setAttribute('d', STATE_ICONS[state]);
      menuItem.disabled = state === 'busy';
      if (state === 'copied') menuCloseTimer = setTimeout(() => document.body.click(), MENU_CLOSE_MS);
    },
  });
  menuItem.addEventListener('click', menuCopier.click);

  // The first menu of a page is rendered after the click that opens it.
  const menuObserver = new MutationObserver(mountMenuItem);

  function mountMenuItem() {
    if (menuItem.isConnected) return;
    document.querySelector(MENU_LIST_SELECTOR)?.append(menuItem);
  }

  // Playlist and mix cards link to a watch page too; only a video card carries the id of the
  // linked video in its content-id class.
  function cardVideoId(menuButton) {
    const card = menuButton.closest(CARD_SELECTOR);
    const link = card.querySelector('a[href^="/watch"]');
    const id = link && new URL(link.href).searchParams.get('v');
    return id && card.querySelector(`.content-id-${id}`) ? id : null;
  }

  // The menu list is shared by every card and by other menus, so the item is taken out on any
  // click outside it and put back only for a video card's menu button.
  document.addEventListener(
    'click',
    (event) => {
      if (menuItem.contains(event.target)) return;
      const menuButton = event.target.closest(CARD_MENU_BUTTON_SELECTOR);
      menuVideoId = menuButton && cardVideoId(menuButton);
      menuCopier.reset();
      menuItem.remove();
      menuObserver.disconnect();
      if (!menuVideoId) return;
      menuObserver.observe(document.body, { childList: true, subtree: true });
      mountMenuItem();
    },
    true,
  );

  // YouTube is an SPA: this fires after every in-app navigation, including the first load.
  document.addEventListener('yt-navigate-finish', resetForPage);
  resetForPage();
})();
