// Runs in the page's MAIN world on youtube.com: the button in the action row, the transcript
// request and the clipboard write. MAIN world is required to reach the player API and ytcfg;
// YouTube enforces Trusted Types, so the DOM is built with createElement/textContent only.
(() => {
  'use strict';

  const T = globalThis.__ytCopyTranscript;
  const LOG = '[copy-transcript]';
  // The like/dislike and Share group of the action row; the button goes right after it, as a
  // direct child of ytd-menu-renderer, which YouTube keeps across SPA navigation.
  const ANCHOR_SELECTOR = 'ytd-watch-metadata ytd-menu-renderer > #top-level-buttons-computed';
  const RESET_MS = 3000;
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

  // --- UI ------------------------------------------------------------------------------------

  const button = document.createElement('button');
  button.id = 'ytct-button';
  button.type = 'button';
  const icon = document.createElementNS(SVG_NS, 'svg');
  icon.setAttribute('viewBox', '0 0 24 24');
  icon.setAttribute('aria-hidden', 'true');
  const iconPath = document.createElementNS(SVG_NS, 'path');
  icon.append(iconPath);
  button.append(icon);
  // Lives in <body>, not in the button: ytd-menu-renderer clips its overflow.
  const bubble = document.createElement('div');
  bubble.id = 'ytct-bubble';

  let resetTimer = 0;
  // Transcript text fetched but not yet on the clipboard (the write was refused, see copy()).
  let pendingText = null;

  function showBubble(message) {
    const rect = button.getBoundingClientRect();
    bubble.textContent = message;
    bubble.style.left = `${rect.left + rect.width / 2 + window.scrollX}px`;
    bubble.style.top = `${rect.top + window.scrollY}px`;
    document.body.append(bubble);
  }

  // The message is the tooltip and the accessible name; outside idle and busy it is also shown
  // in a bubble above the button.
  function setState(state, message, autoReset) {
    clearTimeout(resetTimer);
    button.dataset.state = state;
    button.title = message;
    button.setAttribute('aria-label', message);
    if (state === 'idle' || state === 'busy') bubble.remove();
    else showBubble(message);
    iconPath.setAttribute('d', STATE_ICONS[state]);
    button.disabled = state === 'busy';
    if (autoReset) resetTimer = setTimeout(() => setState('idle', IDLE_LABEL), RESET_MS);
  }

  // YouTube renders the action row some time after the page (or the first watch page of the
  // session) loads, so the button is inserted when the row appears.
  const rowObserver = new MutationObserver(mount);

  function mount() {
    if (button.isConnected || !currentVideoId()) return;
    const anchor = document.querySelector(ANCHOR_SELECTOR);
    if (!anchor) return;
    anchor.after(button);
    rowObserver.disconnect();
  }

  function resetForPage() {
    pendingText = null;
    setState('idle', IDLE_LABEL);
    if (button.isConnected || !currentVideoId()) return;
    rowObserver.observe(document.body, { childList: true, subtree: true });
    mount();
  }

  // --- transcript source: innertube get_panel -------------------------------------------------

  // The player API returns the response of the video that is playing now, unlike
  // window.ytInitialPlayerResponse, which keeps the first video after SPA navigation.
  function playerResponseFor(videoId) {
    const response = document.getElementById('movie_player')?.getPlayerResponse?.();
    return response?.videoDetails?.videoId === videoId ? response : null;
  }

  // The request YouTube's own "Show transcript" button sends. The transcript comes in the
  // language of context.client.hl when the video has a track in it, otherwise in the video's
  // default track; hl undefined keeps the interface language.
  async function fetchPanel(videoId, hl) {
    const context = window.ytcfg?.get?.('INNERTUBE_CONTEXT');
    if (!context) throw new Error('ytcfg INNERTUBE_CONTEXT is missing');
    const response = await fetch('/youtubei/v1/get_panel?prettyPrint=false', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        context: hl ? { ...context, client: { ...context.client, hl } } : context,
        panelId: T.PANEL_ID,
        params: T.buildParams(videoId),
      }),
    });
    if (!response.ok) throw new Error(`get_panel returned HTTP ${response.status}`);
    return T.collectSegments(await response.json());
  }

  // --- copy ----------------------------------------------------------------------------------

  // Returns the segments, or null when the video has no transcript.
  async function loadSegments(videoId) {
    const playerResponse = playerResponseFor(videoId);
    if (!playerResponse) {
      // Without the track list the spoken language is unknown; a video without captions gets
      // an empty response.
      console.warn(LOG, 'no player response for this video, using the interface language');
      const segments = await fetchPanel(videoId);
      return segments.length ? segments : null;
    }

    const track = T.pickTrack(playerResponse.captions?.playerCaptionsTracklistRenderer);
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

  async function copy() {
    if (pendingText !== null) {
      // Second click: still inside the user gesture, so the write is allowed.
      await navigator.clipboard.writeText(pendingText);
      pendingText = null;
      setState('copied', 'Copied', true);
      return;
    }

    const videoId = currentVideoId();
    setState('busy', 'Copying...');
    const segments = await loadSegments(videoId);
    if (currentVideoId() !== videoId) return; // navigated meanwhile, resetForPage already ran
    if (!segments) {
      setState('none', 'No transcript available', true);
      return;
    }

    const text = T.formatTranscript(segments, withTimestamps());
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

  button.addEventListener('click', () => {
    copy().catch((error) => {
      console.error(LOG, error);
      pendingText = null;
      setState('failed', 'Failed - see console', true);
    });
  });

  // YouTube is an SPA: this fires after every in-app navigation, including the first load.
  document.addEventListener('yt-navigate-finish', resetForPage);
  resetForPage();
})();
