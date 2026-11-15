'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { pickTrack, buildParams, collectSegments, formatTranscript, formatTime } = require('../src/transcript.js');

const track = (languageCode, kind) => ({ languageCode, ...(kind && { kind }) });

test('buildParams reproduces the params YouTube served for its own panel', () => {
  // Captured from ytInitialData of watch?v=8jPQjjsBbIc on 2026-11-15 (manual English track).
  const live =
    'Cgs4alBRampzQmJJYxIOQ2dBU0FtVnVHZ0ElM0QYASozZW5nYWdlbWVudC1wYW5lbC1zZWFyY2hhYmxlLXRyYW5zY3JpcHQtc2VhcmNoLXBhbmVsMAA4AUAB';
  assert.equal(buildParams('8jPQjjsBbIc', { languageCode: 'en', trackName: '' }), live);
});

test('buildParams encodes the asr kind into the track reference', () => {
  const outer = Buffer.from(decodeURIComponent(buildParams('8jPQjjsBbIc', track('en', 'asr'))), 'base64');
  const inner = Buffer.from(decodeURIComponent(outer.subarray(15, 15 + outer[14]).toString()), 'base64');
  assert.deepEqual([...inner], [0x0a, 3, ...Buffer.from('asr'), 0x12, 2, ...Buffer.from('en'), 0x1a, 0]);
});

test('pickTrack prefers manual captions in the spoken language', () => {
  const tracks = [track('ar'), track('en'), track('en', 'asr'), track('ru')];
  assert.equal(pickTrack({ captionTracks: tracks }), tracks[1]);
});

test('pickTrack matches a regional manual track to the spoken language', () => {
  const tracks = [track('de'), track('en-US'), track('en', 'asr')];
  assert.equal(pickTrack({ captionTracks: tracks }), tracks[1]);
});

test('pickTrack falls back to the auto-generated track', () => {
  const tracks = [track('de'), track('en', 'asr')];
  assert.equal(pickTrack({ captionTracks: tracks }), tracks[1]);
});

test('pickTrack uses the default track when the spoken language is unknown', () => {
  const tracks = [track('ar'), track('fr'), track('de')];
  const tracklist = {
    captionTracks: tracks,
    audioTracks: [{ defaultCaptionTrackIndex: 1 }],
    defaultAudioTrackIndex: 0,
  };
  assert.equal(pickTrack(tracklist), tracks[1]);
  assert.equal(pickTrack({ captionTracks: tracks }), tracks[0]);
});

test('pickTrack returns null when the video has no captions', () => {
  assert.equal(pickTrack(undefined), null);
  assert.equal(pickTrack({ captionTracks: [] }), null);
});

test('collectSegments finds segments at any depth and skips section headers', () => {
  const response = {
    actions: [{
      wrapper: {
        initialSegments: [
          { transcriptSectionHeaderRenderer: { snippet: { simpleText: 'Intro' } } },
          { transcriptSegmentRenderer: { startMs: '0', snippet: { runs: [{ text: 'Hello\nthere' }] } } },
          { transcriptSegmentRenderer: { startMs: '65000', snippet: { simpleText: ' second  line ' } } },
          { transcriptSegmentRenderer: { startMs: '70000', snippet: { runs: [{ text: ' ' }] } } },
        ],
      },
    }],
  };
  assert.deepEqual(collectSegments(response), [
    { time: '0:00', text: 'Hello there' },
    { time: '1:05', text: 'second line' },
  ]);
});

test('formatTime switches to hours past 60 minutes', () => {
  assert.equal(formatTime(59_999), '0:59');
  assert.equal(formatTime(3_600_000), '1:00:00');
  assert.equal(formatTime(7_384_000), '2:03:04');
});

test('formatTranscript', () => {
  const segments = [{ time: '0:00', text: 'a' }, { time: '0:05', text: 'b' }];
  assert.equal(formatTranscript(segments, false), 'a b');
  assert.equal(formatTranscript(segments, true), '0:00 a\n0:05 b');
});
