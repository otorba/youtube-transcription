// Runs in the page's MAIN world on youtube.com: the button, the transcript request and the
// clipboard write. MAIN world is required to reach the player API and ytcfg; YouTube enforces
// Trusted Types, so the DOM is built with createElement/textContent only.
(() => {
  'use strict';

  const T = globalThis.__ytCopyTranscript;
  const LOG = '[copy-transcript]';
  const TIMESTAMPS_KEY = 'ytct:timestamps';
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
