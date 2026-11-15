# Copy YouTube Transcript

A personal Chrome extension: one click copies the transcript of the current YouTube video to the
clipboard. No limits, no account, no server, no permissions beyond running on youtube.com.

## Load it

1. Open `chrome://extensions`.
2. Turn on "Developer mode" (top right).
3. Click "Load unpacked" and pick this folder (the one with `manifest.json`).
4. Reload any YouTube tabs that were already open.

After changing the code, press the reload icon on the extension's card and reload the YouTube tab.

## Use it

On a `youtube.com/watch` page a "Copy transcript" pill sits in the bottom-right corner.

- Click it: the full transcript goes to the clipboard, the button turns green and shows the line count.
- "timestamps" checkbox: off gives plain flowing text (best for pasting into an AI chat), on gives
  one `m:ss text` line per transcript line. The choice is remembered.
- "No transcript available": the video has no captions at all, not even auto-generated.
- "Ready - click again to copy": the transcript was fetched but Chrome refused the clipboard write
  (slow fetch or the tab lost focus). Click once more.
- "Failed - see console": open DevTools, the error is logged with the `[copy-transcript]` prefix.

When a video has several caption languages, the original spoken language is copied, manual captions
preferred over auto-generated.

## Tests

`node --test` runs the unit tests of the pure logic. Behavior on YouTube itself can only be checked
by hand, see the checklist in `CLAUDE.md`.
