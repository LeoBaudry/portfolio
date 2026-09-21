import { ScrollTrigger } from 'gsap/ScrollTrigger';
import './smooth-scroll';
import { initPageTransitions } from './page-transitions';
import { initRevealText } from './reveal-text';
import { initProjectsReel } from './projects-reel';
import { initFooterParallax } from './footer';
import { initProjetsPage } from './projets-page';

// astro:page-load fires after every navigation (including the first), so
// per-page setup lives here instead of at module scope - module top-level
// code only runs once per session under ClientRouter's SPA navigation.
let teardown: Array<() => void> = [];

document.addEventListener('astro:page-load', () => {
  initRevealText();
  const reel = initProjectsReel();
  initFooterParallax();
  const projets = initProjetsPage();

  teardown = [reel?.destroy, projets?.destroy].filter(
    (fn): fn is () => void => typeof fn === 'function'
  );
});

// Runs right before the outgoing page's DOM is torn down. Each page's own
// destroy() releases its listeners/observers/rAF loops; ScrollTrigger.getAll
// is the catch-all for the scroll-triggered animations (reveal-text,
// footer) that don't track their own instances.
document.addEventListener('astro:before-swap', () => {
  teardown.forEach((fn) => fn());
  teardown = [];
  ScrollTrigger.getAll().forEach((st) => st.kill());
});

initPageTransitions();
