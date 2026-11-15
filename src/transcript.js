// Pure transcript logic: no DOM, no network. Loaded as a MAIN-world content script
// (exposes globalThis.__ytCopyTranscript) and required by the node tests.
(() => {
  'use strict';

  const PANEL_ID = 'PAmodern_transcript_view';

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

  // --- get_panel params (protobuf, base64) ---------------------------------------------------

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

  const bytesField = (field, bytes) => [...varint((field << 3) | 2), ...varint(bytes.length), ...bytes];
  const varintField = (field, value) => [...varint(field << 3), ...varint(value)];

  // Mirrors the params YouTube sends when its own "Show transcript" button loads the panel:
  //   149: { 1: videoId, 3: 1 }
  // The language is not part of the params, it follows context.client.hl of the request.
  function buildParams(videoId) {
    const message = bytesField(149, [...bytesField(1, utf8.encode(videoId)), ...varintField(3, 1)]);
    return btoa(String.fromCharCode(...message));
  }

  // --- response parsing ----------------------------------------------------------------------

  const cleanText = (text) => text.replace(/\s+/g, ' ').trim();

  // Collects every transcriptSegmentViewModel wherever it sits, in document order, so a change
  // in the wrappers around the segment list does not break parsing. Chapter titles are separate
  // timelineChapterViewModel nodes and are left out.
  function collectSegments(response) {
    const segments = [];
    const visit = (node) => {
      if (Array.isArray(node)) {
        node.forEach(visit);
        return;
      }
      if (!node || typeof node !== 'object') return;
      for (const [key, value] of Object.entries(node)) {
        if (key !== 'transcriptSegmentViewModel') {
          visit(value);
          continue;
        }
        const text = cleanText(value.simpleText ?? '');
        if (text) segments.push({ time: value.timestamp, text });
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

  const api = { PANEL_ID, pickTrack, buildParams, collectSegments, formatTranscript };
  if (typeof module !== 'undefined') module.exports = api;
  else globalThis.__ytCopyTranscript = api;
})();
