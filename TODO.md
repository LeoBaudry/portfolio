# Roadmap

Ordered so that each step only builds on finished ones. Items marked
(Figma) wait on a mockup from Leo before any code.

## Next session (written 2026-09-24, for 2026-09-25)

A. **Hide the link preview on hover.** Hovering a project image/video shows
   the browser's own URL bubble bottom-left ("localhost:4321/projets/mirage")
   - Leo wants it gone. It's the browser's status bar for any `<a href>`; no
   CSS/JS setting hides it while the href is there. Options to decide:
   (1) drop the `href` from the image links and navigate in JS (Astro's
   `navigate()`), keeping `role="link"` + `tabindex="0"` + Enter handling -
   loses middle-click / "open in new tab" / right-click link menu, and the
   morph code finds sources by `[href="/projets/<slug>"]` (project-morph.ts
   allCopiesOf, targetLink) so it must switch to a `data-href`/`data-slug`;
   (2) keep the href on the text/title only and make the image a JS target;
   (3) keep it. Check SEO: crawlers still need real links somewhere (e.g. the
   titles, or a hidden list).
B. **Reel cursor ring animates out on click.** The ring following the
   cursor on the homepage reel (`.reel-cursor`, progress to next project =
   `strokeDashoffset`, projects-reel.ts setRingProgress) just stays when a
   project is clicked. Make it "unravel" (stroke unwinds back to 0, maybe
   shrinks) as part of the reel leave hook (registerMorphLeaveHook in
   projects-reel.ts). Its show/hide is also a CSS opacity fade
   (`.reel-cursor.is-active`) - move that to the same unravel/wind-up so no
   opacity is left in the reel.
C. **Reel cursor on mobile.** No cursor there, so it's pinned bottom-right
   (`.is-fixed-position`) right on top of the "1 / 5" counter. Make it read
   clearly on touch: e.g. merge it with the counter (ring around it, or a
   progress line under "1 / 5"), or move it (bottom-centre / top-right). Plus
   the same animate-out on click as B.
D. **Remove reel mode B** (Leo, 2026-09-24: "we'll remove B later on").
   `MODE_RIDEAU` in projects-reel.ts: A = triggered bar transitions (used,
   and everything recent - text masks, click exit, videos - is built on it),
   B = scroll-scrubbed bars (unused). Delete the flag, `buildTransition`,
   the `transitions` array and the B branches in the scroll handler/reset
   (~50 lines). Leave the separate hero-recede A/B flag (~line 47) alone
   unless Leo decides on it too.

## Phase 1 — Media foundation (no design input needed)

0. [x] **Site-entry loader.** Done 2026-09-23: logo strokes slide into
   their masks (CSS), count + bottom line + grid lines follow real progress
   (site-loader-inline.js), background turns orange at 100, exits column by
   column along the reel grid. Plays on every hard load; a cached refresh is
   naturally fast. Dev preview: `?loader-sim=6`.
0b. [x] **Favicon set.** Done 2026-09-24, generated from `src/assets/logo.svg`
   with sharp: adaptive transparent `favicon.svg` (ink / paper in dark mode),
   ink transparent `favicon.ico` (16+32), ink-tile + paper-logo
   apple-touch-icon + android-chrome 192/512, `site.webmanifest`, head links.
0c. [x] **/projets: no opacity transitions between views.** Done 2026-09-24,
   confirmed by Leo: fadePanel removed. Vue 1/2 <-> vue 3 now use
   vue 3's own technique: an ink `.view-curtain` per item animated with
   transform scaleY (origin flipped bottom/top), NOT clip-path (first try
   used clip-path on the images - laggy, repaints every frame). Leaving:
   text sinks, then curtains close upward (vue 2 left to right). Arriving:
   curtains open upward, text rises last. See hide/showCarouselView,
   hide/showDezoomView in projets-page.ts. View switch ignored mid
   carousel step. Entering vue 3 (switch, reload, back from a project)
   reveals every row with any part on screen (onScreenListeRows), not just
   those >= 40% - the 40% rule is only for rows scrolled into view.
1. [x] **Main visual + mobile variant.** Each project gets a `main` visual
   (desktop + optional mobile version) separate from its gallery `images`.
   The main visual is what shows in the homepage reel, /projets vue 1 and 2,
   the first image of vue 3 rows, and the [slug] hero. The mobile version is
   served when the screen is portrait (taller than wide); projects without one
   keep the desktop file everywhere.
2. [x] **Videos in [slug] content.** Done 2026-09-24 (Leo to check in
   browser). An `images` entry in projets.json can be a video: a path ending
   in .mp4/.webm, or `{ "desktop": "...mp4", "mobile": "...mp4" }` (mobile
   served when portrait, like `main`). Files go in `public/`.
   `ProjectMedia.astro` renders ProjectImage or a muted/looping/playsinline
   `<video preload="none">` whose box ratio is read from the MP4 header at
   build time (no layout jump). project-page.ts loads it ahead of view,
   reveals it with the same mask as images once it has a frame, plays it only
   while on screen; reduced motion = first frame, no autoplay. Vue 3 thumbs
   skip videos (thumbsOf in projets.astro). Test data: Aurore's first
   content item = placeholder-video-1 (desktop) / -2 (mobile).
   Later, if needed: playable/focusable videos with controls (Leo: "we'll
   see").
3. [~] **Video as main visual.** Built 2026-09-24, Leo testing. Test data:
   Aurore's `main.video` (placeholder videos). How to export real videos
   (format, sizes, ffmpeg, first-frame posters): `docs/video-export.md`.
   - Data: `main` gets an optional `video: { desktop, mobile? }`; its images
     stay and are the poster (real posters = the video's FIRST FRAME, or the
     poster -> video swap shows).
   - `MainVisual.astro`: ProjectImage + `<video data-main-video>` layered
     exactly over it, shown once it has a frame (`visibility: inherit`,
     never `visible` - a visible child leaks through vue 1's / the reel's
     hidden stacked items). Muted via the property too (the attribute alone
     plays with sound after a client-side navigation).
   - Playing (`main-video.ts`): "shown" is judged on the video's <img> (not
     the video - hidden until its first frame; not the parent -
     .morph-link is display:contents). Vue 1 / reel toggle visibility, so
     projets-page.ts (carousel steps) and projects-reel.ts
     (MutationObserver on project styles) call refreshMainVideos().
   - Scroll freeze fix (measured: long frames, no script, as a video
     (re)started): warmUpVideos() STARTS every shown video ~1.2s after a
     page/view settles (one per idle period), and a warm video keeps
     playing off screen while shown; paused only when hidden. Reverses
     "pause when out of view" - pending the stress test; revert = drop the
     `warm` flag. Applies to [slug] content videos too: every muted loop
     carries `data-loop-video` (playback), main visuals also
     `data-main-video` (morphs). Refreshes batched to one per frame. The
     approach preloader (starts downloads ~1 screen ahead) must stay: it
     covers the window before the warm-up reaches a video - removing it
     brought the first-load freeze back.
   - Reveals wait for the video's first frame (whenVideoReady, 1s cap):
     vue 2 cards (openDezoomMask / revealDezoomCard), view curtains, vue 3
     curtains. Not vue 1's wheel step.
   - Morphs fly the <img> clone plus the PLAYING video itself: liftVideo
     moves the real <video> (same task = not paused) into
     #morph-video-host (Layout, transition:persist, z just above the
     clone); landVideo drops it into the destination slot. Vue 1 <-> 2:
     the entering view's copy is swapped into the leaving slot.
   - Vue 2 clip-path masks are on `.dezoom-image` (not the img) so the
     video is masked too. /projets view switches unlock once the new view
     is in place; reveal tails play on in the background.

## Phase 2 — Site-wide structure

4. [moved] Light/dark mode -> end of Phase 4 (Leo, 2026-09-24: "the kind
   of thing to do in the very end"). Its prerequisite, role-named colour
   tokens (background / text / line / curtain instead of ink / paper), can
   still be done any time as a quick session so the menu and transition
   screen are built on them.
5. [ ] **Menu.** Always-hamburger pill, centred, glass effect (dark/light,
   slight transparency). Top-centre on the homepage, animates to bottom-centre
   on other pages. On /projets the vue 1/2/3 buttons rise out of it (mask)
   and slide right. On [slug] it splits: `← PROJETS` bottom-left, menu icon
   bottom-right. Replaces today's temp-nav / view-switcher / project-back, so
   the morph code's chrome hide/reveal hooks must move to it.
6. [ ] **Page transition redesign.** Brand colour + logo centred instead of
   the plain black wipe.
7. [ ] **FR/EN.** Astro i18n routing, language picked from the browser
   language (not region) on first visit, plus a manual switch. Texts written
   by Leo in both languages rather than machine-translated.

## Phase 3 — Content layouts (Figma)

8. [ ] Homepage: layout of the two text sections. (Figma)
9. [ ] [slug] page: title, description, alignment, how images/videos are
   laid out. (Figma)
10. [ ] About page. (Figma)

## Phase 4 — Polish

11. [ ] Interactive footer (ASCII / dithered idea). Not a priority.
12. [ ] **Light/dark mode** (moved from item 4). Open questions, asked
   2026-09-24, unanswered: OS setting only or + manual switch (in the
   menu)? Loader stays dark or follows the theme? Light palette = straight
   paper/ink swap or Leo's own values?

## Before launch — test once the site is finished and online

- [ ] **Video stress test:** give EVERY project a main video (placeholders
  are fine), rebuild (`npm run build` + `npm run preview`, not dev), check
  scroll freezes, CPU/battery with many warm videos playing off screen
  (main-video.ts warm-up), mobile. Decide then whether to keep "play off
  screen once warm" or cap it. Also watch vue 2's clip-path masks (reveal /
  morph-sibling crop on `.dezoom-image`), which now clip playing videos -
  clip-path repaints every frame; move them to curtains if they stutter.

- [ ] **Delete placeholder videos** `public/placeholder-video-1.mp4` /
  `-2.mp4` and remove/replace Aurore's `main.video` in projets.json.

- [ ] **Favicons / icons.** Only testable for real on the deployed site
  (browsers cache icons hard - use a private window):
  - `favicon.svg` in Chrome/Firefox/Edge tabs, with the OS in light AND dark
    mode (ink logo / paper logo).
  - `favicon.ico` (ink) in Safari and any older browser that ignores the SVG.
  - iPhone: Share > Add to Home Screen -> `apple-touch-icon.png` looks sharp,
    margins OK.
  - Android: Chrome > Add to Home screen / Install -> icon (192), splash
    screen (512 + ink background), label from `site.webmanifest` (check the
    name "Léo Baudry"), ink status bar.
  - Regenerate script: logo -> all icons with sharp (ask Claude to redo it if
    `src/assets/logo.svg` changes).

---

# TODO / Known issues — /projets page

`src/pages/projets.astro` and `src/scripts/projets-page.ts` hold the current
three-view (carousel / dezoom / liste) implementation with a working
vue1<->vue2 morph transition. Vue 3 (liste) is done, no changes needed there.

Previous items 1-4 (sibling text caught in image mask, ~5% image left
hidden after reveal, entering choreography sequencing/easing, leaving
choreography's extra siblings'-text phase) are done - fixed in
`morphBetweenCarouselAndDezoom()` / `initDezoomObserver()`.

Vue 3 (liste) now has its own enter/leave transition (row stagger, distinct
from the vue1<->vue2 morph and from the page wipe) - see transitionListe()
in projets-page.ts.

/projets/[slug].astro added: individual project pages, reached from any of
the 3 views via a morph transition (clicked image grows into the page's
hero) - see src/scripts/project-morph.ts.

## 2026-09-22 session — chrome masking, vue3 perf, dezoom centering

Fixed this session, all still need a real-browser confirm (see "Next
session" below):

- Vue1's info text wasn't animating out when opening a project (it worked
  fine for the vue1<->vue2 view switch). Root cause: vue1's carousel image
  is already full-bleed, so project-morph.ts's floating clone appeared
  already at ~its final size/position - it covered the whole screen the
  instant it became visible, before the leave-out animations (which ran
  concurrently, not before) had a chance to actually play or be seen.
- Same root cause explained `#temp-nav` and `.view-switcher` (bottom-right
  icons) popping away instantly instead of animating - nothing was ever
  animating them at all, they just happened to be covered by the clone.
  project-morph.ts's event.loader is now sequenced so all of the leave
  animations (info text, temp-nav, view-switcher/project-back) actually
  play - visible, on the real outgoing page - *before* the clone is ever
  shown/covers anything. temp-nav and view-switcher/project-back now slide
  off toward their nearest viewport edge (same eases as
  hideInfoParts/revealInfoParts) instead of just vanishing on swap, and
  slide back in once the morph settles on the other side - see
  hideChromeEl/revealChromeEl in project-morph.ts.
- Vue3 (liste) leaving was genuinely laggy, not just slow-feeling: each row
  was animating up to 4 separate `<img>` clip-paths at once (clip-path
  forces a repaint per animated element per frame), so several visible rows
  staggering at the same time meant a dozen-plus concurrent repaints.
  hideListeRow/showListeRow now animate the row's single `.liste-images`
  wrapper instead of each image - same visual result (the images sit flush
  against it with no gap), a fraction of the animation count.
- Dezoom card centering before its morph: implemented via a new
  registerMorphCenterHook in project-morph.ts, called before the source
  rect is captured - projets-page.ts's handleMorphCenter recenters a
  clicked dezoom card (if it wasn't already centered) and corrects
  `current`/sessionStorage to the card that was actually clicked (previously
  whatever currentFromDezoom() guessed from the scroll position *before*
  the click, which could be a different, more-centered card).

## 2026-09-22 session, round 2 - chrome mask technique + curtain-based vue3

User feedback on the round 1 fixes above, addressed:

- `.project-back` was flashing fully visible on arriving at a project page,
  then getting covered by the still-mid-flight clone, then popping visible
  again at settle - because it's freshly mounted on the incoming page (not
  persisted like `#temp-nav`), so it started fully visible with nothing
  hiding it first. Fixed with `snapChromeHidden()` in project-morph.ts -
  snaps it to its hidden position the instant the swap happens, before
  anything can paint. Same latent bug existed for `.view-switcher` on the
  backward arrival at /projets; fixed the same way.
- The round 1 chrome hide/reveal (`#temp-nav`, `.view-switcher`,
  `.project-back`) just translated the whole element toward the nearest
  viewport edge - it animated, but didn't read as "mask" the way the rest
  of the site does (info text sinking under a fixed overflow:hidden
  boundary). Reworked to match exactly: each now has its own dedicated
  overflow:hidden mask ancestor (`#temp-nav` itself, `.view-switcher`
  itself, new `.project-back-mask`) sized to fit it, and what animates is
  an inner element sliding down by its own height, swallowed by the mask's
  bottom edge - same technique, same eases, as
  hideInfoParts/revealInfoParts. Required a small markup split in
  Layout.astro / projets.astro / [slug].astro (see `.temp-nav-inner`,
  `.view-switcher-inner`, `.project-back-mask`).
- Vue3 (liste) was still laggy after round 1's "1 clip-path per row instead
  of 4" fix - user correctly suspected clip-path itself, not just the
  count: it forces a repaint of the image's own pixels every frame, and
  isn't compositor-only work the way a transform is, unlike most other
  animations on this page. Replaced entirely with two solid
  `var(--color-ink)` curtain divs per row (`.liste-images-curtain-top/
  -bottom`, in projets.astro) animating only `transform: scaleY()` -
  fully GPU/compositor-driven, same visual crop (verified the scaleY math
  reproduces the exact original clip-path crop, not an approximation) and
  identical timing. See hideListeRow/showListeRow's comment in
  projets-page.ts for the derivation.

Live-tested this round via a Chrome tab: confirmed via instrumented
`astro:after-swap` logging that `.project-back`/`.view-switcher-inner`
start already-hidden (non-zero translateY) at the very moment they're
mounted, not visible-then-hidden; confirmed both settle back to identity
transform; confirmed vue3 renders and transitions with no visible artifacts
and no new console errors (only the same known
`document.hidden`-related `InvalidStateError` from the flaky automation
tab, not a real bug - see feedback_browser_test_tooling_flaky).

## 2026-09-22 session, round 3 - user feedback on round 2

- Vue3 leaving: a thin white line was showing right under each row's image
  band - the row's own `border-bottom` (a faint near-white line, always
  there, normally hidden by the photo's own visual noise) became visible
  once the curtain covering it was solid ink, and a curtain flush with the
  image's exact box (`inset: 0`) left a sub-pixel rounding gap right at
  that edge. Fixed by overshooting the curtain 2px past the image band on
  every edge (`top/bottom: -2px` instead of `inset: 0`) - invisible against
  the photo itself, plugs the gap.
- `.view-switcher`'s mask didn't fully cover, and only the icons were
  masked, not the panel+background as a unit - both from the same
  structural mistake: `.view-switcher` was simultaneously the mask
  (overflow:hidden) *and* had its own padding, while a separate
  `.view-switcher-inner` (just the icons) was what actually translated -
  so translating by the icons' own height left a padding-sized sliver
  uncovered, and the background panel never moved at all. Restructured:
  new `.view-switcher-mask` (fixed, overflow:hidden, no padding/size of its
  own) wraps `.view-switcher` (now just the panel - background, padding,
  radius, buttons, unchanged from before this whole feature started), and
  `.view-switcher` itself is what project-morph.ts translates - whole
  panel moves as one piece, and since the mask has no extra padding its
  height matches the panel's exactly, so a full-height translate clears it
  completely. Verified via `getBoundingClientRect()`: mask and panel rects
  are now identical.
- Vue3 -> project page and back looked harsh compared to a normal vue1/2
  -> vue3 switch - because it was structurally different: on this return
  path, every row was set instantly fully open on page load except the
  current row's *text* (images always popped instantly, no defer at all),
  whereas a normal switch runs the full staggered showListeRows() reveal.
  Fixed by making the backward-restore path structurally match a normal
  entrance: applyRestoredView now closes *every* row (not just leaves the
  current one deferred), and revealAfterMorphSettle calls showListeRows()
  itself once the clone settles - same staggered curtain-grow-open + text
  reveal, same function, as switching into vue3 normally. Confirmed live
  via an astro:page-load listener that rows are genuinely in the closed
  (scaleY(1)) state right after restore, before the deferred reveal runs -
  not just reaching the same end state by a different (instant) path.

## 2026-09-22 session, round 4 - vue3 leaving looked broken, wrong scroll

User report: leaving vue3 (liste) for a project page "looked very bad,
nothing fits, shows halfway scroll through", and once landed, all the
project's extra images popped in at once instead of one at a time on
scroll - the ask was "going to a new project page should always be at the
top of it".

Root cause: `lenis` in smooth-scroll.ts is a single instance that lives for
the *entire session* (module scope, never torn down between page
navigations) and its raf loop never stops running on its own. The existing
`window.scrollTo(0, 0)` reset on swap moved the real scroll position, but
not Lenis's own remembered target - so a couple of frames later Lenis would
smoothly "correct" the page back toward wherever it used to be scrolled
(e.g. deep in the liste), which is exactly what read as "halfway scroll
through" while leaving, and as several `.project-extra` blocks landing
already in view (triggering their IntersectionObserver reveals all at once)
instead of the page genuinely sitting at the top.

Fixed with a new `resetPageScroll()` in smooth-scroll.ts (Lenis-aware:
`lenis.scrollTo(0, {immediate:true, force:true})` when Lenis exists, a raw
`window.scrollTo(0,0)` otherwise), used by both page-transitions.ts and
project-morph.ts instead of the raw call. Also `pageLenis.stop()`/`start()`
now bracket the whole morph transition in project-morph.ts (stopped when a
morph nav starts, so Lenis can't keep drifting the still-visible outgoing
page during the leave animations either; restarted once forward lands on a
project page, or immediately if the transition gets aborted mid-flight -
backward intentionally leaves the restart to projets-page.ts's own
view-specific pageLenis start()/stop(), which already existed).

That stop() surfaced a real, easy-to-miss bug of its own: liste's own
`scrollListeToCurrent()` calls `pageLenis.scrollTo(target, {immediate:true})`
*without* `force: true` - Lenis silently no-ops a scrollTo while stopped
unless forced, and this now runs while project-morph.ts has just stopped
it (it only restarts pageLenis for liste a few lines later in the same
init function) - so a backward-morph restore into liste was quietly
landing at the top instead of the actual saved row. Fixed by adding
`force: true` there too. Lesson: adding a `.stop()` anywhere in a codebase
with a session-long singleton like this Lenis instance means auditing
*every* existing `scrollTo` call against that instance, not just the new
code path - `force: true` is easy to forget on the ones that already
"worked" only because the instance happened to always be running before.

Confirmed live in Chrome: scrolled deep into liste, clicked a row, landed
scrollY:0 on the project page and it stayed 0 (no drift), then confirmed
going back restored the actual clicked row (not the top) with the fix.

## 2026-09-22 session, round 5 - "nothing changed" + missing content below hero

Two real, separate bugs found after the user reported round 4's backward
(project page -> vue3) fix hadn't changed anything, and separately asked
whether missing content below a project's hero image was normal (it
wasn't):

- **Project pages: every image below the hero was permanently stuck
  unloaded.** `.project-extra img` had `loading="lazy"`, but
  `initProjectPage` (project-page.ts) sets every one of those images'
  `clip-path` to fully hidden (`inset(100% 0 0 0)`) the instant it runs -
  combined with no explicit width/height (so `height: auto` collapses to
  0px before the image has loaded and its aspect ratio is known), this
  left the browser's native lazy-load distance heuristic with nothing to
  ever trigger on: 0 visible area, 0 layout height, nothing "getting
  close". Confirmed live (`img.complete`/`naturalWidth` stayed 0/false
  indefinitely, even scrolled to the very bottom of the page - setting
  `img.loading = 'eager'` on one made it load in under a second). Fixed by
  dropping `loading="lazy"` - the custom IntersectionObserver reveal
  already staggers *when* each image animates in, native lazy-load was
  redundant and, combined with the clip-path, actively broken. Doing this
  properly (keep lazy loading, give images real dimensions so they don't
  collapse) needs actual width/height data this project doesn't have yet -
  see the old "images selon width : picture d'astro" note below, still
  open.
- **Round 4's liste-restore fix was wrong: closing every row (not just the
  current one) during the backward morph left the whole page solid ink for
  the ~0.8s the clone takes to shrink back**, which is why the user saw no
  improvement - a closed row and "nothing rendered" look identical since
  the curtain color matches the page background. The actual clone only
  ever targets a row's *first* image (see allCopiesOf's comment in
  project-morph.ts) - every other image, in every row including the
  current one, was never covered by anything and never needed hiding.
  Reverted applyRestoredView's liste branch and revealAfterMorphSettle back
  to the pre-round-3 shape: only the current row's *text* defers/reveals
  (exactly matching how dezoom only ever defers its current item + visible
  siblings, never the whole view), every row's images stay open/visible
  the whole time. Confirmed live via a page-load listener that rows are
  open (not closed) immediately after restore now.
- Also restarted the dev server mid-session (`astro dev stop` + `astro dev
  --background`) per [[feedback_browser_test_tooling_flaky]] - big rewrite,
  wanted to rule out stale HMR state before concluding "nothing changed"
  meant the code itself was wrong.

## 2026-09-22 session, round 6 - unified scroll-reveal for vue3 rows

User asked for: (1) liste rows revealing in sequence (bottom-to-top mask)
during the backward morph instead of popping in all at once, and (2) rows
animating in the same way the *first* time they're scrolled to during
normal vertical scrolling, not just during transitions. Implemented both
with one mechanism instead of two:

- New `initListeRevealObserver()` in projets-page.ts: a single
  IntersectionObserver, set up once and left running for the page's
  lifetime, that reveals any not-yet-`revealed` row (via the existing
  `showListeRow`) the moment it's scrolled into view - whether that
  scrolling happens during a transition (the clone still mid-flight) or
  from a user just scrolling down normally, long after any transition
  ended.
- `dataset.revealed` (set in `setListeRowOpenInstant`/`showListeRow`,
  cleared in `setListeRowClosedInstant`/`hideListeRow`) is what the
  observer checks before acting, and it resets whenever a row is hidden
  again - so re-entering liste later replays the reveal, same as dezoom
  already does, matching "first time" to mean "first time this visit",
  not "once ever in the session".
- `applyRestoredView`'s liste branch and `transitionListe`'s
  entering-liste branch got much simpler as a result: they only need to
  handle the *current* row specially (instantly open, since the clone
  covers its first image - see round 5's note) or the *currently-visible*
  rows (still get the nice staggered showListeRows() call on a normal
  switch) - every other row is just left closed and the persistent
  observer picks it up whenever the user actually gets there. `showListeRow`
  itself is unchanged.
- Also fixed a related bug this surfaced: `hideListeRows`/`showListeRows`'s
  old "instantly force offscreen rows to the target state" behavior could
  strand an already-revealed row (closed it, but revealed stayed true, so
  the observer would then refuse to ever reopen it - see setListeRowClosedInstant's
  comment). Now offscreen rows are only touched if they're not yet revealed
  (nothing to do) or already revealed (left alone, correct either way).

**Real bug found and fixed via this round's testing, not by design:** a
`let listeRevealObserver` was declared *after* the line that first called
`initListeRevealObserver()` (which reads it) - `let`/`const` are in their
temporal dead zone until their own declaration line runs, unlike a
`function` declaration, so this threw `ReferenceError: Cannot access
'listeRevealObserver' before initialization` on **every single page
load**, silently aborting the rest of `initProjetsPage()` - meaning
`registerMorphLeaveHook`/`registerMorphCenterHook` and everything after
the crash point never ran. This is what actually caused the confusing,
inconsistent test results this round (view switches "not sticking",
sessionStorage reads/writes seemingly not happening, backward restores
landing on the wrong view) - not real transition bugs, just an uncaught
exception wiping out half of every page's setup. Fixed by moving the
declaration above its first use. `astro check` does not catch this kind
of runtime-only TDZ ordering issue - only live testing did.

**Still open, not resolved this round:** a white line reported appearing
"a few px above the large 1st project image" shortly after starting to
leave an individual project page (before the swap to vue3). Investigated
extensively (zoomed screenshots at various points via an artificially
slowed-down transition, computed-style audits of every element near the
hero's top edge, background-color checks) without finding a structural
cause or reproducing it live - every audited element in that region is
ink-colored with no border, and the "few px" symptom didn't show up in
any capture. Best-effort hypothesis if it resurfaces: `body`'s own
background is `--color-paper` (near-white, see global.css) and is the
only near-white candidate anywhere in the page, so if this is still
happening, look for a sub-pixel gap that exposes body's background
somewhere in the leave sequence - but this needs a live browser
(ideally the user describing/recording it) to actually pin down, the
automation tab's `document.hidden`-while-testing behavior makes catching
a specific animation frame very unreliable (see
feedback_browser_test_tooling_flaky.md).

## 2026-09-22 session, round 7 - per-image stagger, real mask fix, pacing

More user feedback on vue3 <-> [slug] and the scroll-reveal:

- `.liste-row .item-info` was missing `overflow: hidden` - the ONE masked
  text on the site without it (`.carousel-info`, `.dezoom-item .item-info`
  all have it). Without it, hideInfoParts/revealInfoParts's translateY had
  nothing to clip against, so the "hidden" state was just the title sitting
  there in plain view, shifted down ("appears instant, and too low") -
  explains "you went the easy way, it just slides" too. Added the missing
  `overflow: hidden` in projets.astro.
- Only the *clicked* row ever animated on leaving vue3 for a project page;
  every other visible row's text/images just vanished with the page swap.
  `handleMorphLeave`'s liste-row branch now calls the same `hideListeRows()`
  used when leaving liste via the view switcher, so every visible row
  closes together.
- The clicked row's images were popping open instantly on the way back
  (`setListeRowOpenInstant`), not doing the real reveal. Split
  `showListeRow` into `revealListeRowImages` + text, so the current row's
  images can reveal properly (concurrent with the clone, same as any other
  row) while its *text* alone still waits for the clone to settle
  (`hideCurrentInfoInstant` -> revealed in `revealAfterMorphSettle`) -
  matches "title should only animate after the image is done", since with
  the mask fix above the wait is now actually invisible instead of showing
  text sitting in the wrong spot.
- The 4 images in a row were one shared curtain pair (a round 1/2 perf
  consolidation, back when this was clip-path-based and every extra
  animated element was expensive) - now `transform`-only, so cost isn't
  the concern it was. Restructured to a curtain pair *per image*
  (`.liste-image` wrapping each `<img>`, in projets.astro) and gave each a
  100ms stagger behind the previous one (`LISTE_IMAGE_STAGGER` in
  projets-page.ts) - the "in line, slightly delayed compared to each
  other" ask.
- Scroll-reveal threshold raised 0.15 -> 0.4 (`initListeRevealObserver`) -
  rows are tall, and revealing at only 15% visible meant most of the row
  (and the reveal animation) was still below the fold when it played,
  reading as underwhelming rather than as a real "it opens" moment.
- Pacing bumped modestly (project-morph.ts): `MORPH_DURATION` 0.8 -> 0.95,
  `CHROME_HIDE_DURATION` 0.32 -> 0.38, `CHROME_REVEAL_DURATION` 0.38 ->
  0.45.

Verified with a single, minimal live check this round (navigate, switch to
liste, screenshot, check console) rather than the exhaustive multi-step
testing of previous rounds - the user asked to cut back on
claude-in-chrome usage given the token cost, so the rest of this round
relies on code review + `astro check` (0 errors) rather than an end-to-end
click-through. Worth the user's own pass, more than previous rounds.

**Still open:** the white line above the project hero on leaving (see
round 6's note - unreproduced, no structural cause found).

## 2026-09-22 session, round 8 - the real "nonsense" bug + full choreography

Round 7's `handleMorphLeave` change (call `hideListeRows()` for every visible
row, including the clicked one) was a real regression: it closed the
clicked row's *first* image - the exact image the morph clone is supposed
to grow from - via its own curtain, before the clone ever became visible.
So the sequence read as "image vanishes, then a new image pops in from
nowhere and morphs" instead of one continuous photo growing into the hero.
Confirmed live this round that the fix holds: the clicked row's first image
now stays fully visible throughout, untouched by any curtain.

Full requested choreography for vue3 -> [slug] via `handleListeRowMorphLeave`
(new, in projets-page.ts) - clicked row's title first (small nudge +
curtain, not a full slide) -> every other visible row's title right behind
it -> *then* images close, skipping only the clicked row's first:

- Image curtains (and the new title curtain) simplified from two
  (top-anchored + bottom-anchored, meeting in the middle) to one per
  element, with `transform-origin` flipped in JS right before each
  animation - reveal is top-anchored shrinking to 0 (bottom-to-top,
  unchanged, already praised as "perfect"), hide is now bottom-anchored
  growing to 1 (also bottom-to-top, replacing the old symmetric
  meet-in-the-middle close) - matches the explicit "mask disappearance
  bottom to top" request for both directions.
- New `.liste-title-curtain` (projets.astro) gives titles the same
  curtain-based masking as images, instead of the old full-height
  translateY slide - fixes "you went the easy way, it just slides" for
  real this time, plus a small `LISTE_TITLE_NUDGE_PX` (10px) secondary
  motion per "without moving too much, just going down a little bit".
- Backward restore's current-row title-defer (`hideCurrentInfoInstant`/
  `revealAfterMorphSettle`) now uses `setListeTitleClosedInstant`/
  `revealListeTitle` (the curtain) instead of the old generic
  translateY-based helpers.
- `handleMorphCenter` extended to liste rows: clicking a project row now
  auto-scrolls (`alignListeRowToBottom`) so that row's image band lines up
  with the viewport's bottom edge before the morph starts, same mechanism
  already used for dezoom card centering. Untouched: what "except the
  first one" in the request meant exactly wasn't fully clear - implemented
  as a plain align-to-bottom-if-needed with no special-casing for row 0;
  worth confirming this matches intent.
- Deliberately did NOT touch reveal-text.ts/RevealText - the destination
  [slug] page's own intro text uses GSAP ScrollTrigger with `start: 'top
  85%'`, which should already fire close to immediately once the page
  loads (the text is at the top, already "in view"), concurrent with the
  clone's own continued travel to the hero position after the swap - this
  is very likely already happening as asked ("text starts appearing while
  only the 1st image is still on screen"), just not independently verified
  this round.

**A second TDZ bug** (same class as round 6's, see
[[feedback_lenis_singleton_stop_force]]-style lesson but for ordering, not
force): `LISTE_IMAGE_STAGGER`/`LISTE_TITLE_NUDGE_PX` were declared *after*
the "close every row" init step that (transitively) reads them, throwing
`ReferenceError` on every page load again. Moved both constants above
`const listeRows = ...`. Caught this one via live testing before reporting
done - `astro check` does not catch it.

Per the user's request this round, live verification was intentionally
kept to the minimum needed to confirm the core regression was actually
fixed (not the full multi-phase choreography timing, which needs a human's
eyes/judgment anyway) - see
[[feedback_minimize_browser_automation_tokens]]. Worth the user's own full
pass on: title-then-titles-then-images pacing, the small title nudge
amount, and the new bottom-to-top hide direction actually reading as
intended.

## Next session - real-browser confirm

Still true from round 1, now covering rounds 2 through 6's changes too:
nothing here has been judged for *smoothness/timing* by a human in a real
foreground tab. First thing next time:
- Click through all 3 views' forward+backward morph and confirm the
  chrome (temp-nav, view-switcher, project-back) now reads as sinking
  under a mask, not sliding, and that view-switcher's whole panel moves
  together (not just the icons) with full coverage.
- Confirm vue3's leaving/entering curtains genuinely feel less laggy, and
  that the white-line-under-each-row artifact is actually gone (not just
  structurally patched).
- Confirm vue3 -> project page -> back now feels like a normal vue3
  entrance (staggered reveal), not a harsh instant pop.
- Clicking an off-center dezoom card recenters it before morphing, and
  `current` survives correctly (back button lands on the right card).

Scroll lock during the morph transition - `toggleScrollLock(true)` fires on
every morph nav in project-morph.ts and intercepts wheel/touchmove/keydown
at the window level with `capture: true`, ahead of Lenis entirely - reading
the code, this should already hold regardless of Lenis's own state, but
still worth a real scroll-during-morph check since it's never been
confirmed live.
