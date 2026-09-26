import gsap from 'gsap';
import { CustomEase } from 'gsap/CustomEase';
import { toggleScrollLock } from './page-transitions';
import { lenis as pageLenis, resetPageScroll } from './smooth-scroll';
import { abortFlight, flightHost, landVideo, liftVideo, setMainVisualHidden } from './main-video';

gsap.registerPlugin(CustomEase);

const MORPH_DURATION = 0.95;
// Longest the landing waits for the destination image to be decoded.
const TARGET_DECODE_TIMEOUT = 400;
const MORPH_EASE = CustomEase.create('projectMorph', '0.76, 0, 0.24, 1');
// The flying video's host sits just above the clone (z-index 210, Layout).
const FLIGHT_Z = 211;

const CHROME_HIDE_DURATION = 0.38;
const CHROME_REVEAL_DURATION = 0.45;
const CHROME_HIDE_EASE = CustomEase.create('chromeHide', '0.4, 0, 1, 1');
const CHROME_REVEAL_EASE = CustomEase.create('chromeReveal', '0, 0, 0.2, 1');

function maskClearDistance(el: HTMLElement): number {
  return el.getBoundingClientRect().height;
}

function hideChromeEl(el: HTMLElement | null): Promise<void> {
  if (!el) return Promise.resolve();
  const clear = maskClearDistance(el);
  return new Promise((resolve) => {
    gsap.to(el, { y: clear, duration: CHROME_HIDE_DURATION, ease: CHROME_HIDE_EASE, onComplete: resolve });
  });
}

function revealChromeEl(el: HTMLElement | null): Promise<void> {
  if (!el) return Promise.resolve();
  return new Promise((resolve) => {
    gsap.to(el, { y: 0, duration: CHROME_REVEAL_DURATION, ease: CHROME_REVEAL_EASE, onComplete: resolve });
  });
}

function snapChromeHidden(el: HTMLElement | null): void {
  if (!el) return;
  gsap.set(el, { y: maskClearDistance(el) });
}

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function isMorphSourceLink(el: unknown): el is HTMLElement {
  return el instanceof HTMLElement && el.hasAttribute('data-morph-source');
}

function isMorphBackLink(el: unknown): el is HTMLElement {
  return el instanceof HTMLElement && el.hasAttribute('data-morph-back');
}

function slugFromPath(pathname: string): string | null {
  const parts = pathname.split('/').filter(Boolean);
  return parts.length >= 2 && parts[0] === 'projets' ? parts[1] : null;
}

function allCopiesOf(slug: string): HTMLImageElement[] {
  return Array.from(
    document.querySelectorAll<HTMLElement>(`.projects-page [data-morph-source][href="/projets/${slug}"]`)
  )
    .map((link) => link.querySelector<HTMLImageElement>('img'))
    .filter((img): img is HTMLImageElement => img !== null);
}

type LeaveHook = (clickedItem: HTMLElement) => Promise<void>;
let leaveHook: LeaveHook | null = null;
export function registerMorphLeaveHook(fn: LeaveHook | null): void {
  leaveHook = fn;
}

type CenterHook = (clickedItem: HTMLElement) => Promise<void>;
let centerHook: CenterHook | null = null;
export function registerMorphCenterHook(fn: CenterHook | null): void {
  centerHook = fn;
}

export const morphEvents = new EventTarget();
export const MORPH_SETTLED_EVENT = 'project-morph:settled';

let direction: 'forward' | 'backward' | null = null;

export function isBackwardMorphPending(): boolean {
  return direction === 'backward';
}

export function initProjectMorph(): void {
  const clone = document.getElementById('project-morph-clone') as HTMLImageElement | null;
  if (!clone || prefersReducedMotion()) return;


  let backSlug: string | null = null;
  let inFlightTween: gsap.core.Tween | null = null;
  // The main-visual video flying with the clone, if the source was playing one.
  let flyingVideo: HTMLVideoElement | null = null;
  // Clone + video host: always moved together (the host is just hidden when
  // there's no video).
  const flyers = [clone, flightHost()].filter((el): el is HTMLElement => el !== null);

  function resetToIdle(snapChromeVisible = false): void {
    inFlightTween?.kill();
    inFlightTween = null;
    gsap.set(clone, { display: 'none' });
    flyingVideo = null;
    abortFlight();
    toggleScrollLock(false);
    direction = null;
    backSlug = null;
    
    if (snapChromeVisible) {
      pageLenis?.start();
    }
  }

  document.addEventListener('astro:before-preparation', () => {
    if (direction) resetToIdle(true);
  });

  document.addEventListener('astro:before-preparation', (event: any) => {
    const source = event.sourceElement;
    const isForward = isMorphSourceLink(source);
    const isBackward = !isForward && isMorphBackLink(source);
    if (!isForward && !isBackward) return;

    const clickedItem = isForward
      ? (source.closest<HTMLElement>('.carousel-item, .dezoom-item, .liste-row, .reel-project') ?? null)
      : null;
    const sourceImg = isForward
      ? source.querySelector<HTMLImageElement>('img')
      : document.querySelector<HTMLImageElement>('[data-project-hero]');
    if (!sourceImg) return;

    direction = isForward ? 'forward' : 'backward';
    if (isBackward) backSlug = slugFromPath(event.from.pathname);
    toggleScrollLock(true);
    
    pageLenis?.stop();

    clone.src = sourceImg.currentSrc || sourceImg.src;
    
    const cloneReady = Promise.race([
      (clone.decode?.() ?? Promise.resolve()).catch(() => {}),
      new Promise<void>((resolve) => setTimeout(resolve, 150)),
    ]);

    const viewSwitcherEl = isForward
      ? document.querySelector<HTMLElement>('.view-switcher-mask .view-switcher')
      : null;
    const projectBackEl = isBackward ? document.querySelector<HTMLElement>('.project-back') : null;

    const originalLoader = event.loader;
    event.loader = async () => {
      const pageLoaded = originalLoader();

      if (isForward && clickedItem) await (centerHook?.(clickedItem) ?? Promise.resolve());

      const rect = sourceImg.getBoundingClientRect();
      gsap.set(flyers, { top: rect.top, left: rect.left, width: rect.width, height: rect.height });

      await cloneReady;

      let leaving: Promise<any> = Promise.resolve();
      if (isForward && clickedItem) {
        // Each page registers how its own UI leaves: /projets
        // (projets-page.ts) and the homepage reel (projects-reel.ts).
        if (leaveHook) leaving = leaveHook(clickedItem);
      } else if (isBackward) {
        const introEls = document.querySelectorAll('.project-intro > *, .project-extra');
        if (introEls.length > 0) {
          leaving = new Promise<void>((resolve) => {
            gsap.to(introEls, {
              clipPath: 'inset(0% 0% 100% 0%)',
              y: -10,
              duration: 0.35,
              stagger: 0.05,
              ease: 'power3.inOut',
              onComplete: resolve
            });
          });
        }
      }

      const chromeLeaving = hideChromeEl(viewSwitcherEl ?? projectBackEl);
      await Promise.all([leaving, chromeLeaving]);

      gsap.set(clone, { display: 'block' });
      // A playing main-visual video keeps playing on top of the clone
      // (main-video.ts) - lifted before hiding the image, so it isn't hidden
      // with it.
      flyingVideo = liftVideo(sourceImg, FLIGHT_Z);
      setMainVisualHidden(sourceImg, true);
      await pageLoaded;
    };
  });

  function morphTo(targetImg: HTMLImageElement, onSettled?: () => void): void {
    const wasBackward = direction === 'backward';
    setMainVisualHidden(targetImg, true);
    const toRect = targetImg.getBoundingClientRect();
    // The destination shares the clone's URL (ProjectImage), so it's in the
    // cache - but on a page's first visit its <img> isn't decoded yet, and
    // swapping the clone for it on landing showed an empty slot / the
    // picture popping in (first load only, 2026-09-26). The clone stays on
    // top until the destination can paint. Capped: decode() can hang.
    const targetReady = Promise.race([
      targetImg.decode().catch(() => {}),
      new Promise<void>((resolve) => setTimeout(resolve, TARGET_DECODE_TIMEOUT)),
    ]);

    const tween = (inFlightTween = gsap.to(flyers, {
      top: toRect.top - 1,
      left: toRect.left,
      width: toRect.width,
      height: toRect.height + 2,
      duration: MORPH_DURATION,
      ease: MORPH_EASE,
      onComplete: () => {
        void targetReady.then(() => {
          // Reset meanwhile (another navigation started): nothing to land.
          if (inFlightTween !== tween) return;
          if (flyingVideo) landVideo(flyingVideo, targetImg);
          flyingVideo = null;
          setMainVisualHidden(targetImg, false);
          resetToIdle();
          onSettled?.();
          if (wasBackward) morphEvents.dispatchEvent(new Event(MORPH_SETTLED_EVENT));
        });
      },
    }));
  }

  document.addEventListener('astro:after-swap', () => {
    resetPageScroll();

    if (direction === 'forward') {
      pageLenis?.start();
      const heroImg = document.querySelector<HTMLImageElement>('[data-project-hero]');
      if (!heroImg) {
        resetToIdle();
        return;
      }
      const projectBackEl = document.querySelector<HTMLElement>('.project-back');
      snapChromeHidden(projectBackEl);
      morphTo(heroImg, () => {
        revealChromeEl(projectBackEl);
      });
    } else if (direction === 'backward' && backSlug) {
      allCopiesOf(backSlug).forEach((img) => setMainVisualHidden(img, true));
      snapChromeHidden(document.querySelector<HTMLElement>('.view-switcher-mask .view-switcher'));
    }
  });

  document.addEventListener('astro:page-load', () => {
    if (direction !== 'backward') return;

    const activeView = document.querySelector<HTMLElement>('.projects-page')?.dataset.view;
    const scope = activeView ? `.view-${activeView}` : '.projects-page';

    if (backSlug) {
      allCopiesOf(backSlug).forEach((img) => {
        if (!img.closest(scope)) setMainVisualHidden(img, false);
      });
    }

    const targetLink = backSlug
      ? document.querySelector<HTMLElement>(`${scope} [data-morph-source][href="/projets/${backSlug}"]`)
      : null;
    const targetImg = targetLink?.querySelector<HTMLImageElement>('img');
    if (!targetImg) {
      resetToIdle();
      return;
    }
    morphTo(targetImg, () => {
      revealChromeEl(document.querySelector<HTMLElement>('.view-switcher-mask .view-switcher'));
    });
  });
} 