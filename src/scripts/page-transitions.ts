import gsap from 'gsap';
import { CustomEase } from 'gsap/CustomEase';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(CustomEase, ScrollTrigger);

// content.md §8: reveal par le bas. A single fixed panel wipes up to fully
// cover the viewport before the DOM swap happens, then continues in the
// same direction off the top to reveal the new page - one continuous
// upward sweep, not a cover-then-separate-uncover. The page content itself
// shifts a little in the same direction while it's happening (parallax),
// distinct from the wipe's own motion.
//
// Every element this file animates (#page-wipe, #transition-root) has
// transition:animate="none" in Layout.astro, and #page-wipe's idle position
// is set here via GSAP rather than in CSS. Both are load-bearing: Astro's
// ClientRouter otherwise plays its own default crossfade on the same nodes
// through the native View Transition API, and a CSS transform on #page-wipe
// stacks under GSAP's yPercent instead of being replaced by it - either one
// alone is enough to make the wipe visibly tear/double up.
//
// GSAP's core ease system only understands its own named eases
// (power1-4, expo, etc.) - a raw CSS cubic-bezier() string like the rest of
// the site uses (see projets-page.ts) is silently ignored there without
// CustomEase registered, which is why this read as linear/no-easing before.
//
// Both phases share one symmetric ease-in-out curve rather than giving the
// reveal its own expo-out: expo-out covers most of its visual distance in
// the first ~20% of its duration by design, which is exactly "skips half
// the screen instantly then crawls" - wrong shape for a wipe that has to
// cross the full viewport evenly.
const WIPE_EASE = CustomEase.create('wipe', '0.76, 0, 0.24, 1');
const WIPE_IN_DURATION = 0.7;
// The reveal reads as rushed at the same duration as the cover - it gets
// more time to settle rather than snapping away.
const WIPE_OUT_DURATION = 0.9;
// Many views in this site (the homepage's pinned hero/reel section, every
// view on /projets) rely on position:fixed. Transforming an ancestor of
// them - which is what animating #transition-root's yPercent does - makes
// that ancestor their containing block for as long as the transform is
// non-empty, so this has to stay barely-there and, more importantly, fully
// clear itself back to no transform at all once settled (see clearProps
// below) or those fixed elements stay broken on every page after the first
// transition, not just during it.
const CONTENT_PARALLAX_PERCENT = 1.5;

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function playTimeline(tl: gsap.core.Timeline): Promise<void> {
  return new Promise((resolve) => {
    tl.eventCallback('onComplete', () => resolve());
  });
}

export function initPageTransitions(): void {
  const overlay = document.getElementById('page-wipe');
  if (!overlay || prefersReducedMotion()) return;

  gsap.set(overlay, { yPercent: 100 });

  // astro:page-load also fires once after the plain browser 'load' event on
  // the very first page (no SPA navigation involved) - without this flag
  // that fires the wipe-out for a wipe-in that never happened, sweeping the
  // overlay through the viewport on every cold load for no reason.
  let transitionInFlight = false;

  // astro:before-preparation fires as soon as a same-origin navigation is
  // intercepted, before the new page has been fetched. Wrapping its loader
  // lets the wipe-in finish covering the screen before the swap - without
  // this, the swap can land mid-animation on a fast/cached navigation.
  document.addEventListener('astro:before-preparation', (event: any) => {
    transitionInFlight = true;
    const content = document.getElementById('transition-root');
    const originalLoader = event.loader;

    const tl = gsap.timeline();
    tl.fromTo(overlay, { yPercent: 100 }, { yPercent: 0, duration: WIPE_IN_DURATION, ease: WIPE_EASE }, 0);
    if (content) {
      tl.to(content, { yPercent: -CONTENT_PARALLAX_PERCENT, duration: WIPE_IN_DURATION, ease: WIPE_EASE }, 0);
    }

    event.loader = async () => {
      await Promise.all([originalLoader(), playTimeline(tl)]);
    };
  });

  // Runs right after the new DOM is swapped in, while the wipe still fully
  // covers the screen. Positions the incoming content at its own starting
  // offset so it can settle into place as the wipe uncovers it.
  document.addEventListener('astro:after-swap', () => {
    const content = document.getElementById('transition-root');
    if (content) gsap.set(content, { yPercent: CONTENT_PARALLAX_PERCENT });
    window.scrollTo(0, 0);
  });

  // Fires once the new page's own scripts have re-initialized (see
  // astro:page-load handling in main.ts). Now it's safe to uncover.
  document.addEventListener('astro:page-load', () => {
    if (!transitionInFlight) return;
    transitionInFlight = false;
    const content = document.getElementById('transition-root');
    const tl = gsap.timeline();
    tl.to(overlay, { yPercent: -100, duration: WIPE_OUT_DURATION, ease: WIPE_EASE }, 0);
    if (content) {
      // clearProps: once settled, #transition-root must carry no inline
      // transform at all (not even translate(0,0)) - GSAP leaving one
      // behind, even a no-op one, keeps it as a containing block for any
      // position:fixed descendant forever, not just mid-transition.
      tl.to(content, { yPercent: 0, duration: WIPE_OUT_DURATION, ease: WIPE_EASE, clearProps: 'transform' }, 0);
    }

    // The new page's own init (main.ts, on this same astro:page-load event
    // but registered earlier so it runs first) creates its ScrollTrigger
    // pins while #transition-root still carries its +1.5% starting offset
    // above, since that offset is only cleared over the course of this
    // timeline. Any pin measured then is stale by the time this timeline
    // finishes and the transform disappears - refresh once it's genuinely
    // done to re-measure against the real, settled DOM instead of leaving
    // it to self-correct on the next scroll (which is what the ~50px gap
    // under a freshly re-pinned section was).
    tl.eventCallback('onComplete', () => ScrollTrigger.refresh());
  });
}
