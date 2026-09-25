import Lenis from 'lenis';
import { lenis as pageLenis } from './smooth-scroll';
import { afterSiteLoader } from './site-loader';
import {
  isBackwardMorphPending,
  morphEvents,
  MORPH_SETTLED_EVENT,
  registerMorphLeaveHook,
  registerMorphCenterHook,
} from './project-morph';
import {
  abortFlight,
  flightHost,
  landVideo,
  liftVideo,
  refreshMainVideos,
  setMainVisualHidden,
} from './main-video';
import { type ViewMode, consumeIsReload, readProjetsState, saveProjetsState } from './projets/state';
import {
  CAROUSEL_INFO_HIDE_DELAY,
  DEZOOM_CROP_CLOSED,
  DEZOOM_INFO_HIDE_DELAY,
  DEZOOM_MASK_HIDDEN,
  DEZOOM_MASK_VISIBLE,
  DEZOOM_OTHERS_IMAGE_DELAY,
  DEZOOM_OTHERS_TEXT_DELAY,
  INFO_HIDE_TOTAL,
  INFO_PART_STAGGER,
  LISTE_IMAGE_STAGGER,
  LISTE_REVEAL_THRESHOLD,
  LISTE_ROW_STAGGER,
  LISTE_TITLE_ROW_STAGGER,
  MORPH_DURATION,
  MORPH_EASE,
  MORPH_VIDEO_Z,
  STEP_DURATION,
  STEP_EASE,
  STEP_INFO_HIDE_DELAY,
  STEP_INFO_REVEAL_DELAY,
  VIEW_IMAGE_AFTER_INFO,
  VIEW_IMAGE_STAGGER,
  VIEW_REVEAL_STAGGER,
  VIEW_TEXT_AFTER_REVEAL,
  WHEEL_THRESHOLD,
} from './projets/timing';
import {
  animateAndSettle,
  hideInfoParts,
  maskClearDistance,
  resetClearDistanceCache,
  revealInfoParts,
  settle,
} from './projets/anim';
import {
  getRowCache,
  hideListeRow,
  hideListeRowImages,
  hideListeTitle,
  revealListeImageCurtain,
  revealListeTitle,
  setListeRowClosedInstant,
  setListeTitleClosedInstant,
  showListeRow,
} from './projets/liste-rows';
import {
  dezoomMask,
  hideDezoomItemInfo,
  hideDezoomItemInfoInstant,
  openDezoomMask,
  resetDezoomItemInfoInstant,
  revealDezoomCard,
  showDezoomItemInfo,
} from './projets/dezoom-cards';
import { closeViewCurtain, openViewCurtain, resetViewCurtains } from './projets/view-curtains';

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

  // Each transition resolves as soon as the new view is in place (morph
  // landed / entering reveal started) - its reveal tail (text, other cards'
  // stagger) plays on in the background, so the switcher unlocks without
  // waiting ~2s. Safe to switch mid-reveal: every hide goes through
  // animateAndSettle, which cancels a reveal still running on that element
  // (vue 3's delayed reveals are also guarded by bumpCurtainGen).
  function setView(next: ViewMode): void {
    // Not mid carousel step either: both would animate the same item's clip-path.
    if (next === view || switching || carouselLocked) return;

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
    refreshMainVideos();
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
    // Vue 1 hides non-current items with visibility, which the videos'
    // IntersectionObserver can't see - tell them (here and once settled).
    refreshMainVideos();

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
      refreshMainVideos();
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
    // Ctrl+wheel (and trackpad pinch, which browsers report the same way)
    // is the browser's own zoom - never swallow it.
    if (e.ctrlKey) return;
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
          revealDezoomCard(el, 0, DEZOOM_OTHERS_TEXT_DELAY);
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

  const listeRows = Array.from(panels.liste?.querySelectorAll<HTMLElement>('.liste-row') ?? []);
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

  // Every row with any part on screen, top to bottom. Entering vue 3 reveals
  // all of these at once: the 40% rule (LISTE_REVEAL_THRESHOLD) is for rows
  // arriving while scrolling - applied here, a centred row's neighbours
  // (only peeking in by a strip) stayed closed until the first scroll popped
  // them, while the first/last project, which can't be centred, showed its
  // neighbour in time. Rows below the fold are still left to the observer.
  function onScreenListeRows(): HTMLElement[] {
    const vh = window.innerHeight;
    return listeRows.filter((row) => {
      const r = row.getBoundingClientRect();
      return r.height > 0 && r.bottom > 0 && r.top < vh;
    });
  }

  function showListeRows(): Promise<void> {
    const toShow = onScreenListeRows().filter((row) => !row.dataset.revealed);
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
            // Claimed now so the observer never reveals it twice; played
            // once the site-entry loader is out of the way (immediately on
            // every other visit - see afterSiteLoader).
            row.dataset.revealed = 'true';
            afterSiteLoader().then(() => showListeRow(row, i * LISTE_ROW_STAGGER));
          }
        });
      },
      { threshold: LISTE_REVEAL_THRESHOLD }
    );
    listeRows.forEach((row) => listeRevealObserver!.observe(row));
  }

  function hideCarouselView(): Promise<void> {
    return Promise.all([
      hideCarouselInfo(0),
      closeViewCurtain(carouselItems[carouselIndex], VIEW_IMAGE_AFTER_INFO),
    ]).then(() => {});
  }

  function showCarouselView(): Promise<void> {
    return Promise.all([
      openViewCurtain(carouselItems[carouselIndex], 0),
      showCarouselInfo(carouselIndex, VIEW_TEXT_AFTER_REVEAL),
    ]).then(() => {});
  }

  function hideDezoomView(): Promise<void> {
    const items = visibleDezoomItems(-1).filter((el) => el.dataset.revealed);
    return Promise.all(
      items.map((el, i) =>
        Promise.all([
          hideDezoomItemInfo(el, i * INFO_PART_STAGGER),
          closeViewCurtain(el, VIEW_IMAGE_AFTER_INFO + i * VIEW_IMAGE_STAGGER),
        ])
      )
    ).then(() => {});
  }

  // What's on screen opens left to right under its curtain; everything else
  // starts masked for the observer (initDezoomObserver), as before. The
  // on-screen ones are claimed first so the observer leaves them alone.
  function showDezoomView(): Promise<void> {
    const onScreen = visibleDezoomItems(-1);
    dezoomItems.forEach((el) => {
      const mask = dezoomMask(el);
      const isOnScreen = onScreen.includes(el);
      if (isOnScreen) el.dataset.revealed = 'true';
      else delete el.dataset.revealed;
      if (mask) mask.style.clipPath = isOnScreen ? '' : DEZOOM_MASK_HIDDEN;
      hideDezoomItemInfoInstant(el);
    });
    return Promise.all(
      onScreen.map((el, i) => {
        const delay = i * VIEW_REVEAL_STAGGER;
        return Promise.all([openViewCurtain(el, delay), showDezoomItemInfo(el, delay + VIEW_TEXT_AFTER_REVEAL)]);
      })
    ).then(() => {});
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
        // Read where vue 2 actually is before stopping it - otherwise vue 3
        // centres on whatever `current` was last set to elsewhere (vue 3 ->
        // vue 2 already did this via currentFromListe above).
        current = currentFromDezoom();
        isDezoomActive = false;
        cancelAnimationFrame(rafId);
        dezoomLenis?.stop();
      }
      if (leavingPanel) {
        await (view === 'carousel' ? hideCarouselView() : hideDezoomView());
        leavingPanel.hidden = true;
        resetViewCurtains(leavingPanel);
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
      void showListeRows();
    } else {
      pageLenis?.stop();
      if (next === 'carousel') {
        carouselIndex = current;
        setCarouselCurrentImage(carouselIndex);
        void showCarouselView();
      } else if (next === 'dezoom') {
        isDezoomActive = true;
        const dl = ensureDezoomLenis();
        dl?.start();
        scrollDezoomToCurrent(dl);
        rafId = requestAnimationFrame(dezoomRaf);
        void showDezoomView();
      }
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

    // A playing main-visual video flies with .morph-hero and keeps playing
    // (main-video.ts). The entering view's copy takes its place in the view
    // being left, so that view still has one next time.
    const videoHost = flightHost();
    if (videoHost && fromRect) {
      Object.assign(videoHost.style, {
        top: `${fromRect.top}px`,
        left: `${fromRect.left}px`,
        width: `${fromRect.width}px`,
        height: `${fromRect.height}px`,
      });
    }
    const flyingVideo = leavingImg ? liftVideo(leavingImg, MORPH_VIDEO_Z, heroImage(next, heroIndex)) : null;

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
          const mask = dezoomMask(el);
          if (mask) mask.style.clipPath = '';
          return;
        }
        delete el.dataset.revealed;
        const mask = dezoomMask(el);
        if (mask) mask.style.clipPath = DEZOOM_MASK_HIDDEN;
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
      if (enteringImg) setMainVisualHidden(enteringImg, true);

      const keyframes = [
        { top: `${fromRect.top}px`, left: `${fromRect.left}px`, width: `${fromRect.width}px`, height: `${fromRect.height}px` },
        { top: `${toRect.top}px`, left: `${toRect.left}px`, width: `${toRect.width}px`, height: `${toRect.height}px` },
      ];
      const options: KeyframeAnimationOptions = { duration: MORPH_DURATION, easing: MORPH_EASE, fill: 'forwards' };
      morphDone = settle(morphHero.animate(keyframes, options));
      if (flyingVideo && videoHost) {
        morphDone = Promise.all([morphDone, settle(videoHost.animate(keyframes, options))]).then(() => {});
      }
    }

    const leavingOthersDone = leavingView === 'dezoom' ? Promise.all(
      visibleSiblings.map((el) => {
        const mask = dezoomMask(el);
        if (!mask) return Promise.resolve();
        return animateAndSettle(mask, [{ clipPath: DEZOOM_MASK_VISIBLE }, { clipPath: DEZOOM_CROP_CLOSED }], {
          duration: MORPH_DURATION,
          easing: MORPH_EASE,
          fill: 'forwards',
        }).then(() => {
          mask.style.clipPath = DEZOOM_CROP_CLOSED;
        });
      })
    ).then(() => {}) : Promise.resolve();

    await Promise.all([morphDone, leavingOthersDone]);
    if (flyingVideo && enteringImg) landVideo(flyingVideo, enteringImg);
    else if (flyingVideo) abortFlight();

    if (morphHero) {
      morphHero.hidden = true;
      morphHero.style.cssText = '';
    }
    if (enteringImg) setMainVisualHidden(enteringImg, false);

    if (leavingView === 'dezoom') {
      panels.dezoom!.hidden = true;
      visibleSiblings.forEach((el) => {
        const mask = dezoomMask(el);
        if (mask) mask.style.clipPath = '';
      });
    }

    if (next === 'carousel') {
      void showCarouselInfo(heroIndex);
    } else {
      void showDezoomItemInfo(dezoomItems[heroIndex]);
      visibleSiblings.forEach((el) =>
        revealDezoomCard(el, DEZOOM_OTHERS_IMAGE_DELAY, DEZOOM_OTHERS_IMAGE_DELAY + DEZOOM_OTHERS_TEXT_DELAY)
      );
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
        if (el.dataset.deferredReveal === 'true') {
          delete el.dataset.deferredReveal;
          openDezoomMask(el, i * DEZOOM_OTHERS_IMAGE_DELAY);
        }
        showDezoomItemInfo(el, DEZOOM_OTHERS_TEXT_DELAY);
      });
      return;
    }
    if (view === 'liste') {
      revealListeTitle(listeRows[current]);

      const currentRow = listeRows[current];
      if (currentRow) {
        delete currentRow.dataset.morphLanding;
        const otherImages = getRowCache(currentRow).images.slice(1);
        otherImages.forEach((wrap, i) => {
          revealListeImageCurtain(wrap, (i + 1) * LISTE_IMAGE_STAGGER);
        });
      }

      // Plus any row only peeking in (under the observer's 40%) - same as
      // entering vue 3, see onScreenListeRows.
      const onScreen = onScreenListeRows();
      const deferredRows = listeRows.filter(
        (row) => row.dataset.deferredReveal === 'true' || (onScreen.includes(row) && !row.dataset.revealed)
      );
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
          const mask = dezoomMask(el);
          const textDone = hideDezoomItemInfo(el, 0);
          if (!mask) return textDone;
          const cropDone = animateAndSettle(mask, [{ clipPath: DEZOOM_MASK_VISIBLE }, { clipPath: DEZOOM_CROP_CLOSED }], {
            duration: MORPH_DURATION,
            easing: MORPH_EASE,
            fill: 'forwards',
          }).then(() => {
            mask.style.clipPath = DEZOOM_CROP_CLOSED;
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

  // Two ways in: coming back from a project page (deferCurrentInfo - the
  // morph clone covers the current image, the rest waits for it to settle,
  // see revealAfterMorphSettle), or a reload. A reload runs behind the
  // site-entry loader, so it plays each view's normal entrance rather than
  // snapping to its end state: hidden starting state now, animation once
  // the loader has cleared enough to see it (afterSiteLoader).
  function applyRestoredView(deferCurrentInfo: boolean): void {
    if (view === 'carousel') {
      carouselIndex = current;
      setCarouselCurrentImage(carouselIndex);
      hideCurrentInfoInstant();
      if (!deferCurrentInfo) afterSiteLoader().then(() => showCarouselInfo(carouselIndex));
      return;
    }

    panels.carousel!.hidden = true;

    if (view === 'dezoom' && !deferCurrentInfo) {
      panels.dezoom!.hidden = false;
      isDezoomActive = true;
      const dl = ensureDezoomLenis();
      dl?.start();
      scrollDezoomToCurrent(dl);
      // Same as entering vue 2 from the switcher: everything starts masked;
      // the current item and its on-screen neighbours reveal now,
      // staggered, and the rest are left to the observer for when they
      // scroll into view.
      const onScreen = [dezoomItems[current], ...visibleDezoomItems(current)].filter(Boolean);
      dezoomItems.forEach((el) => {
        if (onScreen.includes(el)) el.dataset.revealed = 'true';
        else delete el.dataset.revealed;
        const mask = dezoomMask(el);
        if (mask) mask.style.clipPath = DEZOOM_MASK_HIDDEN;
        hideDezoomItemInfoInstant(el);
      });
      afterSiteLoader().then(() => {
        onScreen.forEach((el, i) =>
          revealDezoomCard(el, i * DEZOOM_OTHERS_IMAGE_DELAY, i === 0 ? 0 : DEZOOM_OTHERS_TEXT_DELAY)
        );
      });
      rafId = requestAnimationFrame(dezoomRaf);
    } else if (view === 'dezoom') {
      panels.dezoom!.hidden = false;
      isDezoomActive = true;
      const dl = ensureDezoomLenis();
      dl?.start();
      scrollDezoomToCurrent(dl);
      const deferredSiblings = deferCurrentInfo ? new Set(visibleDezoomItems(current)) : null;
      dezoomItems.forEach((el, i) => {
        el.dataset.revealed = 'true';
        const mask = dezoomMask(el);
        if (i === current) {
          if (mask) mask.style.clipPath = '';
          if (deferCurrentInfo) hideCurrentInfoInstant();
          else resetDezoomItemInfoInstant(el);
        } else if (deferredSiblings?.has(el)) {
          el.dataset.deferredReveal = 'true';
          if (mask) mask.style.clipPath = DEZOOM_MASK_HIDDEN;
          hideDezoomItemInfoInstant(el);
        } else {
          if (mask) mask.style.clipPath = '';
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
          currentRow.dataset.morphLanding = 'true';
        }
      }
      scrollListeToCurrent();
      if (!deferCurrentInfo) {
        // Title + images of every row on screen, as when switching to vue 3
        // (showListeRows). Claimed now so the scroll-reveal observer leaves
        // them alone.
        const onScreen = onScreenListeRows();
        onScreen.forEach((row) => {
          row.dataset.revealed = 'true';
        });
        afterSiteLoader().then(() => {
          onScreen.forEach((row, i) => showListeRow(row, i * LISTE_ROW_STAGGER));
        });
      }
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
    resetClearDistanceCache();
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