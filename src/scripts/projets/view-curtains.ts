// /projets vue 1/2: the ink curtains used when switching to/from vue 3.

import { MORPH_DURATION, MORPH_EASE, VIEW_REVEAL_DURATION, VIEW_REVEAL_EASE } from './timing';
import { animateAndSettle, bumpCurtainGen, whenMainVisualReady } from './anim';

function viewCurtain(item: HTMLElement | undefined): HTMLElement | null {
  return item?.querySelector<HTMLElement>('.view-curtain') ?? null;
}

// Same motion as hideListeImageCurtain / revealListeImageCurtain.
export function closeViewCurtain(item: HTMLElement | undefined, delay: number): Promise<void> {
  const curtain = viewCurtain(item);
  if (!curtain) return Promise.resolve();
  bumpCurtainGen(curtain);
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

// Waits for the picture (image + video) like vue 3's curtains; a close in
// the meantime supersedes it (bumpCurtainGen).
export function openViewCurtain(item: HTMLElement | undefined, delay: number): Promise<void> {
  const curtain = viewCurtain(item);
  if (!curtain || !item) return Promise.resolve();
  curtain.style.transformOrigin = 'top';
  curtain.style.transform = 'scaleY(1)';
  const gen = bumpCurtainGen(curtain);
  const calledAt = performance.now();
  return whenMainVisualReady(item.querySelector('img')).then(() => {
    if (curtain.dataset.curtainGen !== gen) return;
    return animateAndSettle(curtain, [{ transform: 'scaleY(1)' }, { transform: 'scaleY(0)' }], {
      duration: VIEW_REVEAL_DURATION,
      delay: Math.max(0, delay - (performance.now() - calledAt)),
      easing: VIEW_REVEAL_EASE,
      fill: 'forwards',
    }).then(() => {
      curtain.style.transform = '';
    });
  });
}

// Once the leaving panel is display:none - nobody sees the curtains
// reopen, and nothing else (the vue 1 <-> 2 morph) finds them closed.
export function resetViewCurtains(panel: HTMLElement): void {
  panel.querySelectorAll<HTMLElement>('.view-curtain').forEach((curtain) => {
    curtain.getAnimations().forEach((anim) => anim.cancel());
    curtain.style.transform = '';
  });
}
