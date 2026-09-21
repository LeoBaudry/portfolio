import gsap from 'gsap';
import { CustomEase } from 'gsap/CustomEase';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(CustomEase, ScrollTrigger);

const WIPE_EASE = CustomEase.create('wipe', '0.76, 0, 0.24, 1');
const WIPE_IN_DURATION = 0.7;
const WIPE_OUT_DURATION = 0.9;
const SAFE_TOP_THRESHOLD_PX = 8;
const CONTENT_PARALLAX_VH = '10vh'; 

/**
 * Determines the strategy for the outgoing parallax lift.
 * 
 * If the page is scrolled and a ScrollTrigger pin is active (e.g., the 
 * homepage reel), applying a CSS transform to #transition-root would change 
 * the containing block for fixed descendants, causing them to jump off-screen.
 * In that scenario, we must animate `top` instead, and manually transform 
 * the pinned elements.
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
    const content = document.getElementById('transition-root');
    const originalLoader = event.loader;

    const tl = gsap.timeline();
    tl.fromTo(overlay, { yPercent: 100 }, { yPercent: 0, duration: WIPE_IN_DURATION, ease: WIPE_EASE }, 0);
    
    if (content) {
      if (canLiftViaTransform(content)) {
        tl.to(content, { y: `-${CONTENT_PARALLAX_VH}`, duration: WIPE_IN_DURATION, ease: WIPE_EASE }, 0);
      } else {
        // Safe fallback for scrolled pages with active pins: animate layout 'top' 
        // to avoid reparenting, then manually lift the pinned elements to match.
        tl.to(content, { top: `-${CONTENT_PARALLAX_VH}`, duration: WIPE_IN_DURATION, ease: WIPE_EASE }, 0);
        
        const activePins = ScrollTrigger.getAll()
          .filter((st) => st.pin && st.isActive)
          // Type assertion required here: filter() guarantees st.pin exists, 
          // but TS doesn't narrow the type automatically without a custom guard.
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
    
    // The incoming DOM is fresh and carries no stale inline transforms.
    // We only need to ensure ScrollTrigger measures it accurately right now, 
    // before the screen uncovers and before we apply the incoming parallax offset.
    ScrollTrigger.refresh();

    const tl = gsap.timeline();
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