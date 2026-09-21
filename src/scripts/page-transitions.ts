import gsap from 'gsap';
import { CustomEase } from 'gsap/CustomEase';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(CustomEase, ScrollTrigger);

const WIPE_EASE = CustomEase.create('wipe', '0.76, 0, 0.24, 1');
const WIPE_IN_DURATION = 0.7;
const WIPE_OUT_DURATION = 0.9;
const SAFE_TOP_THRESHOLD_PX = 8;
const CONTENT_PARALLAX_VH = '10vh'; 

// --- GESTION DU BLOCAGE DU SCROLL ---
let isScrollLocked = false;

function preventScroll(e: Event) {
  if (isScrollLocked) {
    e.preventDefault();
    e.stopPropagation();
  }
}

function preventScrollKeys(e: KeyboardEvent) {
  if (!isScrollLocked) return;
  const keys = ['Space', 'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'];
  if (keys.includes(e.code)) {
    e.preventDefault();
    e.stopPropagation();
  }
}

function toggleScrollLock(locked: boolean) {
  isScrollLocked = locked;
  if (locked) {
    // L'option { capture: true } est magique ici : elle permet d'intercepter l'événement
    // AVANT que Lenis n'ait le temps de le lire pour calculer son inertie.
    window.addEventListener('wheel', preventScroll, { passive: false, capture: true });
    window.addEventListener('touchmove', preventScroll, { passive: false, capture: true });
    window.addEventListener('keydown', preventScrollKeys, { passive: false, capture: true });
  } else {
    window.removeEventListener('wheel', preventScroll, { capture: true });
    window.removeEventListener('touchmove', preventScroll, { capture: true });
    window.removeEventListener('keydown', preventScrollKeys, { capture: true });
  }
}
// ------------------------------------

/**
 * Détermine la stratégie pour le décalage (parallax) de la page sortante.
 */
function canLiftViaTransform(content: HTMLElement): boolean {
  if (Math.abs(content.getBoundingClientRect().top) < SAFE_TOP_THRESHOLD_PX) {
    return true;
  }
  
  const hasActivePin = ScrollTrigger.getAll().some((st) => st.pin && st.isActive);
  return !hasActivePin;
}

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function playTimeline(tl: gsap.core.Animation): Promise<void> {
  return new Promise((resolve) => {
    tl.eventCallback('onComplete', () => resolve());
  });
}

export function initPageTransitions(): void {
  const overlay = document.getElementById('page-wipe');
  if (!overlay || prefersReducedMotion()) return;

  gsap.set(overlay, { yPercent: 100 });

  let transitionInFlight = false;

  document.addEventListener('astro:before-preparation', (event: any) => {
    transitionInFlight = true;
    
    // 🔒 On verrouille le scroll dès qu'on clique sur un lien !
    toggleScrollLock(true);
    
    const content = document.getElementById('transition-root');
    const originalLoader = event.loader;

    const tl = gsap.timeline();
    tl.fromTo(overlay, { yPercent: 100 }, { yPercent: 0, duration: WIPE_IN_DURATION, ease: WIPE_EASE }, 0);
    
    if (content) {
      if (canLiftViaTransform(content)) {
        tl.to(content, { y: `-${CONTENT_PARALLAX_VH}`, duration: WIPE_IN_DURATION, ease: WIPE_EASE }, 0);
      } else {
        tl.to(content, { top: `-${CONTENT_PARALLAX_VH}`, duration: WIPE_IN_DURATION, ease: WIPE_EASE }, 0);
        
        const activePins = ScrollTrigger.getAll()
          .filter((st) => st.pin && st.isActive)
          .map((st) => st.pin as Element);
          
        if (activePins.length > 0) {
          tl.to(activePins, { y: `-${CONTENT_PARALLAX_VH}`, duration: WIPE_IN_DURATION, ease: WIPE_EASE }, 0);
        }
      }
    }

    event.loader = async () => {
      await Promise.all([originalLoader(), playTimeline(tl)]);
    };
  });

  document.addEventListener('astro:after-swap', () => {
    window.scrollTo(0, 0);
  });

  document.addEventListener('astro:page-load', () => {
    if (!transitionInFlight) return;
    transitionInFlight = false;

    const content = document.getElementById('transition-root');
    
    ScrollTrigger.refresh();

    const tl = gsap.timeline();
    
    // 🔓 On déverrouille le scroll EXACTEMENT quand le rideau finit de s'effacer
    tl.eventCallback('onComplete', () => {
      toggleScrollLock(false);
    });

    tl.to(overlay, { yPercent: -100, duration: WIPE_OUT_DURATION, ease: WIPE_EASE }, 0);

    if (content) {
      tl.fromTo(
        content,
        { y: CONTENT_PARALLAX_VH },
        { y: '0vh', duration: WIPE_OUT_DURATION, ease: WIPE_EASE, clearProps: 'transform' },
        0
      );
    }
  });
}