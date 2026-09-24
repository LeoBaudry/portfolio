// Muted looping videos: main visuals (MainVisual.astro, layered over the
// project's main image, which stays the thing every morph measures and
// flies) and [slug] content videos (ProjectMedia.astro). A main-visual
// video is shown only once it has a frame, so the image stands in while it
// loads.
//
// When they play: once "warm" (warmUpVideos - started while the page/view
// is still), a video keeps playing even scrolled off screen, as long as it's
// actually shown (its view active, its vue 1 / reel project current - those
// hide with visibility, invisible to an IntersectionObserver, so
// projets-page.ts / projects-reel.ts call refreshMainVideos() on change).
// Starting playback sets up the decoder, and Chrome tears that down for a
// video left paused a while - either way, starting on arrival froze the
// scroll for a few frames (measured: long frames with no script, right as
// the video resumed). Not yet warm, a video plays only while on screen.
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

const WARM_UP_DELAY = 1200;
const VIDEO_READY_TIMEOUT = 1000;

let observer: IntersectionObserver | null = null;
const onScreen = new Set<HTMLVideoElement>();
let warmUpTimer = 0;
let refreshQueued = false;

const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');

// Shared with project-page.ts (content videos load just ahead of view).
export function startLoading(video: HTMLVideoElement): void {
  // Property, not just the attribute: after a client-side navigation the
  // attribute alone leaves it playing with sound.
  video.muted = true;
  if (video.preload === 'none') {
    video.preload = 'auto';
    video.load();
  }
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

function applyRefresh(): void {
  refreshQueued = false;
  const reduced = reducedMotionQuery.matches;
  document.querySelectorAll<HTMLVideoElement>(LOOP_SELECTOR).forEach((video) => {
    if (video.dataset.flying) return;
    const shown = !reduced && isShown(video);
    // Hidden (view switched, project changed): warm again only after the
    // next warm-up, so a view's videos don't all start mid-transition.
    if (!shown) delete video.dataset.warm;
    if (shown && (onScreen.has(video) || video.dataset.warm)) {
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

function whenIdle(fn: () => void): void {
  // Safari has no requestIdleCallback.
  if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(fn, { timeout: 2000 });
  else setTimeout(fn, 200);
}

// Starts (and keeps playing, see applyRefresh) every video the page/view
// can show while nothing moves: once it has settled, one per idle period -
// so scrolling never has to start one.
export function warmUpVideos(): void {
  window.clearTimeout(warmUpTimer);
  warmUpTimer = window.setTimeout(() => {
    const pending = Array.from(document.querySelectorAll<HTMLVideoElement>(LOOP_SELECTOR));
    const next = () => {
      const video = pending.shift();
      if (!video) return;
      if (!video.dataset.flying && !reducedMotionQuery.matches && isShown(video)) {
        video.dataset.warm = 'true';
        startLoading(video);
        video.play().catch(() => {});
      }
      whenIdle(next);
    };
    whenIdle(next);
  }, WARM_UP_DELAY);
}

export function initMainVideos(root: ParentNode = document): { destroy: () => void } | undefined {
  const videos = Array.from(root.querySelectorAll<HTMLVideoElement>(LOOP_SELECTOR)).filter(
    (video) => !video.dataset.flying
  );
  if (videos.length === 0) return undefined;

  observer?.disconnect();
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
  });
  videos.forEach((video) => observer!.observe(video));
  warmUpVideos();

  return {
    destroy: () => {
      window.clearTimeout(warmUpTimer);
      observer?.disconnect();
      observer = null;
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

// For masks about to open on a main image (vue 2 cards, view curtains, vue
// 3's first image): starts its video loading and resolves once it has a
// frame, so the mask opens on the video, not on the image it replaces a
// moment later. Capped - a slow network never holds a reveal for long, the
// image then stands in as usual. Immediate for a plain image.
export function whenVideoReady(img: Element | null | undefined): Promise<void> {
  const video = videoFor(img);
  if (!video || reducedMotionQuery.matches) return Promise.resolve();
  startLoading(video);
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

// Moves the video playing over `img` into the flight host (which the caller
// has already placed on `img`'s rect and animates with its clone). Null -
// nothing to fly - when that video isn't actually playing: the clone's
// image then flies alone, as for any image. `swapFrom`: a main image on the
// same page whose video takes the lifted one's place (vue 1 <-> 2 - the
// view being left must keep a video for next time).
export function liftVideo(img: HTMLElement, zIndex: number, swapFrom?: HTMLElement | null): HTMLVideoElement | null {
  const video = videoFor(img);
  const host = flightHost();
  if (!video || !host || video.paused || !video.classList.contains('has-frame')) return null;
  video.dataset.flying = 'true';
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
export function landVideo(video: HTMLVideoElement, img: HTMLElement): void {
  const current = videoFor(img);
  if (current) {
    forget(current);
    current.replaceWith(video);
  } else {
    (img.parentElement instanceof HTMLPictureElement ? img.parentElement : img).after(video);
  }
  delete video.dataset.flying;
  const host = flightHost();
  if (host) host.style.display = 'none';
  // It's where the morph just landed, i.e. on screen - counted now so a
  // refresh before the observer's first callback doesn't pause it.
  onScreen.add(video);
  observer?.observe(video);
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

// Safety net: should the page swap still pause the flying video, resume it
// (it kept its time, so at worst a one-frame hitch).
document.addEventListener('astro:after-swap', () => {
  flightHost()
    ?.querySelectorAll('video')
    .forEach((video) => {
      if (video.paused) video.play().catch(() => {});
    });
});
