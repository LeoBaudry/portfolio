import gsap from 'gsap';
import { SplitText } from 'gsap/SplitText';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(SplitText, ScrollTrigger);

const LINE_DURATION = 0.9;
const LINE_STAGGER = 0.06;
const CHAR_DURATION = 0.6;
const CHAR_STAGGER = 0.02;
const EASE = 'power3.out';

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function initRevealText(root: ParentNode = document): void {
  const targets = root.querySelectorAll<HTMLElement>('[data-reveal]');

  targets.forEach((el) => {
    if (el.dataset.revealReady) return;

    const mode = el.dataset.reveal === 'chars' ? 'chars' : 'lines';

    if (prefersReducedMotion()) {
      el.dataset.revealReady = 'true';
      return;
    }

    SplitText.create(el, {
      type: mode,
      mask: mode,
      linesClass: 'reveal-line',
      charsClass: 'reveal-char',
      autoSplit: true,
      onSplit(self) {
        el.dataset.revealReady = 'true';
        const items = mode === 'chars' ? self.chars : self.lines;
        return gsap.from(items, {
          yPercent: 110,
          duration: mode === 'chars' ? CHAR_DURATION : LINE_DURATION,
          ease: EASE,
          stagger: mode === 'chars' ? CHAR_STAGGER : LINE_STAGGER,
          scrollTrigger: {
            trigger: el,
            start: 'top 85%',
            once: true,
          },
        });
      },
    });
  });
}
