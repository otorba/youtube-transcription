# Copy YouTube Transcript

Personal unpacked Chrome extension (MV3). One job: on `youtube.com/watch`, a button copies the video's
transcript to the clipboard. Out of scope, do not add: summaries, AI calls, chat, sidebar UI, settings
sync, Web Store publishing. Independent implementation, no code or assets from other extensions.

## Where things live

- `manifest.json` - one content script entry, `world: "MAIN"`, no permissions.
- `src/transcript.js` - pure logic, no DOM or network: track choice (`pickTrack`), `get_transcript`
  params (`buildParams`), response parsing (`collectSegments`), output (`formatTranscript`). Exposes
  `globalThis.__ytCopyTranscript` in the page and `module.exports` under node.
- `src/content.js` - the button, both transcript sources, clipboard write, SPA navigation handling.
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
- Language: the original spoken language, manual over auto-generated. The `asr` track names the
  spoken language; with no `asr` track the video's default caption track is used.
- Clipboard: `navigator.clipboard.writeText` needs the click's transient activation. If it is refused
  after a slow fetch, the text is kept and the next click writes it.
- Stale data: the video id is taken from the URL at click time, the player response is accepted only
  if its `videoDetails.videoId` matches, and a result is dropped if the URL changed meanwhile.

## YouTube hooks in use

Status as of 2026-11-15. "Verified" means checked against a live watch page fetched with curl.
Nothing was verified inside a real browser session with the extension loaded.

| Hook | Used for | Status |
| --- | --- | --- |
| `yt-navigate-finish` event on `document` | re-sync button on SPA navigation | not verified |
| `document.getElementById('movie_player').getPlayerResponse()` | fresh player response after SPA navigation | not verified |
| `captions.playerCaptionsTracklistRenderer.captionTracks[]` (`languageCode`, `kind: "asr"`, `trackName`), `audioTracks[].defaultCaptionTrackIndex`, `defaultAudioTrackIndex` | track choice, "no captions" state | verified (shape, in `ytInitialPlayerResponse`) |
| `ytcfg.get('INNERTUBE_CONTEXT')` | request context | verified that the key exists in the page's ytcfg; the `get` accessor not verified |
| `POST /youtubei/v1/get_transcript` with `{context, params}` | primary source | endpoint and params verified in `ytInitialData`; the call itself not verified (see below) |
| params protobuf: `1` videoId, `2` urlencoded base64 of `{1: kind, 2: languageCode, 3: trackName}`, `3`=1, `5`=`engagement-panel-searchable-transcript-search-panel`, `6`=0, `7`=1, `8`=1 | choosing the language track | verified: `buildParams` reproduces the live params byte for byte (unit test). The `asr` variant and field 3 as track name are inferred |
| response: any `transcriptSegmentRenderer` with `startMs` and `snippet.runs[].text` / `snippet.simpleText` | parsing | not verified (shape from memory; the parser searches at any depth) |
| `ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-searchable-transcript"]` | fallback panel | target id verified in `ytInitialData`; the element selector not verified |
| `ytd-video-description-transcript-section-renderer button`, `ytd-transcript-segment-renderer`, `.segment-timestamp`, `.segment-text`, `visibility` attribute values `ENGAGEMENT_PANEL_VISIBILITY_EXPANDED/HIDDEN` | fallback panel open, read, close | not verified (visibility enum names verified in `ytInitialData`) |

Findings from the 2026-11-15 probe:

- Caption track `baseUrl` (`/api/timedtext`), with or without `&fmt=json3`, returned HTTP 200 with an
  empty body. It needs a proof-of-origin token, so it is not used.
- curl calls to `get_transcript` returned 400 `FAILED_PRECONDITION` twice: with a minimal context,
  and with the page's full `INNERTUBE_CONTEXT`, its `visitorData`, the page's cookies and the
  `X-Youtube-Client-*` headers, all logged out. That second request is close to what
  `fetchFromInnertube` sends, so the endpoint wants something a plain replay lacks (a signed-in
  session or an attestation token). Expect the primary source to fail at least when logged out;
  whether it works signed in is the first thing to check in the browser. On failure the console
  shows `[copy-transcript] get_transcript failed, reading the transcript panel instead` and the
  panel fallback does the work.
- `ytInitialData` also mentions a `PAmodern_transcript_view` panel, a sign of a newer transcript UI
  that may not use `ytd-transcript-segment-renderer`.

## Why these two sources

- Primary, `get_transcript`: it is the request YouTube's own panel sends, returns every segment in
  one response (no virtualized list to scroll on long videos), needs no visible UI change, and its
  params allow choosing the language track.
- Fallback, the transcript panel DOM: follows whatever YouTube itself renders, so it survives a
  change in the request side. Its limits: it shows YouTube's default language, it briefly opens the
  panel, and a virtualized list would truncate long videos.
- Rejected, caption `baseUrl`: empty body without a proof-of-origin token.

## Re-discovering hooks when YouTube changes something

Open a watch page with DevTools.

1. Console warnings prefixed `[copy-transcript]` say which source failed and why.
2. Request side: Network tab, filter `get_transcript`, click "Show transcript" in the description.
   Compare the request body (`context`, `params`) and the response shape with `fetchFromInnertube`
   and `collectSegments`. Decode `params` with
   `atob(decodeURIComponent(p))` to compare the protobuf fields with `buildParams`; a new captured
   value goes into the first unit test.
3. Player data: `document.getElementById('movie_player').getPlayerResponse().captions` in the
   console, after navigating to a second video without reload, to confirm it is fresh.
4. Panel side: with the transcript open, inspect a transcript line for the panel element, its
   `target-id`, the per-line element and its timestamp/text children; update the selectors at the
   top of `src/content.js`.
5. Navigation: `document.addEventListener('yt-navigate-finish', () => console.log('nav'))`, then
   click another video.
6. Update the table above with the new date.

## Manual checklist (the only real verification)

Load unpacked, open DevTools console, then:

1. Video with manual captions: copies, text matches the manual track in the spoken language.
2. Video with auto-generated captions only: copies.
3. Video with no captions at all: "No transcript available".
4. 2h+ video: the line count and the last lines match the end of the video (with timestamps on).
5. Navigate to another video without reloading, click: the new video's transcript, not the old one.
6. Timestamps checkbox on and off, and that it survives a reload.
7. No `[copy-transcript]` warning in the console. A warning means the fallback was used; repeat 4
   with that in mind, since the panel may virtualize its list.
