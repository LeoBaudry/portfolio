import gsap from 'gsap';
import { CustomEase } from 'gsap/CustomEase';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { lenis, resetPageScroll } from '../scroll/smooth-scroll';
import { whenVideoReady } from '../media/video';
import { showMenuExtras } from '../menu/menu';

gsap.registerPlugin(CustomEase, ScrollTrigger);

const WIPE_EASE = CustomEase.create('wipe', '0.76, 0, 0.24, 1');
const WIPE_IN_DURATION = 0.7;
const WIPE_OUT_DURATION = 0.9;
const SAFE_TOP_THRESHOLD_PX = 8;
const CONTENT_PARALLAX_VH = '10vh';
// Longest the covered screen waits for the new page's visible images to be
// decoded, then for its visible main video to play its first frame.
const IMAGES_READY_CAP = 800;
const VIDEOS_READY_CAP = 600;
// Share of the wipe's lift after which the menu extras come out.
const EXTRAS_SHOW_AT = 0.6;

// --- GESTION DU BLOCAGE DU SCROLL ---
let isScrollLocked = false;

function preventScroll(e: Event) {
  // Ctrl+wheel / pinch is the browser's zoom, not a scroll - leave it alone.
  if (e instanceof WheelEvent && e.ctrlKey) return;
  if (isScrollLocked) {
    e.preventDefault();
    e.stopPropagation();
  }
}

function preventScrollKeys(e: KeyboardEvent) {
  if (!isScrollLocked) return;
  const keys = ['Space', 'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'];
  if (keys.includes(e.code)) {
    e.preventDefault();
    e.stopPropagation();
  }
}

// Exported: transitions/morph.ts reuses this for its own transition rather than
// duplicating a second scroll lock.
export function toggleScrollLock(locked: boolean) {
  isScrollLocked = locked;
  if (locked) {
    // L'option { capture: true } est magique ici : elle permet d'intercepter l'événement
    // AVANT que Lenis n'ait le temps de le lire pour calculer son inertie.
    window.addEventListener('wheel', preventScroll, { passive: false, capture: true });
    window.addEventListener('touchmove', preventScroll, { passive: false, capture: true });
    window.addEventListener('keydown', preventScrollKeys, { passive: false, capture: true });
  } else {
    window.removeEventListener('wheel', preventScroll, { capture: true });
    window.removeEventListener('touchmove', preventScroll, { capture: true });
    window.removeEventListener('keydown', preventScrollKeys, { capture: true });
  }
}
// ------------------------------------

// A hidden/minimised window can report a bogus viewport size; if scroll
// lengths (e.g. the homepage reel's pin) get measured then, the page ends up
// too short to scroll. Re-measure on return - but not mid-transition.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible' || isScrollLocked) return;
  requestAnimationFrame(() => {
    lenis?.resize();
    ScrollTrigger.refresh();
  });
});

// A project card's <a> is marked data-morph-source (see projets.astro), and
// a project page's own back link is marked data-morph-back (see
// [slug].astro) - navigating from either hands the whole transition to
// transitions/morph.ts's own image-morph (forward or reverse) instead of this
// file's plain wipe. Both files check this independently on the same
// astro:before-preparation event rather than coordinating through shared
// mutable state.
export function isMorphNavigation(el: unknown): el is HTMLElement {
  return el instanceof HTMLElement && (el.hasAttribute('data-morph-source') || el.hasAttribute('data-morph-back'));
}

/**
 * Détermine la stratégie pour le décalage (parallax) de la page sortante.
 */
function canLiftViaTransform(content: HTMLElement): boolean {
  if (Math.abs(content.getBoundingClientRect().top) < SAFE_TOP_THRESHOLD_PX) {
    return true;
  }
  
  const hasActivePin = ScrollTrigger.getAll().some((st) => st.pin && st.isActive);
  return !hasActivePin;
}

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function playTimeline(tl: gsap.core.Animation): Promise<void> {
  return new Promise((resolve) => {
    tl.eventCallback('onComplete', () => resolve());
  });
}

function capped(promise: Promise<unknown>, ms: number): Promise<void> {
  return Promise.race([promise.then(() => {}), new Promise<void>((resolve) => setTimeout(resolve, ms))]);
}

function nextFrames(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
}

// The new page's images the lifting wipe will uncover first: on screen and
// not hidden (a /projets view's inactive panel, a non-current vue 1 item).
function visibleImages(): HTMLImageElement[] {
  return Array.from(document.querySelectorAll<HTMLImageElement>('#transition-root img')).filter((img) => {
    const r = img.getBoundingClientRect();
    const onScreen = r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth;
    return onScreen && img.checkVisibility?.({ visibilityProperty: true } as CheckVisibilityOptions) !== false;
  });
}

let transitionInFlight = false;
// Counts every navigation start: a page-load still waiting on its images /
// video checks it's still the latest before initing or lifting.
let navigationId = 0;

// A wiped navigation (not a morph, not the first load) inits its page
// itself, once the covered screen has what it needs - main.ts skips it.
export function isWipeNavigation(): boolean {
  return transitionInFlight;
}

export function initPageTransitions(initPage: () => void): void {
  const overlay = document.getElementById('page-wipe');
  if (!overlay || prefersReducedMotion()) return;

  gsap.set(overlay, { yPercent: 100 });

  // Started on the swap: the new page's visible images decoding.
  let imagesReady: Promise<void> = Promise.resolve();

  document.addEventListener('astro:before-preparation', (event: any) => {
    navigationId += 1;
    // transitions/morph.ts owns this navigation entirely instead - see
    // isMorphNavigation's comment.
    if (isMorphNavigation(event.sourceElement)) {
      transitionInFlight = false;
      return;
    }

    transitionInFlight = true;

    // 🔒 On verrouille le scroll dès qu'on clique sur un lien !
    toggleScrollLock(true);
    
    const content = document.getElementById('transition-root');
    const originalLoader = event.loader;

    const tl = gsap.timeline();
    tl.fromTo(overlay, { yPercent: 100 }, { yPercent: 0, duration: WIPE_IN_DURATION, ease: WIPE_EASE }, 0);
    
    if (content) {
      if (canLiftViaTransform(content)) {
        tl.to(content, { y: `-${CONTENT_PARALLAX_VH}`, duration: WIPE_IN_DURATION, ease: WIPE_EASE }, 0);
      } else {
        tl.to(content, { top: `-${CONTENT_PARALLAX_VH}`, duration: WIPE_IN_DURATION, ease: WIPE_EASE }, 0);
        
        const activePins = ScrollTrigger.getAll()
          .filter((st) => st.pin && st.isActive)
          .map((st) => st.pin as Element);
          
        if (activePins.length > 0) {
          tl.to(activePins, { y: `-${CONTENT_PARALLAX_VH}`, duration: WIPE_IN_DURATION, ease: WIPE_EASE }, 0);
        }
      }
    }

    event.loader = async () => {
      await Promise.all([originalLoader(), playTimeline(tl)]);
    };
  });

  document.addEventListener('astro:after-swap', () => {
    resetPageScroll();
    if (!transitionInFlight) return;
    // Capped: decode() can hang, and a lazy image that never starts loading
    // just rejects - either way the wipe doesn't wait long.
    imagesReady = capped(
      Promise.all(visibleImages().map((img) => img.decode().catch(() => {}))),
      IMAGES_READY_CAP
    );
  });

  // The wipe used to lift the moment the new page was swapped in, while it
  // initialised, decoded its images and started its video decoder - those
  // long frames landed on the wipe's first frames (it jumped / froze).
  // Now, under the still-covering wipe: images decoded -> page init (its
  // entrances start here, as before, right as the wipe lifts) -> the visible
  // main video started and on its first frame (the decoder start-up, the
  // costly part - media/video.ts) -> two clean frames -> lift.
  document.addEventListener('astro:page-load', async () => {
    if (!transitionInFlight) return;
    transitionInFlight = false;
    const id = navigationId;

    await imagesReady;
    // Another navigation started meanwhile: this page is on its way out
    // (and the wipe is that navigation's now).
    if (id !== navigationId) return;
    initPage();
    await capped(Promise.all(visibleImages().map((img) => whenVideoReady(img))), VIDEOS_READY_CAP);
    await nextFrames();
    if (id !== navigationId) return;

    const content = document.getElementById('transition-root');

    ScrollTrigger.refresh();

    const tl = gsap.timeline();
    
    // 🔓 On déverrouille le scroll EXACTEMENT quand le rideau finit de s'effacer
    tl.eventCallback('onComplete', () => {
      toggleScrollLock(false);
    });

    tl.to(overlay, { yPercent: -100, duration: WIPE_OUT_DURATION, ease: WIPE_EASE }, 0);
    // The page's menu extras (menu/menu.ts) come out once
    // most of the page is uncovered.
    tl.call(showMenuExtras, [], WIPE_OUT_DURATION * EXTRAS_SHOW_AT);

    if (content) {
      tl.fromTo(
        content,
        { y: CONTENT_PARALLAX_VH },
        { y: '0vh', duration: WIPE_OUT_DURATION, ease: WIPE_EASE, clearProps: 'transform' },
        0
      );
    }
  });
}