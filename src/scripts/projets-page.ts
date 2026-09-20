import Lenis from 'lenis';
import { lenis as pageLenis } from './smooth-scroll';

// Vue 1 (carrousel): a step is triggered by the first meaningful bit of
// wheel motion, then locked until the swipe finishes - without this, a
// single trackpad gesture (which fires dozens of wheel events) would skip
// through most of the list in one go. Deliberately a bit higher than a bare
// "any motion at all" threshold, so a small/accidental nudge doesn't step.
const WHEEL_THRESHOLD = 18;
const STEP_DURATION = 900;
const STEP_EASE = 'cubic-bezier(0.76, 0, 0.24, 1)';

// Info text reveals/hides as if sliding under a mask (.item-info is
// overflow:hidden, .info-name/.info-meta are what actually translate) -
// appearing rises up into view, disappearing sinks back down out of it.
// Title and meta animate as two independent targets rather than one shared
// block, meta trailing the title by INFO_PART_STAGGER on both ends.
const INFO_HIDE_DURATION = 320;
const INFO_HIDE_EASE = 'cubic-bezier(0.4, 0, 1, 1)';
const INFO_REVEAL_DURATION = 380;
const INFO_REVEAL_EASE = 'cubic-bezier(0, 0, 0.2, 1)';
const INFO_PART_STAGGER = 70;
// Total time until the *last* part (meta, staggered after the title) has
// finished hiding - used to time a reveal relative to hide actually being
// done, not just the title's own share of it.
const INFO_HIDE_TOTAL = INFO_HIDE_DURATION + INFO_PART_STAGGER;
// A beat before a step's outgoing text even starts sinking away, so it
// doesn't react the instant the wheel fires.
const STEP_INFO_HIDE_DELAY = 150;
// Reveal is timed off the *step*, not off when hide happens to finish - the
// text should read as synchronized with the image's own swipe, landing
// well after the incoming image has mostly arrived rather than racing it.
const STEP_INFO_REVEAL_DELAY = STEP_DURATION * 0.85;
// Leaving dezoom, the selected card's text sinking away reads better with a
// generous beat after the click before it starts - long enough that the
// hide clearly plays out as its own beat before anything else moves.
const DEZOOM_INFO_HIDE_DELAY = 450;
// Same idea leaving carousel for dezoom.
const CAROUSEL_INFO_HIDE_DELAY = 350;

// Vue 1 <-> Vue 2 morph: a single dedicated <img> (.morph-hero) is
// physically resized from the outgoing image's on-screen rect to the
// incoming one's - a normal, unexaggerated ease-in-out.
const MORPH_DURATION = 700;
const MORPH_EASE = 'cubic-bezier(0.4, 0, 0.2, 1)';
const MORPH_SIBLING_FADE_DURATION = 650;

type ViewMode = 'carousel' | 'dezoom' | 'liste';

export function initProjetsPage(root: ParentNode = document): void {
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
  // The project the user is "on" - kept in sync from whichever view is
  // active, and used to position whichever view they switch into next.
  let current = 0;
  // Blocks new view switches while a vue1<->vue2 morph is in flight - that
  // sequence (hide text, morph, reveal text) has to run start to finish
  // before another one begins.
  let switching = false;

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

    // Vues 1 & 2 take over the whole viewport and drive their own scroll;
    // vue 3 is normal document flow and uses the page's own scroll.
    if (view === 'liste') {
      pageLenis?.start();
      pageLenis?.resize();
      scrollListeToCurrent();
    } else {
      pageLenis?.stop();
    }
    if (view === 'dezoom') {
      const dl = ensureDezoomLenis();
      dl?.start();
      scrollDezoomToCurrent(dl);
    } else {
      dezoomLenis?.stop();
    }
    if (view === 'carousel') {
      carouselIndex = current;
      setCarouselCurrentImage(carouselIndex);
      setCarouselInfoInstant(carouselIndex);
    }
  }

  switcherButtons.forEach((btn) => {
    btn.addEventListener('click', () => setView((btn.dataset.setView as ViewMode) ?? 'carousel'));
  });

  // ---------------------------------------------------------------------
  // Vue 1 - grand carrousel: incoming image swipes in over the outgoing
  // one, wrapping the index means looping past the last/first project is
  // always just as seamless as any other step. Info text lives in one
  // shared, fixed bottom-left block - not on the images themselves - and
  // slides under its own mask between projects.
  // ---------------------------------------------------------------------

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

  function settle(animation: Animation): Promise<void> {
    // Same defensive reasoning as MORPH_TRANSITION_TIMEOUT - `finished` is
    // compositor-driven and outside this code's control, so a hard cap
    // guarantees callers awaiting this can't get stuck forever if a frame
    // never comes.
    const timeout = new Promise<void>((resolve) => window.setTimeout(resolve, 2000));
    return Promise.race([animation.finished.catch(() => {}), timeout]).then(() => {
      try {
        // If that timeout is what fired (the animation never actually
        // played), its currentTime is still sitting at 0 - commitStyles()
        // bakes in whatever frame it's *currently* showing, not
        // necessarily the end one, so force a seek to the end first.
        if (animation.playState !== 'finished') animation.finish();
        animation.commitStyles();
      } catch {
        // Already canceled elsewhere, or nothing left to commit.
      }
      animation.cancel();
    });
  }

  // How far a part has to travel to fully clear its mask, in px - NOT
  // translateY(100%), which is relative to the part's *own* height. The
  // meta line is much shorter than the title, so 100% of its own height
  // fell well short of the shared mask's (title-sized) clipping edge,
  // leaving the tail end of it still visible at "fully hidden".
  function maskClearDistance(el: HTMLElement): number {
    const mask = el.closest<HTMLElement>('.item-info');
    return (mask ?? el).getBoundingClientRect().height;
  }

  // Title and meta animate independently (meta starting/leaving
  // INFO_PART_STAGGER after the title) rather than as one block, so both
  // hide/reveal pairs take two elements instead of one.
  function hideInfoParts(name: HTMLElement | null, meta: HTMLElement | null, delay = 0): Promise<void> {
    const targets = [name, meta].filter((el): el is HTMLElement => Boolean(el));
    return Promise.all(
      targets.map((el, i) => {
        const clear = maskClearDistance(el);
        return settle(
          el.animate([{ transform: 'translateY(0)' }, { transform: `translateY(${clear}px)` }], {
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
    return Promise.all(
      targets.map((el, i) => {
        const clear = maskClearDistance(el);
        el.style.transform = `translateY(${clear}px)`;
        return settle(
          el.animate([{ transform: `translateY(${clear}px)` }, { transform: 'translateY(0)' }], {
            duration: INFO_REVEAL_DURATION,
            delay: delay + i * INFO_PART_STAGGER,
            easing: INFO_REVEAL_EASE,
            fill: 'forwards',
          })
        );
      })
    ).then(() => {});
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
    // Text content must not swap to the new project until the outgoing
    // text has actually finished sliding away - starting the reveal
    // concurrently with a `delay` looked right on paper, but the reveal's
    // own setup immediately overwrote the name/meta text nodes still mid-
    // hide, so the outgoing text displayed the *incoming* project's name
    // for the whole hide animation. Chaining after hide's own promise
    // fixes that; the remaining delay keeps the reveal landing at roughly
    // the same point relative to the image swipe as before.
    hideCarouselInfo(STEP_INFO_HIDE_DELAY).then(() => {
      showCarouselInfo(toIndex, Math.max(0, STEP_INFO_REVEAL_DELAY - STEP_INFO_HIDE_DELAY - INFO_HIDE_TOTAL));
    });

    // Explicit z-index rather than leaning on .is-current's own (both
    // elements carry that class for the duration of the swipe, and which
    // one is later in the DOM depends on direction) - the incoming image
    // must always paint above the outgoing one, whichever way it's coming
    // from.
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

  panels.carousel?.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      if (switching || carouselLocked || Math.abs(e.deltaY) < WHEEL_THRESHOLD) return;
      stepCarousel(e.deltaY > 0 ? 1 : -1);
    },
    { passive: false }
  );

  // ---------------------------------------------------------------------
  // Vue 2 - carrousel dézoomé: continuous horizontal scroll, vertical
  // wheel gesture mapped to horizontal motion via Lenis.
  // ---------------------------------------------------------------------

  const dezoomTrack = panels.dezoom?.querySelector<HTMLElement>('.dezoom-track') ?? null;
  const dezoomItems = Array.from(panels.dezoom?.querySelectorAll<HTMLElement>('.dezoom-item') ?? []);
  let dezoomLenis: Lenis | null = null;

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
      const raf = (time: number) => {
        dezoomLenis?.raf(time);
        requestAnimationFrame(raf);
      };
      requestAnimationFrame(raf);
    }
    return dezoomLenis;
  }

  // What scrollDezoomToCurrent would set scrollLeft to if this item were
  // current - shared by both directions so "where an item goes" and "which
  // item is here" can never drift apart the way they did before.
  function centeredScrollFor(el: HTMLElement): number {
    if (!panels.dezoom) return el.offsetLeft;
    const centered = el.offsetLeft - (panels.dezoom.clientWidth - el.offsetWidth) / 2;
    const limit = dezoomLenis?.limit ?? Infinity;
    return Math.max(0, Math.min(centered, limit));
  }

  // Finds which item's *own* centered-and-clamped target position is
  // closest to the actual scrollLeft, rather than comparing scrollLeft
  // against item centers directly - the latter breaks at the first/last
  // project, where clamping means the current item isn't actually centered
  // (it's flush against the track's start/end), so its true center sits
  // well off the viewport's geometric center and a neighbor would win.
  function currentFromDezoom(): number {
    if (dezoomItems.length === 0 || !panels.dezoom) return current;
    const scrollLeft = panels.dezoom.scrollLeft;
    let best = 0;
    let bestDist = Infinity;
    dezoomItems.forEach((el, i) => {
      const dist = Math.abs(centeredScrollFor(el) - scrollLeft);
      if (dist < bestDist) {
        bestDist = dist;
        best = i;
      }
    });
    return best;
  }

  // Centers the current card rather than flush-left against the viewport -
  // scrollTo's own clamping to [0, dl.limit] naturally gives the "left for
  // the first project, right for the last" behavior for free, since a
  // centered target near either end just gets pulled back into range.
  function scrollDezoomToCurrent(dl: Lenis | null): void {
    const target = dezoomItems[current];
    if (!dl || !target || !panels.dezoom) return;
    dl.resize();
    const clamped = centeredScrollFor(target);
    dl.scrollTo(clamped, { immediate: true, force: true });
    // Lenis applies even an immediate scrollTo through its own raf() tick
    // rather than synchronously, so a dropped/delayed frame right after
    // could leave native scrollLeft not yet caught up to it - setting it
    // directly guarantees the position is really there right away, which
    // currentFromDezoom() (reading scrollLeft) depends on when the user
    // immediately switches away again.
    panels.dezoom.scrollLeft = clamped;
  }

  function hideDezoomItemInfo(item: HTMLElement | undefined, delay = 0): Promise<void> {
    const name = item?.querySelector<HTMLElement>('.info-name') ?? null;
    const meta = item?.querySelector<HTMLElement>('.info-meta') ?? null;
    return hideInfoParts(name, meta, delay);
  }

  function showDezoomItemInfo(item: HTMLElement | undefined, delay = 0): Promise<void> {
    const name = item?.querySelector<HTMLElement>('.info-name') ?? null;
    const meta = item?.querySelector<HTMLElement>('.info-meta') ?? null;
    return revealInfoParts(name, meta, delay);
  }

  // ---------------------------------------------------------------------
  // Vue 3 - liste: normal page scroll (existing page Lenis instance).
  // ---------------------------------------------------------------------

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

  // ---------------------------------------------------------------------
  // Vue 1 <-> Vue 2 morph
  // ---------------------------------------------------------------------
  // Sequence: outgoing text sinks under its mask first -> .morph-hero (one
  // dedicated <img>, not part of either view) is placed over the outgoing
  // image's exact on-screen rect, the real views swap shape/visibility
  // instantly underneath it, and it animates to the incoming image's rect
  // while that real image stays hidden until it lands -> incoming text
  // rises into place. One element whose own width/height genuinely change,
  // not two screenshots cross-fading - see the CSS comment on .morph-hero
  // for why that distinction is the whole point.

  function heroImage(v: ViewMode, index: number): HTMLImageElement | null {
    const item = v === 'carousel' ? carouselItems[index] : v === 'dezoom' ? dezoomItems[index] : null;
    return item?.querySelector<HTMLImageElement>('img') ?? null;
  }

  // Beat after the current project's own text starts hiding/revealing
  // before the rest of the (on-screen) cards follow as a group - the
  // current one reads first, then the row catches up together rather than
  // everything moving as one undifferentiated block.
  const DEZOOM_OTHERS_STAGGER = 150;

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
    // Leaving dezoom, `current` only ever gets updated by its scroll
    // listener - if the user scrolled and then left without triggering
    // another scroll event in between, it was stale, so the morph kept
    // grabbing whatever project `current` last happened to be (often index
    // 0) instead of the one actually on screen. Reading it fresh here,
    // right before it's used, is what entering dezoom already gets for
    // free (carouselIndex is kept live the whole time carousel is active).
    if (view === 'dezoom') current = currentFromDezoom();
    const heroIndex = current;

    // Warm up .morph-hero's own decode of this image as early as possible
    // - it's a fresh <img> that's never shown this src before, so even a
    // cached image needs a moment to decode for *this* element the first
    // time, and doing that only right before the morph needed to show it
    // left a brief blank flash. Kicking it off now lets it happen
    // concurrently with the text hide below, which takes far longer.
    const heroSrc = heroImage(view, heroIndex)?.currentSrc;
    if (morphHero && heroSrc) {
      morphHero.src = heroSrc;
      morphHero.decode?.().catch(() => {});
    }

    if (view === 'carousel') {
      await hideCarouselInfo(CAROUSEL_INFO_HIDE_DELAY);
    } else {
      // The other visible cards' text and the card itself fade out on the
      // same schedule, started here but only actually awaited below (after
      // the hero's own text) - overlapping the two instead of stacking them.
      // This *is* awaited, unlike before: previously nothing here waited on
      // it, so the cards were still fully opaque when the panel got hidden
      // a moment later and they just vanished instantly with it - that's
      // the "all other images disappear" report, a separate bug from the
      // flash below, not caused by it.
      const others = visibleDezoomItems(heroIndex);
      const othersDelay = DEZOOM_INFO_HIDE_DELAY + DEZOOM_OTHERS_STAGGER;
      const othersFadeOut = Promise.all(
        others.map((el) => {
          const fade = el.animate([{ opacity: 1 }, { opacity: 0 }], {
            duration: MORPH_SIBLING_FADE_DURATION,
            delay: othersDelay,
            easing: 'ease-in',
            fill: 'forwards',
          });
          return settle(fade);
        })
      );
      others.forEach((el) => hideDezoomItemInfo(el, othersDelay));
      await hideDezoomItemInfo(dezoomItems[heroIndex], DEZOOM_INFO_HIDE_DELAY);
      await othersFadeOut;
    }

    const leavingView = view;
    const leavingImg = heroImage(leavingView, heroIndex);
    const fromRect = leavingImg?.getBoundingClientRect() ?? null;

    // Instant DOM swap - the real views change shape/visibility right
    // away; .morph-hero (below) is what actually shows the transition.
    panels[leavingView]!.hidden = true;
    panels[next]!.hidden = false;
    view = next;
    page!.dataset.view = view;
    updateSwitcherUI();

    if (next === 'carousel') {
      carouselIndex = heroIndex;
      setCarouselCurrentImage(heroIndex);
    } else {
      const dl = ensureDezoomLenis();
      dl?.start();
      scrollDezoomToCurrent(dl);
      // Hidden here, but not faded in yet - see below. Starting their fade
      // (and their text reveal) at this same instant, while the hero
      // image is still mid-morph, was landing before it had actually
      // settled into place.
      dezoomItems.forEach((el, i) => {
        if (i !== heroIndex) el.style.opacity = '0';
      });
    }
    if (leavingView === 'dezoom') dezoomLenis?.stop();

    const enteringImg = heroImage(next, heroIndex);
    const toRect = enteringImg?.getBoundingClientRect() ?? null;

    if (morphHero && leavingImg && fromRect && toRect) {
      // No await here on purpose. src was already set (and decode() kicked
      // off, fire-and-forget) back when this function started, concurrent
      // with the several-hundred-ms text hide above - by now it's decoded
      // in every realistic case. An `await` right here - even one that
      // resolves "immediately" - still yields at least one real paint
      // before continuing, and during that paint the panel swap above had
      // already happened but .morph-hero was still `hidden` and the real
      // incoming image was still fully visible at its resting spot: a
      // frame (or several, since decode()'s promise settles via a genuine
      // async step, not a microtask) of the *other* real view showing
      // through, which read as "the old view flashes." Doing all of this
      // synchronously, in the same tick as the DOM swap above, means the
      // very first frame the browser paints already has morphHero visible
      // at fromRect and the real incoming image hidden - nothing in
      // between for a flash to occur in.
      morphHero.style.top = `${fromRect.top}px`;
      morphHero.style.left = `${fromRect.left}px`;
      morphHero.style.width = `${fromRect.width}px`;
      morphHero.style.height = `${fromRect.height}px`;
      morphHero.hidden = false;
      // The real incoming image is already sitting at its final spot the
      // whole time this runs - hide it while the overlay travels there, or
      // the two would show at once (right back to the "two images"
      // problem this whole approach exists to avoid).
      if (enteringImg) enteringImg.style.visibility = 'hidden';

      const anim = morphHero.animate(
        [
          { top: `${fromRect.top}px`, left: `${fromRect.left}px`, width: `${fromRect.width}px`, height: `${fromRect.height}px` },
          { top: `${toRect.top}px`, left: `${toRect.left}px`, width: `${toRect.width}px`, height: `${toRect.height}px` },
        ],
        { duration: MORPH_DURATION, easing: MORPH_EASE, fill: 'forwards' }
      );
      await settle(anim);

      morphHero.hidden = true;
      morphHero.style.cssText = '';
      if (enteringImg) enteringImg.style.visibility = '';
    }

    if (next === 'carousel') {
      await showCarouselInfo(heroIndex);
    } else {
      // Only now, with the hero image actually settled, do the other
      // cards start fading in and revealing their own text - current
      // project's text first (below), everyone else's following together.
      const others = visibleDezoomItems(heroIndex);
      dezoomItems.forEach((el, i) => {
        if (i === heroIndex) return;
        const fade = el.animate([{ opacity: 0 }, { opacity: 1 }], {
          duration: MORPH_SIBLING_FADE_DURATION,
          easing: 'ease-out',
          fill: 'forwards',
        });
        settle(fade);
      });
      others.forEach((el) => showDezoomItemInfo(el, DEZOOM_OTHERS_STAGGER));
      await showDezoomItemInfo(dezoomItems[heroIndex]);
    }
  }

  // ---------------------------------------------------------------------
  // Initial state
  // ---------------------------------------------------------------------

  page.dataset.view = view;
  updateSwitcherUI();
  pageLenis?.stop();

  window.addEventListener('resize', () => {
    if (view === 'dezoom') dezoomLenis?.resize();
  });
}
