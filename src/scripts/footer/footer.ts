import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

const PARALLAX_YPERCENT = 8;

export function initFooterParallax(root: ParentNode = document): void {
  const wrap = root.querySelector<HTMLElement>('.footer-reveal');
  // Parallax the inner content only, never the sticky element that carries
  // the background - transforming that one leaves a gap where its painted
  // box no longer lines up with its (unmoved) layout/sticky position.
  const inner = wrap?.querySelector<HTMLElement>('.footer-inner');
  if (!wrap || !inner) return;

  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  gsap.fromTo(
    inner,
    { yPercent: -PARALLAX_YPERCENT },
    {
      yPercent: 0,
      ease: 'none',
      scrollTrigger: {
        trigger: wrap,
        start: 'top bottom',
        end: 'bottom bottom',
        scrub: true,
      },
    }
  );
}
