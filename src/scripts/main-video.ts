// Muted looping videos: main visuals (MainVisual.astro, layered over the
// project's main image, which stays the thing every morph measures and
// flies) and [slug] content videos (ProjectMedia.astro). A main-visual
// video is shown only once it has a frame, so the image stands in while it
// loads.
//
// When they play: only while shown (its view active, its vue 1 / reel
// project current - those hide with visibility, invisible to an
// IntersectionObserver, so projets-page.ts / projects-reel.ts call
// refreshMainVideos() on change) AND on screen. Then:
// - homepage reel, vue 1, [slug]: the MAX_PLAYING nearest the viewport's
//   centre (the reel and vue 1 only ever show one project anyway);
// - vue 2 / vue 3 (many projects on screen): only the current one, nearest
//   the middle, following the scroll (isCurrentOnly / playingSet).
// Everything else is paused - nothing decodes off screen.
// Starting playback sets up the decoder, which can cost a few long frames
// (measured: no script, right as a video started). So the first start
// happens where nobody sees it: every masked reveal (view curtains, vue 2
// cards, vue 3 rows) waits on whenVideoReady, which starts the video and
// waits for its first played frame while the mask is still closed.
//
// Morphs (main visuals only): the playing video itself flies (liftVideo ->
// landVideo). It's moved into a fixed "flight host" (#morph-video-host,
// Layout.astro) that is animated with the morph clone, then dropped into
// the destination's slot in place of that video. A media element moved
// within one task keeps playing, so the picture never stops - across a page
// swap too, since the host is transition:persist.

// Every muted loop (playback) / main visuals only (morphs, poster lookup).
const LOOP_SELECTOR = 'video[data-loop-video]';
const MAIN_SELECTOR = 'video[data-main-video]';

const VIDEO_READY_TIMEOUT = 1000;
// After the first 'playing' event, how long to wait for a frame to actually
// reach the screen (requestVideoFrameCallback) before giving up on it.
const FIRST_FRAME_TIMEOUT = 150;

let observer: IntersectionObserver | null = null;
// Several steps so the observer reports again as a video moves through the
// viewport - the ranking below (closest to the centre) is redone each time.
const PLAY_THRESHOLDS = [0, 0.25, 0.5, 0.75, 1];
// At most this many play at once, the ones nearest the viewport's centre
// (vue 3 fits 3-5 rows on screen: all of them playing lagged).
const MAX_PLAYING = 3;
// Starts a video's download about one screen before it's reached, so the
// data is there before it has to play. Removing it as "redundant" brought
// the first-load freeze back.
let preloader: IntersectionObserver | null = null;
const PRELOAD_MARGIN = '100%';
const onScreen = new Set<HTMLVideoElement>();
let refreshQueued = false;

const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');

// Shared with project-page.ts (content videos load just ahead of view).
export function startLoading(video: HTMLVideoElement): void {
  // Property, not just the attribute: after a client-side navigation the
  // attribute alone leaves it playing with sound.
  video.muted = true;
  // Raising preload from 'none' resumes the download on its own. No load()
  // after it: that restarted the element and cancelled the request just
  // made (DevTools: every video "(canceled)" once, initiator this line).
  if (video.preload === 'none') video.preload = 'auto';
}

// The image a main-visual video sits on (ProjectImage: <img> or
// <picture><img>). Null for a content video.
function posterOf(video: HTMLVideoElement): HTMLImageElement | null {
  const prev = video.previousElementSibling;
  if (prev instanceof HTMLImageElement) return prev;
  return prev instanceof HTMLPictureElement ? prev.querySelector('img') : null;
}

// Judged on the image, never the video itself: the video is
// visibility:hidden until it has a frame, so checking it would mean it never
// plays. (Not the parent either - .morph-link is display:contents, which
// checkVisibility always reports as not visible.) The image is hidden
// exactly when the video should be: inactive panel, non-current vue 1 item,
// mid-morph. A content video has no image and is always "shown".
function isShown(video: HTMLVideoElement): boolean {
  const poster = posterOf(video);
  return poster?.checkVisibility?.({ visibilityProperty: true } as CheckVisibilityOptions) ?? true;
}

// Vue 2 / vue 3 (panels marked data-video-play="current", projets.astro):
// many projects on screen at once, so only the "current" one plays - the
// one nearest the middle of the screen, same rule with a mouse or on touch.
// The middle, except that a scroller can't go past its ends, so the first
// and last projects could never reach it and never played. The point
// slides from the middle to the start edge over the first half-screen of
// scroll, and to the end edge over the last - on each axis that scrolls:
// vertically the page (vue 3), horizontally the panel itself (vue 2
// scrolls sideways inside its own fixed panel, not the page).
function slidingLine(scroll: number, max: number, size: number, start: number): number {
  if (max <= 0) return start + size / 2;
  if (max < size) return start + size * (scroll / max);
  if (scroll < size / 2) return start + scroll;
  if (max - scroll < size / 2) return start + size - (max - scroll);
  return start + size / 2;
}

function currentPoint(video: HTMLVideoElement): { x: number; y: number } {
  const panel = video.closest<HTMLElement>('[data-video-play="current"]');
  let x = window.innerWidth / 2;
  if (panel && panel.scrollWidth > panel.clientWidth) {
    const rect = panel.getBoundingClientRect();
    x = slidingLine(panel.scrollLeft, panel.scrollWidth - panel.clientWidth, panel.clientWidth, rect.left);
  }
  const h = window.innerHeight;
  const y = slidingLine(window.scrollY, document.documentElement.scrollHeight - h, h, 0);
  return { x, y };
}

function distanceToCurrentLine(video: HTMLVideoElement): number {
  const rect = (posterOf(video) ?? video).getBoundingClientRect();
  const point = currentPoint(video);
  return Math.hypot(rect.left + rect.width / 2 - point.x, rect.top + rect.height / 2 - point.y);
}

// Both axes: vue 2 scrolls sideways, vue 3 and [slug] down.
function distanceToCentre(video: HTMLVideoElement): number {
  const rect = (posterOf(video) ?? video).getBoundingClientRect();
  return Math.hypot(rect.left + rect.width / 2 - window.innerWidth / 2, rect.top + rect.height / 2 - window.innerHeight / 2);
}

// Listings' videos (MainVisual mobileVideo={false}: homepage reel, /projets
// vues 1-3) on a touch device: treated as no video at all - never loaded,
// never played, nothing waits for them; the image stays. Mobile data was
// too slow for them (~2s on slow 4G). Live check: mouse <-> touch can
// change mid-session (device emulation, a tablet with a mouse).
const finePointer = window.matchMedia('(pointer: fine)');
finePointer.addEventListener('change', () => refreshMainVideos());

// Also left alone: a video finishing its loop after landing (landVideo).
function isSkipped(video: HTMLVideoElement): boolean {
  if (video.dataset.finishing) return true;
  return video.hasAttribute('data-desktop-only') && !finePointer.matches;
}

// On screen and shown - may play, subject to the rules in playingSet.
function isEligible(video: HTMLVideoElement): boolean {
  return !reducedMotionQuery.matches && !isSkipped(video) && onScreen.has(video) && isShown(video);
}

function isCurrentOnly(video: HTMLVideoElement): boolean {
  return video.closest('[data-video-play="current"]') !== null;
}

function nearestCurrentLine(list: HTMLVideoElement[]): HTMLVideoElement | null {
  return list.sort((a, b) => distanceToCurrentLine(a) - distanceToCurrentLine(b))[0] ?? null;
}

// "Current" follows the scroll live: re-checked on every scroll (one pass
// per frame at most - refreshMainVideos batches), including the last bit
// of vue 3 where rows are already fully in view and the observer stays
// silent. (Tried: switching only once the scroll settled - Leo: worse.)
// Capture: vue 2 scrolls its own panel, whose scroll events don't bubble.
document.addEventListener('scroll', () => refreshMainVideos(), { capture: true, passive: true });

// The videos allowed to play right now (among the eligible ones).
function playingSet(all: HTMLVideoElement[]): Set<HTMLVideoElement> {
  const eligible = all.filter((video) => !video.dataset.flying && isEligible(video));
  const currentOnly = eligible.filter(isCurrentOnly);
  const free = eligible
    .filter((video) => !isCurrentOnly(video))
    .sort((a, b) => distanceToCentre(a) - distanceToCentre(b));
  const playing = new Set(free.slice(0, MAX_PLAYING));
  const current = nearestCurrentLine(currentOnly);
  if (current) playing.add(current);
  return playing;
}

function applyRefresh(): void {
  refreshQueued = false;
  const all = Array.from(document.querySelectorAll<HTMLVideoElement>(LOOP_SELECTOR));
  const playing = playingSet(all);
  all.forEach((video) => {
    // Mid-flight, or being started behind its mask (whenVideoReady decides).
    if (video.dataset.flying || video.dataset.priming) return;
    // Finishing its loop (landVideo): plays on to its end - unless nobody
    // can see it any more (scrolled away, its reel / vue 1 project changed),
    // then it settles right away.
    if (video.dataset.finishing) {
      if (!onScreen.has(video) || !isShown(video)) settle(video);
      return;
    }
    if (playing.has(video)) {
      startLoading(video);
      video.play().catch(() => {});
    } else if (!video.paused) {
      video.pause();
    }
  });
}

// Batched to one pass per frame: observers, the reel's style watcher and
// the morphs can all ask within the same frame, and each pass checks every
// video's visibility.
export function refreshMainVideos(): void {
  if (refreshQueued) return;
  refreshQueued = true;
  requestAnimationFrame(applyRefresh);
}

export function initMainVideos(root: ParentNode = document): { destroy: () => void } | undefined {
  const videos = Array.from(root.querySelectorAll<HTMLVideoElement>(LOOP_SELECTOR)).filter(
    (video) => !video.dataset.flying
  );
  if (videos.length === 0) return undefined;

  observer?.disconnect();
  preloader?.disconnect();
  onScreen.clear();
  videos.forEach((video) => {
    video.muted = true;
    // First frame loaded (even paused) or playing: the video can stand in
    // for its image from here.
    const showFrame = () => video.classList.add('has-frame');
    video.addEventListener('loadeddata', showFrame);
    video.addEventListener('playing', showFrame);
  });
  observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      const video = entry.target as HTMLVideoElement;
      if (entry.isIntersecting) onScreen.add(video);
      else onScreen.delete(video);
    });
    refreshMainVideos();
  }, { threshold: PLAY_THRESHOLDS });
  videos.forEach((video) => observer!.observe(video));

  // Only a video that would actually show (not a hidden view's, not a
  // non-current vue 1 / reel project's) - otherwise every copy downloads.
  preloader = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        const video = entry.target as HTMLVideoElement;
        if (!entry.isIntersecting || reducedMotionQuery.matches || isSkipped(video) || !isShown(video)) return;
        preloader?.unobserve(video);
        startLoading(video);
      });
    },
    { rootMargin: PRELOAD_MARGIN }
  );
  videos.forEach((video) => preloader!.observe(video));

  return {
    destroy: () => {
      observer?.disconnect();
      observer = null;
      preloader?.disconnect();
      preloader = null;
      onScreen.clear();
      // Not one mid-flight to the next page: it has to keep playing.
      videos.forEach((video) => {
        if (!video.dataset.flying) video.pause();
      });
    },
  };
}

// The main-visual video layered over a main image, if any - right after
// the <img> or its <picture>.
function videoFor(img: Element | null | undefined): HTMLVideoElement | null {
  if (!img) return null;
  const host = img.parentElement instanceof HTMLPictureElement ? img.parentElement : img;
  const next = host.nextElementSibling;
  return next instanceof HTMLVideoElement && next.matches(MAIN_SELECTOR) ? next : null;
}

// Measured directly, not from `onScreen`: a reveal can ask before the
// observer's first callback for this video has come in.
function inViewport(video: HTMLVideoElement): boolean {
  const rect = (posterOf(video) ?? video).getBoundingClientRect();
  return rect.bottom > 0 && rect.top < window.innerHeight && rect.width > 0;
}

function withinPlayingCap(video: HTMLVideoElement): boolean {
  const mine = distanceToCentre(video);
  let closer = 0;
  document.querySelectorAll<HTMLVideoElement>(LOOP_SELECTOR).forEach((other) => {
    if (other === video || other.dataset.flying || isCurrentOnly(other)) return;
    if (!isShown(other) || !inViewport(other)) return;
    if (distanceToCentre(other) < mine) closer++;
  });
  return closer < MAX_PLAYING;
}

// Would this vue 2/3 video be the current one? Measured directly, like
// withinPlayingCap - the observer may not have reported yet.
function isCurrentCandidate(video: HTMLVideoElement): boolean {
  const candidates = Array.from(document.querySelectorAll<HTMLVideoElement>(LOOP_SELECTOR)).filter(
    (other) => !other.dataset.flying && isCurrentOnly(other) && isShown(other) && inViewport(other)
  );
  return nearestCurrentLine(candidates) === video;
}

function whenFirstFrame(video: HTMLVideoElement): Promise<void> {
  if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      video.removeEventListener('loadeddata', done);
      video.removeEventListener('error', done);
      resolve();
    };
    const timer = setTimeout(done, VIDEO_READY_TIMEOUT);
    video.addEventListener('loadeddata', done);
    video.addEventListener('error', done);
  });
}

// For masks about to open on a main image (vue 2 cards, view curtains, vue
// 3's first image): starts its video PLAYING and resolves once a played
// frame has reached the screen - the decoder start-up (the costly part, see
// the top of this file) happens behind the still-closed mask, and the mask
// opens on a running video rather than on the image it replaces a moment
// later. Capped - a slow network never holds a reveal for long, the image
// then stands in as usual. Immediate for a plain image or a video already
// playing. Afterwards applyRefresh decides as usual (pauses it if it isn't
// on screen after all).
export function whenVideoReady(img: Element | null | undefined): Promise<void> {
  const video = videoFor(img);
  if (!video || reducedMotionQuery.matches || isSkipped(video) || video.dataset.flying) return Promise.resolve();
  if (!video.paused && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) return Promise.resolve();
  startLoading(video);
  // One that won't get to play right away - vue 2/3 but not the current
  // project, or beyond the MAX_PLAYING cap - just shows its first frame;
  // revealing a whole screen of cards/rows mustn't start every decoder at
  // once. The current one does start here, behind its mask - counted as on
  // screen now, before the observer has said so, or the refresh after it
  // would pause it again.
  if (isCurrentOnly(video)) {
    if (!isCurrentCandidate(video)) return whenFirstFrame(video);
    onScreen.add(video);
  } else if (!withinPlayingCap(video)) {
    return whenFirstFrame(video);
  }
  video.dataset.priming = 'true';
  video.play().catch(() => {});
  return new Promise((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      video.removeEventListener('playing', onPlaying);
      video.removeEventListener('error', done);
      delete video.dataset.priming;
      refreshMainVideos();
      resolve();
    };
    const onPlaying = () => {
      if ('requestVideoFrameCallback' in video) {
        video.requestVideoFrameCallback(done);
        setTimeout(done, FIRST_FRAME_TIMEOUT);
      } else {
        done();
      }
    };
    const timer = setTimeout(done, VIDEO_READY_TIMEOUT);
    video.addEventListener('error', done);
    if (!video.paused && video.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) onPlaying();
    else video.addEventListener('playing', onPlaying, { once: true });
  });
}

// Hide/show a main image together with its video (morph start / landing).
export function setMainVisualHidden(img: HTMLElement | null | undefined, hidden: boolean): void {
  if (!img) return;
  img.style.visibility = hidden ? 'hidden' : '';
  const video = videoFor(img);
  if (!video) return;
  video.style.visibility = hidden ? 'hidden' : '';
  // Shown again (morph landed): no observer event will say so.
  if (!hidden) refreshMainVideos();
}

export function flightHost(): HTMLElement | null {
  return document.getElementById('morph-video-host');
}

function forget(video: HTMLVideoElement): void {
  observer?.unobserve(video);
  onScreen.delete(video);
}

// Moves the video over `img` into the flight host (which the caller has
// already placed on `img`'s rect and animates with its clone). Playing or
// paused: a paused one flies on its paused frame - left behind, the clone's
// image flew alone, and that image is the poster, a different picture from
// the video until the posters are real first frames (seen going back from
// a [slug] scrolled down, its hero video paused off screen). Null - nothing
// to fly - only when the video has no frame yet. `swapFrom`: a main image
// on the same page whose video takes the lifted one's place (vue 1 <-> 2 -
// the view being left must keep a video for next time).
export function liftVideo(img: HTMLElement, zIndex: number, swapFrom?: HTMLElement | null): HTMLVideoElement | null {
  const video = videoFor(img);
  const host = flightHost();
  if (!video || !host || !video.classList.contains('has-frame')) return null;
  // Flying on from a slot where it was finishing its loop: that slot's
  // rules no longer apply, the landing decides again.
  stopFinishing(video);
  video.removeAttribute('data-image-only');
  video.dataset.flying = video.paused ? 'paused' : 'playing';
  forget(video);
  host.style.zIndex = String(zIndex);
  host.style.display = 'block';
  const replacement = swapFrom ? videoFor(swapFrom) : null;
  if (replacement) {
    forget(replacement);
    replacement.pause();
    video.replaceWith(replacement);
    observer?.observe(replacement);
  }
  // Same task as its removal above (or appendChild's own move): no pause.
  host.appendChild(video);
  video.style.visibility = '';
  return video;
}

// Drops the flying video into `img`'s slot, replacing the video there.
// Where videos don't play - an image-only slot (vue 3, MainVisual
// withVideo={false}) or a listing on a touch device (mobileVideo={false}) -
// it doesn't stop dead on whatever frame it had (that read as a different
// picture from every other project) nor cut back to the image (a jump): it
// plays on until the end of its loop, then settles into the image, which
// is its first frame - so the hand-over looks like just another loop.
export function landVideo(video: HTMLVideoElement, img: HTMLElement): void {
  const current = videoFor(img);
  let finish: boolean;
  if (current) {
    forget(current);
    // It takes that slot's rules.
    video.toggleAttribute('data-desktop-only', current.hasAttribute('data-desktop-only'));
    current.replaceWith(video);
    finish = isSkipped(video);
  } else {
    video.setAttribute('data-image-only', '');
    (img.parentElement instanceof HTMLPictureElement ? img.parentElement : img).after(video);
    finish = true;
  }
  delete video.dataset.flying;
  const host = flightHost();
  if (host) host.style.display = 'none';
  // It's where the morph just landed, i.e. on screen - counted now so a
  // refresh before the observer's first callback doesn't pause it.
  onScreen.add(video);
  observer?.observe(video);
  if (finish) {
    video.dataset.finishing = 'true';
    video.loop = false;
    video.addEventListener('ended', onFinished);
    video.play().catch(() => settle(video));
  }
  // Otherwise: play or stay paused by the usual rules.
  refreshMainVideos();
}

function onFinished(event: Event): void {
  settle(event.currentTarget as HTMLVideoElement);
}

function stopFinishing(video: HTMLVideoElement): void {
  delete video.dataset.finishing;
  video.removeEventListener('ended', onFinished);
  video.loop = true;
}

// The end of the finishing loop (or it went out of sight): back to the
// image. An image-only slot drops the video altogether; a listing's slot on
// touch keeps it (its own, for desktop) hidden, rewound for next time.
function settle(video: HTMLVideoElement): void {
  if (!video.dataset.finishing) return;
  stopFinishing(video);
  video.pause();
  if (video.hasAttribute('data-image-only')) {
    forget(video);
    video.remove();
    return;
  }
  video.classList.remove('has-frame');
  video.currentTime = 0;
}

// A morph abandoned mid-flight: whatever is still in the host goes.
export function abortFlight(): void {
  const host = flightHost();
  if (!host) return;
  host.querySelectorAll('video').forEach((video) => {
    video.pause();
    video.remove();
  });
  host.style.display = 'none';
}

// Safety net: should the page swap still pause a video that was flying
// while playing, resume it (it kept its time, so at worst a one-frame
// hitch). One that took off paused stays paused - landVideo decides.
document.addEventListener('astro:after-swap', () => {
  flightHost()
    ?.querySelectorAll<HTMLVideoElement>('video[data-flying="playing"]')
    .forEach((video) => {
      if (video.paused) video.play().catch(() => {});
    });
});
