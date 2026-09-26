import gsap from 'gsap';
import { CustomEase } from 'gsap/CustomEase';
import { navigate } from 'astro:transitions/client';
import { afterSiteLoaderDone } from './site-loader';

// The site menu's bar (SiteMenu.astro). Persisted, so everything here is
// set up once per session (main.ts), not per page.
//
// - Entrance, once the site-entry loader is fully gone: a square with the
//   logo already in it is revealed top to bottom and widens left and right
//   into the bar, the logo holding the centre; near the end of the
//   widening the logo slides to the left end, and as it arrives the page
//   name and the burger rise into their masks. (Hiding
//   it, when needed, is the same shape the other way: bottom edge rising.)
// - Navigation: slides to its place for the next page (top-centre on the
//   homepage, bottom-centre everywhere else) while the page leaves; the
//   page name swaps through its mask once the new page is in.
// - Burger: the logo leaves left, the burger right, the page name upwards;
//   the bar shrinks back to a centred square and a cross rises into it.
//   Closing plays it back (the cross leaves upwards, the name rises in).
//   At the same time the panel (SiteMenuPanel) opens from its edge next to
//   the bar - below it on the homepage, above it elsewhere - and its lines
//   rise into their masks. Closes on the cross, Escape, a click outside,
//   and any navigation (the page transition then plays as usual).
// - Scroll: down hides the bar (bottom edge rising), up brings it back
//   (revealed top to bottom); any scroll while it's open closes it.
//
// The bar's shape is a clip-path on the whole menu - a small element, so
// no repaint cost worth a curtain here (unlike full-size images, see the
// transform curtains in projets.astro).

gsap.registerPlugin(CustomEase);

const EASE = CustomEase.create('menuBar', '0.76, 0, 0.24, 1');
const HIDE_EASE = CustomEase.create('menuHide', '0.4, 0, 1, 1');
const REVEAL_EASE = CustomEase.create('menuReveal', '0, 0, 0.2, 1');
const SQUARE_IN = 0.4;
const WIDEN = 0.55;
// Entrance: the logo holds the centre while the square widens, then slides
// to its place, starting this far (share of WIDEN) into the widening.
const LOGO_SLIDE = 0.65;
const LOGO_SLIDE_AT = 0.95;
const PART_IN = 0.4;
const PART_STAGGER = 0.08;
const PART_OUT = 0.24;
const SHRINK = 0.6;
// Same length as the page wipe / morph it runs alongside.
const MOVE = 0.9;
const ROLL = 0.85;
const PANEL_IN = 0.7;
const PANEL_OUT = 0.5;
const LINE_STAGGER = 0.025;
const CTA_FILL = 0.45;
const SCROLL_HIDE = 0.45;
const SCROLL_SHOW = 0.55;
// Scroll steps smaller than this are ignored (trackpad jitter), and near
// the top of the page the bar always stays.
const SCROLL_MIN_DELTA = 4;
const SCROLL_TOP_ZONE = 60;
const RADIUS = '2px';

type Shape = 'hidden' | 'square' | 'bar';

// Hidden = clipped a pixel PAST the edge. Sizes aren't whole pixels (e.g.
// 51.15px) and offsetHeight rounds them: clipping exactly to the rounded
// size left a sub-pixel sliver, drawn as a 1px line (Leo, 2026-09-26).
const PAST_EDGE = 1;

export function initSiteMenu(): void {
  const menu = document.getElementById('site-menu');
  if (!menu) return;
  const logo = menu.querySelector<HTMLElement>('.site-menu-logo')!;
  // The logo's mask cell slides with the bar's shape (square -> bar); the
  // logo itself slides inside it - moving the logo instead, its own mask
  // would clip it.
  const logoCell = logo.parentElement!;
  const name = menu.querySelector<HTMLElement>('.site-menu-name')!;
  const nameText = menu.querySelector<HTMLElement>('.site-menu-name-text')!;
  const toggle = menu.querySelector<HTMLButtonElement>('.site-menu-toggle')!;
  const close = menu.querySelector<HTMLButtonElement>('.site-menu-close')!;
  const panel = document.getElementById('site-menu-panel');
  const panelLines = panel ? Array.from(panel.querySelectorAll<HTMLElement>('.panel-line')) : [];
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const d = (seconds: number) => (reduced ? 0 : seconds);

  let shape: Shape = 'hidden';
  let open = false;
  let busy: gsap.core.Timeline | null = null;

  // The bar's shape = the menu's clip-path, tweened as plain numbers and
  // written out on every update. Not by tweening the
  // clip-path string: the browser reports it back shortened (equal values
  // merged, e.g. "inset(0px 214px round 2px)"), GSAP then paired the
  // numbers wrongly and one side jumped instead of animating.
  const clipState = { bottom: 0, side: 0 };
  function applyClip(): void {
    menu!.style.clipPath = `inset(0px ${clipState.side}px ${clipState.bottom}px ${clipState.side}px round ${RADIUS})`;
  }
  function clipFor(target: Shape): { bottom: number; side: number } {
    const w = menu!.offsetWidth;
    const h = menu!.offsetHeight;
    const side = Math.max(0, (w - h) / 2);
    // Hidden = the bottom edge up at the top: it reveals top to bottom.
    if (target === 'hidden') return { bottom: h + PAST_EDGE, side };
    if (target === 'square') return { bottom: 0, side };
    return { bottom: 0, side: 0 };
  }
  function setShape(target: Shape): void {
    Object.assign(clipState, clipFor(target));
    applyClip();
  }
  function shapeTo(target: Shape, duration: number): gsap.core.Tween {
    return gsap.to(clipState, { ...clipFor(target), duration: d(duration), ease: EASE, onUpdate: applyClip });
  }

  // How far the logo / burger cells sit from the bar's centre.
  function toCentre(): number {
    return Math.max(0, (menu!.offsetWidth - menu!.offsetHeight) / 2);
  }

  // The panel's reveal, same technique as the bar's shape: its clip-path
  // from plain numbers. Closed = collapsed onto its edge next to the bar
  // (its top edge when it hangs below the bar, its bottom edge above).
  const panelClip = { top: 0, bottom: 0 };
  function applyPanelClip(): void {
    panel!.style.clipPath = `inset(${panelClip.top}px 0px ${panelClip.bottom}px 0px round ${RADIUS})`;
  }
  function panelClipFor(opened: boolean): { top: number; bottom: number } {
    if (opened) return { top: 0, bottom: 0 };
    const h = panel!.offsetHeight + PAST_EDGE;
    return panel!.dataset.position === 'top' ? { top: 0, bottom: h } : { top: h, bottom: 0 };
  }

  function enter(): void {
    setShape('hidden');
    // The CSS's hidden offsets again, as percentages (GSAP would read the
    // CSS translate back as fixed px).
    // The logo is already in place: the square's reveal uncovers it.
    gsap.set(logo, { xPercent: 0, x: 0 });
    gsap.set([toggle, name, close], { xPercent: 0, x: 0, yPercent: 100, y: 0 });
    gsap.set(logoCell, { x: toCentre() });
    busy = gsap
      .timeline({ onComplete: () => void (busy = null) })
      .add(shapeTo('square', SQUARE_IN), 0)
      .add(() => void (shape = 'square'))
      .add(shapeTo('bar', WIDEN), 'widen')
      .add(() => void (shape = 'bar'), `widen+=${d(WIDEN)}`)
      .to(logoCell, { x: 0, duration: d(LOGO_SLIDE), ease: EASE }, `widen+=${d(WIDEN * LOGO_SLIDE_AT)}`)
      .to(name, { yPercent: 0, duration: d(PART_IN), ease: REVEAL_EASE }, `-=${d(0.2)}`)
      .to(toggle, { yPercent: 0, duration: d(PART_IN), ease: REVEAL_EASE }, `<${d(PART_STAGGER)}`);
  }

  // Burger: bar -> centred square with a cross, and back.
  function setOpen(next: boolean): gsap.core.Timeline | null {
    if (next === open || busy || shape === 'hidden') return null;
    open = next;
    toggle.setAttribute('aria-expanded', String(open));
    // Only the visible button is reachable.
    toggle.tabIndex = open ? -1 : 0;
    close.tabIndex = open ? 0 : -1;
    const tl = gsap.timeline({ onComplete: () => void (busy = null) });
    busy = tl;
    if (open) {
      tl.to(logo, { xPercent: -100, duration: d(PART_OUT), ease: HIDE_EASE }, 0)
        .to(toggle, { xPercent: 100, duration: d(PART_OUT), ease: HIDE_EASE }, 0)
        .to(name, { yPercent: -100, duration: d(PART_OUT), ease: HIDE_EASE }, 0)
        .add(shapeTo('square', SHRINK), d(0.15))
        .fromTo(close, { yPercent: 100 }, { yPercent: 0, duration: d(PART_IN), ease: REVEAL_EASE }, `-=${d(0.3)}`)
        .add(() => void (shape = 'square'));
      if (panel) {
        panel.inert = false;
        panel.classList.add('is-open');
        Object.assign(panelClip, panelClipFor(false));
        applyPanelClip();
        // y: 0 too - GSAP reads the CSS's hidden translate back as px and
        // would keep it under its own yPercent (the lines then only showed
        // mid-close).
        gsap.set(panelLines, { yPercent: 100, y: 0 });
        tl.to(panelClip, { ...panelClipFor(true), duration: d(PANEL_IN), ease: EASE, onUpdate: applyPanelClip }, d(0.15))
          .to(panelLines, { yPercent: 0, duration: d(PART_IN), ease: REVEAL_EASE, stagger: d(LINE_STAGGER) }, d(0.3));
      }
      if (!reduced) close.focus({ preventScroll: true });
    } else {
      if (panel) {
        tl.to(panelLines, { yPercent: -100, duration: d(PART_OUT), ease: HIDE_EASE, stagger: d(LINE_STAGGER / 3) }, 0)
          .to(panelClip, { ...panelClipFor(false), duration: d(PANEL_OUT), ease: EASE, onUpdate: applyPanelClip }, d(0.15))
          .add(() => {
            panel.inert = true;
            panel.classList.remove('is-open');
          });
      }
      tl.to(close, { yPercent: -100, duration: d(PART_OUT), ease: HIDE_EASE }, 0)
        .add(shapeTo('bar', SHRINK), d(0.15))
        .fromTo(name, { yPercent: 100 }, { yPercent: 0, duration: d(PART_IN), ease: REVEAL_EASE }, `-=${d(0.3)}`)
        .to(logo, { xPercent: 0, duration: d(PART_IN), ease: REVEAL_EASE }, '<')
        .to(toggle, { xPercent: 0, duration: d(PART_IN), ease: REVEAL_EASE }, '<')
        .add(() => void (shape = 'bar'));
      if (document.activeElement === close) toggle.focus({ preventScroll: true });
    }
    return tl;
  }

  toggle.addEventListener('click', () => setOpen(true));
  close.addEventListener('click', () => setOpen(false));

  // Closing no matter what: an opening still playing is finished first.
  // `instant`: straight to closed, no animation.
  function forceClose(instant = false): Promise<void> {
    if (!open) return Promise.resolve();
    busy?.progress(1);
    busy = null;
    const tl = setOpen(false);
    if (!tl) return Promise.resolve();
    if (instant) {
      tl.progress(1);
      return Promise.resolve();
    }
    return new Promise((resolve) => void tl.eventCallback('onComplete', () => {
      busy = null;
      resolve();
    }));
  }

  // A link in the open menu: close it first, THEN navigate - the page
  // transition (and the bar's move top <-> bottom) only starts once the
  // menu is shut. Both at once moved the still-open menu across the screen
  // (Leo, 2026-09-26). Modified clicks (new tab...) are left to the browser.
  panel?.querySelectorAll<HTMLAnchorElement>('a[data-menu-link]').forEach((link) => {
    link.addEventListener('click', (event) => {
      if (!open || event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      const href = link.getAttribute('href')!;
      void forceClose().then(() => navigate(href));
    });
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') forceClose();
  });
  document.addEventListener('pointerdown', (event) => {
    if (!open || !(event.target instanceof Node)) return;
    if (menu.contains(event.target) || panel?.contains(event.target)) return;
    forceClose();
  });

  // Contact button: the fill slides up in on hover and on out through the
  // top on leave, then waits below again. Each tween starts from wherever
  // the fill is, so hovering in and out quickly never jumps.
  const cta = panel?.querySelector<HTMLElement>('.panel-cta');
  const ctaFill = panel?.querySelector<HTMLElement>('.panel-cta-fill');
  if (cta && ctaFill) {
    // As yPercent (GSAP would read the CSS translate back as px).
    gsap.set(ctaFill, { yPercent: 100, y: 0 });
    const fillIn = () =>
      gsap.to(ctaFill, { yPercent: 0, duration: d(CTA_FILL), ease: EASE, overwrite: true });
    const fillOut = () =>
      gsap.to(ctaFill, {
        yPercent: -100,
        duration: d(CTA_FILL),
        ease: EASE,
        overwrite: true,
        onComplete: () => void gsap.set(ctaFill, { yPercent: 100 }),
      });
    cta.addEventListener('pointerenter', fillIn);
    cta.addEventListener('pointerleave', fillOut);
    cta.addEventListener('focus', fillIn);
    cta.addEventListener('blur', fillOut);
  }

  // The current page's link gets its marker (the small accent square on
  // its left, SiteMenuPanel.astro). A project page counts as Projets.
  function markCurrent(): void {
    const path = location.pathname.replace(/\/$/, '') || '/';
    panel?.querySelectorAll<HTMLAnchorElement>('.panel-nav .panel-item[href]').forEach((link) => {
      const href = link.getAttribute('href')!;
      const current = href === '/' ? path === '/' : path === href || path.startsWith(`${href}/`);
      if (current) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });
  }
  markCurrent();

  // Top-centre on the homepage, bottom-centre elsewhere. FLIP: the CSS
  // places it (so a resize needs nothing), GSAP only animates the offset
  // from where it was.
  function moveFor(pathname: string): void {
    const position = pathname === '/' ? 'top' : 'bottom';
    if (menu!.dataset.position === position) return;
    const before = menu!.getBoundingClientRect().top;
    menu!.dataset.position = position;
    if (panel) panel.dataset.position = position;
    const after = menu!.getBoundingClientRect().top;
    gsap.fromTo(menu, { y: before - after }, { y: 0, duration: d(MOVE), ease: EASE });
  }

  // Page name change: ONE roll - the old name leaves its mask upwards while
  // the new one rises in right under it (a copy of the name, dropped once
  // it's in). Out-then-in, one after the other, read as a double animation
  // (Leo, 2026-09-26). The same name asked for twice is ignored, and a new
  // change first finishes a roll still running.
  let pendingName = nameText.textContent ?? '';
  let rollTl: gsap.core.Timeline | null = null;
  function renameTo(next: string): void {
    if (next === pendingName) return;
    pendingName = next;
    rollTl?.progress(1);
    if (shape === 'hidden' || open) {
      nameText.textContent = next;
      return;
    }
    const incoming = name.cloneNode(true) as HTMLElement;
    incoming.querySelector('.site-menu-name-text')!.textContent = next;
    incoming.setAttribute('aria-hidden', 'true');
    name.after(incoming);
    gsap.set(incoming, { yPercent: 100, y: 0 });
    rollTl = gsap
      .timeline({
        onComplete: () => {
          nameText.textContent = next;
          gsap.set(name, { yPercent: 0 });
          incoming.remove();
          rollTl = null;
        },
      })
      .to(name, { yPercent: -100, duration: d(ROLL), ease: EASE }, 0)
      .to(incoming, { yPercent: 0, duration: d(ROLL), ease: EASE }, 0);
  }

  // Any other navigation with the menu open (browser back / forward...):
  // snap it shut, so it never travels across the screen open.
  document.addEventListener('astro:before-preparation', (event: any) => {
    void forceClose(true);
    moveFor(event.to.pathname);
  });

  document.addEventListener('astro:after-swap', () => {
    const next = document.getElementById('transition-root')?.dataset.pageName;
    if (next) renameTo(next);
    markCurrent();
    lastScrollY = window.scrollY;
    setScrollHidden(false);
  });

  // The clip-paths and offsets are in px: redo them for the new size once a
  // resize is over (mid-animation, the running tween finishes on the old
  // numbers first).
  let resizeTimer = 0;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      if (busy || shape === 'hidden') return;
      setShape(shape);
      if (scrollHidden) {
        clipState.bottom = menu.offsetHeight + PAST_EDGE;
        applyClip();
      }
    }, 150);
  });

  // Scroll: down hides the bar, up brings it back. Only the bar at rest -
  // not mid-entrance, not open (scrolling closes it instead).
  let scrollHidden = false;
  let scrollTween: gsap.core.Tween | null = null;
  function setScrollHidden(hide: boolean): void {
    if (hide === scrollHidden) return;
    if (hide && (busy || open || shape !== 'bar')) return;
    scrollHidden = hide;
    menu!.inert = hide;
    scrollTween?.kill();
    scrollTween = gsap.to(clipState, {
      bottom: hide ? menu!.offsetHeight + PAST_EDGE : 0,
      duration: d(hide ? SCROLL_HIDE : SCROLL_SHOW),
      ease: EASE,
      onUpdate: applyClip,
    });
  }

  let lastScrollY = window.scrollY;
  window.addEventListener(
    'scroll',
    () => {
      const y = window.scrollY;
      const delta = y - lastScrollY;
      lastScrollY = y;
      // Open: scrolling closes it - but only a gesture does (below), never
      // the scroll event itself. Lenis keeps the page gliding for a moment
      // after a flick: opening the menu during that glide, the leftover
      // scroll closed it again at once (Leo, 2026-09-26).
      if (open) return;
      if (Math.abs(delta) < SCROLL_MIN_DELTA) return;
      setScrollHidden(delta > 0 && y > SCROLL_TOP_ZONE);
    },
    { passive: true }
  );
  // Scrolling closes an open menu: a wheel / swipe / scroll key anywhere
  // but the panel (which scrolls itself on a short window). Gestures, not
  // scroll events - see above. Also covers the pages that don't scroll the
  // window (/projets vues 1-2 step, or scroll their own panels).
  const isInMenu = (target: EventTarget | null) =>
    target instanceof Node && (menu.contains(target) || !!panel?.contains(target));
  const closeOnGesture = (event: Event) => {
    if (open && !(event.target instanceof Node && panel?.contains(event.target))) forceClose();
  };
  window.addEventListener('wheel', closeOnGesture, { passive: true });
  window.addEventListener('touchmove', closeOnGesture, { passive: true });
  const SCROLL_KEYS = ['PageDown', 'PageUp', 'ArrowDown', 'ArrowUp', 'Home', 'End', ' '];
  window.addEventListener('keydown', (event) => {
    // Space / arrows on a focused menu button are that button's own keys.
    if (open && SCROLL_KEYS.includes(event.key) && !isInMenu(event.target)) forceClose();
  });

  afterSiteLoaderDone().then(enter);
}
