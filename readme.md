# Generic Video Ad Skipper

A small Chrome extension (Manifest V3) that detects a video ad playing on a web page, mutes it, and jumps to the end of the ad. It is **site-agnostic**: it looks for generic signals instead of hard-coding any particular website.

> **Disclaimer:** This project is for personal and educational use. Skipping ads may violate the terms of service of some websites, and sites can detect or counter it. Use at your own risk.

## Features

- **Detects ads on any site** using generic signals (no per-site code).
- **Clicks "Skip Ad" buttons** that appear over the video.
- **Skips separate ad videos** by jumping to their last moment.
- **Skips ads stitched into a stream** (server-side ad insertion) by jumping forward by the on-screen countdown, never past the stream's seekable end.
- **Mutes during ads** and restores your previous sound state afterwards.

## Installation

1. Download or clone this repository.
2. Open `chrome://extensions` in Chrome (or any Chromium browser).
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked** and select this folder (the one containing `manifest.json`).
5. Open a page with a video, then reload it.

After changing any file, click the reload icon on the extension's card and refresh the tab.

## How it works

For every visible `<video>` on the page the script checks for an ad signal:

| Signal | Examples | Strength |
|---|---|---|
| Player in an ad state | classes such as `ad-showing`, `ad-playing`, `ad-interrupting`, `ima-ad-container`, `vjs-ad-playing`, `jw-flag-ads` on or over the video | Strong |
| Ad label over the video | `Ad 1 of 2 (00:20)`, `Ad · 0:15`, `Advertisement 15s` | Strong, and provides a countdown |
| Ad UI classes | `ad-badge`, `ad-overlay`, `ad-container` | Weak: never triggers a seek or mute on its own |

When a signal is found, it acts in this order:

1. **Skip button:** if a "Skip Ad" button overlaps the video, click it.
2. **Separate ad video** (duration of 180 s or less): seek to its last moment. If a countdown is shown, the video's remaining time must match it, so other videos on the page are left alone.
3. **Stitched ad in a long stream** (with a countdown): seek forward by the countdown, clamped to the seekable end.

Labels and classes only count if they contain or visibly overlap the video, so banner ads elsewhere on the page are ignored.

## Configuration

Settings are at the top of `content.js`:

```js
const CONFIG = {
  DEBUG: true,                  // log to the console
  TICK_MS: 500,                 // how often to check
  MAX_AD_SECONDS: 180,          // longer standalone videos are never treated as ads
  COUNTDOWN_TOLERANCE_S: 3,     // allowed mismatch between label and video time left
  STITCHED_COOLDOWN_MS: 1200,   // min gap between forward jumps in a stitched stream
  CLICK_COOLDOWN_MS: 800,
  MIN_VIDEO_W: 150,
  MIN_VIDEO_H: 80,
  LABEL_CLIMB_LEVELS: 5,        // how far above a video to look for an "Ad" label
  MUTE_DURING_ADS: true,        // mute during ads, restore afterwards
  UNMUTE_DELAY_MS: 700          // wait before unmuting after the ad signal disappears
};
```

To limit the extension to specific sites, edit `matches` in `manifest.json`:

```json
"matches": ["https://www.example.com/*", "https://another.example/*"]
```

## Debugging

1. Open DevTools on the page (**Cmd + Option + J** on Mac, **Ctrl + Shift + J** on Windows/Linux).
2. Filter the Console by `AdSkipper`.

You should see lines like:

```
[AdSkipper] Loaded on https://...
[AdSkipper] Ad signal: label:"Ad 1 of 1 (00:20)" | strong: true | remaining: 20 | video: {...}
[AdSkipper] Muted during ad
[AdSkipper] Separate ad video: 0.2 -> 20.0
[AdSkipper] Restored sound after ad
```

If an ad isn't detected, inspect the ad's badge or container in DevTools (right-click → Inspect). Add a distinctive class fragment to `STRONG_CLASS` in `content.js`. If the ad label uses different wording, adjust the `AD_LABEL` regular expression.

## Limitations

- **Live streams:** if an ad is stitched into a live stream, it sits at the live edge, so only the part that is already available can be skipped. To skip a whole break, watch slightly behind live so the content after the ad already exists.
- **Unknown players:** ads with no label, no ad-state class and no skip button won't be detected until you add a pattern.
- **Shadow DOM and cross-origin iframes:** if the ad label is in a different frame from the video, or inside a shadow root, it can't be seen.
- **Anti-skipping measures:** some players detect seeking during ads and replay the ad or show a warning. Sites such as YouTube may also change their markup at any time and break detection.
- **Sound handling:** some ad SDKs control volume instead of the mute flag, which this extension doesn't handle.
- **Autoplay policy:** Chrome may occasionally pause a video when it is unmuted by a script if you haven't interacted with the page.

## Project structure

```
.
├── manifest.json   # Extension manifest (MV3, runs on all URLs and frames)
├── content.js      # Detection, skipping and muting logic
└── README.md
```

## Contributing

Issues and pull requests are welcome, especially ad-state class names or label formats that aren't detected yet. Please include the relevant `[AdSkipper]` console output when reporting a problem.

## License

Add a license of your choice (for example MIT) before publishing.