import Lenis from 'lenis';
import { lenis as pageLenis } from './smooth-scroll';

// --- Constantes ---
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

// La chorégraphie d'entrée : le texte current passe en premier, les autres images attendent ce délai
const DEZOOM_OTHERS_IMAGE_DELAY = 150; 
const DEZOOM_OTHERS_TEXT_DELAY = MORPH_SIBLING_FADE_DURATION * 0.85;

const DEZOOM_CROP_CLOSED = 'inset(50% 0 50% 0)';
const DEZOOM_MASK_HIDDEN = 'inset(100% 0 0 0)';
const DEZOOM_MASK_VISIBLE = 'inset(0 0 0 0)';

type ViewMode = 'carousel' | 'dezoom' | 'liste';

export function initProjetsPage(root: ParentNode = document) {
  const page = root.querySelector<HTMLElement>('.projects-page');
  if (!page) return;

  const panels: Record<ViewMode, HTMLElement | null> = {
    carousel: page.querySelector('.view-carousel'),
    dezoom: page.querySelector('.view-dezoom'),
    liste: page.querySelector('.view-liste'),
  };
  const switcherButtons = Array.from(page.querySelectorAll<HTMLButtonElement>('[data-set-view]'));
  const morphHero = page.querySelector<HTMLImageElement>('.morph-hero');

  let view: ViewMode = 'carousel';
  let current = 0;
  let switching = false;
  
  // BarbaJS & Performance variables
  let rafId: number;
  let isDezoomActive = false;
  let dezoomObserver: IntersectionObserver | null = null;
  const clickHandlers: { btn: HTMLButtonElement; handler: () => void }[] = [];

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
    
    if (isCarouselDezoomMorph) {
      switching = true;
      morphBetweenCarouselAndDezoom(next).finally(() => {
        switching = false;
      });
      return;
    }

    if (view === 'dezoom') current = currentFromDezoom();
    else if (view === 'liste') current = currentFromListe();

    view = next;
    (Object.keys(panels) as ViewMode[]).forEach((v) => {
      const el = panels[v];
      if (el) el.hidden = v !== view;
    });
    page!.dataset.view = view;
    updateSwitcherUI();

    if (view === 'liste') {
      pageLenis?.start();
      pageLenis?.resize();
      scrollListeToCurrent();
    } else {
      pageLenis?.stop();
    }
    
    if (view === 'dezoom') {
      isDezoomActive = true;
      const dl = ensureDezoomLenis();
      dl?.start();
      scrollDezoomToCurrent(dl);
      rafId = requestAnimationFrame(dezoomRaf);
      
      if (!isCarouselDezoomMorph) {
        dezoomItems.forEach((el) => {
          delete el.dataset.revealed;
          const img = el.querySelector('img');
          if (img) img.style.clipPath = DEZOOM_MASK_HIDDEN;
          hideDezoomItemInfoInstant(el);
        });
      }
    } else {
      isDezoomActive = false;
      cancelAnimationFrame(rafId);
      dezoomLenis?.stop();
    }
    
    if (view === 'carousel') {
      carouselIndex = current;
      setCarouselCurrentImage(carouselIndex);
      setCarouselInfoInstant(carouselIndex);
    }
  }

  switcherButtons.forEach((btn) => {
    const handler = () => setView((btn.dataset.setView as ViewMode) ?? 'carousel');
    btn.addEventListener('click', handler);
    clickHandlers.push({ btn, handler });
  });

  // --- Outils partagés ---

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

  function maskClearDistance(el: HTMLElement): number {
    const mask = el.closest<HTMLElement>('.item-info');
    return (mask ?? el).getBoundingClientRect().height;
  }

  function hideInfoParts(name: HTMLElement | null, meta: HTMLElement | null, delay = 0): Promise<void> {
    const targets = [name, meta].filter((el): el is HTMLElement => Boolean(el));
    const clears = targets.map((el) => maskClearDistance(el));
    return Promise.all(
      targets.map((el, i) => {
        return settle(
          el.animate([{ transform: 'translateY(0)' }, { transform: `translateY(${clears[i]}px)` }], {
            duration: INFO_HIDE_DURATION,
            delay: delay + i * INFO_PART_STAGGER,
            easing: INFO_HIDE_EASE,
            fill: 'forwards',
          })
        );
      })
    ).then(() => {});
  }

  function revealInfoParts(name: HTMLElement | null, meta: HTMLElement | null, delay = 0): Promise<void> {
    const targets = [name, meta].filter((el): el is HTMLElement => Boolean(el));
    const clears = targets.map((el) => maskClearDistance(el));
    targets.forEach((el, i) => { el.style.transform = `translateY(${clears[i]}px)`; });
    return Promise.all(
      targets.map((el, i) => {
        return settle(
          el.animate([{ transform: `translateY(${clears[i]}px)` }, { transform: 'translateY(0)' }], {
            duration: INFO_REVEAL_DURATION,
            delay: delay + i * INFO_PART_STAGGER,
            easing: INFO_REVEAL_EASE,
            fill: 'forwards',
          })
        );
      })
    ).then(() => {});
  }

  // --- Vue 1 ---

  const carouselItems = Array.from(panels.carousel?.querySelectorAll<HTMLElement>('.carousel-item') ?? []);
  const carouselInfoMask = panels.carousel?.querySelector<HTMLElement>('.carousel-info') ?? null;
  const carouselInfoContent = carouselInfoMask?.querySelector<HTMLElement>('.info-content') ?? null;
  const carouselInfoName = carouselInfoContent?.querySelector<HTMLElement>('.info-name') ?? null;
  const carouselInfoMeta = carouselInfoContent?.querySelector<HTMLElement>('.info-meta') ?? null;
  const n = carouselItems.length;
  let carouselIndex = 0;
  let carouselLocked = false;
  let carouselAnimation: Animation | null = null;

  function setCarouselCurrentImage(index: number): void {
    carouselAnimation?.cancel();
    carouselAnimation = null;
    carouselLocked = false;
    carouselItems.forEach((el, i) => {
      el.classList.toggle('is-current', i === index);
      el.style.transform = 'translateX(0)';
      el.style.zIndex = '';
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
    toEl.classList.add('is-current');

    const animation = (carouselAnimation = toEl.animate(
      [{ transform: `translateX(${dir * 100}%)` }, { transform: 'translateX(0)' }],
      { duration: STEP_DURATION, easing: STEP_EASE, fill: 'forwards' }
    ));
    settle(animation).then(() => {
      carouselAnimation = null;
      toEl.style.zIndex = '';
      fromEl.classList.remove('is-current');
      carouselIndex = toIndex;
      current = carouselIndex;
      carouselLocked = false;
    });
  }

  const handleWheel = (e: WheelEvent) => {
    e.preventDefault();
    if (switching || carouselLocked || Math.abs(e.deltaY) < WHEEL_THRESHOLD) return;
    stepCarousel(e.deltaY > 0 ? 1 : -1);
  };
  panels.carousel?.addEventListener('wheel', handleWheel, { passive: false });

  // --- Vue 2 ---

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
            const reveal = img.animate([{ clipPath: DEZOOM_MASK_HIDDEN }, { clipPath: DEZOOM_MASK_VISIBLE }], {
              duration: MORPH_SIBLING_FADE_DURATION,
              easing: MORPH_SIBLING_EASE,
              fill: 'forwards',
              // Pas de délai d'image ici : au scroll, ça apparait tout de suite
            });
            settle(reveal, MORPH_SIBLING_FADE_DURATION + 200).then(() => {
              img.style.clipPath = '';
            });
          }
          showDezoomItemInfo(el, DEZOOM_OTHERS_TEXT_DELAY);
        }
      });
    }, {
      root: panels.dezoom,
      threshold: 0.15
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

  // --- Vue 3 ---

  const listeRows = Array.from(panels.liste?.querySelectorAll<HTMLElement>('.liste-row') ?? []);

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
    if (pageLenis) pageLenis.scrollTo(target, { immediate: true });
    else target.scrollIntoView({ block: 'start' });
  }

  // --- Vue 1 <-> Vue 2 morph ---

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

    const visibleSiblings = visibleDezoomItems(heroIndex);

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
        const crop = img.animate([{ clipPath: DEZOOM_MASK_VISIBLE }, { clipPath: DEZOOM_CROP_CLOSED }], {
          duration: MORPH_DURATION,
          easing: MORPH_EASE,
          fill: 'forwards',
        });
        return settle(crop, MORPH_DURATION + 200).then(() => {
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
          const reveal = img.animate([{ clipPath: DEZOOM_MASK_HIDDEN }, { clipPath: DEZOOM_MASK_VISIBLE }], {
            duration: MORPH_SIBLING_FADE_DURATION,
            delay: DEZOOM_OTHERS_IMAGE_DELAY, // LA MAGIE EST ICI : On retient les images voisines 150ms
            easing: MORPH_SIBLING_EASE,
            fill: 'forwards',
          });
          return settle(reveal, MORPH_SIBLING_FADE_DURATION + DEZOOM_OTHERS_IMAGE_DELAY + 200).then(() => {
            img.style.clipPath = '';
          });
        }),
        // Le délai du texte voisin = le délai de l'image + le ratio
        ...visibleSiblings.map((el) => showDezoomItemInfo(el, DEZOOM_OTHERS_IMAGE_DELAY + DEZOOM_OTHERS_TEXT_DELAY)),
      ]);
      
      // Le texte du hero se lance en premier, avec un délai de 0
      await showDezoomItemInfo(dezoomItems[heroIndex]);
      await othersDone;
    }
  }

  // --- Initial state & Events ---

  page.dataset.view = view;
  updateSwitcherUI();
  pageLenis?.stop();

  let resizeTimer: number;
  const handleResize = () => {
    clearTimeout(resizeTimer);
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
      panels.carousel?.removeEventListener('wheel', handleWheel);
      
      clickHandlers.forEach(({ btn, handler }) => {
        btn.removeEventListener('click', handler);
      });
      
      if (dezoomObserver) {
        dezoomObserver.disconnect();
        dezoomObserver = null;
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