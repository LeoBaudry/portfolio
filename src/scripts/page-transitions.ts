import gsap from 'gsap';
import { CustomEase } from 'gsap/CustomEase';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(CustomEase, ScrollTrigger);

const WIPE_EASE = CustomEase.create('wipe', '0.76, 0, 0.24, 1');
const WIPE_IN_DURATION = 0.7;
const WIPE_OUT_DURATION = 0.9;
const SAFE_TOP_THRESHOLD_PX = 8;
const CONTENT_PARALLAX_VH = '10vh'; 

function contentSafeToLift(content: HTMLElement): boolean {
  // 1. Si on est tout en haut, on peut tout bouger d'un bloc sans risque
  if (Math.abs(content.getBoundingClientRect().top) < SAFE_TOP_THRESHOLD_PX) {
    return true;
  }
  // 2. Si on a scrollé, on vérifie s'il y a des "pins" (épingles) ScrollTrigger actifs.
  const hasActivePin = ScrollTrigger.getAll().some(st => st.pin && st.isActive);
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
    const content = document.getElementById('transition-root');
    const originalLoader = event.loader;

    const tl = gsap.timeline();
    tl.fromTo(overlay, { yPercent: 100 }, { yPercent: 0, duration: WIPE_IN_DURATION, ease: WIPE_EASE }, 0);
    
    if (content) {
      if (contentSafeToLift(content)) {
        // Scénario A : Sûr (haut de page ou page sans ScrollTrigger). 
        // On bouge tout d'un seul bloc via 'y'.
        tl.to(content, { y: `-${CONTENT_PARALLAX_VH}`, duration: WIPE_IN_DURATION, ease: WIPE_EASE }, 0);
      } else {
        // Scénario B : Dangereux (au milieu de la section projets de la homepage).
        // 1. On bouge le contenu normal de la page via 'top' (aucun saut de repère)
        tl.to(content, { top: `-${CONTENT_PARALLAX_VH}`, duration: WIPE_IN_DURATION, ease: WIPE_EASE }, 0);
        
        // 2. On isole exactement les éléments qui sont "collés" à l'écran à cet instant...
        const activePins = ScrollTrigger.getAll()
          .filter(st => st.pin && st.isActive)
          .map(st => st.pin);
          
        // 3. ...et on les fait monter manuellement en même temps que le reste !
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
    
    if (content) {
      // Nettoyage impératif des transforms pour que ScrollTrigger mesure 
      // la nouvelle page entrante à sa taille parfaite sans erreur.
      gsap.set(content, { clearProps: 'transform,top' });
      ScrollTrigger.refresh();
    }

    const tl = gsap.timeline();
    tl.to(overlay, { yPercent: -100, duration: WIPE_OUT_DURATION, ease: WIPE_EASE }, 0);

    if (content) {
      // L'animation entrante, qui se joue enfin systématiquement sans sauter.
      tl.fromTo(
        content,
        { y: CONTENT_PARALLAX_VH },
        { y: '0vh', duration: WIPE_OUT_DURATION, ease: WIPE_EASE, clearProps: 'transform' },
        0
      );
    }
  });
}