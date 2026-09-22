import Lenis from 'lenis';
import { lenis as pageLenis } from './smooth-scroll';
import {
  isBackwardMorphPending,
  morphEvents,
  MORPH_SETTLED_EVENT,
  registerMorphLeaveHook,
  registerMorphCenterHook,
} from './project-morph';

// Remembers which view/project was showing when leaving for an individual
// project page, so coming back (the back link, or the browser back button)
// restores it instead of resetting to the carousel's first project - also
// what project-morph.ts's reverse morph reads to find the correct on-page
// target to animate back into.
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

// Vue 3 (liste) transition: same "grow open from the bottom entering,
// crop-to-a-line leaving" motion as vue 2's own sibling cards below, and the
// same hideInfoParts/revealInfoParts text treatment - but via the
// var(--color-ink) curtain elements in hideListeRow/showListeRow, not the
// DEZOOM_MASK_*/DEZOOM_CROP_CLOSED clip-paths those sibling cards still use
// (clip-path on liste's larger images was the real cause of "leaving vue3
// is laggy" - see hideListeRow's comment). Staggered row by row.
const LISTE_ROW_STAGGER = 60;
const PANEL_FADE_DURATION = 320;
const PANEL_FADE_EASE = 'cubic-bezier(0.4, 0, 0.2, 1)';

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

  // Only restore if this load is actually the reverse leg of a project-page
  // round trip (project-morph.ts already knows this synchronously - its
  // astro:before-preparation ran well before this page-load). Restoring on
  // any load that merely finds something in sessionStorage doesn't
  // distinguish that from a plain refresh or a fresh visit, which is why a
  // refresh was landing back wherever a project was last opened from
  // instead of the carousel.
  const restored = isBackwardMorphPending() ? readProjetsState() : null;
  let view: ViewMode = restored?.view ?? 'carousel';
  let current = restored?.current ?? 0;
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

  // Animated counterpart to scrollDezoomToCurrent's instant jump - used only
  // to recenter a clicked dezoom card before its project-morph starts (see
  // handleMorphCenter below), so the morph always begins from a centered
  // position instead of wherever the card happened to be sitting when
  // clicked. A no-op if it's already there (nothing to animate) so clicking
  // an already-centered card doesn't add any delay.
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

  // --- Vue 3 ---

  const listeRows = Array.from(panels.liste?.querySelectorAll<HTMLElement>('.liste-row') ?? []);
  // Both declared up here, ahead of every function that reads them (which
  // includes the "close every row" init step a few lines down) - same
  // temporal-dead-zone reasoning as listeRevealObserver right below: a
  // `const` used before its own declaration line has run throws
  // "Cannot access ... before initialization", unlike a `function`
  // declaration, which is fully hoisted. This bit twice already in this
  // file - see feedback_lenis_singleton_stop_force-style lesson, but for
  // TDZ ordering instead of stop()/force.
  const LISTE_IMAGE_STAGGER = 100;
  const LISTE_TITLE_NUDGE_PX = 10;
  // Declared here, before it's used below - initListeRevealObserver is
  // called from the setup right after this (still earlier in the file
  // than its own function declaration), and `let` bindings are in their
  // temporal dead zone until this exact line runs, unlike a `function`
  // declaration - referencing it from a call made before this point threw
  // "Cannot access 'listeRevealObserver' before initialization" and
  // silently aborted the rest of initProjetsPage on every single page
  // load (registerMorphLeaveHook/registerMorphCenterHook and everything
  // after never ran), which is what was actually behind the view-state/
  // navigation flakiness this bug produced.
  let listeRevealObserver: IntersectionObserver | null = null;
  // Every row's images start closed instead of the CSS default (open), so
  // initListeRevealObserver has something to actually reveal the first
  // time each one is scrolled to (see setListeRowClosedInstant/
  // initListeRevealObserver further down). Whichever row ends up current
  // (view switch or restore) gets instantly re-opened by its own code
  // path right after, same as it always has.
  //
  // Text is deliberately NOT pre-hidden here the same way - this runs at
  // page-init time, while .view-liste is normally still `hidden` (default
  // view is carousel), and maskClearDistance measures the *current*
  // rendered height to know how far to translate; on a `display:none`
  // ancestor that's always 0, so the "hidden" position it would compute is
  // indistinguishable from "already visible" (translateY(0) either way) -
  // a silent no-op, not a real hide. showListeRow's own revealInfoParts
  // call already snaps text to a freshly-measured hidden position
  // immediately before animating it open, once the row is actually laid
  // out - that's the only text-hiding this needs.
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
    // force: true - on a backward-morph restore this runs while
    // project-morph.ts still has pageLenis stopped (it only restarts it,
    // for this view, a little further down in this same function), and
    // Lenis silently no-ops a scrollTo without `force` while stopped -
    // without it this call did nothing, leaving the page wherever the
    // native scroll reset (astro:after-swap) had left it (the top) instead
    // of the actual restored row.
    if (pageLenis) pageLenis.scrollTo(target, { immediate: true, force: true });
    else target.scrollIntoView({ block: 'start' });
  }

  // Animated scroll so a clicked row's own image band ends up flush with
  // the viewport's bottom edge, instead of morphing from wherever it
  // happened to be sitting when clicked - same idea as centerDezoomItem,
  // just aligned to the bottom (matching how the clone grows toward a
  // hero that fills the screen) rather than centered. A no-op if it's
  // already there.
  function alignListeRowToBottom(row: HTMLElement): Promise<void> {
    if (!pageLenis) return Promise.resolve();
    const imagesEl = row.querySelector<HTMLElement>('.liste-images');
    if (!imagesEl) return Promise.resolve();
    const rect = imagesEl.getBoundingClientRect();
    const target = window.scrollY + rect.bottom - window.innerHeight;
    const clamped = Math.max(0, target);
    if (Math.abs(window.scrollY - clamped) < 1) return Promise.resolve();

    // force: true - project-morph.ts has already called pageLenis.stop()
    // by the time this runs (it happens synchronously in the
    // astro:before-preparation handler, before this centerHook is ever
    // awaited) - without force, Lenis silently no-ops a scrollTo while
    // stopped, which means onComplete never fires and this promise never
    // resolves. Since project-morph.ts awaits this exact promise before
    // doing anything else, that hung the entire navigation: scroll stayed
    // locked (toggleScrollLock(true) already ran) and nothing ever
    // happened. Same gotcha as scrollListeToCurrent's own force:true - see
    // feedback_lenis_singleton_stop_force in memory.
    return new Promise((resolve) => {
      pageLenis!.scrollTo(clamped, { duration: 0.5, force: true, onComplete: () => resolve() });
    });
  }

  // Leaving/entering used to crop .liste-images with an animated clip-path,
  // which stayed genuinely laggy even after cutting it down to 1 animation
  // per row (previous pass) - clip-path forces the browser to re-rasterize
  // the newly exposed/hidden pixels of the image itself every frame, which
  // isn't compositor-only work the way a transform is, and these are large
  // images (22vw tall, full row width). Replaced with a solid
  // var(--color-ink) curtain *per image* (.liste-image-curtain, added in
  // projets.astro) that animates only `transform: scaleY()` - fully
  // compositor-driven, no repaint of the photo underneath at all - one per
  // image (not per row) so each can be staggered slightly behind the last
  // as it reveals/hides, instead of the whole row moving as a single unit.
  //
  // Both directions read as "bottom to top" (matching the scroll-triggered
  // reveal, and per explicit request for the leave direction too - a
  // symmetric close meeting in the middle, this used to do, doesn't) - the
  // curtain's own transform-origin is flipped in JS right before each
  // animation instead of keeping two separate curtains around:
  // - revealing: scaleY(1) -> scaleY(0), origin top - starts fully covered,
  //   and as it shrinks toward its top anchor, the remaining cover's own
  //   bottom edge recedes upward, uncovering the image from the bottom up.
  // - hiding: scaleY(0) -> scaleY(1), origin bottom - starts uncovered, and
  //   as it grows from its bottom anchor, the cover's own top edge advances
  //   upward, covering the image from the bottom up.
  function listeRowImages(row: HTMLElement): HTMLElement[] {
    return Array.from(row.querySelectorAll<HTMLElement>('.liste-image'));
  }

  function listeTitleCurtain(row: HTMLElement): HTMLElement | null {
    return row.querySelector<HTMLElement>('.liste-title-curtain');
  }

  function hideListeImageCurtain(wrap: HTMLElement, delay = 0): Promise<void> {
    const curtain = wrap.querySelector<HTMLElement>('.liste-image-curtain');
    if (!curtain) return Promise.resolve();
    curtain.style.transformOrigin = 'bottom';
    return settle(
      curtain.animate([{ transform: 'scaleY(0)' }, { transform: 'scaleY(1)' }], {
        duration: MORPH_DURATION,
        delay,
        easing: MORPH_EASE,
        fill: 'forwards',
      }),
      MORPH_DURATION + delay + 200
    ).then(() => {
      curtain.style.transform = 'scaleY(1)';
    });
  }

  function revealListeImageCurtain(wrap: HTMLElement, delay = 0): Promise<void> {
    const curtain = wrap.querySelector<HTMLElement>('.liste-image-curtain');
    if (!curtain) return Promise.resolve();
    curtain.style.transformOrigin = 'top';
    curtain.style.transform = 'scaleY(1)';
    return settle(
      curtain.animate([{ transform: 'scaleY(1)' }, { transform: 'scaleY(0)' }], {
        duration: MORPH_SIBLING_FADE_DURATION,
        delay,
        easing: MORPH_SIBLING_EASE,
        fill: 'forwards',
      }),
      MORPH_SIBLING_FADE_DURATION + delay + 200
    ).then(() => {
      curtain.style.transform = '';
    });
  }

  // skip lets a caller leave the row's first image alone (see
  // handleMorphLeaveListeRow below - the clicked row's first image is the
  // morph clone's own source and must stay untouched by this, or the
  // source photo vanishes under its own row's curtain before the clone
  // ever appears to take over from it).
  function hideListeRowImages(row: HTMLElement, delay = 0, skip = 0): Promise<void> {
    return Promise.all(
      listeRowImages(row)
        .slice(skip)
        .map((wrap, i) => hideListeImageCurtain(wrap, delay + i * LISTE_IMAGE_STAGGER))
    ).then(() => {});
  }

  // Images-only half of showListeRow, split out so a row's images can
  // reveal on their own timeline separate from its title - used for the
  // current row on a backward-morph restore, whose title needs to stay
  // masked until the clone settles (see revealAfterMorphSettle) while its
  // images can safely reveal right away, same as any other row. Resets
  // just the image curtains to closed first (not the title - a caller
  // managing that separately, e.g. hideCurrentInfoInstant, owns it).
  function revealListeRowImages(row: HTMLElement, delay = 0): Promise<void> {
    listeRowImages(row).forEach((wrap) => {
      const curtain = wrap.querySelector<HTMLElement>('.liste-image-curtain');
      if (curtain) curtain.style.transform = 'scaleY(1)';
    });
    row.dataset.revealed = 'true';
    return Promise.all(
      listeRowImages(row).map((wrap, i) => revealListeImageCurtain(wrap, delay + i * LISTE_IMAGE_STAGGER))
    ).then(() => {});
  }

  // Title curtain + a small (not full-height) translateY nudge on
  // .item-info itself - the curtain does the actual masking (see the big
  // comment above), the nudge is a subtle secondary motion, not something
  // that needs its own clipping.
  function hideListeTitle(row: HTMLElement, delay = 0): Promise<void> {
    const info = row.querySelector<HTMLElement>('.item-info');
    const curtain = listeTitleCurtain(row);
    const infoDone = info
      ? settle(
          info.animate([{ transform: 'translateY(0)' }, { transform: `translateY(${LISTE_TITLE_NUDGE_PX}px)` }], {
            duration: INFO_HIDE_DURATION,
            delay,
            easing: INFO_HIDE_EASE,
            fill: 'forwards',
          }),
          INFO_HIDE_DURATION + delay + 200
        ).then(() => {
          info.style.transform = `translateY(${LISTE_TITLE_NUDGE_PX}px)`;
        })
      : Promise.resolve();
    const curtainDone = curtain
      ? (() => {
          curtain.style.transformOrigin = 'bottom';
          return settle(
            curtain.animate([{ transform: 'scaleY(0)' }, { transform: 'scaleY(1)' }], {
              duration: MORPH_DURATION,
              delay,
              easing: MORPH_EASE,
              fill: 'forwards',
            }),
            MORPH_DURATION + delay + 200
          ).then(() => {
            curtain.style.transform = 'scaleY(1)';
          });
        })()
      : Promise.resolve();
    return Promise.all([infoDone, curtainDone]).then(() => {});
  }

  function revealListeTitle(row: HTMLElement, delay = 0): Promise<void> {
    setListeTitleClosedInstant(row);
    const info = row.querySelector<HTMLElement>('.item-info');
    const curtain = listeTitleCurtain(row);
    const infoDone = info
      ? settle(
          info.animate([{ transform: `translateY(${LISTE_TITLE_NUDGE_PX}px)` }, { transform: 'translateY(0)' }], {
            duration: INFO_REVEAL_DURATION,
            delay,
            easing: INFO_REVEAL_EASE,
            fill: 'forwards',
          }),
          INFO_REVEAL_DURATION + delay + 200
        ).then(() => {
          info.style.transform = '';
        })
      : Promise.resolve();
    const curtainDone = curtain
      ? (() => {
          curtain.style.transformOrigin = 'top';
          return settle(
            curtain.animate([{ transform: 'scaleY(1)' }, { transform: 'scaleY(0)' }], {
              duration: MORPH_SIBLING_FADE_DURATION,
              delay,
              easing: MORPH_SIBLING_EASE,
              fill: 'forwards',
            }),
            MORPH_SIBLING_FADE_DURATION + delay + 200
          ).then(() => {
            curtain.style.transform = '';
          });
        })()
      : Promise.resolve();
    return Promise.all([infoDone, curtainDone]).then(() => {});
  }

  function setListeTitleClosedInstant(row: HTMLElement): void {
    const curtain = listeTitleCurtain(row);
    if (curtain) curtain.style.transform = 'scaleY(1)';
    const info = row.querySelector<HTMLElement>('.item-info');
    if (info) info.style.transform = `translateY(${LISTE_TITLE_NUDGE_PX}px)`;
  }

  function setListeTitleOpenInstant(row: HTMLElement): void {
    const curtain = listeTitleCurtain(row);
    if (curtain) curtain.style.transform = '';
    const info = row.querySelector<HTMLElement>('.item-info');
    if (info) info.style.transform = '';
  }

  function hideListeRow(row: HTMLElement, delay = 0): Promise<void> {
    const titleDone = hideListeTitle(row, delay);
    const imagesDone = hideListeRowImages(row, delay);
    return Promise.all([titleDone, imagesDone]).then(() => {
      // Canonical fully-closed resting state (see setListeRowClosedInstant)
      // - also clears `revealed` (see its comment) so this row's own
      // scroll-triggered reveal (initListeRevealObserver below) replays
      // next time it's shown, same as dezoom already does on re-entry.
      setListeRowClosedInstant(row);
    });
  }

  function showListeRow(row: HTMLElement, delay = 0): Promise<void> {
    row.dataset.revealed = 'true';
    const titleDone = revealListeTitle(row, delay);
    const imagesDone = revealListeRowImages(row, delay);
    return Promise.all([titleDone, imagesDone]).then(() => {});
  }

  // Canonical instant "closed"/"open" states for a whole row (title +
  // every image), shared by the animated hide/show above and the instant
  // restore paths below - never left at an animated tween's mid-flight
  // value. Also the single place `dataset.revealed` is set/cleared, so
  // initListeRevealObserver (below) and every caller agree on what it
  // means: closed = not revealed (its scroll-triggered reveal should still
  // play), open = revealed (already shown, leave it alone).
  function setListeRowClosedInstant(row: HTMLElement): void {
    listeRowImages(row).forEach((wrap) => {
      const curtain = wrap.querySelector<HTMLElement>('.liste-image-curtain');
      if (curtain) curtain.style.transform = 'scaleY(1)';
    });
    setListeTitleClosedInstant(row);
    delete row.dataset.revealed;
  }

  function setListeRowOpenInstant(row: HTMLElement): void {
    listeRowImages(row).forEach((wrap) => {
      const curtain = wrap.querySelector<HTMLElement>('.liste-image-curtain');
      if (curtain) curtain.style.transform = '';
    });
    setListeTitleOpenInstant(row);
    row.dataset.revealed = 'true';
  }

  // Liste can hold far more rows than fit on screen at once (8 here, could
  // be more) - animating every row's every image on switch (up to 4 each)
  // regardless of whether it's actually visible was the "very laggy"
  // leaving-liste report: dozens of concurrent clip-path animations, most
  // of them for rows nobody can see. Only the ones near the viewport get
  // the real animation on a view switch; everything further out is left
  // closed and picked up later by initListeRevealObserver as the user
  // actually scrolls to it, instead of popping open instantly.
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

  // Only rows that are both near the viewport *and* still unrevealed get
  // touched - an already-revealed row found offscreen is left exactly as
  // it is (open) rather than forced closed, which would strand it: closed
  // but marked revealed means initListeRevealObserver would never open it
  // again (see setListeRowClosedInstant's comment on what the flag means).
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

  // Rows further than visibleListeRows' margin get their real reveal here
  // instead, the first time the user actually scrolls to them - same
  // bottom-to-top mask/text reveal as showListeRow, just triggered by
  // scroll position instead of a view-switch/morph settling. Set up once
  // and left running for the page's lifetime (observing costs nothing
  // while `.view-liste` is hidden - a hidden ancestor means these rows
  // have no layout box, so they simply never intersect until the view
  // becomes active). `dataset.revealed` (see setListeRowClosedInstant) is
  // what stops this from re-triggering a row a view-switch or restore
  // already handled.
  function initListeRevealObserver(): void {
    if (listeRevealObserver || listeRows.length === 0) return;
    listeRevealObserver = new IntersectionObserver(
      (entries) => {
        const toReveal = entries.filter(
          (entry) => entry.isIntersecting && !(entry.target as HTMLElement).dataset.revealed
        );
        toReveal.forEach((entry, i) => {
          showListeRow(entry.target as HTMLElement, i * LISTE_ROW_STAGGER);
        });
      },
      // Higher than dezoom/project-page's own reveal thresholds (0.15/0.2)
      // on purpose - liste rows are tall, and revealing at only 15% visible
      // meant most of the row (and the reveal animation playing out on it)
      // was still off past the bottom edge, reading as underwhelming
      // rather than as a real "look, it opens" moment.
      { threshold: 0.4 }
    );
    listeRows.forEach((row) => listeRevealObserver!.observe(row));
  }

  function fadePanel(panel: HTMLElement, direction: 'in' | 'out'): Promise<void> {
    const keyframes =
      direction === 'in' ? [{ opacity: 0 }, { opacity: 1 }] : [{ opacity: 1 }, { opacity: 0 }];
    if (direction === 'in') panel.style.opacity = '0';
    return settle(
      panel.animate(keyframes, { duration: PANEL_FADE_DURATION, easing: PANEL_FADE_EASE, fill: 'forwards' })
    ).then(() => {
      panel.style.opacity = '';
    });
  }

  // Vue 3 doesn't morph with the others - it's a different layout entirely
  // (vertical rows vs. a single full-bleed/16:10 image), so there's no
  // shared element to physically resize between them the way vue1<->vue2
  // does. Whichever view is leaving fades out (a quick, simple cross-fade
  // - the liste rows fading+lifting doesn't need a matching entrance choice
  // from carousel/dezoom, which have no equivalent per-item stagger), then
  // liste's rows stagger in - or, entering carousel/dezoom, the panel just
  // fades in once liste's rows have staggered out.
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
          // LE FIX : On efface d'urgence tout vieux masque 
          // posé lors d'un précédent passage sur la vue 2
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

  // Only used when arriving via a backward project-morph (see
  // isBackwardMorphPending's comment in project-morph.ts): the current
  // item's own info text stays masked instead of instantly visible, since
  // the incoming clone is still covering that exact spot for the next
  // ~0.8s - showing it now just means it gets covered, then "reappears"
  // once the clone clears, which reads as a glitch rather than a reveal.
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

  // The animated counterpart, played once project-morph.ts's clone actually
  // settles (see the MORPH_SETTLED_EVENT listener below) rather than on
  // page load. For dezoom this also covers the visible siblings deferred by
  // applyRestoredView below - grow-open from the bottom, the same
  // clip-path/timing as entering dezoom from carousel normally uses
  // (morphBetweenCarouselAndDezoom's othersDone), not a reverse of the
  // leaving crop.
  function revealAfterMorphSettle(): void {
    if (view === 'carousel') {
      showCarouselInfo(carouselIndex);
      return;
    }
    if (view === 'dezoom') {
      showDezoomItemInfo(dezoomItems[current]);
      visibleDezoomItems(current).forEach((el, i) => {
        const img = el.querySelector<HTMLElement>('img');
        // data-deferred-reveal, not a clip-path string match: the browser
        // normalizes inline style strings on read-back (this constant's
        // 'inset(100% 0 0 0)' comes back as 'inset(100% 0px 0px)'), so a
        // direct equality check against the constant silently never
        // matched - the text half of this reveal ran (no such check there)
        // while the image half quietly never did.
        if (img && el.dataset.deferredReveal === 'true') {
          delete el.dataset.deferredReveal;
          const delay = i * DEZOOM_OTHERS_IMAGE_DELAY;
          const reveal = img.animate([{ clipPath: DEZOOM_MASK_HIDDEN }, { clipPath: DEZOOM_MASK_VISIBLE }], {
            duration: MORPH_SIBLING_FADE_DURATION,
            delay,
            easing: MORPH_SIBLING_EASE,
            fill: 'forwards',
          });
          settle(reveal, MORPH_SIBLING_FADE_DURATION + delay + 200).then(() => {
            img.style.clipPath = '';
          });
        }
        showDezoomItemInfo(el, DEZOOM_OTHERS_TEXT_DELAY);
      });
      return;
    }
    // Only the current row's title was deferred (applyRestoredView above
    // reveals its images right away - see revealListeRowImages there), so
    // that's the only thing this needs to reveal, same as carousel/dezoom
    // above.
    if (view === 'liste') revealListeTitle(listeRows[current]);
  }

  // Fired by project-morph.ts's isForward path before anything else -
  // even before it captures the clicked image's rect - so a dezoom card
  // that isn't already centered gets scrolled there first, and the morph
  // always starts from a centered position. Also corrects `current`: the
  // astro:before-preparation listener below (handleBeforePreparation) has
  // already run and saved whatever currentFromDezoom() guessed from the
  // scroll position *before* this click, which is wrong when the clicked
  // card wasn't the nearest-to-center one - this is the one place that
  // actually knows which card was clicked, so it overwrites both.
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
      return alignListeRowToBottom(clickedItem);
    }
    return Promise.resolve();
  }

  // Fired by project-morph.ts's isForward path, before it lets the actual
  // navigation proceed - the counterpart to revealAfterMorphSettle, for
  // leaving instead of arriving. Registered as project-morph.ts's
  // leaveHook rather than that file reaching into these closures directly,
  // which would need a circular import the other way.
  async function handleMorphLeave(clickedItem: HTMLElement): Promise<void> {
    if (clickedItem.classList.contains('carousel-item')) {
      await hideCarouselInfo(0);
      return;
    }
    if (clickedItem.classList.contains('dezoom-item')) {
      const idx = dezoomItems.indexOf(clickedItem);
      const siblings = idx >= 0 ? visibleDezoomItems(idx) : [];
      await Promise.all([
        hideDezoomItemInfo(clickedItem, 0),
        ...siblings.map((el) => {
          const img = el.querySelector<HTMLElement>('img');
          const textDone = hideDezoomItemInfo(el, 0);
          if (!img) return textDone;
          const crop = img.animate([{ clipPath: DEZOOM_MASK_VISIBLE }, { clipPath: DEZOOM_CROP_CLOSED }], {
            duration: MORPH_DURATION,
            easing: MORPH_EASE,
            fill: 'forwards',
          });
          const cropDone = settle(crop, MORPH_DURATION + 200).then(() => {
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

  // Choreographed leave for a liste-row click, in the order asked for:
  // 1. the clicked row's own title masks away first, moving down just a
  //    little (LISTE_TITLE_NUDGE_PX) rather than the usual full slide.
  // 2. every other visible row's title follows right behind it, not all
  //    at once.
  // 3. only *then* do images start closing - every image except the
  //    clicked row's first, which is the morph clone's own source (see
  //    hideListeRowImages' comment) and has to stay exactly as it is
  //    until the clone visually takes over from it; closing it here would
  //    hide the source photo under its own row's curtain first, so the
  //    morph would start growing from an already-blank spot instead of
  //    the photo.
  const LISTE_TITLE_ROW_STAGGER = 80;

  async function handleListeRowMorphLeave(clickedRow: HTMLElement): Promise<void> {
    const { visible } = visibleListeRows();
    const otherRows = visible.filter((row) => row !== clickedRow && row.dataset.revealed);

    await Promise.all([
      hideListeTitle(clickedRow, 0),
      ...otherRows.map((row, i) => hideListeTitle(row, LISTE_TITLE_ROW_STAGGER * (i + 1))),
    ]);

    await Promise.all([
      hideListeRowImages(clickedRow, 0, 1),
      ...otherRows.map((row, i) => hideListeRowImages(row, LISTE_ROW_STAGGER * i)),
    ]);
  }

  // The HTML always bakes in view=carousel, project 0 as .is-current, vue2/3
  // panels hidden - if a saved state points elsewhere, get there instantly
  // (no transition, this is page load, not a user-triggered switch) before
  // anything paints.
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
      // Scrolled to current *before* reading visibleDezoomItems below - it
      // measures against the live viewport, so it needs the real scroll
      // position already in place to identify the right siblings.
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
          // Grow-open once the morph settles (revealAfterMorphSettle)
          // instead of instantly visible now, same reasoning as the
          // current item's own text above. Marked via a data attribute,
          // not inferred later from the clip-path value itself - see
          // revealAfterMorphSettle's comment on why that read-back doesn't
          // reliably match.
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
      // Only the current row's *first* image is ever the morph clone's
      // target (project-morph.ts's backward path always resolves to a
      // row's first <img> - see allCopiesOf's comment) - every other row
      // is already closed (every row starts closed by default, see the
      // setup near listeRows above) and left for initListeRevealObserver
      // to reveal, same as it would for a fresh scroll.
      //
      // The current row's own images reveal right away too (not instantly
      // open, an actual staggered reveal like everything else -
      // revealListeRowImages), running *while* the clone is still
      // shrinking back rather than after a blank pause - the clone sits on
      // top of whatever this does underneath the whole time anyway. Only
      // its *text* stays masked (hideCurrentInfoInstant) until the clone
      // actually settles (revealAfterMorphSettle) - it isn't covered by
      // the clone, so revealing it early would show it sitting in the
      // wrong place while the image is still mid-flight.
      const currentRow = listeRows[current];
      if (currentRow) {
        revealListeRowImages(currentRow);
        if (deferCurrentInfo) hideCurrentInfoInstant();
        else resetDezoomItemInfoInstant(currentRow);
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

  // Keeps sessionStorage current right up to the moment a navigation away
  // actually starts (not just on view switches) - current can also change
  // from scrolling within dezoom/liste without going through setView.
  const handleBeforePreparation = () => {
    if (view === 'dezoom') current = currentFromDezoom();
    else if (view === 'liste') current = currentFromListe();
    saveProjetsState(view, current);
  };
  document.addEventListener('astro:before-preparation', handleBeforePreparation);

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
      document.removeEventListener('astro:before-preparation', handleBeforePreparation);
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