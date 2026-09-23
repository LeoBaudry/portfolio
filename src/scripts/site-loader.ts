import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { toggleScrollLock } from './page-transitions';

// Site-entry loader, second half. #site-loader (Layout.astro) is server-
// rendered and covers the viewport from the first paint; its whole
// animation, exit included, runs from site-loader-inline.js, inlined in the
// HTML so it's alive while this bundle is still downloading. This half only
// hooks the page in: init it as the loader's columns start clearing, then
// hide the panel once they're gone.
//
// The panel is transition:persist'ed and only ever hidden, never removed -
// removing it would let the next page's own fresh copy mount and cover the
// screen.
//
// The page itself doesn't move during the exit (no parallax slide like
// #page-wipe's): ScrollTrigger re-measures on window 'load', which on a
// slow connection lands mid-exit - measured while shifted, the homepage
// reel's pin was left 10vh off, showing a strip of page background at the
// top until the next navigation.

declare global {
  interface Window {
    __siteLoader?: { reveal: Promise<void>; uncovered: Promise<void>; done: Promise<void> };
  }
}

/**
 * Resolves once the site-entry loader has cleared enough of the screen for
 * an entrance animation to be seen - immediately when it isn't showing
 * (every client-side navigation, reduced motion). Pages init as the
 * loader's columns *start* clearing, so an entrance kicked off right at init
 * would play out unseen underneath them: set the hidden starting state at
 * init, start the animation from this.
 */
export function afterSiteLoader(): Promise<void> {
  const loader = document.getElementById('site-loader');
  if (!loader || loader.hidden || !window.__siteLoader) return Promise.resolve();
  return window.__siteLoader.uncovered;
}

function hideLoader(loader: HTMLElement): void {
  loader.hidden = true;
  loader.setAttribute('aria-busy', 'false');
}

/**
 * Hooks the page in behind the loader, calling `onReveal` as its columns
 * start clearing - the page is being uncovered from that moment, the same as
 * a client-side navigation inits its page under the lifting #page-wipe.
 */
export async function runSiteLoader(onReveal: () => void): Promise<void> {
  const loader = document.getElementById('site-loader');
  const reveal = () => {
    onReveal();
    // Same as page-transitions.ts does after every client-side init: this
    // init can run after window 'load' (ScrollTrigger's own auto-refresh
    // point), so nothing else would re-measure the pins.
    ScrollTrigger.refresh();
  };

  if (!loader || loader.hidden || !window.__siteLoader) {
    if (loader) hideLoader(loader);
    reveal();
    return;
  }

  toggleScrollLock(true);
  await window.__siteLoader.reveal;
  reveal();
  await window.__siteLoader.done;
  hideLoader(loader);
  toggleScrollLock(false);
}
