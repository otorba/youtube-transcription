// Runs in the page's MAIN world on youtube.com: the button, the two transcript sources and the
// clipboard write. MAIN world is required to reach the player API and ytcfg; YouTube enforces
// Trusted Types, so the DOM is built with createElement/textContent only.
(() => {
  'use strict';

  const T = globalThis.__ytCopyTranscript;
  const LOG = '[copy-transcript]';
  const TIMESTAMPS_KEY = 'ytct:timestamps';
  const PANEL_SELECTOR =
    'ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-searchable-transcript"]';
  const SEGMENT_SELECTOR = 'ytd-transcript-segment-renderer';
  const OPENER_SELECTOR = 'ytd-video-description-transcript-section-renderer button';
  const PANEL_TIMEOUT_MS = 8000;
  const RESET_MS = 3000;
  const IDLE_LABEL = 'Copy transcript';

  const currentVideoId = () =>
    location.pathname === '/watch' ? new URLSearchParams(location.search).get('v') : null;

  // --- UI ------------------------------------------------------------------------------------

  const root = document.createElement('div');
  root.id = 'ytct-root';
  const button = document.createElement('button');
  button.id = 'ytct-button';
  button.type = 'button';
  const label = document.createElement('label');
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.checked = localStorage.getItem(TIMESTAMPS_KEY) === '1';
  label.append(checkbox, 'timestamps');
  root.append(button, label);
  document.body.append(root);

  let resetTimer = 0;
  // Transcript text fetched but not yet on the clipboard (the write was refused, see copy()).
  let pendingText = null;

  function setState(state, text, autoReset) {
    clearTimeout(resetTimer);
    root.dataset.state = state;
    button.textContent = text;
    button.disabled = state === 'busy';
    if (autoReset) resetTimer = setTimeout(() => setState('idle', IDLE_LABEL), RESET_MS);
  }

  function resetForPage() {
    pendingText = null;
    root.hidden = !currentVideoId();
    setState('idle', IDLE_LABEL);
  }

  // --- source 1: innertube get_transcript ----------------------------------------------------

  // The player API returns the response of the video that is playing now, unlike
  // window.ytInitialPlayerResponse, which keeps the first video after SPA navigation.
  function playerResponseFor(videoId) {
    const response = document.getElementById('movie_player')?.getPlayerResponse?.();
    return response?.videoDetails?.videoId === videoId ? response : null;
  }

  async function fetchFromInnertube(videoId, track) {
    const context = window.ytcfg?.get?.('INNERTUBE_CONTEXT');
    if (!context) throw new Error('ytcfg INNERTUBE_CONTEXT is missing');
    const response = await fetch('/youtubei/v1/get_transcript?prettyPrint=false', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ context, params: T.buildParams(videoId, track) }),
    });
    if (!response.ok) throw new Error(`get_transcript returned HTTP ${response.status}`);
    const segments = T.collectSegments(await response.json());
    if (!segments.length) throw new Error('get_transcript returned no segments');
    return segments;
  }

  // --- source 2: YouTube's own transcript panel ----------------------------------------------

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  // Returns null when the page has no transcript panel, which YouTube only renders for videos
  // that have a transcript.
  async function readFromPanel(videoId) {
    const panel = document.querySelector(PANEL_SELECTOR);
    if (!panel) return null;

    const openedByUs = !panel.querySelector(SEGMENT_SELECTOR);
    if (openedByUs) {
      const opener = document.querySelector(OPENER_SELECTOR);
      if (opener) opener.click();
      else panel.setAttribute('visibility', 'ENGAGEMENT_PANEL_VISIBILITY_EXPANDED');
    }

    const deadline = Date.now() + PANEL_TIMEOUT_MS;
    while (!panel.querySelector(SEGMENT_SELECTOR)) {
      if (Date.now() > deadline) throw new Error('transcript panel did not load any segments');
      if (currentVideoId() !== videoId) throw new Error('navigated away while the panel was loading');
      await sleep(200);
    }

    const segments = [];
    for (const node of panel.querySelectorAll(SEGMENT_SELECTOR)) {
      const text = T.cleanText(node.querySelector('.segment-text')?.textContent ?? '');
      const time = T.cleanText(node.querySelector('.segment-timestamp')?.textContent ?? '');
      if (text) segments.push({ time, text });
    }
    if (openedByUs) panel.setAttribute('visibility', 'ENGAGEMENT_PANEL_VISIBILITY_HIDDEN');
    if (!segments.length) throw new Error('transcript panel segments had no text');
    return segments;
  }

  // --- copy ----------------------------------------------------------------------------------

  // Returns the segments, or null when the video has no transcript.
  async function loadSegments(videoId) {
    const playerResponse = playerResponseFor(videoId);
    if (playerResponse) {
      const track = T.pickTrack(playerResponse.captions?.playerCaptionsTracklistRenderer);
      if (!track) return null;
      try {
        return await fetchFromInnertube(videoId, track);
      } catch (error) {
        console.warn(LOG, 'get_transcript failed, reading the transcript panel instead:', error);
      }
    } else {
      console.warn(LOG, 'no player response for this video, reading the transcript panel instead');
    }
    return readFromPanel(videoId);
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

    const text = T.formatTranscript(segments, checkbox.checked);
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

  checkbox.addEventListener('change', () => {
    localStorage.setItem(TIMESTAMPS_KEY, checkbox.checked ? '1' : '0');
    pendingText = null;
    setState('idle', IDLE_LABEL);
  });

  // YouTube is an SPA: this fires after every in-app navigation, including the first load.
  document.addEventListener('yt-navigate-finish', resetForPage);
  resetForPage();
})();
