// project-page.ts
const REVEAL_DURATION = 650;
const REVEAL_DELAY = 150;
const REVEAL_EASE = 'cubic-bezier(0.16, 1, 0.3, 1)';
const MASK_HIDDEN = 'inset(100% 0 0 0)';
const MASK_VISIBLE = 'inset(0 0 0 0)';

// Chrome's native lazy-load never starts on an image fully hidden by its own
// clip-path, so loading is triggered by hand (loading='eager') ahead of view.
// Revealing before load would open the mask on an empty box, so wait for it.
function whenLoaded(el: HTMLElement): Promise<void> {
  if (!(el instanceof HTMLImageElement) || (el.complete && el.naturalWidth > 0)) return Promise.resolve();
  return new Promise((resolve) => {
    el.addEventListener('load', () => resolve(), { once: true });
    el.addEventListener('error', () => resolve(), { once: true });
  });
}

function startLoading(el: HTMLElement): void {
  if (el instanceof HTMLImageElement) el.loading = 'eager';
}

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
        startLoading(el);
        whenLoaded(el).then(() => {
          if (!el.isConnected) return;
          const reveal = el.animate([{ clipPath: MASK_HIDDEN }, { clipPath: MASK_VISIBLE }], {
            duration: REVEAL_DURATION,
            delay: REVEAL_DELAY,
            easing: REVEAL_EASE,
            fill: 'both',
          });
          reveal.finished
            .then(() => {
              el.style.clipPath = '';
            })
            .catch(() => {});
        });
      });
    },
    // FIX : Seuil abaissé à 0 pour forcer le déclenchement immédiat de l'affichage des images
    { threshold: 0 }
  );

  const preloader = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        preloader.unobserve(entry.target);
        startLoading(entry.target as HTMLElement);
      });
    },
    { rootMargin: '0px 0px 100% 0px' }
  );

  images.forEach((img) => {
    preloader.observe(img);
    observer.observe(img);
  });

  return {
    destroy: () => {
      preloader.disconnect();
      observer.disconnect();
    },
  };
}