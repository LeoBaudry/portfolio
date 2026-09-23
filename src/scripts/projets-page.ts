import Lenis from 'lenis';
import { lenis as pageLenis } from './smooth-scroll';
import {
  isBackwardMorphPending,
  morphEvents,
  MORPH_SETTLED_EVENT,
  registerMorphLeaveHook,
  registerMorphCenterHook,
} from './project-morph';

const PROJETS_STATE_KEY = 'projets-view-state';

function saveProjetsState(view: string, current: number): void {
  try {
    sessionStorage.setItem(PROJETS_STATE_KEY, JSON.stringify({ view, current }));
  } catch {}
}

function readProjetsState(): { view: 'carousel' | 'dezoom' | 'liste'; current: number } | null {
  try {
    const raw = sessionStorage.getItem(PROJETS_STATE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed.current === 'number' &&
      ['carousel', 'dezoom', 'liste'].includes(parsed.view)
    ) {
      return parsed;
    }
  } catch {}
  return null;
}

const WHEEL_THRESHOLD = 18;
const STEP_DURATION = 850;
const STEP_EASE = 'cubic-bezier(0.77, 0, 0.175, 1)';

const INFO_HIDE_DURATION = 320;
const INFO_HIDE_EASE = 'cubic-bezier(0.4, 0, 1, 1)';
const INFO_REVEAL_DURATION = 380;
const INFO_REVEAL_EASE = 'cubic-bezier(0, 0, 0.2, 1)';
const INFO_PART_STAGGER = 70;
const INFO_HIDE_TOTAL = INFO_HIDE_DURATION + INFO_PART_STAGGER;
const STEP_INFO_HIDE_DELAY = 150;
const STEP_INFO_REVEAL_DELAY = STEP_DURATION * 0.85;

const DEZOOM_INFO_HIDE_DELAY = 450;
const CAROUSEL_INFO_HIDE_DELAY = 350;

const MORPH_DURATION = 700;
const MORPH_EASE = 'cubic-bezier(0.4, 0, 0.2, 1)';
const MORPH_SIBLING_FADE_DURATION = 650;
const MORPH_SIBLING_EASE = 'cubic-bezier(0.16, 1, 0.3, 1)'; 

const DEZOOM_OTHERS_IMAGE_DELAY = 150; 
const DEZOOM_OTHERS_TEXT_DELAY = MORPH_SIBLING_FADE_DURATION * 0.85;

const DEZOOM_CROP_CLOSED = 'inset(50% 0 50% 0)';
const DEZOOM_MASK_HIDDEN = 'inset(100% 0 0 0)';
const DEZOOM_MASK_VISIBLE = 'inset(0 0 0 0)';

const LISTE_ROW_STAGGER = 60;
const PANEL_FADE_DURATION = 320;
const PANEL_FADE_EASE = 'cubic-bezier(0.4, 0, 0.2, 1)';

type ViewMode = 'carousel' | 'dezoom' | 'liste';

interface RowCache {
  images: HTMLElement[];
  curtain: HTMLElement | null;
  info: HTMLElement | null;
}
const rowDOMCache = new WeakMap<HTMLElement, RowCache>();
let clearDistanceCache = new WeakMap<HTMLElement, number>();

// A height cached before the custom font finishes swapping in would stick
// (wrong) for the rest of the session otherwise - resize is the only other
// thing that clears this cache, and a font swap doesn't fire resize.
document.fonts?.ready.then(() => {
  clearDistanceCache = new WeakMap();
});

function getRowCache(row: HTMLElement): RowCache {
  let cached = rowDOMCache.get(row);
  if (!cached) {
    cached = {
      images: Array.from(row.querySelectorAll<HTMLElement>('.liste-image')),
      curtain: row.querySelector<HTMLElement>('.liste-title-curtain'),
      info: row.querySelector<HTMLElement>('.item-info')
    };
    rowDOMCache.set(row, cached);
  }
  return cached;
}

// The navigation entry describes the whole document, not each client-side
// navigation, so "reload" is only meaningful for the very first init.
let isFirstInit = true;

function consumeIsReload(): boolean {
  const wasFirst = isFirstInit;
  isFirstInit = false;
  const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
  return wasFirst && nav?.type === 'reload';
}

export function initProjetsPage(root: ParentNode = document) {
  const isReload = consumeIsReload();
  const page = root.querySelector<HTMLElement>('.projects-page');
  if (!page) return;

  const panels: Record<ViewMode, HTMLElement | null> = {
    carousel: page.querySelector('.view-carousel'),
    dezoom: page.querySelector('.view-dezoom'),
    liste: page.querySelector('.view-liste'),
  };
  const switcherButtons = Array.from(page.querySelectorAll<HTMLButtonElement>('[data-set-view]'));
  const morphHero = page.querySelector<HTMLImageElement>('.morph-hero');

  const restored = isBackwardMorphPending() || isReload ? readProjetsState() : null;
  const projectCount = page.querySelectorAll('.carousel-item').length;
  let view: ViewMode = restored?.view ?? 'carousel';
  let current = Math.max(0, Math.min(restored?.current ?? 0, projectCount - 1));
  let switching = false;
  
  let rafId: number;
  let isDezoomActive = false;
  let dezoomObserver: IntersectionObserver | null = null;
  const clickHandlers: { btn: HTMLButtonElement; handler: () => void }[] = [];

  let listeMorphSettled = !isBackwardMorphPending();

  function updateSwitcherUI(): void {
    switcherButtons.forEach((btn) => {
      const active = btn.dataset.setView === view;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-pressed', String(active));
    });
  }

  function setView(next: ViewMode): void {
    if (next === view || switching) return;

    const isCarouselDezoomMorph =
      (view === 'carousel' && next === 'dezoom') || (view === 'dezoom' && next === 'carousel');

    switching = true;
    const transition = isCarouselDezoomMorph ? morphBetweenCarouselAndDezoom(next) : transitionListe(next);
    transition.finally(() => {
      switching = false;
    });
  }

  switcherButtons.forEach((btn) => {
    const handler = () => setView((btn.dataset.setView as ViewMode) ?? 'carousel');
    btn.addEventListener('click', handler);
    clickHandlers.push({ btn, handler });
  });

  function settle(animation: Animation, timeoutMs = 2000): Promise<void> {
    return new Promise((resolve) => {
      let isDone = false;
      const timer = window.setTimeout(() => finish(), timeoutMs);

      const finish = () => {
        if (isDone) return;
        isDone = true;
        clearTimeout(timer);
        try {
          if (animation.playState !== 'finished') animation.finish();
          animation.commitStyles();
        } catch {}
        animation.cancel();
        resolve();
      };

      animation.finished.then(finish).catch(finish);
    });
  }

  function animateAndSettle(el: HTMLElement, keyframes: Keyframe[], options: KeyframeAnimationOptions): Promise<void> {
    // A second animate() call while a previous one from here is still
    // playing on the same element (e.g. dezoom's entrance reveal still
    // in-flight when a fast first click's leave-hide starts) doesn't cancel
    // it - WAAPI just runs both, so the element flickers through whichever
    // resolves last. The newest call always wins.
    el.getAnimations().forEach((anim) => anim.cancel());
    const durationMs = (options.duration as number) || 0;
    const delayMs = (options.delay as number) || 0;
    return settle(el.animate(keyframes, options), durationMs + delayMs + 200);
  }

  function maskClearDistance(el: HTMLElement): number {
    let dist = clearDistanceCache.get(el);
    if (dist === undefined) {
      const mask = el.closest<HTMLElement>('.item-info');
      dist = (mask ?? el).getBoundingClientRect().height;
      clearDistanceCache.set(el, dist);
    }
    return dist;
  }

  function hideInfoParts(name: HTMLElement | null, meta: HTMLElement | null, delay = 0): Promise<void> {
    const targets = [name, meta].filter((el): el is HTMLElement => Boolean(el));
    const clears = targets.map((el) => maskClearDistance(el));
    return Promise.all(
      targets.map((el, i) => animateAndSettle(el, 
        [{ transform: 'translateY(0)' }, { transform: `translateY(${clears[i]}px)` }], 
        { duration: INFO_HIDE_DURATION, delay: delay + i * INFO_PART_STAGGER, easing: INFO_HIDE_EASE, fill: 'forwards' }
      ))
    ).then(() => {});
  }

  function revealInfoParts(name: HTMLElement | null, meta: HTMLElement | null, delay = 0): Promise<void> {
    const targets = [name, meta].filter((el): el is HTMLElement => Boolean(el));
    const clears = targets.map((el) => maskClearDistance(el));
    targets.forEach((el, i) => { el.style.transform = `translateY(${clears[i]}px)`; });
    return Promise.all(
      targets.map((el, i) => animateAndSettle(el, 
        [{ transform: `translateY(${clears[i]}px)` }, { transform: 'translateY(0)' }], 
        { duration: INFO_REVEAL_DURATION, delay: delay + i * INFO_PART_STAGGER, easing: INFO_REVEAL_EASE, fill: 'forwards' }
      ))
    ).then(() => {});
  }

  const carouselItems = Array.from(panels.carousel?.querySelectorAll<HTMLElement>('.carousel-item') ?? []);
  const carouselInfoMask = panels.carousel?.querySelector<HTMLElement>('.carousel-info') ?? null;
  const carouselInfoContent = carouselInfoMask?.querySelector<HTMLElement>('.info-content') ?? null;
  const carouselInfoName = carouselInfoContent?.querySelector<HTMLElement>('.info-name') ?? null;
  const carouselInfoMeta = carouselInfoContent?.querySelector<HTMLElement>('.info-meta') ?? null;
  const n = carouselItems.length;
  let carouselIndex = 0;
  let carouselLocked = false;
  let carouselAnimation: Animation | null = null;
  
  // FIX QUEUEING : On stocke l'intention de clic pour l'appliquer au projet entrant
  let queuedCarouselMorph = false;
  const carouselLinks = Array.from(panels.carousel?.querySelectorAll<HTMLAnchorElement>('.morph-link') ?? []);
  
  carouselLinks.forEach(link => {
    link.addEventListener('click', (e) => {
      if (carouselLocked) {
        // Le clic a eu lieu pendant une animation de transition !
        // On annule ce faux clic, et on se prépare à déclencher le projet de destination.
        e.preventDefault();
        e.stopPropagation();
        queuedCarouselMorph = true;
      }
    });
  });

  function setCarouselCurrentImage(index: number): void {
    carouselAnimation?.cancel();
    carouselAnimation = null;
    carouselLocked = false;
    queuedCarouselMorph = false;
    carouselItems.forEach((el, i) => {
      el.classList.toggle('is-current', i === index);
      el.style.transform = '';
      el.style.zIndex = '';
      el.style.clipPath = '';
    });
  }

  function setCarouselInfoInstant(index: number): void {
    const item = carouselItems[index];
    if (carouselInfoName) {
      carouselInfoName.textContent = item?.dataset.name ?? '';
      carouselInfoName.style.transform = 'translateY(0)';
    }
    if (carouselInfoMeta) {
      carouselInfoMeta.textContent = item?.dataset.meta ?? '';
      carouselInfoMeta.style.transform = 'translateY(0)';
    }
  }

  function hideCarouselInfo(delay = 0): Promise<void> {
    return hideInfoParts(carouselInfoName, carouselInfoMeta, delay);
  }

  function showCarouselInfo(index: number, delay = 0): Promise<void> {
    const item = carouselItems[index];
    if (carouselInfoName) carouselInfoName.textContent = item?.dataset.name ?? '';
    if (carouselInfoMeta) carouselInfoMeta.textContent = item?.dataset.meta ?? '';
    return revealInfoParts(carouselInfoName, carouselInfoMeta, delay);
  }

  // --- VUE 1 : CURTAIN REVEAL PUR ---
  function stepCarousel(dir: 1 | -1): void {
    if (carouselLocked || switching || n < 2) return;
    const fromIndex = carouselIndex;
    const toIndex = (carouselIndex + dir + n) % n;
    const fromEl = carouselItems[fromIndex];
    const toEl = carouselItems[toIndex];

    carouselLocked = true;
    hideCarouselInfo(STEP_INFO_HIDE_DELAY).then(() => {
      showCarouselInfo(toIndex, Math.max(0, STEP_INFO_REVEAL_DELAY - STEP_INFO_HIDE_DELAY - INFO_HIDE_TOTAL));
    });

    toEl.style.zIndex = '2';
    fromEl.style.zIndex = '1';
    toEl.classList.add('is-current');

    // FIX FLASH : Le vieux projet ne subit AUCUN mouvement et AUCUN scale. 
    // Il attend juste que le nouveau rideau le recouvre.
    fromEl.style.transform = '';

    // On crée un rideau pur via clip-path. 
    // Vers l'avant (1) = le rideau se tire de droite à gauche.
    const clipStart = dir === 1 ? 'inset(0% 0% 0% 100%)' : 'inset(0% 100% 0% 0%)';

    const animation = (carouselAnimation = toEl.animate(
      [
        { clipPath: clipStart },
        { clipPath: 'inset(0% 0% 0% 0%)' }
      ],
      { duration: STEP_DURATION, easing: STEP_EASE, fill: 'forwards' }
    ));

    settle(animation).then(() => {
      carouselAnimation = null;
      toEl.style.zIndex = '';
      toEl.style.clipPath = '';
      fromEl.style.zIndex = '';
      fromEl.classList.remove('is-current');
      carouselIndex = toIndex;
      current = carouselIndex;
      carouselLocked = false;
      
      // FIX QUEUEING : Si on a cliqué pendant l'animation, on lance l'ouverture
      // du projet fraîchement arrivé (toIndex) !
      if (queuedCarouselMorph) {
        queuedCarouselMorph = false;
        const activeLink = carouselItems[current].querySelector<HTMLAnchorElement>('.morph-link');
        if (activeLink) activeLink.click();
      }
    });
  }

  const handleWheel = (e: WheelEvent) => {
    e.preventDefault();
    if (switching || carouselLocked || Math.abs(e.deltaY) < WHEEL_THRESHOLD) return;
    stepCarousel(e.deltaY > 0 ? 1 : -1);
  };
  panels.carousel?.addEventListener('wheel', handleWheel, { passive: false });

  const dezoomTrack = panels.dezoom?.querySelector<HTMLElement>('.dezoom-track') ?? null;
  const dezoomItems = Array.from(panels.dezoom?.querySelectorAll<HTMLElement>('.dezoom-item') ?? []);
  let dezoomLenis: Lenis | null = null;

  function initDezoomObserver() {
    if (!panels.dezoom || dezoomObserver) return;
    dezoomObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const el = entry.target as HTMLElement;
          if (el.dataset.revealed) return;
          el.dataset.revealed = 'true';
          
          const img = el.querySelector('img');
          if (img) {
            animateAndSettle(img, [{ clipPath: DEZOOM_MASK_HIDDEN }, { clipPath: DEZOOM_MASK_VISIBLE }], {
              duration: MORPH_SIBLING_FADE_DURATION,
              easing: MORPH_SIBLING_EASE,
              fill: 'forwards'
            }).then(() => {
              img.style.clipPath = '';
            });
          }
          showDezoomItemInfo(el, DEZOOM_OTHERS_TEXT_DELAY);
        }
      });
    }, {
      root: panels.dezoom,
      // 0, not a fraction: on mobile the neighbours only peek in by a sliver,
      // and visibleDezoomItems() already counts any sliver as visible.
      threshold: 0
    });
    dezoomItems.forEach(el => dezoomObserver!.observe(el));
  }

  const dezoomRaf = (time: number) => {
    if (!isDezoomActive) return;
    dezoomLenis?.raf(time);
    rafId = requestAnimationFrame(dezoomRaf);
  };

  function ensureDezoomLenis(): Lenis | null {
    if (!panels.dezoom || !dezoomTrack) return null;
    if (!dezoomLenis) {
      dezoomLenis = new Lenis({
        wrapper: panels.dezoom,
        content: dezoomTrack,
        orientation: 'horizontal',
        gestureOrientation: 'vertical',
        eventsTarget: panels.dezoom,
        smoothWheel: true,
      });
      initDezoomObserver();
    }
    return dezoomLenis;
  }

  function currentFromDezoom(): number {
    if (dezoomItems.length === 0 || !panels.dezoom) return current;
    const scrollLeft = panels.dezoom.scrollLeft;
    const panelWidth = panels.dezoom.clientWidth;
    const limit = dezoomLenis?.limit ?? Infinity;

    let best = 0;
    let bestDist = Infinity;
    dezoomItems.forEach((el, i) => {
      const centered = el.offsetLeft - (panelWidth - el.offsetWidth) / 2;
      const dist = Math.abs(Math.max(0, Math.min(centered, limit)) - scrollLeft);
      if (dist < bestDist) {
        bestDist = dist;
        best = i;
      }
    });
    return best;
  }

  function scrollDezoomToCurrent(dl: Lenis | null): void {
    const target = dezoomItems[current];
    if (!dl || !target || !panels.dezoom) return;
    dl.resize();
    const panelWidth = panels.dezoom.clientWidth;
    const centered = target.offsetLeft - (panelWidth - target.offsetWidth) / 2;
    const clamped = Math.max(0, Math.min(centered, dl.limit));
    dl.scrollTo(clamped, { immediate: true, force: true });
    panels.dezoom.scrollLeft = clamped;
  }

  function centerDezoomItem(item: HTMLElement): Promise<void> {
    if (!panels.dezoom || !dezoomLenis) return Promise.resolve();
    const panelWidth = panels.dezoom.clientWidth;
    const centered = item.offsetLeft - (panelWidth - item.offsetWidth) / 2;
    const clamped = Math.max(0, Math.min(centered, dezoomLenis.limit));
    if (Math.abs(panels.dezoom.scrollLeft - clamped) < 1) return Promise.resolve();

    return new Promise((resolve) => {
      dezoomLenis!.scrollTo(clamped, { duration: 0.5, onComplete: () => resolve() });
    });
  }

  function hideDezoomItemInfo(item: HTMLElement | undefined, delay = 0): Promise<void> {
    const name = item?.querySelector<HTMLElement>('.info-name') ?? null;
    const meta = item?.querySelector<HTMLElement>('.info-meta') ?? null;
    return hideInfoParts(name, meta, delay);
  }

  function hideDezoomItemInfoInstant(item: HTMLElement | undefined): void {
    const name = item?.querySelector<HTMLElement>('.info-name') ?? null;
    const meta = item?.querySelector<HTMLElement>('.info-meta') ?? null;
    if (name) name.style.transform = `translateY(${maskClearDistance(name)}px)`;
    if (meta) meta.style.transform = `translateY(${maskClearDistance(meta)}px)`;
  }

  function showDezoomItemInfo(item: HTMLElement | undefined, delay = 0): Promise<void> {
    const name = item?.querySelector<HTMLElement>('.info-name') ?? null;
    const meta = item?.querySelector<HTMLElement>('.info-meta') ?? null;
    return revealInfoParts(name, meta, delay);
  }

  function resetDezoomItemInfoInstant(item: HTMLElement | undefined): void {
    const name = item?.querySelector<HTMLElement>('.info-name') ?? null;
    const meta = item?.querySelector<HTMLElement>('.info-meta') ?? null;
    if (name) name.style.transform = '';
    if (meta) meta.style.transform = '';
  }

  const listeRows = Array.from(panels.liste?.querySelectorAll<HTMLElement>('.liste-row') ?? []);
  const LISTE_IMAGE_STAGGER = 100;
  const LISTE_TITLE_NUDGE_PX = 10;
  let listeRevealObserver: IntersectionObserver | null = null;

  listeRows.forEach((row) => setListeRowClosedInstant(row));
  initListeRevealObserver();

  function currentFromListe(): number {
    if (listeRows.length === 0) return current;
    const mid = window.innerHeight / 2;
    let best = 0;
    let bestDist = Infinity;
    listeRows.forEach((el, i) => {
      const r = el.getBoundingClientRect();
      const dist = Math.abs((r.top + r.bottom) / 2 - mid);
      if (dist < bestDist) {
        bestDist = dist;
        best = i;
      }
    });
    return best;
  }

  function scrollListeToCurrent(): void {
    const target = listeRows[current];
    if (!target) return;
    if (pageLenis) {
      pageLenis.resize(); 
      const rect = target.getBoundingClientRect();
      const targetY = window.scrollY + rect.top + (rect.height / 2) - (window.innerHeight / 2);
      const clamped = Math.max(0, Math.min(targetY, pageLenis.limit));
      pageLenis.scrollTo(clamped, { immediate: true, force: true });
    } else {
      target.scrollIntoView({ block: 'center' });
    }
  }

  function centerListeRow(row: HTMLElement): Promise<void> {
    if (!pageLenis) return Promise.resolve();
    pageLenis.resize(); 
    const rect = row.getBoundingClientRect();
    const target = window.scrollY + rect.top + (rect.height / 2) - (window.innerHeight / 2);
    const clamped = Math.max(0, Math.min(target, pageLenis.limit));
    
    if (Math.abs(window.scrollY - clamped) < 1) return Promise.resolve();

    return new Promise((resolve) => {
      pageLenis!.scrollTo(clamped, { duration: 0.5, force: true, onComplete: () => resolve() });
    });
  }

  function hideListeImageCurtain(wrap: HTMLElement, delay = 0): Promise<void> {
    const curtain = wrap.querySelector<HTMLElement>('.liste-image-curtain');
    if (!curtain) return Promise.resolve();
    curtain.style.transformOrigin = 'bottom';
    return animateAndSettle(curtain, [{ transform: 'scaleY(0)' }, { transform: 'scaleY(1)' }], {
      duration: MORPH_DURATION,
      delay,
      easing: MORPH_EASE,
      fill: 'forwards',
    }).then(() => {
      curtain.style.transform = 'scaleY(1)';
    });
  }

  function revealListeImageCurtain(wrap: HTMLElement, delay = 0): Promise<void> {
    const curtain = wrap.querySelector<HTMLElement>('.liste-image-curtain');
    if (!curtain) return Promise.resolve();
    curtain.style.transformOrigin = 'top';
    curtain.style.transform = 'scaleY(1)';
    return animateAndSettle(curtain, [{ transform: 'scaleY(1)' }, { transform: 'scaleY(0)' }], {
      duration: MORPH_SIBLING_FADE_DURATION,
      delay,
      easing: MORPH_SIBLING_EASE,
      fill: 'forwards',
    }).then(() => {
      curtain.style.transform = '';
    });
  }

  function hideListeRowImages(row: HTMLElement, delay = 0, skip = 0): Promise<void> {
    return Promise.all(
      getRowCache(row).images
        .slice(skip)
        .map((wrap, i) => hideListeImageCurtain(wrap, delay + i * LISTE_IMAGE_STAGGER))
    ).then(() => {});
  }

  function revealListeRowImages(row: HTMLElement, delay = 0): Promise<void> {
    const images = getRowCache(row).images;
    images.forEach((wrap) => {
      const curtain = wrap.querySelector<HTMLElement>('.liste-image-curtain');
      if (curtain) curtain.style.transform = 'scaleY(1)';
    });
    row.dataset.revealed = 'true';
    return Promise.all(
      images.map((wrap, i) => revealListeImageCurtain(wrap, delay + i * LISTE_IMAGE_STAGGER))
    ).then(() => {});
  }

  function hideListeTitle(row: HTMLElement, delay = 0): Promise<void> {
    const { info, curtain } = getRowCache(row);
    
    const infoDone = info ? animateAndSettle(info, 
      [{ transform: 'translateY(0)' }, { transform: `translateY(${LISTE_TITLE_NUDGE_PX}px)` }], 
      { duration: INFO_HIDE_DURATION, delay, easing: INFO_HIDE_EASE, fill: 'forwards' }
    ).then(() => {
      info.style.transform = `translateY(${LISTE_TITLE_NUDGE_PX}px)`;
    }) : Promise.resolve();

    const curtainDone = curtain ? (() => {
      curtain.style.transformOrigin = 'bottom';
      return animateAndSettle(curtain, 
        [{ transform: 'scaleY(0)' }, { transform: 'scaleY(1)' }], 
        { duration: MORPH_DURATION, delay, easing: MORPH_EASE, fill: 'forwards' }
      ).then(() => {
        curtain.style.transform = 'scaleY(1)';
      });
    })() : Promise.resolve();
    
    return Promise.all([infoDone, curtainDone]).then(() => {});
  }

  function revealListeTitle(row: HTMLElement, delay = 0): Promise<void> {
    setListeTitleClosedInstant(row);
    const { info, curtain } = getRowCache(row);
    
    const infoDone = info ? animateAndSettle(info, 
      [{ transform: `translateY(${LISTE_TITLE_NUDGE_PX}px)` }, { transform: 'translateY(0)' }], 
      { duration: INFO_REVEAL_DURATION, delay, easing: INFO_REVEAL_EASE, fill: 'forwards' }
    ).then(() => {
      info.style.transform = '';
    }) : Promise.resolve();

    const curtainDone = curtain ? (() => {
      curtain.style.transformOrigin = 'top';
      return animateAndSettle(curtain, 
        [{ transform: 'scaleY(1)' }, { transform: 'scaleY(0)' }], 
        { duration: MORPH_SIBLING_FADE_DURATION, delay, easing: MORPH_SIBLING_EASE, fill: 'forwards' }
      ).then(() => {
        curtain.style.transform = '';
      });
    })() : Promise.resolve();
    
    return Promise.all([infoDone, curtainDone]).then(() => {});
  }

  function setListeTitleClosedInstant(row: HTMLElement): void {
    const { info, curtain } = getRowCache(row);
    if (curtain) curtain.style.transform = 'scaleY(1)';
    if (info) info.style.transform = `translateY(${LISTE_TITLE_NUDGE_PX}px)`;
  }

  function setListeTitleOpenInstant(row: HTMLElement): void {
    const { info, curtain } = getRowCache(row);
    if (curtain) curtain.style.transform = '';
    if (info) info.style.transform = '';
  }

  function hideListeRow(row: HTMLElement, delay = 0): Promise<void> {
    const titleDone = hideListeTitle(row, delay);
    const imagesDone = hideListeRowImages(row, delay);
    return Promise.all([titleDone, imagesDone]).then(() => {
      setListeRowClosedInstant(row);
    });
  }

  function showListeRow(row: HTMLElement, delay = 0): Promise<void> {
    row.dataset.revealed = 'true';
    const titleDone = revealListeTitle(row, delay);
    const imagesDone = revealListeRowImages(row, delay);
    return Promise.all([titleDone, imagesDone]).then(() => {});
  }

  function setListeRowClosedInstant(row: HTMLElement): void {
    getRowCache(row).images.forEach((wrap) => {
      const curtain = wrap.querySelector<HTMLElement>('.liste-image-curtain');
      if (curtain) curtain.style.transform = 'scaleY(1)';
    });
    setListeTitleClosedInstant(row);
    delete row.dataset.revealed;
  }

  function setListeRowOpenInstant(row: HTMLElement): void {
    getRowCache(row).images.forEach((wrap) => {
      const curtain = wrap.querySelector<HTMLElement>('.liste-image-curtain');
      if (curtain) curtain.style.transform = '';
    });
    setListeTitleOpenInstant(row);
    row.dataset.revealed = 'true';
  }

  function visibleListeRows(): { visible: HTMLElement[]; offscreen: HTMLElement[] } {
    const margin = window.innerHeight * 0.5;
    const visible: HTMLElement[] = [];
    const offscreen: HTMLElement[] = [];
    listeRows.forEach((row) => {
      const r = row.getBoundingClientRect();
      if (r.bottom > -margin && r.top < window.innerHeight + margin) visible.push(row);
      else offscreen.push(row);
    });
    return { visible, offscreen };
  }

  function hideListeRows(): Promise<void> {
    if (listeRows.length === 0) return Promise.resolve();
    const { visible } = visibleListeRows();
    const toHide = visible.filter((row) => row.dataset.revealed);
    return Promise.all(toHide.map((row, i) => hideListeRow(row, i * LISTE_ROW_STAGGER))).then(() => {});
  }

  function showListeRows(): Promise<void> {
    if (listeRows.length === 0) return Promise.resolve();
    const { visible } = visibleListeRows();
    const toShow = visible.filter((row) => !row.dataset.revealed);
    return Promise.all(toShow.map((row, i) => showListeRow(row, i * LISTE_ROW_STAGGER))).then(() => {});
  }

  function initListeRevealObserver(): void {
    if (listeRevealObserver || listeRows.length === 0) return;
    listeRevealObserver = new IntersectionObserver(
      (entries) => {
        const toReveal = entries.filter(
          (entry) => entry.isIntersecting && !(entry.target as HTMLElement).dataset.revealed
        );
        toReveal.forEach((entry, i) => {
          const row = entry.target as HTMLElement;
          if (isBackwardMorphPending() && !listeMorphSettled) {
            row.dataset.deferredReveal = 'true';
          } else {
            showListeRow(row, i * LISTE_ROW_STAGGER);
          }
        });
      },
      { threshold: 0.4 }
    );
    listeRows.forEach((row) => listeRevealObserver!.observe(row));
  }

  function fadePanel(panel: HTMLElement, direction: 'in' | 'out'): Promise<void> {
    const keyframes =
      direction === 'in' ? [{ opacity: 0 }, { opacity: 1 }] : [{ opacity: 1 }, { opacity: 0 }];
    if (direction === 'in') panel.style.opacity = '0';
    return animateAndSettle(panel, keyframes, { duration: PANEL_FADE_DURATION, easing: PANEL_FADE_EASE, fill: 'forwards' }).then(() => {
      panel.style.opacity = '';
    });
  }

  async function transitionListe(next: ViewMode): Promise<void> {
    const leavingPanel = panels[view];
    const enteringPanel = panels[next];
    if (!enteringPanel) return;

    if (view === 'liste') {
      current = currentFromListe();
      await hideListeRows();
      leavingPanel!.hidden = true;
    } else {
      if (view === 'dezoom') {
        isDezoomActive = false;
        cancelAnimationFrame(rafId);
        dezoomLenis?.stop();
      }
      if (leavingPanel) {
        await fadePanel(leavingPanel, 'out');
        leavingPanel.hidden = true;
      }
    }

    view = next;
    page!.dataset.view = view;
    updateSwitcherUI();
    enteringPanel.hidden = false;

    if (next === 'liste') {
      pageLenis?.start();
      pageLenis?.resize();
      scrollListeToCurrent();
      await showListeRows();
    } else {
      pageLenis?.stop();
      if (next === 'carousel') {
        carouselIndex = current;
        setCarouselCurrentImage(carouselIndex);
        setCarouselInfoInstant(carouselIndex);
      } else if (next === 'dezoom') {
        isDezoomActive = true;
        const dl = ensureDezoomLenis();
        dl?.start();
        scrollDezoomToCurrent(dl);
        rafId = requestAnimationFrame(dezoomRaf);
        dezoomItems.forEach((el) => {
          delete el.dataset.revealed;
          const img = el.querySelector('img');
          if (img) img.style.clipPath = DEZOOM_MASK_HIDDEN;
          hideDezoomItemInfoInstant(el);
        });
      }
      await fadePanel(enteringPanel, 'in');
    }
  }

  function heroImage(v: ViewMode, index: number): HTMLImageElement | null {
    const item = v === 'carousel' ? carouselItems[index] : v === 'dezoom' ? dezoomItems[index] : null;
    return item?.querySelector<HTMLImageElement>('img') ?? null;
  }

  function visibleDezoomItems(excluding: number): HTMLElement[] {
    if (!panels.dezoom) return [];
    const panelRect = panels.dezoom.getBoundingClientRect();
    return dezoomItems.filter((el, i) => {
      if (i === excluding) return false;
      const r = el.getBoundingClientRect();
      return r.right > panelRect.left && r.left < panelRect.right;
    });
  }

  async function morphBetweenCarouselAndDezoom(next: ViewMode): Promise<void> {
    if (view === 'dezoom') current = currentFromDezoom();
    const heroIndex = current;

    // Only ever-revealed cards get a leave animation - a still-masked one
    // would otherwise be animated out from a visible starting position.
    const visibleSiblings = visibleDezoomItems(heroIndex).filter((el) => el.dataset.revealed);

    const heroSrc = heroImage(view, heroIndex)?.currentSrc;
    if (morphHero && heroSrc) {
      morphHero.src = heroSrc;
      morphHero.decode?.().catch(() => {});
    }

    if (view === 'carousel') {
      await hideCarouselInfo(CAROUSEL_INFO_HIDE_DELAY);
    } else {
      await hideDezoomItemInfo(dezoomItems[heroIndex], DEZOOM_INFO_HIDE_DELAY);
      if (visibleSiblings.length > 0) {
        await Promise.all(visibleSiblings.map((el) => hideDezoomItemInfo(el, 0)));
      }
    }

    const leavingView = view;
    const leavingImg = heroImage(leavingView, heroIndex);
    const fromRect = leavingImg?.getBoundingClientRect() ?? null;

    panels[next]!.hidden = false;
    view = next;
    page!.dataset.view = view;
    updateSwitcherUI();
    
    if (leavingView === 'carousel') {
      panels.carousel!.hidden = true;
    }

    if (next === 'carousel') {
      carouselIndex = heroIndex;
      setCarouselCurrentImage(heroIndex);
    } else {
      isDezoomActive = true;
      const dl = ensureDezoomLenis();
      dl?.start();
      scrollDezoomToCurrent(dl);
      rafId = requestAnimationFrame(dezoomRaf);
      
      dezoomItems.forEach((el, i) => {
        if (i === heroIndex) {
          el.dataset.revealed = 'true';
          hideDezoomItemInfoInstant(el);
          const img = el.querySelector('img');
          if (img) img.style.clipPath = '';
          return;
        }
        delete el.dataset.revealed;
        const img = el.querySelector('img');
        if (img) img.style.clipPath = DEZOOM_MASK_HIDDEN;
        hideDezoomItemInfoInstant(el);
      });

      visibleSiblings.forEach((el) => {
        el.dataset.revealed = 'true';
      });
    }
    
    if (leavingView === 'dezoom') {
      isDezoomActive = false;
      cancelAnimationFrame(rafId);
      dezoomLenis?.stop();
    }

    const enteringImg = heroImage(next, heroIndex);
    const toRect = enteringImg?.getBoundingClientRect() ?? null;

    let morphDone: Promise<void> = Promise.resolve();
    if (morphHero && leavingImg && fromRect && toRect) {
      morphHero.style.top = `${fromRect.top}px`;
      morphHero.style.left = `${fromRect.left}px`;
      morphHero.style.width = `${fromRect.width}px`;
      morphHero.style.height = `${fromRect.height}px`;
      morphHero.hidden = false;
      if (enteringImg) enteringImg.style.visibility = 'hidden';

      const anim = morphHero.animate(
        [
          { top: `${fromRect.top}px`, left: `${fromRect.left}px`, width: `${fromRect.width}px`, height: `${fromRect.height}px` },
          { top: `${toRect.top}px`, left: `${toRect.left}px`, width: `${toRect.width}px`, height: `${toRect.height}px` },
        ],
        { duration: MORPH_DURATION, easing: MORPH_EASE, fill: 'forwards' }
      );
      morphDone = settle(anim);
    }

    const leavingOthersDone = leavingView === 'dezoom' ? Promise.all(
      visibleSiblings.map((el) => {
        const img = el.querySelector('img');
        if (!img) return Promise.resolve();
        return animateAndSettle(img, [{ clipPath: DEZOOM_MASK_VISIBLE }, { clipPath: DEZOOM_CROP_CLOSED }], {
          duration: MORPH_DURATION,
          easing: MORPH_EASE,
          fill: 'forwards',
        }).then(() => {
          img.style.clipPath = DEZOOM_CROP_CLOSED;
        });
      })
    ).then(() => {}) : Promise.resolve();

    await Promise.all([morphDone, leavingOthersDone]);

    if (morphHero) {
      morphHero.hidden = true;
      morphHero.style.cssText = '';
    }
    if (enteringImg) enteringImg.style.visibility = '';
    
    if (leavingView === 'dezoom') {
      panels.dezoom!.hidden = true;
      visibleSiblings.forEach((el) => {
        const img = el.querySelector('img');
        if (img) img.style.clipPath = '';
      });
    }

    if (next === 'carousel') {
      await showCarouselInfo(heroIndex);
    } else {
      const othersDone = Promise.all([
        ...visibleSiblings.map((el) => {
          const img = el.querySelector('img');
          if (!img) return Promise.resolve();
          return animateAndSettle(img, [{ clipPath: DEZOOM_MASK_HIDDEN }, { clipPath: DEZOOM_MASK_VISIBLE }], {
            duration: MORPH_SIBLING_FADE_DURATION,
            delay: DEZOOM_OTHERS_IMAGE_DELAY,
            easing: MORPH_SIBLING_EASE,
            fill: 'forwards',
          }).then(() => {
            img.style.clipPath = '';
          });
        }),
        ...visibleSiblings.map((el) => showDezoomItemInfo(el, DEZOOM_OTHERS_IMAGE_DELAY + DEZOOM_OTHERS_TEXT_DELAY)),
      ]);
      
      await showDezoomItemInfo(dezoomItems[heroIndex]);
      await othersDone;
    }
  }

  function hideCurrentInfoInstant(): void {
    if (view === 'carousel') {
      const item = carouselItems[carouselIndex];
      if (carouselInfoName) {
        carouselInfoName.textContent = item?.dataset.name ?? '';
        carouselInfoName.style.transform = `translateY(${maskClearDistance(carouselInfoName)}px)`;
      }
      if (carouselInfoMeta) {
        carouselInfoMeta.textContent = item?.dataset.meta ?? '';
        carouselInfoMeta.style.transform = `translateY(${maskClearDistance(carouselInfoMeta)}px)`;
      }
    } else if (view === 'dezoom') {
      hideDezoomItemInfoInstant(dezoomItems[current]);
    } else if (view === 'liste') {
      setListeTitleClosedInstant(listeRows[current]);
    }
  }

  function revealAfterMorphSettle(): void {
    listeMorphSettled = true;

    if (view === 'carousel') {
      showCarouselInfo(carouselIndex);
      return;
    }
    if (view === 'dezoom') {
      showDezoomItemInfo(dezoomItems[current]);
      visibleDezoomItems(current).forEach((el, i) => {
        const img = el.querySelector<HTMLElement>('img');
        if (img && el.dataset.deferredReveal === 'true') {
          delete el.dataset.deferredReveal;
          const delay = i * DEZOOM_OTHERS_IMAGE_DELAY;
          animateAndSettle(img, [{ clipPath: DEZOOM_MASK_HIDDEN }, { clipPath: DEZOOM_MASK_VISIBLE }], {
            duration: MORPH_SIBLING_FADE_DURATION,
            delay,
            easing: MORPH_SIBLING_EASE,
            fill: 'forwards',
          }).then(() => {
            img.style.clipPath = '';
          });
        }
        showDezoomItemInfo(el, DEZOOM_OTHERS_TEXT_DELAY);
      });
      return;
    }
    if (view === 'liste') {
      revealListeTitle(listeRows[current]);
      
      const currentRow = listeRows[current];
      if (currentRow) {
        const otherImages = getRowCache(currentRow).images.slice(1);
        otherImages.forEach((wrap, i) => {
          revealListeImageCurtain(wrap, (i + 1) * LISTE_IMAGE_STAGGER); 
        });
      }

      const deferredRows = listeRows.filter(row => row.dataset.deferredReveal === 'true');
      deferredRows.forEach((row, i) => {
        delete row.dataset.deferredReveal;
        showListeRow(row, 150 + (i * LISTE_ROW_STAGGER));
      });
    }
  }

  function handleMorphCenter(clickedItem: HTMLElement): Promise<void> {
    if (view === 'dezoom' && clickedItem.classList.contains('dezoom-item')) {
      const idx = dezoomItems.indexOf(clickedItem);
      if (idx < 0) return Promise.resolve();
      current = idx;
      saveProjetsState(view, current);
      return centerDezoomItem(clickedItem);
    }
    if (view === 'liste' && clickedItem.classList.contains('liste-row')) {
      const idx = listeRows.indexOf(clickedItem);
      if (idx < 0) return Promise.resolve();
      current = idx;
      saveProjetsState(view, current);
      return centerListeRow(clickedItem);
    }
    return Promise.resolve();
  }

  async function handleMorphLeave(clickedItem: HTMLElement): Promise<void> {
    if (clickedItem.classList.contains('carousel-item')) {
      await hideCarouselInfo(0);
      return;
    }
    if (clickedItem.classList.contains('dezoom-item')) {
      const idx = dezoomItems.indexOf(clickedItem);
      const siblings = idx >= 0 ? visibleDezoomItems(idx).filter((el) => el.dataset.revealed) : [];
      await Promise.all([
        hideDezoomItemInfo(clickedItem, 0),
        ...siblings.map((el) => {
          const img = el.querySelector<HTMLElement>('img');
          const textDone = hideDezoomItemInfo(el, 0);
          if (!img) return textDone;
          const cropDone = animateAndSettle(img, [{ clipPath: DEZOOM_MASK_VISIBLE }, { clipPath: DEZOOM_CROP_CLOSED }], {
            duration: MORPH_DURATION,
            easing: MORPH_EASE,
            fill: 'forwards',
          }).then(() => {
            img.style.clipPath = DEZOOM_CROP_CLOSED;
          });
          return Promise.all([textDone, cropDone]).then(() => {});
        }),
      ]);
      return;
    }
    if (clickedItem.classList.contains('liste-row')) {
      await handleListeRowMorphLeave(clickedItem);
    }
  }

  const LISTE_TITLE_ROW_STAGGER = 80;

  async function handleListeRowMorphLeave(clickedRow: HTMLElement): Promise<void> {
    const { visible } = visibleListeRows();
    const otherRows = visible.filter((row) => row !== clickedRow && row.dataset.revealed);

    await Promise.all([
      hideListeTitle(clickedRow, 0),
      ...otherRows.map((row, i) => hideListeTitle(row, LISTE_TITLE_ROW_STAGGER * (i + 1))),
      hideListeRowImages(clickedRow, 0, 1),
      ...otherRows.map((row, i) => hideListeRowImages(row, LISTE_ROW_STAGGER * i)),
    ]);
  }

  function applyRestoredView(deferCurrentInfo: boolean): void {
    if (view === 'carousel') {
      carouselIndex = current;
      setCarouselCurrentImage(carouselIndex);
      if (deferCurrentInfo) hideCurrentInfoInstant();
      else setCarouselInfoInstant(carouselIndex);
      return;
    }

    panels.carousel!.hidden = true;

    if (view === 'dezoom') {
      panels.dezoom!.hidden = false;
      isDezoomActive = true;
      const dl = ensureDezoomLenis();
      dl?.start();
      scrollDezoomToCurrent(dl);
      const deferredSiblings = deferCurrentInfo ? new Set(visibleDezoomItems(current)) : null;
      dezoomItems.forEach((el, i) => {
        el.dataset.revealed = 'true';
        const img = el.querySelector('img');
        if (i === current) {
          if (img) img.style.clipPath = '';
          if (deferCurrentInfo) hideCurrentInfoInstant();
          else resetDezoomItemInfoInstant(el);
        } else if (deferredSiblings?.has(el)) {
          el.dataset.deferredReveal = 'true';
          if (img) img.style.clipPath = DEZOOM_MASK_HIDDEN;
          hideDezoomItemInfoInstant(el);
        } else {
          if (img) img.style.clipPath = '';
          resetDezoomItemInfoInstant(el);
        }
      });
      rafId = requestAnimationFrame(dezoomRaf);
    } else if (view === 'liste') {
      panels.liste!.hidden = false;
      const currentRow = listeRows[current];
      if (currentRow) {
        if (deferCurrentInfo) {
          hideCurrentInfoInstant();
          getRowCache(currentRow).images.forEach((wrap, i) => {
            const curtain = wrap.querySelector<HTMLElement>('.liste-image-curtain');
            if (curtain) {
              if (i === 0) curtain.style.transform = '';
              else curtain.style.transform = 'scaleY(1)';
            }
          });
          currentRow.dataset.revealed = 'true';
        } else {
          revealListeRowImages(currentRow);
          resetDezoomItemInfoInstant(currentRow);
        }
      }
      scrollListeToCurrent();
    }
  }

  registerMorphLeaveHook(handleMorphLeave);
  registerMorphCenterHook(handleMorphCenter);

  page.dataset.view = view;
  updateSwitcherUI();
  if (restored) {
    const deferCurrentInfo = isBackwardMorphPending();
    applyRestoredView(deferCurrentInfo);
    if (deferCurrentInfo) {
      morphEvents.addEventListener(MORPH_SETTLED_EVENT, revealAfterMorphSettle, { once: true });
    }
  }
  if (view === 'liste') {
    pageLenis?.start();
    pageLenis?.resize();
  } else {
    pageLenis?.stop();
  }

  const handleBeforePreparation = () => {
    if (view === 'dezoom') current = currentFromDezoom();
    else if (view === 'liste') current = currentFromListe();
    saveProjetsState(view, current);
  };
  document.addEventListener('astro:before-preparation', handleBeforePreparation);
  window.addEventListener('pagehide', handleBeforePreparation);

  let resizeTimer: number;
  const handleResize = () => {
    clearTimeout(resizeTimer);
    clearDistanceCache = new WeakMap();
    resizeTimer = window.setTimeout(() => {
      if (view === 'dezoom') dezoomLenis?.resize();
    }, 150);
  };
  window.addEventListener('resize', handleResize);

  return {
    destroy: () => {
      isDezoomActive = false;
      cancelAnimationFrame(rafId);
      window.removeEventListener('resize', handleResize);
      document.removeEventListener('astro:before-preparation', handleBeforePreparation);
      window.removeEventListener('pagehide', handleBeforePreparation);
      morphEvents.removeEventListener(MORPH_SETTLED_EVENT, revealAfterMorphSettle);
      registerMorphLeaveHook(null);
      registerMorphCenterHook(null);
      panels.carousel?.removeEventListener('wheel', handleWheel);

      clickHandlers.forEach(({ btn, handler }) => {
        btn.removeEventListener('click', handler);
      });

      if (dezoomObserver) {
        dezoomObserver.disconnect();
        dezoomObserver = null;
      }
      if (listeRevealObserver) {
        listeRevealObserver.disconnect();
        listeRevealObserver = null;
      }
      if (dezoomLenis) {
        dezoomLenis.destroy();
        dezoomLenis = null;
      }
      if (pageLenis) {
         pageLenis.start();
      }
    }
  };
}