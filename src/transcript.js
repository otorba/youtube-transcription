// Pure transcript logic: no DOM, no network. Loaded as a MAIN-world content script
// (exposes globalThis.__ytCopyTranscript) and required by the node tests.
(() => {
  'use strict';

  const PANEL_ID = 'engagement-panel-searchable-transcript-search-panel';

  // --- track choice -------------------------------------------------------------------------

  const baseLanguage = (code) => code.split('-')[0];

  // Prefers the original spoken language, manual captions over auto-generated.
  // The auto-generated (kind "asr") track is always in the spoken language, so it names it.
  // Without an asr track the spoken language is unknown: use YouTube's default track.
  function pickTrack(tracklist) {
    const tracks = tracklist?.captionTracks;
    if (!tracks?.length) return null;

    const asr = tracks.find((t) => t.kind === 'asr');
    if (asr) {
      const spoken = baseLanguage(asr.languageCode);
      const manual =
        tracks.find((t) => t.kind !== 'asr' && t.languageCode === asr.languageCode) ??
        tracks.find((t) => t.kind !== 'asr' && baseLanguage(t.languageCode) === spoken);
      return manual ?? asr;
    }

    const audio = tracklist.audioTracks?.[tracklist.defaultAudioTrackIndex ?? 0];
    return tracks[audio?.defaultCaptionTrackIndex ?? 0] ?? tracks[0];
  }

  // --- get_transcript params (protobuf, base64) ----------------------------------------------

  const utf8 = new TextEncoder();

  function varint(n) {
    const out = [];
    while (n > 0x7f) {
      out.push((n & 0x7f) | 0x80);
      n >>>= 7;
    }
    out.push(n);
    return out;
  }

  const stringField = (field, value) => {
    const bytes = utf8.encode(value);
    return [...varint((field << 3) | 2), ...varint(bytes.length), ...bytes];
  };
  const varintField = (field, value) => [...varint(field << 3), ...varint(value)];
  const base64 = (bytes) => encodeURIComponent(btoa(String.fromCharCode(...bytes)));

  // Mirrors the params YouTube puts in ytInitialData for its own transcript panel:
  //   1: videoId, 2: base64({1: kind, 2: languageCode, 3: track name}), 3: 1, 5: panel id, 6: 0, 7: 1, 8: 1
  function buildParams(videoId, track) {
    const trackRef = base64([
      ...stringField(1, track.kind ?? ''),
      ...stringField(2, track.languageCode),
      ...stringField(3, track.trackName ?? ''),
    ]);
    return base64([
      ...stringField(1, videoId),
      ...stringField(2, trackRef),
      ...varintField(3, 1),
      ...stringField(5, PANEL_ID),
      ...varintField(6, 0),
      ...varintField(7, 1),
      ...varintField(8, 1),
    ]);
  }

  // --- response parsing ----------------------------------------------------------------------

  function formatTime(ms) {
    const total = Math.floor(ms / 1000);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = String(total % 60).padStart(2, '0');
    return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
  }

  const cleanText = (text) => text.replace(/\s+/g, ' ').trim();

  // Collects every transcriptSegmentRenderer wherever it sits, in document order, so a change
  // in the wrappers around the segment list does not break parsing.
  function collectSegments(response) {
    const segments = [];
    const visit = (node) => {
      if (Array.isArray(node)) {
        node.forEach(visit);
        return;
      }
      if (!node || typeof node !== 'object') return;
      for (const [key, value] of Object.entries(node)) {
        if (key !== 'transcriptSegmentRenderer') {
          visit(value);
          continue;
        }
        const snippet = value.snippet ?? {};
        const text = cleanText(snippet.simpleText ?? (snippet.runs ?? []).map((r) => r.text).join(''));
        if (text) segments.push({ time: formatTime(Number(value.startMs)), text });
      }
    };
    visit(response);
    return segments;
  }

  // segments: [{ time: "1:23", text }]
  function formatTranscript(segments, withTimestamps) {
    return withTimestamps
      ? segments.map((s) => `${s.time} ${s.text}`).join('\n')
      : segments.map((s) => s.text).join(' ');
  }

  const api = { pickTrack, buildParams, collectSegments, formatTranscript, formatTime, cleanText };
  if (typeof module !== 'undefined') module.exports = api;
  else globalThis.__ytCopyTranscript = api;
})();
