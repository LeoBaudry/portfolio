// Site-entry loader, first half - inlined into the HTML right after
// #site-loader (see Layout.astro), so it runs while the page is still being
// parsed, long before the main JS bundle has downloaded. Plain JS, no
// imports: anything it waited on would be exactly the delay it exists to
// cover.
//
// While loading: a line along the bottom edge and the count follow the real
// progress, and the homepage's grid lines draw up from the bottom. At 100
// the background turns brand orange from the bottom up (behind everything),
// the logo and count leave, and the panel exits column by column along the
// same grid, each column clearing bottom to top, left to right.
//
// It resolves window.__siteLoader.reveal as the columns start clearing (the
// bundled half, site-loader.ts, inits the page then), .uncovered once most
// of the page shows (pages start their entrance animations then - see
// afterSiteLoader) and .done once the columns are gone (the panel is hidden
// and scrolling unlocked).
//
// Durations mirror the CSS entrance (.site-loader-stroke in global.css) -
// keep both in sync.
(() => {
  const loader = document.getElementById('site-loader');
  // Astro re-runs body scripts it hasn't seen on client-side navigation;
  // this must only ever run on a hard load.
  if (!loader || loader.hidden || window.__siteLoader) return;

  let resolveReveal;
  let resolveUncovered;
  let resolveDone;
  window.__siteLoader = {
    reveal: new Promise((resolve) => (resolveReveal = resolve)),
    uncovered: new Promise((resolve) => (resolveUncovered = resolve)),
    done: new Promise((resolve) => (resolveDone = resolve)),
  };
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
    resolveReveal();
    resolveUncovered();
    resolveDone();
    return;
  }

  const STROKE_IN = 1000; // ms, = .site-loader-stroke animation-duration
  const STROKE_STAGGER = 180; // ms, = its per-stroke animation-delay
  const COUNT_EASE = 0.12; // share of the gap to real progress closed per 60Hz frame
  const DIGIT_MIN_INTERVAL = 55; // ms - at most one digit change per this
  const DIGIT = 400;
  const DIGIT_STAGGER = 30;
  const GRID_STAGGER = 0.08; // each grid line starts this much progress later...
  const GRID_SPAN = 0.68; // ...and takes this much of it to reach full height
  const GRID_CREEP = 0.05; // progress/s the grid keeps drifting while loading stalls...
  const GRID_LEAD = 0.15; // ...but never more than this ahead of the real progress
  const ORANGE = 700; // ms for the background to turn orange, bottom up
  const LOGO_OUT_AT = 0.6; // share of ORANGE after which the logo/count leave
  const LOGO_OUT = 800;
  const LOGO_OUT_STAGGER = 100;
  const COLUMN_OUT = 700;
  const COLUMN_STAGGER = 70;
  const UNCOVERED_AT = 0.6; // share of the column exit after which pages start their entrance
  // ms - give up waiting on assets after this. Only a guard against an asset
  // that never settles (a failed one already counts as done): anything
  // shorter cuts off a merely slow load, and the columns then clear onto a
  // page whose on-screen images haven't arrived yet.
  const MAX_WAIT = 20000;
  const EXPO_OUT = 'cubic-bezier(0.16, 1, 0.3, 1)';
  const EXPO_IN = 'cubic-bezier(0.7, 0, 0.84, 0)';
  const WIPE = 'cubic-bezier(0.76, 0, 0.24, 1)'; // = #page-wipe's ease

  const start = performance.now();
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const clamp01 = (n) => Math.min(1, Math.max(0, n));

  // --- Real progress -------------------------------------------------------
  // Two phases, weighted by where the time actually goes on a slow link:
  //  1. the page's JS - every module script/preload the <head> lists, each
  //     ticked off as its download completes (Resource Timing). All of them
  //     have run by DOMContentLoaded, which closes this phase regardless.
  //  2. the page itself - fonts + every image actually on screen, known only
  //     once the body is parsed. Offscreen images are deliberately left out:
  //     window 'load' would wait on all of them.
  const SCRIPTS_WEIGHT = 0.55;
  const scriptUrls = new Set(
    Array.from(document.querySelectorAll('script[type="module"][src], link[rel="modulepreload"]'), (el) =>
      new URL(el.getAttribute('src') || el.getAttribute('href'), location.href).href
    )
  );
  const scriptTotal = scriptUrls.size;
  try {
    new PerformanceObserver((list) => list.getEntries().forEach((entry) => scriptUrls.delete(entry.name))).observe({
      type: 'resource',
      buffered: true,
    });
  } catch {
    /* no Resource Timing: phase 1 just completes at DOMContentLoaded */
  }

  let parsed = false;
  let pageDone = 0;
  let pageTotal = 0;
  const onParsed = () => {
    parsed = true;
    const vw = innerWidth;
    const vh = innerHeight;
    const images = Array.from(document.querySelectorAll('#transition-root img')).filter((img) => {
      if (img.complete) return false;
      const r = img.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 && r.top < vh && r.left < vw;
    });
    const tasks = [
      document.fonts.ready,
      ...images.map(
        (img) =>
          new Promise((resolve) => {
            img.addEventListener('load', resolve, { once: true });
            img.addEventListener('error', resolve, { once: true });
          })
      ),
    ];
    pageTotal = tasks.length;
    tasks.forEach((task) => task.then(() => pageDone++));
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', onParsed, { once: true });
  else onParsed();

  // Dev-only preview (data-sim is only rendered by the dev server):
  // `?loader-sim=6` fakes a 6s load arriving in 8 chunks.
  const sim = loader.hasAttribute('data-sim') ? Number(new URLSearchParams(location.search).get('loader-sim')) : 0;

  function realProgress(now) {
    if (sim > 0) return Math.min(1, Math.floor(((now - start) / 1000 / sim) * 8) / 8);
    if (now - start > MAX_WAIT) return 1;
    const scripts = parsed ? 1 : scriptTotal ? (scriptTotal - scriptUrls.size) / scriptTotal : 0;
    const page = parsed ? (pageTotal ? pageDone / pageTotal : 1) : 0;
    return SCRIPTS_WEIGHT * scripts + (1 - SCRIPTS_WEIGHT) * page;
  }

  // --- Elements ------------------------------------------------------------
  const strokes = Array.from(loader.querySelectorAll('.site-loader-stroke'), (g) => {
    const [outX, outY] = g.dataset.out.split(' ').map(Number);
    return { g, outX, outY };
  });
  const bar = loader.querySelector('.site-loader-bar');
  const slots = Array.from(loader.querySelectorAll('.site-loader-digit'));
  // Only the columns/lines CSS shows at this breakpoint (5 / 3 / 2).
  const isShown = (el) => getComputedStyle(el).display !== 'none';
  const columns = Array.from(loader.querySelectorAll('.site-loader-col')).filter(isShown);
  const gridlines = Array.from(loader.querySelectorAll('.site-loader-gridline')).filter(isShown);

  // --- Count ---------------------------------------------------------------
  // Three digit slots, each its own mask: a changed digit leaves up through
  // the top while its replacement rises in from below. Leading zeros dimmed.
  function setDigits(value) {
    const text = String(value).padStart(3, '0');
    const first = text.search(/[1-9]/);
    let changed = 0;
    slots.forEach((slot, i) => {
      slot.classList.toggle('is-leading', first === -1 || i < first);
      const current = slot.lastElementChild;
      if (!current || current.textContent === text[i]) return;

      const next = document.createElement('span');
      next.textContent = text[i];
      slot.append(next);

      // Leave from wherever it is now - it may still be mid-entrance.
      const from = getComputedStyle(current).transform;
      current.getAnimations().forEach((anim) => anim.cancel());
      const delay = changed++ * DIGIT_STAGGER;
      current
        .animate([{ transform: from === 'none' ? 'translateY(0)' : from }, { transform: 'translateY(-100%)' }], {
          duration: DIGIT,
          delay,
          easing: EXPO_OUT,
          fill: 'forwards',
        })
        .finished.then(() => current.remove(), () => {});
      next.animate([{ transform: 'translateY(100%)' }, { transform: 'translateY(0)' }], {
        duration: DIGIT,
        delay,
        easing: EXPO_OUT,
        fill: 'backwards',
      });
    });
  }

  // --- Frame loop ----------------------------------------------------------
  // The count chases real progress a fixed share per frame (scaled by frame
  // time, so 60Hz and 120Hz run the same); the bottom line follows it.
  // The grid has its own value: it chases real progress the same way but
  // also keeps creeping forward while loading stalls (e.g. between the two
  // phases), capped at GRID_LEAD ahead so it never runs off on its own.
  let value = 1;
  let count = 1;
  let grid = 0;
  let lastChange = 0;
  let last = start;
  let exiting = false;

  function frame(now) {
    const dt = Math.min(100, now - last);
    last = now;
    const frameEase = 1 - Math.pow(1 - COUNT_EASE, dt / (1000 / 60));
    const real = realProgress(now);

    const target = 1 + 99 * real;
    value += (target - value) * frameEase;
    if (target >= 100 && 100 - value < 0.5) value = 100;
    if (bar) bar.style.transform = `scaleX(${(value - 1) / 99})`;

    const lead = real >= 1 ? 1 : Math.min(0.98, real + GRID_LEAD);
    grid = Math.min(lead, Math.max(grid + (real - grid) * frameEase, grid + (GRID_CREEP * dt) / 1000));
    if (real >= 1 && 1 - grid < 0.002) grid = 1;
    gridlines.forEach((line, i) => {
      line.style.transform = `scaleY(${clamp01((grid - i * GRID_STAGGER) / GRID_SPAN)})`;
    });

    const next = Math.floor(value);
    if (next !== count && (next === 100 || now - lastChange >= DIGIT_MIN_INTERVAL)) {
      count = next;
      lastChange = now;
      setDigits(count);
    }

    if (count === 100 && !exiting) {
      exiting = true;
      exit();
    }
    if (count < 100 || grid < 1) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // --- Exit ----------------------------------------------------------------
  // Waits for the strokes' entrance to finish (the loader's only floor), then:
  //  1. each column's orange fill rises from the bottom - the background
  //     turns orange, under the grid lines, logo and count;
  //  2. the digits leave up through their masks and each stroke carries on
  //     along its own axis out of its mask;
  //  3. the columns clear one by one, left to right, each bottom to top,
  //     taking their grid line with them. The bottom line is hidden first -
  //     it's orange on orange by then, so that's invisible.
  async function exit() {
    const entranceEnd = start + STROKE_IN + STROKE_STAGGER * (strokes.length - 1);
    await wait(Math.max(0, entranceEnd - performance.now()) + DIGIT);

    columns.forEach((col) => {
      col.firstElementChild?.animate([{ transform: 'scaleY(0)' }, { transform: 'scaleY(1)' }], {
        duration: ORANGE,
        easing: WIPE,
        fill: 'forwards',
      });
    });
    await wait(ORANGE * LOGO_OUT_AT);

    const up = [{ transform: 'translateY(0)' }, { transform: 'translateY(-100%)' }];
    slots.forEach((slot, i) => {
      slot.lastElementChild?.animate(up, {
        duration: LOGO_OUT,
        delay: i * LOGO_OUT_STAGGER * 0.5,
        easing: EXPO_IN,
        fill: 'forwards',
      });
    });
    strokes.forEach((st, i) => {
      st.g.animate([{ transform: 'translate(0px, 0px)' }, { transform: `translate(${st.outX}px, ${st.outY}px)` }], {
        duration: LOGO_OUT,
        delay: i * LOGO_OUT_STAGGER,
        easing: EXPO_IN,
        fill: 'forwards',
      });
    });
    await wait(Math.max(ORANGE * (1 - LOGO_OUT_AT), LOGO_OUT + LOGO_OUT_STAGGER * (strokes.length - 1)));

    if (bar) bar.style.visibility = 'hidden';
    resolveReveal();
    const clear = [{ transform: 'scaleY(1)' }, { transform: 'scaleY(0)' }];
    const timing = (i) => ({ duration: COLUMN_OUT, delay: i * COLUMN_STAGGER, easing: WIPE, fill: 'forwards' });
    columns.forEach((col, i) => col.animate(clear, timing(i)));
    gridlines.forEach((line, i) => {
      line.style.transformOrigin = 'top';
      line.animate(clear, timing(i));
    });

    const columnsOut = COLUMN_OUT + COLUMN_STAGGER * Math.max(0, columns.length - 1);
    await wait(columnsOut * UNCOVERED_AT);
    resolveUncovered();
    await wait(columnsOut * (1 - UNCOVERED_AT));
    resolveDone();
  }
})();
