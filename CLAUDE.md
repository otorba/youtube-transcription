# Copy YouTube Transcript

Personal unpacked Chrome extension (MV3). One job: on `youtube.com/watch`, a button copies the video's
transcript to the clipboard. Out of scope, do not add: summaries, AI calls, chat, sidebar UI, settings
sync, Web Store publishing. Independent implementation, no code or assets from other extensions.

## Where things live

- `manifest.json` - one content script entry, `world: "MAIN"`, no permissions.
- `src/transcript.js` - pure logic, no DOM or network: track choice (`pickTrack`), `get_panel`
  params (`buildParams`), response parsing (`collectSegments`), output (`formatTranscript`). Exposes
  `globalThis.__ytCopyTranscript` in the page and `module.exports` under node.
- `src/content.js` - the button, the `get_panel` request, clipboard write, SPA navigation handling.
- `src/content.css` - the floating pill (fixed bottom-right, not injected into YouTube's layout, so
  layout changes cannot remove it).
- `test/transcript.test.js` - unit tests for `transcript.js`. Run `node --test`.

Checks: `node --check` on every JS file, `node --test`. Nothing here can exercise live YouTube.

## Design decisions

- Everything runs in the MAIN world: the player API and `ytcfg` are invisible from the isolated
  world. Consequences: no `chrome.*` APIs (the timestamps toggle lives in `localStorage`, key
  `ytct:timestamps`), and YouTube's Trusted Types forbid `innerHTML` - build DOM with
  `createElement`/`textContent`.
- Output: plain text joins all segments with spaces; with timestamps, one `m:ss text` line each.
  A segment is what YouTube's transcript panel shows as one line (a sentence or two), not a single
  caption cue, and its timestamp string comes from the response as is.
- Language: the original spoken language, manual over auto-generated. The `asr` track names the
  spoken language; with no `asr` track the video's default caption track is used. The request has
  no track parameter: the picked track's `languageCode` goes into `context.client.hl`, and YouTube
  returns the track in that language, or the video's default track when there is none. A code that
  is not a YouTube interface language (`eo`, `ckb`) gets HTTP 400, then the request is repeated
  with the page's own `hl`.
- Clipboard: `navigator.clipboard.writeText` needs the click's transient activation. If it is refused
  after a slow fetch, the text is kept and the next click writes it.
- Stale data: the video id is taken from the URL at click time, the player response is accepted only
  if its `videoDetails.videoId` matches, and a result is dropped if the URL changed meanwhile.

## YouTube hooks in use

Status as of 2026-11-15. "Verified" means seen working in a signed-in Chrome session on live watch
pages, with the extension loaded and the button clicked for real (the full manual checklist).

| Hook | Used for | Status |
| --- | --- | --- |
| `yt-navigate-finish` event on `document` | re-sync button on SPA navigation | verified |
| `document.getElementById('movie_player').getPlayerResponse()` | fresh player response after SPA navigation | verified (new video id after two SPA navigations) |
| `captions.playerCaptionsTracklistRenderer.captionTracks[]` (`languageCode`, `kind: "asr"`), `audioTracks[].defaultCaptionTrackIndex`, `defaultAudioTrackIndex` | track choice, "no captions" state | verified |
| `ytcfg.get('INNERTUBE_CONTEXT')` | request context | verified |
| `POST /youtubei/v1/get_panel` with `{context, panelId: "PAmodern_transcript_view", params}`, plain `fetch` with only `Content-Type` | the transcript | verified |
| params protobuf: `149: {1: videoId, 3: 1}`, plain base64 | naming the video | verified: `buildParams` reproduces the captured params byte for byte (unit test) |
| `context.client.hl` | choosing the language track | verified: `en`, `fr`, `uk`, `pt-BR` return that track on a video with 65 tracks; `xx`, `eo`, `ckb` return 400. `zh-CN` and `zh-TW` returned the same track |
| response: any `transcriptSegmentViewModel` with `simpleText` and `timestamp` (`"0:27"`, `"3:08:07"`) | parsing | verified. Chapter titles are separate `timelineChapterViewModel` nodes |
| response of a video without captions: HTTP 200 with only `responseContext` | (not relied on when the player response is present) | verified |

Findings from the 2026-11-15 browser session:

- `POST /youtubei/v1/get_transcript` returns HTTP 400 from the page even signed in, and YouTube's
  own "Show transcript" button no longer calls it. It calls `get_panel` and adds an
  `Authorization` header, which a plain `fetch` does not need.
- The whole transcript comes in one response with no continuation: 1554 segments for a 3h08 video.
- The old panel `engagement-panel-searchable-transcript` still exists in the DOM but never gets
  segments, and `ytd-transcript-segment-renderer` matched nothing. In the test tab YouTube's own
  button did not open the `PAmodern_transcript_view` panel either (possibly because of the test
  instrumentation), so its DOM was never seen. The panel DOM fallback was removed for that reason.
- Caption track `baseUrl` (`/api/timedtext`) returned HTTP 200 with an empty body from curl. It
  needs a proof-of-origin token, so it is not used.
- Not checked live: a video whose spoken language has both a manual track in another language and
  an `asr` track only (the `hl` override should pick the `asr` one), and the 400 retry on a real
  `eo`/`ckb` video.

## Why this source

- `get_panel` is the request YouTube's own transcript panel sends, returns every segment in one
  response, needs no visible UI change, and `hl` allows choosing the language track.
- There is no second source. Rejected: `get_transcript` (HTTP 400), caption `baseUrl` (empty body
  without a proof-of-origin token), the transcript panel DOM (not rendered in the probe, would show
  only YouTube's default language and open the panel visibly).

## Re-discovering hooks when YouTube changes something

Open a watch page with DevTools.

1. Console messages prefixed `[copy-transcript]` say what failed and why.
2. Request side: Network tab, filter `youtubei`, click "Show transcript" in the description.
   Compare the endpoint, the request body (`panelId`, `params`; the body is gzip-compressed) and
   the response shape with `fetchPanel` and `collectSegments`. Decode `params` with `atob(p)` to
   compare the protobuf fields with `buildParams`; a new captured value goes into the first unit
   test.
3. Player data: `document.getElementById('movie_player').getPlayerResponse().captions` in the
   console, after navigating to a second video without reload, to confirm it is fresh.
4. Navigation: `document.addEventListener('yt-navigate-finish', () => console.log('nav'))`, then
   click another video.
5. Update the table above with the new date.

## Manual checklist (the only real verification)

Load unpacked, open DevTools console, then:

1. Video with manual captions: copies, text matches the manual track in the spoken language.
2. Video with auto-generated captions only: copies.
3. Video with no captions at all: "No transcript available".
4. 2h+ video: the line count and the last lines match the end of the video (with timestamps on).
5. Navigate to another video without reloading, click: the new video's transcript, not the old one.
6. Timestamps checkbox on and off, and that it survives a reload.
7. No `[copy-transcript]` warning in the console. A warning means the spoken-language request was
   refused or the player response was missing, and the interface language was used instead.
