// /projets: WAAPI settle helpers, the text masks, and "is this picture ready".

import { whenVideoReady } from '../main-video';
import {
  INFO_HIDE_DURATION,
  INFO_HIDE_EASE,
  INFO_PART_STAGGER,
  INFO_REVEAL_DURATION,
  INFO_REVEAL_EASE,
} from './timing';

let clearDistanceCache = new WeakMap<HTMLElement, number>();

// A height cached before the custom font finishes swapping in would stick
// (wrong) for the rest of the session otherwise - resize is the only other
// thing that clears this cache, and a font swap doesn't fire resize.
document.fonts?.ready.then(() => {
  clearDistanceCache = new WeakMap();
});

// Also cleared on resize (projets-page.ts).
export function resetClearDistanceCache(): void {
  clearDistanceCache = new WeakMap();
}

export function settle(animation: Animation, timeoutMs = 2000): Promise<void> {
  return new Promise((resolve) => {
    let isDone = false;
    const timer = window.setTimeout(() => finish(), timeoutMs);

    const finish = () => {
      if (isDone) return;
      isDone = true;
      clearTimeout(timer);
      try {
        if (animation.playState !== 'finished') animation.finish();
        animation.commitStyles();
      } catch {}
      animation.cancel();
      resolve();
    };

    animation.finished.then(finish).catch(finish);
  });
}

export function animateAndSettle(el: HTMLElement, keyframes: Keyframe[], options: KeyframeAnimationOptions): Promise<void> {
  // A second animate() call while a previous one from here is still
  // playing on the same element (e.g. dezoom's entrance reveal still
  // in-flight when a fast first click's leave-hide starts) doesn't cancel
  // it - WAAPI just runs both, so the element flickers through whichever
  // resolves last. The newest call always wins.
  el.getAnimations().forEach((anim) => anim.cancel());
  const durationMs = (options.duration as number) || 0;
  const delayMs = (options.delay as number) || 0;
  return settle(el.animate(keyframes, options), durationMs + delayMs + 200);
}

export function maskClearDistance(el: HTMLElement): number {
  let dist = clearDistanceCache.get(el);
  if (dist === undefined) {
    const mask = el.closest<HTMLElement>('.item-info');
    dist = (mask ?? el).getBoundingClientRect().height;
    clearDistanceCache.set(el, dist);
  }
  return dist;
}

export function hideInfoParts(name: HTMLElement | null, meta: HTMLElement | null, delay = 0): Promise<void> {
  const targets = [name, meta].filter((el): el is HTMLElement => Boolean(el));
  const clears = targets.map((el) => maskClearDistance(el));
  return Promise.all(
    targets.map((el, i) => animateAndSettle(el,
      [{ transform: 'translateY(0)' }, { transform: `translateY(${clears[i]}px)` }],
      { duration: INFO_HIDE_DURATION, delay: delay + i * INFO_PART_STAGGER, easing: INFO_HIDE_EASE, fill: 'forwards' }
    ))
  ).then(() => {});
}

export function revealInfoParts(name: HTMLElement | null, meta: HTMLElement | null, delay = 0): Promise<void> {
  const targets = [name, meta].filter((el): el is HTMLElement => Boolean(el));
  const clears = targets.map((el) => maskClearDistance(el));
  targets.forEach((el, i) => { el.style.transform = `translateY(${clears[i]}px)`; });
  return Promise.all(
    targets.map((el, i) => animateAndSettle(el,
      [{ transform: `translateY(${clears[i]}px)` }, { transform: 'translateY(0)' }],
      { duration: INFO_REVEAL_DURATION, delay: delay + i * INFO_PART_STAGGER, easing: INFO_REVEAL_EASE, fill: 'forwards' }
    ))
  ).then(() => {});
}

// Every hide/reveal/instant-set of an image's curtain bumps this, so a
// reveal still waiting on its image (see revealListeImageCurtain) can tell
// it's been superseded - e.g. leaving vue 3 before a slow image arrived -
// and not open a curtain on a row that's since been closed again.
export function bumpCurtainGen(wrap: HTMLElement): string {
  const gen = String(Number(wrap.dataset.curtainGen ?? 0) + 1);
  wrap.dataset.curtainGen = gen;
  return gen;
}

// Resolves once the image has pixels to show: loaded (or failed - never
// hold a curtain forever), then decoded, with decode() raced against a
// short timeout since it can hang. Thumbs are loading="lazy" (see
// ProjectImage.astro), so one that hasn't started yet is kicked off here.
// An image CSS hides at this breakpoint (vue 3 shows fewer per row on
// smaller screens, see .liste-image:nth-child in projets.astro) counts as
// ready right away: nobody will see it, and forcing it to load would make
// its row's title wait on a download that has no reason to happen.
function whenImageReady(img: HTMLImageElement | null): Promise<void> {
  if (!img || img.getClientRects().length === 0) return Promise.resolve();
  const loaded = img.complete
    ? Promise.resolve()
    : new Promise<void>((resolve) => {
        img.loading = 'eager';
        img.addEventListener('load', () => resolve(), { once: true });
        img.addEventListener('error', () => resolve(), { once: true });
      });
  return loaded.then(() =>
    Promise.race([img.decode().catch(() => {}), new Promise<void>((resolve) => setTimeout(resolve, 150))])
  );
}

// A main image's own readiness plus its video's (main-video.ts) - plain
// images/thumbs have no video, so that half is immediate.
export function whenMainVisualReady(img: HTMLImageElement | null): Promise<void> {
  return Promise.all([whenImageReady(img), whenVideoReady(img)]).then(() => {});
}
