# Copy YouTube Transcript

Personal unpacked Chrome extension (MV3). One job: copy a video's transcript to the clipboard, from a
button on `youtube.com/watch` or from the "More actions" menu of a video card. Out of scope, do not add: summaries, AI calls, chat, sidebar UI, settings
sync, Web Store publishing. Independent implementation, no code or assets from other extensions.

## Where things live

- `manifest.json` - two content script entries (isolated world for the settings bridge, `world:
  "MAIN"` for the rest), the `storage` permission, the settings page as toolbar popup and options
  page.
- `src/transcript.js` - pure logic, no DOM or network: track choice (`pickTrack`), `get_panel`
  params (`buildParams`), response parsing (`collectSegments`), output (`formatTranscript`). Exposes
  `globalThis.__ytCopyTranscript` in the page and `module.exports` under node.
- `src/content.js` - the watch page button, the video card menu item, the `get_panel` request,
  clipboard write, SPA navigation handling. `createCopier` is the copy flow shared by both controls.
- `src/content.css` - the round icon button in the action row, its message bubble, the menu item.
- `src/settings-bridge.js` - isolated world: copies the settings from `chrome.storage.local` to
  data attributes on `<html>` and keeps them current.
- `src/options.html`, `src/options.js` - the settings page (one checkbox, "Include timestamps").
- `test/transcript.test.js` - unit tests for `transcript.js`. Run `node --test`.

Checks: `node --check` on every JS file, `node --test`. Nothing here can exercise live YouTube.

## Design decisions

- The button and the request run in the MAIN world: the player API and `ytcfg` are invisible from
  the isolated world. Consequences: no `chrome.*` APIs there, and YouTube's Trusted Types forbid
  `innerHTML` - build DOM with `createElement`/`createElementNS`/`textContent`.
- Settings live in `chrome.storage.local` (key `timestamps`), not synced. `settings-bridge.js`
  publishes them as `<html data-ytct-timestamps="1|0">`, which `content.js` reads at click time,
  so a change in the popup applies to the next click without a reload.
- The button is one round icon button in the watch page action row, inserted right after
  `#top-level-buttons-computed` (like/dislike and Share) as a direct child of `ytd-menu-renderer`.
  It carries its own CSS instead of YouTube's button classes, which were renamed once already;
  only the two theme colour variables are borrowed, with fallbacks. Inside
  `#top-level-buttons-computed` YouTube re-renders the children, and `ytd-menu-renderer` clips
  overflow, so the message bubble is a separate element in `<body>`.
- Button states: copy icon (idle, dimmed while busy, yellow when a second click is needed), green
  check (copied), yellow alert (no transcript), red alert (failed). The message is the tooltip, the
  `aria-label` and, after a click, the bubble above the button for 3 seconds.
- Video card menu item: "Copy transcript" is appended to the "More actions" menu of a video card
  (home, subscriptions, the watch page sidebar). YouTube keeps one `yt-list-view-model` for all
  these menus and refills it per card, and a foreign node in it survives the refill. So a
  capture-phase click listener removes the item on every click outside it and appends it again
  only when the click is on a video card's menu button, remembering that card's video id.
  Playlist and mix cards are skipped: only a video card has `content-id-<videoId>` matching its
  watch link. The item shows the state in its label, the menu stays open meanwhile and is closed
  1 second after a copy with `document.body.click()`.
- A card's video is not playing, so there is no track list: the transcript comes in the interface
  language, or the video's default track when there is none in it (no `hl` override). The header
  comes from a `player` request, which answers `UNPLAYABLE` but with `videoDetails`.
- Output: a header (`Title: ...`, `Channel: ...`, blank line) from the player response's
  `videoDetails.title` and `videoDetails.author`, so an AI chat knows which video the text is from;
  it is left out only when the player response is missing. Then plain text joining all segments
  with spaces; with timestamps, one `m:ss text` line each.
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
| `ytd-watch-metadata ytd-menu-renderer > #top-level-buttons-computed` | where the button is inserted | verified: a node inserted after it stays in place across SPA navigation |
| `--yt-sys-color-baseline--additive-background`, `--yt-sys-color-baseline--text-primary`, `html[dark]` | button colours | verified in the dark theme only |
| `document.getElementById('movie_player').getPlayerResponse()` | fresh player response after SPA navigation | verified (new video id after two SPA navigations) |
| `captions.playerCaptionsTracklistRenderer.captionTracks[]` (`languageCode`, `kind: "asr"`), `audioTracks[].defaultCaptionTrackIndex`, `defaultAudioTrackIndex` | track choice, "no captions" state | verified |
| `videoDetails.title`, `videoDetails.author` in the player response | header of the copied text | verified |
| `ytcfg.get('INNERTUBE_CONTEXT')` | request context | verified |
| `POST /youtubei/v1/get_panel` with `{context, panelId: "PAmodern_transcript_view", params}`, plain `fetch` with only `Content-Type` | the transcript | verified |
| params protobuf: `149: {1: videoId, 3: 1}`, plain base64 | naming the video | verified: `buildParams` reproduces the captured params byte for byte (unit test) |
| `context.client.hl` | choosing the language track | verified: `en`, `fr`, `uk`, `pt-BR` return that track on a video with 65 tracks; `xx`, `eo`, `ckb` return 400. `zh-CN` and `zh-TW` returned the same track |
| response: any `transcriptSegmentViewModel` with `simpleText` and `timestamp` (`"0:27"`, `"3:08:07"`) | parsing | verified. Chapter titles are separate `timelineChapterViewModel` nodes |
| `yt-lockup-view-model` with `.content-id-<videoId>` and `a[href^="/watch"]`, its `.ytLockupMetadataViewModelMenuButton` | video card and its menu button | verified on the subscriptions feed and the watch page sidebar (code injected into the page, see below) |
| `ytd-popup-container yt-list-view-model` | where the menu item is appended | verified: the same element serves every card, an appended node survives the refill |
| `POST /youtubei/v1/player` with `{context, videoId}` | title and channel for a card | verified: `UNPLAYABLE`, `videoDetails` present, no `captions`, on 5 videos |
| `get_panel` without the player (no `hl` override) | transcript for a card | verified on 5 feed videos |
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
- The card menu item was checked by injecting `content.js` and its CSS into the page, because the
  loaded extension still ran the old files: the item looked native in the dark theme, a real
  click copied 61 lines with the header and the menu closed. Not checked: the light theme, search
  results (`ytd-video-renderer`, an older menu, not supported), the item with the extension
  itself reloaded, and the watch page button after the `createCopier` refactoring.
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
5. Button missing: inspect the like/dislike row and update `ANCHOR_SELECTOR` in `src/content.js`;
   compare the size and colours of a native round button (Share, Save) with `src/content.css`.
6. Update the table above with the new date.

## Manual checklist (the only real verification)

Load unpacked, open DevTools console, then:

1. Video with manual captions: copies, text matches the manual track in the spoken language and
   starts with the video's title and channel name.
2. Video with auto-generated captions only: copies.
3. Video with no captions at all: "No transcript available".
4. 2h+ video: the line count and the last lines match the end of the video (with timestamps on).
5. Navigate to another video without reloading, click: the new video's transcript, not the old one.
6. Timestamps on and off in the settings popup (toolbar icon): the next click follows it without
   a page reload, and the setting survives a reload.
7. No `[copy-transcript]` warning in the console. A warning means the spoken-language request was
   refused or the player response was missing, and the interface language was used instead.
8. On the home or subscriptions page, a video card's three-dot menu ends with "Copy transcript":
   it copies that video's transcript with its title and channel, then the menu closes. The same
   in the watch page sidebar. A playlist or mix card's menu has no such item.
9. The button sits after Share in the action row, looks like its neighbours in the dark and the
   light theme, and is still there after navigating to another video and after opening a video
   from the home page.
