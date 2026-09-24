# Exporting videos for the portfolio

How to prepare a project video (main visual or `[slug]` content video) so it
loads fast, starts without a flash and plays smoothly.

## Format: H.264 in .mp4 — nothing else

- **H.264 (`.mp4`)** plays in every browser on every device, and is decoded by
  the graphics chip almost everywhere, which matters because several videos
  can be playing at once (see `src/scripts/main-video.ts`).
- **Not AV1 / VP9 / HEVC** for now: AV1 files are 30–50% smaller, but on any
  device without an AV1 decoder chip (most machines older than ~2023) the
  processor decodes it, which is heavier and brings back the scroll freezes.
  Revisit only after the video stress test (see `TODO.md` → Before launch).

## Resolution

| Use | Size | Notes |
|---|---|---|
| Main visual, desktop (landscape) | **1920×1080** max | Full-screen in the reel, vue 1 and the `[slug]` hero. |
| Main visual, mobile (portrait) | **1080×1350** or **1080×1920** | Served when the screen is taller than wide (`main.video.mobile`). |
| `[slug]` content video | **1280–1600 px wide** | Shown at most ~40rem wide; 1920 is wasted there. |

**Very wide / very large screens:** the video always fills its box
(`object-fit: cover`), so it's never stretched.
- On an ultrawide screen (21:9), a 16:9 video has its top and bottom cropped
  (about 12% each side). Keep important content away from the top and bottom
  edges.
- On a 1440p or 4K monitor, 1080p is scaled up and looks slightly soft on
  close inspection. For moving footage this is rarely noticeable; compression
  quality (below) matters more. If a hero ever looks soft on big screens, a
  2560×1440 version is the next step, at roughly twice the file size.

## Export settings (any editor)

- Codec **H.264**, container **.mp4**, pixel format **yuv420p** (8-bit).
- **No audio track.** The videos always play muted; an audio track is wasted
  download. (The current placeholders both have one.)
- **"Web optimised" / "Fast start" ON**: the file's index goes at the start,
  so the first frame shows before the whole file is downloaded.
- **Constant quality, not a fixed high bitrate**: CRF 23–28 (lower = better
  quality, bigger file). Start at 24.
- Keep loops **short** (5–15 s) and make the last frame flow into the first.
- Target size: **under ~5 MB** for a main visual, **under ~3 MB** for a content
  video.

## ffmpeg commands

Install: `winget install ffmpeg` (Windows), then open a new terminal.

**Main visual, desktop (1080p, no audio, fast start):**

```
ffmpeg -i source.mov -c:v libx264 -crf 24 -preset slow -vf "scale=-2:1080" -an -movflags +faststart -pix_fmt yuv420p aurore.mp4
```

**Main visual, mobile (portrait, 1080 wide):**

```
ffmpeg -i source-portrait.mov -c:v libx264 -crf 24 -preset slow -vf "scale=1080:-2" -an -movflags +faststart -pix_fmt yuv420p aurore-mobile.mp4
```

**`[slug]` content video (1600 wide):**

```
ffmpeg -i source.mov -c:v libx264 -crf 25 -preset slow -vf "scale=1600:-2" -an -movflags +faststart -pix_fmt yuv420p aurore-detail.mp4
```

**Poster = the video's first frame (main visuals only):**

```
ffmpeg -i aurore.mp4 -frames:v 1 -q:v 2 1.jpg
ffmpeg -i aurore-mobile.mp4 -frames:v 1 -q:v 2 1-mobile.jpg
```

The main visual's image is shown until the video has a frame, then the video
takes over on top of it. If the image *is* the first frame, that swap is
invisible; if not, it shows as a jump.

What the flags mean: `-crf 24` quality (18 = near lossless, 28 = smaller),
`-preset slow` better compression for the same quality (slower to encode),
`scale=-2:1080` 1080 px tall with the width rounded to an even number, `-an`
drop audio, `-movflags +faststart` index at the start, `-pix_fmt yuv420p` the
colour format every browser can decode.

## Where the files go

- Videos: `public/videos/projects/<slug>/` (served as-is; Astro doesn't
  process video).
- Posters (main visual): next to the project's other images, in
  `src/assets/images/projects/<slug>/`, as usual.
- `src/data/projets.json`:

```json
"main": {
  "desktop": "/images/projects/aurore/1.jpg",
  "mobile": "/images/projects/aurore/1-mobile.jpg",
  "video": {
    "desktop": "/videos/projects/aurore/aurore.mp4",
    "mobile": "/videos/projects/aurore/aurore-mobile.mp4"
  }
},
"images": [
  "/images/projects/aurore/2.jpg",
  { "desktop": "/videos/projects/aurore/aurore-detail.mp4" }
]
```

A content video can also be a plain path string (`"/videos/…/x.mp4"`); use
the `{ desktop, mobile }` form only when it has a portrait version.

## Checklist per video

- [ ] H.264 `.mp4`, no audio, fast start, yuv420p
- [ ] Right size for its use (table above), under the target file size
- [ ] Main visual: poster exported from the first frame (desktop + mobile)
- [ ] Loops cleanly
- [ ] Listed in `projets.json`, file in `public/videos/projects/<slug>/`
