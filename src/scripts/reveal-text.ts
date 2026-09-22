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

    let delay = 0;
    const introParent = el.closest('.project-intro');
    if (introParent) {
      const siblings = Array.from(introParent.querySelectorAll('[data-reveal]'));
      delay = siblings.indexOf(el) * 0.15; 
    }

    SplitText.create(el, {
      type: mode,
      linesClass: 'reveal-line',
      charsClass: 'reveal-char',
      autoSplit: true,
      onSplit(self) {
        el.dataset.revealReady = 'true';
        const items = mode === 'chars' ? self.chars : self.lines;
        
        // FIX : Remplacement du gros slide vertical par un masque d'écrêtage (clip-path)
        // et un micro-mouvement de 10px, sans aucune perte d'opacité.
        return gsap.fromTo(items, 
          {
            clipPath: 'inset(100% 0% 0% 0%)', // Masqué à 100% par le bas
            y: 10 
          },
          {
            clipPath: 'inset(0% 0% 0% 0%)', // Totalement révélé
            y: 0,
            duration: mode === 'chars' ? CHAR_DURATION : LINE_DURATION,
            ease: EASE,
            stagger: mode === 'chars' ? CHAR_STAGGER : LINE_STAGGER,
            delay: delay,
            scrollTrigger: {
              trigger: el,
              start: 'top 85%',
              once: true,
            },
          }
        );
      },
    });
  });
}