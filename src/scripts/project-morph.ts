import gsap from 'gsap';
import { CustomEase } from 'gsap/CustomEase';
import { toggleScrollLock } from './page-transitions';
import { lenis as pageLenis, resetPageScroll } from './smooth-scroll';

gsap.registerPlugin(CustomEase);

// Custom transition between /projets and an individual project (content.md's
// morphing request): the project image physically grows/moves between its
// on-screen rect on one page and the hero rect on the other, rather than
// wiping to a solid panel. Reuses the same FLIP technique already proven
// for the vue1<->vue2 morph in projets-page.ts (resize a single real
// <img>, not a screenshot cross-fade), just spanning a real page
// navigation instead of an in-page view switch.
//
// Two directions, both driven by the same floating clone:
// - forward (a project card's data-morph-source link, in projets.astro/
//   ProjectsReel.astro): source is the clicked card's image, destination is
//   [data-project-hero] on the page being navigated to. Captured on
//   astro:after-swap - it's plain markup, nothing has to run first for it
//   to be in its final place.
// - backward (a project page's data-morph-back back link, in [slug].astro):
//   source is [data-project-hero] on the page being left, destination is
//   the matching card back on /projets. Every one of the 3 views has its
//   own copy of that card, and only projets-page.ts's own astro:page-load
//   listener (registered before this file's, so it has already run by the
//   time ours fires) knows which view is actually being restored - so
//   *which* copy is the real target can only be resolved on page-load. But
//   hiding is separable from that: every copy gets hidden right away on
//   astro:after-swap, before any of them can be visible even for a frame,
//   and page-load un-hides whichever ones didn't turn out to be the target.
//
// There was a "safety backdrop" here at one point (showing #page-wipe as a
// same-color solid behind the clone, meant to paper over a suspected
// View-Transition-API flash). It made things worse, not better: it showed
// up *synchronously*, before the leave/reveal animations below even start,
// so the whole screen went solid ink first and hid whatever was supposed
// to animate underneath it - exactly what read as "text disappears
// instantly" and a "broken" return to a view. Removed; don't re-add it
// without first confirming, live, that it isn't just hiding the real
// animation from view.
const MORPH_DURATION = 0.95;
const MORPH_EASE = CustomEase.create('projectMorph', '0.76, 0, 0.24, 1');

// Fixed-position page chrome (#temp-nav, .view-switcher, .project-back) had
// no equivalent to projets-page.ts's info-text mask - it just sat there at
// full opacity while the clone covered it, which on vue1 (whose source
// image is already full-bleed, so the clone appears already at ~its final
// size) reads as an instant pop rather than a covering motion.
//
// Fixed the same way the info-text does it (hideInfoParts/revealInfoParts
// in projets-page.ts): each of these now has its own dedicated
// overflow:hidden mask ancestor with no size/look of its own (#temp-nav
// itself, .view-switcher-mask, .project-back-mask - see their markup/CSS),
// and what's animated here is the *whole visible thing* inside that mask
// (.temp-nav-inner's links, .view-switcher's entire panel - background and
// icons together, not just the icons within a static panel, - .project-
// back's link), translated by its own height - sinking down and getting
// swallowed by the mask's own bottom edge, same motion/eases as the info
// text, not a slide toward the viewport edge.
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

// .project-back and .view-switcher (the panel) are freshly mounted (not
// persisted) on whichever page is being arrived at, so they render fully
// visible the instant the swap happens - without this they'd flash visible
// for a frame, then get covered by the still-mid-flight clone, then pop
// again once revealChromeEl runs at settle. Snapping them to their hidden
// position immediately after the swap (no animation - there's nothing to
// see yet, the clone hasn't even appeared) closes that gap, matching
// #temp-nav, which never has this problem since it's the same persisted
// DOM node, already left hidden by its own leave animation on the
// outgoing page.
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

// One image per view (carousel/dezoom have exactly one each; liste's link
// wraps up to 4). Deliberately just the first per link, not
// querySelectorAll('... img') - that would grab all 4 of liste's images,
// and only the first one ever gets un-hidden again (by morphTo, which only
// ever resolves a single target image), permanently hiding the other 3.
function allCopiesOf(slug: string): HTMLImageElement[] {
  return Array.from(
    document.querySelectorAll<HTMLElement>(`.projects-page [data-morph-source][href="/projets/${slug}"]`)
  )
    .map((link) => link.querySelector<HTMLImageElement>('img'))
    .filter((img): img is HTMLImageElement => img !== null);
}

// projets-page.ts registers this each time it initializes (and clears it on
// teardown) rather than this file importing its private closures directly,
// which would need a circular import - project-morph.ts already exports
// things projets-page.ts imports the other way. Called on the forward path
// only, before the navigation is allowed to actually proceed, so the
// clicked item's (and, for dezoom, its visible siblings') own info/image
// gets to animate out instead of just vanishing when the page swaps.
type LeaveHook = (clickedItem: HTMLElement) => Promise<void>;
let leaveHook: LeaveHook | null = null;
export function registerMorphLeaveHook(fn: LeaveHook | null): void {
  leaveHook = fn;
}

// Registered the same way as leaveHook, but called first, before the source
// image's rect is even captured - lets projets-page.ts scroll a clicked
// dezoom card to center itself (if it isn't already) so the morph always
// starts from a centered position instead of wherever it happened to be
// sitting. A no-op promise for anything that isn't dezoom or is already
// centered.
type CenterHook = (clickedItem: HTMLElement) => Promise<void>;
let centerHook: CenterHook | null = null;
export function registerMorphCenterHook(fn: CenterHook | null): void {
  centerHook = fn;
}

// projets-page.ts reads isBackwardMorphPending() - on a backward morph it
// keeps the restored project's own info text (and, for dezoom, its
// siblings') masked instead of showing it instantly, so it isn't sitting
// there fully visible while the incoming clone still visually covers the
// screen mid-flight, then popping again once the clone clears. It reveals
// them itself, animated, once the morph below actually settles
// (MORPH_SETTLED_EVENT on morphEvents).
//
// Module-level rather than inside initProjectMorph(): that function only
// ever runs once per session (main.ts calls it at module scope, not on
// astro:page-load), so this is equivalent to instance state, but a plain
// export is far simpler than threading a getter out of its closure.
export const morphEvents = new EventTarget();
export const MORPH_SETTLED_EVENT = 'project-morph:settled';

let direction: 'forward' | 'backward' | null = null;

export function isBackwardMorphPending(): boolean {
  return direction === 'backward';
}

export function initProjectMorph(): void {
  const clone = document.getElementById('project-morph-clone') as HTMLImageElement | null;
  if (!clone || prefersReducedMotion()) return;

  // #temp-nav (the mask) is transition:persist'd in Layout.astro, so
  // .temp-nav-inner (what actually animates) is the same DOM node for the
  // whole session too - safe to grab once here rather than re-querying it
  // per navigation like the page-specific chrome below.
  const tempNavInner = document.querySelector<HTMLElement>('#temp-nav .temp-nav-inner');

  let backSlug: string | null = null;
  let inFlightTween: gsap.core.Tween | null = null;

  function resetToIdle(snapChromeVisible = false): void {
    inFlightTween?.kill();
    inFlightTween = null;
    gsap.set(clone, { display: 'none' });
    toggleScrollLock(false);
    direction = null;
    backSlug = null;
    // Only when aborting mid-flight (see the interruption listener below) -
    // the normal path also calls this from morphTo's onComplete, but
    // *before* that same completion reveals temp-nav itself (onSettled,
    // right after) - snapping it here unconditionally would skip that
    // reveal animation instead of just cleaning up after an abort.
    if (snapChromeVisible) {
      if (tempNavInner) gsap.set(tempNavInner, { y: 0 });
      // Forward's own settle restarts pageLenis itself once it knows it's
      // landed on a project page (see astro:after-swap below), and a
      // backward landing leaves it to projets-page.ts's own view-specific
      // start()/stop() (already applied by the time this could run) - but
      // aborting mid-flight reaches neither of those, and the navigation
      // that interrupted this one might be a plain, non-morph link that
      // never touches pageLenis at all - restart it here so it's never
      // left stopped indefinitely.
      pageLenis?.start();
    }
  }

  // If another navigation starts (morph or not) before a previous morph's
  // 0.8s tween has finished - e.g. clicking again, or hitting back, while
  // the image is still mid-flight - that tween would otherwise keep
  // running against a clone that no longer corresponds to anything on
  // screen, and its onComplete (the only place display:none / scroll
  // unlock happened) may never fire in a way that matches the new page.
  // Reset to a clean slate before anything else happens - including
  // temp-nav, in case it was interrupted mid-hide (e.g. a plain, non-morph
  // link click, which afterwards won't ever call revealChromeEl on it).
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
    // Lenis (a single instance that lives for the whole session, see
    // smooth-scroll.ts) can still be mid-smoothing/decelerating from
    // whatever the user was doing right before they clicked - left running,
    // it keeps nudging the still-visible outgoing page's scroll position
    // during the leave animations below, which is exactly what read as
    // "nothing fits, shows halfway scroll through" while leaving vue3.
    // Restarted in resetToIdle() once the whole transition (leave, morph,
    // and - via resetPageScroll() below - the landing page's scroll reset)
    // has fully settled.
    pageLenis?.stop();

    clone.src = sourceImg.currentSrc || sourceImg.src;
    // decode() has no guaranteed resolution time and can hang indefinitely
    // in some circumstances (e.g. a backgrounded tab, where browsers can
    // deprioritize decode work the same way they throttle rAF) - awaiting
    // it bare would make the entire navigation hang with it, since
    // everything else below is gated on this same promise. Race it against
    // a short timeout instead: the timeout only ever matters in the rare
    // case decode is slow, and losing the anti-flash guarantee there is a
    // far smaller cost than the whole transition never proceeding.
    const cloneReady = Promise.race([
      (clone.decode?.() ?? Promise.resolve()).catch(() => {}),
      new Promise<void>((resolve) => setTimeout(resolve, 150)),
    ]);

    // Queried now, off the still-live outgoing DOM - after astro:after-swap
    // these wouldn't exist (forward) or would be the wrong page's copy
    // (backward) any more.
    const viewSwitcherEl = isForward
      ? document.querySelector<HTMLElement>('.view-switcher-mask .view-switcher')
      : null;
    const projectBackEl = isBackward ? document.querySelector<HTMLElement>('.project-back') : null;

    const originalLoader = event.loader;
    event.loader = async () => {
      // Kick the actual page fetch off immediately - it shouldn't wait on
      // any of the animation work below, only the final swap should.
      const pageLoaded = originalLoader();

      // Dezoom centering (if registered/applicable) has to resolve before
      // the source rect below is captured - it can change sourceImg's own
      // position via a scroll.
      if (isForward && clickedItem) await (centerHook?.(clickedItem) ?? Promise.resolve());

      // top/left/width/height, not transform: the source and destination
      // rects are rarely the same aspect ratio (a 16:10 dezoom card vs. a
      // full-bleed hero, say), and object-fit:cover only re-crops correctly
      // against the element's actual layout box on each frame. Animating
      // via transform: scale() instead stretches the already-cropped
      // bitmap non-uniformly whenever the ratio changes mid-flight, and
      // simply looks distorted - the same technique morphHero already uses
      // successfully for the vue1<->vue2 morph, for the same reason.
      const rect = sourceImg.getBoundingClientRect();
      gsap.set(clone, { top: rect.top, left: rect.left, width: rect.width, height: rect.height });

      await cloneReady;

      // Everything that has to visibly animate away (the clicked item's own
      // info/siblings, plus the page chrome) plays now, with the real
      // outgoing page still on screen - showing the clone (next) before this
      // finishes is what made vue1's info text and the temp-nav/switcher
      // read as popping away instantly rather than animating: vue1's source
      // image is already full-bleed, so the clone appears already at ~its
      // final size and instantly covers everything behind it.
      const leaving = isForward && clickedItem ? leaveHook?.(clickedItem) ?? Promise.resolve() : Promise.resolve();
      const chromeLeaving = Promise.all([
        hideChromeEl(tempNavInner),
        hideChromeEl(viewSwitcherEl ?? projectBackEl),
      ]);
      await Promise.all([leaving, chromeLeaving]);

      // Clone is a single persisted, reused <img>, so between two morphs in
      // the same session it's still holding the *previous* project's
      // decoded bitmap - showing it immediately after only changing .src
      // can paint that stale bitmap for a frame (browsers commonly keep
      // displaying an <img>'s old content until the new src is decoded,
      // rather than blanking), which is exactly "the previous project
      // flashes on the new one". Waiting for decode() (above) before ever
      // making it visible closes that gap entirely.
      gsap.set(clone, { display: 'block' });
      sourceImg.style.visibility = 'hidden';
      await pageLoaded;
    };
  });

  function morphTo(targetImg: HTMLImageElement, onSettled?: () => void): void {
    const wasBackward = direction === 'backward';
    targetImg.style.visibility = 'hidden';
    const toRect = targetImg.getBoundingClientRect();

    inFlightTween = gsap.to(clone, {
      top: toRect.top,
      left: toRect.left,
      width: toRect.width,
      height: toRect.height,
      duration: MORPH_DURATION,
      ease: MORPH_EASE,
      onComplete: () => {
        targetImg.style.visibility = '';
        resetToIdle();
        onSettled?.();
        if (wasBackward) morphEvents.dispatchEvent(new Event(MORPH_SETTLED_EVENT));
      },
    });
  }

  document.addEventListener('astro:after-swap', () => {
    // Lenis-aware (see resetPageScroll's comment in smooth-scroll.ts) - a
    // bare window.scrollTo(0, 0) here left Lenis's own stale target free to
    // smoothly drag the newly-landed page's scroll away from 0 again a
    // couple frames later, which is why a project page could land scrolled
    // partway down instead of at its own top, revealing several
    // .project-extra images at once instead of one at a time on scroll.
    resetPageScroll();

    if (direction === 'forward') {
      // Project pages use plain document scroll (project-page.ts doesn't
      // touch Lenis at all) - safe to hand it back now that the reset
      // above has actually landed, unlike a backward landing, which leaves
      // this to projets-page.ts's own view-specific start()/stop() instead
      // (carousel/dezoom don't want Lenis running on the document at all).
      pageLenis?.start();
      const heroImg = document.querySelector<HTMLImageElement>('[data-project-hero]');
      if (!heroImg) {
        // Destination has no morph target (shouldn't happen for a real
        // project link, but fail safe rather than leaving the clone stuck).
        resetToIdle();
        return;
      }
      // Snapped hidden immediately, before the clone even appears - see
      // snapChromeHidden's comment.
      const projectBackEl = document.querySelector<HTMLElement>('.project-back');
      snapChromeHidden(projectBackEl);
      morphTo(heroImg, () => {
        revealChromeEl(tempNavInner);
        revealChromeEl(projectBackEl);
      });
    } else if (direction === 'backward' && backSlug) {
      // Every view's copy of the target gets hidden immediately, before
      // projets-page.ts has even restored which view is active - see the
      // module doc comment above.
      allCopiesOf(backSlug).forEach((img) => {
        img.style.visibility = 'hidden';
      });
      snapChromeHidden(document.querySelector<HTMLElement>('.view-switcher-mask .view-switcher'));
    }
  });

  document.addEventListener('astro:page-load', () => {
    if (direction !== 'backward') return;

    // Every one of the 3 views has its own <a> for the same project, so a
    // selector scoped only to .projects-page always matches the first one
    // in DOM order (carousel's) regardless of which view is actually
    // active/restored - has to be scoped to the current view's own panel.
    const activeView = document.querySelector<HTMLElement>('.projects-page')?.dataset.view;
    const scope = activeView ? `.view-${activeView}` : '.projects-page';

    if (backSlug) {
      allCopiesOf(backSlug).forEach((img) => {
        if (!img.closest(scope)) img.style.visibility = '';
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
      revealChromeEl(tempNavInner);
      revealChromeEl(document.querySelector<HTMLElement>('.view-switcher-mask .view-switcher'));
    });
  });
}
