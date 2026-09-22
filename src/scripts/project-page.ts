// Individual project page: the extra images below the intro (project-page's
// .project-extra blocks) reveal one at a time as they scroll into view -
// same clip-path-grows-from-bottom language as the dezoom sibling reveal in
// projets-page.ts (initDezoomObserver), reused here via plain values since
// that file's constants are private to its own closure.
const REVEAL_DURATION = 650;
const REVEAL_EASE = 'cubic-bezier(0.16, 1, 0.3, 1)';
const MASK_HIDDEN = 'inset(100% 0 0 0)';
const MASK_VISIBLE = 'inset(0 0 0 0)';

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function initProjectPage(root: ParentNode = document): { destroy: () => void } | undefined {
  const images = Array.from(root.querySelectorAll<HTMLElement>('[data-reveal-image]'));
  if (images.length === 0) return undefined;

  if (prefersReducedMotion()) {
    images.forEach((img) => {
      img.style.clipPath = '';
    });
    return undefined;
  }

  images.forEach((img) => {
    img.style.clipPath = MASK_HIDDEN;
  });

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        const el = entry.target as HTMLElement;
        observer.unobserve(el);
        const reveal = el.animate([{ clipPath: MASK_HIDDEN }, { clipPath: MASK_VISIBLE }], {
          duration: REVEAL_DURATION,
          easing: REVEAL_EASE,
          fill: 'forwards',
        });
        reveal.finished
          .then(() => {
            el.style.clipPath = '';
          })
          .catch(() => {});
      });
    },
    { threshold: 0.2 }
  );

  images.forEach((img) => observer.observe(img));

  return {
    destroy: () => observer.disconnect(),
  };
}
