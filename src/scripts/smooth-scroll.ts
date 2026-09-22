import Lenis from 'lenis';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export let lenis: Lenis | null = null;

if (!prefersReducedMotion) {
  lenis = new Lenis({ duration: 1.1 });
  lenis.on('scroll', ScrollTrigger.update);
  gsap.ticker.add((time) => lenis!.raf(time * 1000));
  gsap.ticker.lagSmoothing(0);
}

// A raw `window.scrollTo(0, 0)` moves the actual scroll position but not
// Lenis's own idea of it - `lenis` here is a single instance that lives for
// the whole session (module scope, never torn down between page
// navigations), so its internal targetScroll/animatedScroll can be left
// holding a stale value from whatever the previous page was scrolled to.
// If its raf loop (always running, driven by gsap.ticker above) is still
// live when that happens, it can spend the next several frames smoothly
// "correcting" the real scroll position back toward that stale target -
// on a page transition this reads as the new page briefly scrolling itself
// to a wrong position on its own. `force: true` because this needs to work
// even while `lenis.stop()` has been called (see project-morph.ts, which
// stops it for the whole transition and expects this to still land).
export function resetPageScroll(): void {
  if (lenis) {
    // Astro's own router restores the previous scroll position on
    // back/forward navigation via a raw native scrollTo(), bypassing Lenis
    // entirely (see moveToLocation in astro/dist/transitions/router.js) -
    // Lenis's targetScroll is left stale at whatever it was before that
    // jump. If it's still 0 from before we ever left this page, the
    // scrollTo(0) below sees target === targetScroll and no-ops (Lenis's
    // own early-return for "already there"), leaving the real, native
    // scroll position stuck wherever Astro jumped it. resize() first
    // resyncs targetScroll/animatedScroll from the actual current native
    // position, so the scrollTo(0) that follows is never a no-op.
    lenis.resize();
    lenis.scrollTo(0, { immediate: true, force: true });
  } else {
    window.scrollTo(0, 0);
  }
}
