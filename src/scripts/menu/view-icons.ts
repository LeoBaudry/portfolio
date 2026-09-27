import gsap from 'gsap';
import { CustomEase } from 'gsap/CustomEase';

// The /projets view buttons' icons (MenuExtras.astro): one animation
// each, played on hover (repeating while the pointer stays) and on click
// (one cycle). Leaving never cuts it: the cycle under way finishes and the
// icon stops at rest. JS, not CSS, for that last part - a CSS animation
// stops dead the moment :hover ends.
// - vue 1: a new frame comes in from the right and pushes the current one
//   out to the left, inside the frame's area;
// - vue 2: same, one card at a time;
// - vue 3: the longest line walks down the list (1, 2, 3), then all back
//   to full length.

gsap.registerPlugin(CustomEase);

const PUSH_EASE = CustomEase.create('viewIconPush', '0.76, 0, 0.24, 1');
const PUSH = 0.6;
// Between two pushes, while the pointer stays.
const HOLD = 0.35;
const LINE_STEP = 0.42;
const LINE_SHORT = 0.55;

// One cycle of the push: the track slides left by one frame / card - the
// next one takes the place of the current - then snaps back, which looks
// identical (every frame / card is the same).
function pushCycle(track: SVGGElement, pitch: number): gsap.core.Timeline {
  return gsap
    .timeline()
    .to(track, { x: -pitch, duration: PUSH, ease: PUSH_EASE })
    .set(track, { x: 0 })
    .to({}, { duration: HOLD });
}

function linesCycle(lines: SVGLineElement[]): gsap.core.Timeline {
  const tl = gsap.timeline({ defaults: { duration: LINE_STEP, ease: PUSH_EASE, transformOrigin: '0% 50%' } });
  lines.forEach((longest, i) => {
    tl.to(lines.filter((line) => line !== longest), { scaleX: LINE_SHORT }, i === 0 ? 0 : '>');
    tl.to(longest, { scaleX: 1 }, '<');
  });
  return tl.to(lines, { scaleX: 1 }, '>').to({}, { duration: HOLD / 2 });
}

// Hover (a mouse only): cycles back to back while the pointer stays;
// leaving lets the current one finish. Click / tap: one cycle, if none is
// playing - on a touch screen that's the only trigger (a tap fires its own
// pointerenter / pointerleave, which would count as a hover).
function bind(button: HTMLElement, cycle: () => gsap.core.Timeline): void {
  let hovering = false;
  let running = false;
  const run = () => {
    running = true;
    cycle().eventCallback('onComplete', () => {
      running = false;
      if (hovering) run();
    });
  };
  button.addEventListener('pointerenter', (event) => {
    if (event.pointerType !== 'mouse') return;
    hovering = true;
    if (!running) run();
  });
  button.addEventListener('pointerleave', () => {
    hovering = false;
  });
  button.addEventListener('click', () => {
    if (!running) run();
  });
}

export function initViewIcons(): void {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const carousel = document.querySelector<HTMLElement>('.site-menu-extras [data-set-view="carousel"]');
  const carouselTrack = carousel?.querySelector<SVGGElement>('.icon-track');
  // Frame width + gap (MenuExtras.astro: 17 + 3).
  if (carousel && carouselTrack) bind(carousel, () => pushCycle(carouselTrack, 20));

  const dezoom = document.querySelector<HTMLElement>('.site-menu-extras [data-set-view="dezoom"]');
  const dezoomTrack = dezoom?.querySelector<SVGGElement>('.icon-track');
  // Card width + gap (4.5 + 2.75).
  if (dezoom && dezoomTrack) bind(dezoom, () => pushCycle(dezoomTrack, 7.25));

  const liste = document.querySelector<HTMLElement>('.site-menu-extras [data-set-view="liste"]');
  const lines = Array.from(liste?.querySelectorAll<SVGLineElement>('line') ?? []);
  if (liste && lines.length) bind(liste, () => linesCycle(lines));
}
