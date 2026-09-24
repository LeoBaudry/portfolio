// /projets vue 3: one row's image curtains and title - open/close, animated or instant.

import {
  INFO_HIDE_DURATION,
  INFO_HIDE_EASE,
  INFO_PART_STAGGER,
  LISTE_IMAGE_STAGGER,
  LISTE_TITLE_AFTER_IMAGES,
  LISTE_TITLE_HIDDEN,
  LISTE_TITLE_PART_STAGGER,
  LISTE_TITLE_REVEAL_DURATION,
  MORPH_DURATION,
  MORPH_EASE,
  MORPH_SIBLING_EASE,
  MORPH_SIBLING_FADE_DURATION,
} from './timing';
import { animateAndSettle, bumpCurtainGen, whenMainVisualReady } from './anim';

interface RowCache {
  images: HTMLElement[];
}
const rowDOMCache = new WeakMap<HTMLElement, RowCache>();
export function getRowCache(row: HTMLElement): RowCache {
  let cached = rowDOMCache.get(row);
  if (!cached) {
    cached = {
      images: Array.from(row.querySelectorAll<HTMLElement>('.liste-image')),
    };
    rowDOMCache.set(row, cached);
  }
  return cached;
}

export function hideListeImageCurtain(wrap: HTMLElement, delay = 0): Promise<void> {
  const curtain = wrap.querySelector<HTMLElement>('.liste-image-curtain');
  if (!curtain) return Promise.resolve();
  bumpCurtainGen(wrap);
  curtain.style.transformOrigin = 'bottom';
  return animateAndSettle(curtain, [{ transform: 'scaleY(0)' }, { transform: 'scaleY(1)' }], {
    duration: MORPH_DURATION,
    delay,
    easing: MORPH_EASE,
    fill: 'forwards',
  }).then(() => {
    curtain.style.transform = 'scaleY(1)';
  });
}

// The curtain stays closed until its image is actually ready, so a slow
// image never gets revealed as an empty box that the photo pops into
// afterwards. `delay` still counts from the call, so images that are
// already there keep their place in the stagger; a late one simply opens
// as soon as it lands.
export function revealListeImageCurtain(wrap: HTMLElement, delay = 0): Promise<void> {
  const curtain = wrap.querySelector<HTMLElement>('.liste-image-curtain');
  if (!curtain) return Promise.resolve();
  const gen = bumpCurtainGen(wrap);
  curtain.style.transformOrigin = 'top';
  curtain.style.transform = 'scaleY(1)';
  const calledAt = performance.now();
  return whenMainVisualReady(wrap.querySelector('img')).then(() => {
    if (wrap.dataset.curtainGen !== gen) return;
    return animateAndSettle(curtain, [{ transform: 'scaleY(1)' }, { transform: 'scaleY(0)' }], {
      duration: MORPH_SIBLING_FADE_DURATION,
      delay: Math.max(0, delay - (performance.now() - calledAt)),
      easing: MORPH_SIBLING_EASE,
      fill: 'forwards',
    }).then(() => {
      curtain.style.transform = '';
    });
  });
}

export function hideListeRowImages(row: HTMLElement, delay = 0, skip = 0): Promise<void> {
  return Promise.all(
    getRowCache(row).images
      .slice(skip)
      .map((wrap, i) => hideListeImageCurtain(wrap, delay + i * LISTE_IMAGE_STAGGER))
  ).then(() => {});
}

function revealListeRowImages(row: HTMLElement, delay = 0): Promise<void> {
  const images = getRowCache(row).images;
  images.forEach((wrap) => {
    const curtain = wrap.querySelector<HTMLElement>('.liste-image-curtain');
    if (curtain) curtain.style.transform = 'scaleY(1)';
  });
  row.dataset.revealed = 'true';
  return Promise.all(
    images.map((wrap, i) => revealListeImageCurtain(wrap, delay + i * LISTE_IMAGE_STAGGER))
  ).then(() => {});
}

// Vue 3's title mask reveal: the name then the meta each rise out of the
// row's .item-info mask (overflow:hidden) and sink back into it.
function listeTitleParts(row: HTMLElement): HTMLElement[] {
  return [row.querySelector<HTMLElement>('.info-name'), row.querySelector<HTMLElement>('.info-meta')].filter(
    (el): el is HTMLElement => Boolean(el)
  );
}

export function hideListeTitle(row: HTMLElement, delay = 0): Promise<void> {
  bumpCurtainGen(row);
  return Promise.all(
    listeTitleParts(row).map((el, i) =>
      animateAndSettle(el, [{ transform: 'translateY(0)' }, { transform: LISTE_TITLE_HIDDEN }], {
        duration: INFO_HIDE_DURATION,
        delay: delay + i * INFO_PART_STAGGER,
        easing: INFO_HIDE_EASE,
        fill: 'forwards',
      }).then(() => {
        el.style.transform = LISTE_TITLE_HIDDEN;
      })
    )
  ).then(() => {});
}

export function revealListeTitle(row: HTMLElement, delay = 0): Promise<void> {
  setListeTitleClosedInstant(row);
  return Promise.all(
    listeTitleParts(row).map((el, i) =>
      animateAndSettle(el, [{ transform: LISTE_TITLE_HIDDEN }, { transform: 'translateY(0)' }], {
        duration: LISTE_TITLE_REVEAL_DURATION,
        delay: delay + i * LISTE_TITLE_PART_STAGGER,
        easing: MORPH_SIBLING_EASE,
        fill: 'forwards',
      }).then(() => {
        el.style.transform = '';
      })
    )
  ).then(() => {});
}

export function setListeTitleClosedInstant(row: HTMLElement): void {
  listeTitleParts(row).forEach((el) => {
    el.style.transform = LISTE_TITLE_HIDDEN;
  });
}

export function hideListeRow(row: HTMLElement, delay = 0): Promise<void> {
  const titleDone = hideListeTitle(row, delay);
  const imagesDone = hideListeRowImages(row, delay);
  return Promise.all([titleDone, imagesDone]).then(() => {
    setListeRowClosedInstant(row);
  });
}

// Images first (each opening as soon as it's loaded, see
// revealListeImageCurtain), then the title once they've all loaded - kept
// closed until then. A hide in the meantime bumps the row's generation
// (bumpCurtainGen, same guard as the image curtains) and cancels it.
export function showListeRow(row: HTMLElement, delay = 0): Promise<void> {
  row.dataset.revealed = 'true';
  setListeTitleClosedInstant(row);
  const gen = bumpCurtainGen(row);
  const calledAt = performance.now();
  const imagesDone = revealListeRowImages(row, delay);
  const titleDone = Promise.all(
    getRowCache(row).images.map((wrap) => whenMainVisualReady(wrap.querySelector('img')))
  ).then(() => {
    if (row.dataset.curtainGen !== gen) return;
    const rowDelayLeft = Math.max(0, delay - (performance.now() - calledAt));
    return revealListeTitle(row, rowDelayLeft + LISTE_TITLE_AFTER_IMAGES);
  });
  return Promise.all([titleDone, imagesDone]).then(() => {});
}

export function setListeRowClosedInstant(row: HTMLElement): void {
  getRowCache(row).images.forEach((wrap) => {
    bumpCurtainGen(wrap);
    const curtain = wrap.querySelector<HTMLElement>('.liste-image-curtain');
    if (curtain) curtain.style.transform = 'scaleY(1)';
  });
  setListeTitleClosedInstant(row);
  bumpCurtainGen(row);
  delete row.dataset.revealed;
}
