import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { resetPageScroll } from './smooth-scroll';
import { initPageTransitions } from './page-transitions';
import { initProjectMorph } from './project-morph';
import { initRevealText } from './reveal-text';
import { initProjectsReel } from './projects-reel';
import { initFooterParallax } from './footer';
import { initProjetsPage } from './projets-page';
import { initProjectPage } from './project-page';
import { initMainVideos } from './main-video';
import { runSiteLoader } from './site-loader';
import { initSiteMenu } from './site-menu';

// The browser applies its own scroll restoration on back/forward navigation
// immediately on popstate - before Astro's router has swapped in the new
// DOM or GSAP has re-pinned the homepage's reel section. Landing on a page
// whose pin-spacer hasn't been (re)built yet, that jump can go past the
// short interim layout's actual height, landing in blank space below all
// of it until GSAP catches up - a flash of the bare body background right
// before the reel snaps into place. Taking manual control here means the
// only thing that ever moves scroll on navigation is our own
// resetPageScroll(), already called on every astro:after-swap.
if ('scrollRestoration' in history) {
  history.scrollRestoration = 'manual';
}

// astro:page-load fires after every navigation (including the first), so
// per-page setup lives here instead of at module scope - module top-level
// code only runs once per session under ClientRouter's SPA navigation.
let teardown: Array<() => void> = [];

function initPage(): void {
  initRevealText();
  const reel = initProjectsReel();
  initFooterParallax();
  const projets = initProjetsPage();
  const projectPage = initProjectPage();
  const mainVideos = initMainVideos();

  teardown = [reel?.destroy, projets?.destroy, projectPage?.destroy, mainVideos?.destroy].filter(
    (fn): fn is () => void => typeof fn === 'function'
  );
}

// Each page's own destroy() releases its listeners/observers/rAF loops;
// ScrollTrigger.getAll is the catch-all for the scroll-triggered animations
// (reveal-text, footer) that don't track their own instances.
function teardownPage(): void {
  teardown.forEach((fn) => fn());
  teardown = [];
  ScrollTrigger.getAll().forEach((st) => st.kill());
}

// Runs right before the outgoing page's DOM is torn down.
document.addEventListener('astro:before-swap', teardownPage);
// The very first page-load of a hard load is held back until the site-entry
// loader starts lifting (see site-loader.ts) - the same moment a client-side
// navigation inits its page under the lifting #page-wipe - so no entrance
// animation plays unseen under the loader.
let isHardLoad = true;
document.addEventListener('astro:page-load', () => {
  if (!isHardLoad) return initPage();
  isHardLoad = false;
  // Astro's router restores the scroll position saved in history.state on
  // a reload (router.js init), regardless of scrollRestoration. The
  // homepage always starts from the top instead - its reel is a scroll-
  // driven sequence meant to be played from the start.
  if (document.querySelector('.projects-reel')) resetPageScroll();
  void runSiteLoader(initPage);
});

// The browser's bfcache can restore a page straight from a frozen snapshot
// (most commonly hit via the back/forward button) without Astro's router
// running at all - none of the astro:* events above fire. Whatever
// ScrollTrigger pins/Lenis state existed the instant the page was frozen
// come back exactly as they were, stale against the just-restored DOM and
// the browser's own (possibly mid-page, not top) scroll restoration - on a
// page with a pinned section (the homepage's reel) that can leave it
// mis-measured and rendering nothing where it's pinned. Treat a persisted
// pageshow exactly like a fresh navigation.
window.addEventListener('pageshow', (event) => {
  if (!event.persisted) return;
  resetPageScroll();
  teardownPage();
  initPage();
});

initPageTransitions();
initProjectMorph();
initSiteMenu();
