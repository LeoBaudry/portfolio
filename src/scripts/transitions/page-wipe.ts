import gsap from 'gsap';
import { CustomEase } from 'gsap/CustomEase';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { SplitText } from 'gsap/SplitText';
import { lenis, resetPageScroll } from '../scroll/smooth-scroll';
import { whenVideoReady } from '../media/video';
import { showMenuExtras } from '../menu/menu';

gsap.registerPlugin(CustomEase, ScrollTrigger, SplitText);

// The page transition (PageTransition.astro) - the site-entry loader in
// miniature: ink columns rise (cover), the logo's strokes slide into their
// masks, the new page's name rises under it, each column turns orange from
// the bottom, the logo and name leave, the columns clear (reveal). Same
// curves as the loader (loader/loader-inline.js).
const WIPE_EASE = CustomEase.create('wipe', '0.76, 0, 0.24, 1');
const EXPO_OUT = CustomEase.create('ptExpoOut', '0.16, 1, 0.3, 1');
const EXPO_IN = CustomEase.create('ptExpoIn', '0.7, 0, 0.84, 0');
// Cover: each column, and the delay from one column to the next.
const COVER = 0.6;
const COLUMN_STAGGER = 0.06;
const GRID_IN = 0.8;
// The logo's strokes sliding in, one after another.
const STROKE_IN = 0.7;
const STROKE_STAGGER = 0.1;
// The new page's name, under the logo: letter by letter, each in its own
// mask.
const NAME_IN = 0.6;
const NAME_STAGGER = 0.035;
const NAME_HOLD = 0.25;
const NAME_OUT_STAGGER = 0.02;
// Reveal: orange rising in each column, the logo / name leaving, the
// columns clearing.
const ORANGE = 0.5;
const ORANGE_STAGGER = 0.04;
const LOGO_OUT_AT = 0.5; // share of ORANGE after which the logo / name leave
const STROKE_OUT = 0.55;
const STROKE_OUT_STAGGER = 0.07;
const NAME_OUT = 0.4;
const CLEAR = 0.7;
const CLEAR_AT = 0.85; // share of ORANGE after which the columns start clearing
// The page drifting up as it's covered, and rising back into place over
// the clear (the parallax the site has had from the start). The strip it
// uncovers shows body's background: the curtain's dark (global.css).
const CONTENT_IN = 1;
const SAFE_TOP_THRESHOLD_PX = 8;
const CONTENT_PARALLAX_VH = '10vh';
// Longest the covered screen waits for the new page's visible images to be
// decoded, then for its visible main video to play its first frame.
const IMAGES_READY_CAP = 800;
const VIDEOS_READY_CAP = 600;
// Share of the columns' clear after which the menu extras come out.
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
  const overlay = document.getElementById('page-transition');
  if (!overlay || prefersReducedMotion()) return;
  const name = overlay.querySelector<HTMLElement>('.pt-name')!;
  const strokes = Array.from(overlay.querySelectorAll<SVGGElement>('.pt-stroke'), (g) => {
    const [x, y] = (g.dataset.out ?? '0 0').split(' ').map(Number);
    return { g, x, y };
  });
  // Only the columns / lines CSS shows at this width (5 / 3 / 2).
  const shown = (el: Element) => getComputedStyle(el).display !== 'none';
  const columns = () => Array.from(overlay.querySelectorAll<HTMLElement>('.pt-col')).filter(shown);
  const gridlines = () => Array.from(overlay.querySelectorAll<HTMLElement>('.pt-gridline')).filter(shown);
  const fills = () => columns().map((col) => col.firstElementChild as HTMLElement);

  let nameSplit: SplitText | null = null;
  const nameChars = () => (nameSplit?.chars ?? []) as HTMLElement[];
  let coverTl: gsap.core.Timeline | null = null;
  let revealTl: gsap.core.Timeline | null = null;
  // The new page's name rising, started on the swap.
  let nameShown: Promise<void> = Promise.resolve();

  // Everything back to "nothing shown": columns down, fills down, strokes
  // out of their masks (at their entrance start), name under its mask.
  function resetOverlay(): void {
    gsap.set(overlay, { visibility: 'hidden' });
    gsap.set(overlay!.querySelectorAll('.pt-col'), { scaleY: 0, transformOrigin: '50% 100%' });
    gsap.set(overlay!.querySelectorAll('.pt-col-fill'), { scaleY: 0, transformOrigin: '50% 100%' });
    gsap.set(overlay!.querySelectorAll('.pt-gridline'), { scaleY: 0, transformOrigin: '50% 100%' });
    strokes.forEach(({ g, x, y }) => gsap.set(g, { x: -x, y: -y }));
    nameSplit?.revert();
    nameSplit = null;
    name.textContent = '';
  }
  resetOverlay();

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

    // A transition already under way (a link clicked mid-reveal): straight
    // back to covered, then on as usual.
    const midway = coverTl?.isActive() || revealTl?.isActive();
    coverTl?.kill();
    revealTl?.kill();
    resetOverlay();
    gsap.set(overlay, { visibility: 'visible' });
    if (midway) gsap.set(columns(), { scaleY: 1 });

    const cols = columns();
    // Until the last column is up.
    const coverDuration = COVER + COLUMN_STAGGER * (cols.length - 1);
    const tl = (coverTl = gsap.timeline());
    // Ink columns rise from the bottom, one after another left to right;
    // the faint grid draws up with them. From the bottom, because the page
    // drifts up meanwhile: the strip it opens at the bottom is covered as
    // it forms (a sideways sweep left it showing - Leo, 2026-09-27).
    tl.to(cols, { scaleY: 1, duration: COVER, ease: WIPE_EASE, stagger: COLUMN_STAGGER }, 0)
      .to(gridlines(), { scaleY: 1, duration: GRID_IN, ease: WIPE_EASE, stagger: COLUMN_STAGGER }, 0.1)
      // Covered: the logo's strokes slide into their masks one by one.
      .to(
        strokes.map(({ g }) => g),
        { x: 0, y: 0, duration: STROKE_IN, ease: EXPO_OUT, stagger: STROKE_STAGGER },
        coverDuration - 0.1
      );

    if (content) {
      if (canLiftViaTransform(content)) {
        tl.to(content, { y: `-${CONTENT_PARALLAX_VH}`, duration: coverDuration, ease: WIPE_EASE }, 0);
      } else {
        tl.to(content, { top: `-${CONTENT_PARALLAX_VH}`, duration: coverDuration, ease: WIPE_EASE }, 0);

        const activePins = ScrollTrigger.getAll()
          .filter((st) => st.pin && st.isActive)
          .map((st) => st.pin as Element);

        if (activePins.length > 0) {
          tl.to(activePins, { y: `-${CONTENT_PARALLAX_VH}`, duration: coverDuration, ease: WIPE_EASE }, 0);
        }
      }
    }

    // The new page is swapped in once the screen is covered AND the logo
    // is in (the loader's one floor: its strokes' entrance).
    event.loader = async () => {
      await Promise.all([originalLoader(), playTimeline(tl)]);
    };
  });

  document.addEventListener('astro:after-swap', () => {
    resetPageScroll();
    if (!transitionInFlight) return;
    // Behind the columns now: the new page's name rises under the logo,
    // letter by letter.
    nameSplit?.revert();
    name.textContent = document.getElementById('transition-root')?.dataset.pageName ?? '';
    nameSplit = SplitText.create(name, { type: 'chars', mask: 'chars' });
    gsap.set(nameChars(), { yPercent: 100 });
    nameShown = playTimeline(
      gsap
        .timeline()
        .to(nameChars(), { yPercent: 0, duration: NAME_IN, ease: EXPO_OUT, stagger: NAME_STAGGER })
        .to({}, { duration: NAME_HOLD })
    );
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
    // The name has been read (it rose and held) before anything leaves.
    await nameShown;
    await nextFrames();
    if (id !== navigationId) return;

    const content = document.getElementById('transition-root');

    ScrollTrigger.refresh();

    const cols = columns();
    const clearAt = ORANGE * CLEAR_AT;
    const clearDuration = CLEAR + COLUMN_STAGGER * (cols.length - 1);
    const tl = (revealTl = gsap.timeline());

    // 🔓 On déverrouille le scroll EXACTEMENT quand le rideau finit de s'effacer
    tl.eventCallback('onComplete', () => {
      toggleScrollLock(false);
      resetOverlay();
      revealTl = null;
    });

    // Each column turns orange from the bottom, behind the logo...
    tl.to(fills(), { scaleY: 1, duration: ORANGE, ease: WIPE_EASE, stagger: ORANGE_STAGGER }, 0)
      // ...the strokes carry on along their diagonal out of their masks,
      // the name leaves upwards...
      .to(
        strokes.map(({ g }) => g),
        {
          x: (i: number) => strokes[i].x,
          y: (i: number) => strokes[i].y,
          duration: STROKE_OUT,
          ease: EXPO_IN,
          stagger: STROKE_OUT_STAGGER,
        },
        ORANGE * LOGO_OUT_AT
      )
      .to(nameChars(), { yPercent: -100, duration: NAME_OUT, ease: EXPO_IN, stagger: NAME_OUT_STAGGER }, ORANGE * LOGO_OUT_AT)
      // ...and the columns clear bottom to top, left to right (the loader's
      // exit), grid lines with them: the top of the screen stays covered
      // longest, hiding the strip the page leaves there as it rises back
      // into place (Leo, 2026-09-27 - clearing sideways showed it).
      .set([...cols, ...gridlines()], { transformOrigin: '50% 0%' }, clearAt)
      .to(cols, { scaleY: 0, duration: CLEAR, ease: WIPE_EASE, stagger: COLUMN_STAGGER }, clearAt)
      .to(gridlines(), { scaleY: 0, duration: CLEAR, ease: WIPE_EASE, stagger: COLUMN_STAGGER }, clearAt);
    // The page's menu extras (menu/menu.ts) come out once most of the page
    // is uncovered.
    tl.call(showMenuExtras, [], clearAt + clearDuration * EXTRAS_SHOW_AT);

    if (content) {
      tl.fromTo(
        content,
        { y: CONTENT_PARALLAX_VH },
        { y: '0vh', duration: CONTENT_IN, ease: WIPE_EASE, clearProps: 'transform' },
        clearAt
      );
    }

  });
}