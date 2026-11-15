# Copy YouTube Transcript

A personal Chrome extension: one click copies the transcript of the current YouTube video to the
clipboard. No limits, no account, no server, no permissions beyond running on youtube.com and
storing its one setting.

## Load it

1. Open `chrome://extensions`.
2. Turn on "Developer mode" (top right).
3. Click "Load unpacked" and pick this folder (the one with `manifest.json`).
4. Reload any YouTube tabs that were already open.

After changing the code, press the reload icon on the extension's card and reload the YouTube tab.

## Use it

On a `youtube.com/watch` page a round button with a copy icon sits in the row under the video,
right after like/dislike and Share.

- Click it: the full transcript goes to the clipboard, the icon turns into a green check and a
  bubble above it shows the line count.
- Timestamps: click the extension's icon in the Chrome toolbar and tick "Include timestamps". Off
  gives plain flowing text (best for pasting into an AI chat), on gives one `m:ss text` line per
  transcript line. The choice is remembered and applies to the next click.
- Yellow alert icon, "No transcript available": the video has no captions at all, not even
  auto-generated.
- Yellow copy icon, "Ready - click again to copy": the transcript was fetched but Chrome refused
  the clipboard write (slow fetch or the tab lost focus). Click once more.
- Red alert icon, "Failed - see console": open DevTools, the error is logged with the
  `[copy-transcript]` prefix.

When a video has several caption languages, the original spoken language is copied, manual captions
preferred over auto-generated.

## Tests

`node --test` runs the unit tests of the pure logic. Behavior on YouTube itself can only be checked
by hand, see the checklist in `CLAUDE.md`.
