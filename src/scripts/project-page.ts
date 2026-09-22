// project-page.ts
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
    // FIX : Seuil abaissé à 0 pour forcer le déclenchement immédiat de l'affichage des images
    { threshold: 0 }
  );

  images.forEach((img) => observer.observe(img));

  return {
    destroy: () => observer.disconnect(),
  };
}