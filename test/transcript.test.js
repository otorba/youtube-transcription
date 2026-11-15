'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { pickTrack, buildParams, collectSegments, formatTranscript } = require('../src/transcript.js');

const track = (languageCode, kind) => ({ languageCode, ...(kind && { kind }) });

test('buildParams reproduces the params YouTube sent for its own panel', () => {
  // Captured from the get_panel request of watch?v=iG9CE55wbtY on 2026-11-15.
  assert.equal(buildParams('iG9CE55wbtY'), 'qgkPCgtpRzlDRTU1d2J0WRgB');
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

test('collectSegments finds segments at any depth and skips chapter titles', () => {
  // Shape of the get_panel response for watch?v=iG9CE55wbtY on 2026-11-15, trimmed.
  const item = (timestamp, simpleText) => ({
    macroMarkersPanelItemViewModel: {
      item: {
        timelineItemViewModel: {
          timestamp,
          contentItems: [{ transcriptSegmentViewModel: { simpleText, timestamp } }],
        },
      },
    },
  });
  const response = {
    content: {
      engagementPanelSectionListRenderer: {
        content: {
          sectionListRenderer: {
            contents: [{
              itemSectionRenderer: {
                header: {
                  macroMarkersPanelItemViewModel: {
                    item: { timelineChapterViewModel: { title: 'Chapter 1: Introduction' } },
                  },
                },
                contents: [item('0:27', 'Good morning.\nHow are you?'), item('1:02:05', ' second  line '), item('1:02:09', ' ')],
              },
            }],
          },
        },
      },
    },
  };
  assert.deepEqual(collectSegments(response), [
    { time: '0:27', text: 'Good morning. How are you?' },
    { time: '1:02:05', text: 'second line' },
  ]);
});

test('collectSegments returns nothing for the empty response of a video without captions', () => {
  assert.deepEqual(collectSegments({ responseContext: {} }), []);
});

test('formatTranscript', () => {
  const segments = [{ time: '0:00', text: 'a' }, { time: '0:05', text: 'b' }];
  assert.equal(formatTranscript(segments, false), 'a b');
  assert.equal(formatTranscript(segments, true), '0:00 a\n0:05 b');
});

test('formatTranscript puts the title and the channel name first when the video is known', () => {
  const segments = [{ time: '0:00', text: 'a' }, { time: '0:05', text: 'b' }];
  const videoDetails = { title: 'Do schools kill creativity?', author: 'TED' };
  assert.equal(
    formatTranscript(segments, false, videoDetails),
    'Title: Do schools kill creativity?\nChannel: TED\n\na b',
  );
  assert.equal(
    formatTranscript(segments, true, videoDetails),
    'Title: Do schools kill creativity?\nChannel: TED\n\n0:00 a\n0:05 b',
  );
});
