// /projets vue 2: one card's image mask and text - reveal/hide.

import {
  DEZOOM_MASK_HIDDEN,
  DEZOOM_MASK_VISIBLE,
  MORPH_SIBLING_EASE,
  MORPH_SIBLING_FADE_DURATION,
} from './timing';
import {
  animateAndSettle,
  bumpCurtainGen,
  hideInfoParts,
  maskClearDistance,
  revealInfoParts,
  whenMainVisualReady,
} from './anim';

// What vue 2's clip-path masks (reveal, crop, morph siblings) apply to:
// the image's wrapper, not the <img> - so a main-visual video layered over
// the image (MainVisual.astro) is masked with it.
export function dezoomMask(item: HTMLElement): HTMLElement | null {
  return item.querySelector<HTMLElement>('.dezoom-image');
}

// Opens a card's mask once its image (and video, if any) can show -
// `delay` still counts from the call, same as revealListeImageCurtain. A
// newer open on the same card supersedes one still waiting.
export function openDezoomMask(item: HTMLElement, delay = 0): Promise<void> {
  const mask = dezoomMask(item);
  if (!mask) return Promise.resolve();
  const gen = bumpCurtainGen(mask);
  const calledAt = performance.now();
  return whenMainVisualReady(item.querySelector('img')).then(() => {
    if (mask.dataset.curtainGen !== gen) return;
    return animateAndSettle(mask, [{ clipPath: DEZOOM_MASK_HIDDEN }, { clipPath: DEZOOM_MASK_VISIBLE }], {
      duration: MORPH_SIBLING_FADE_DURATION,
      delay: Math.max(0, delay - (performance.now() - calledAt)),
      easing: MORPH_SIBLING_EASE,
      fill: 'forwards',
    }).then(() => {
      mask.style.clipPath = '';
    });
  });
}

// Mask, then the card's text - the text waits for the same readiness so
// it never arrives before its picture.
export function revealDezoomCard(item: HTMLElement, imageDelay: number, textDelay: number): Promise<void> {
  const calledAt = performance.now();
  const imageDone = openDezoomMask(item, imageDelay);
  const textDone = whenMainVisualReady(item.querySelector('img')).then(() =>
    showDezoomItemInfo(item, Math.max(0, textDelay - (performance.now() - calledAt)))
  );
  return Promise.all([imageDone, textDone]).then(() => {});
}

export function hideDezoomItemInfo(item: HTMLElement | undefined, delay = 0): Promise<void> {
  const name = item?.querySelector<HTMLElement>('.info-name') ?? null;
  const meta = item?.querySelector<HTMLElement>('.info-meta') ?? null;
  return hideInfoParts(name, meta, delay);
}

export function hideDezoomItemInfoInstant(item: HTMLElement | undefined): void {
  const name = item?.querySelector<HTMLElement>('.info-name') ?? null;
  const meta = item?.querySelector<HTMLElement>('.info-meta') ?? null;
  if (name) name.style.transform = `translateY(${maskClearDistance(name)}px)`;
  if (meta) meta.style.transform = `translateY(${maskClearDistance(meta)}px)`;
}

export function showDezoomItemInfo(item: HTMLElement | undefined, delay = 0): Promise<void> {
  const name = item?.querySelector<HTMLElement>('.info-name') ?? null;
  const meta = item?.querySelector<HTMLElement>('.info-meta') ?? null;
  return revealInfoParts(name, meta, delay);
}

export function resetDezoomItemInfoInstant(item: HTMLElement | undefined): void {
  const name = item?.querySelector<HTMLElement>('.info-name') ?? null;
  const meta = item?.querySelector<HTMLElement>('.info-meta') ?? null;
  if (name) name.style.transform = '';
  if (meta) meta.style.transform = '';
}
