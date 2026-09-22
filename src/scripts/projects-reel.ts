import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { SplitText } from 'gsap/SplitText';

gsap.registerPlugin(ScrollTrigger, SplitText);

/**
 * A/B comparison flag from content.md §5. Flip this to compare the two
 * curtain-trigger behaviours for project-to-project transitions; only one
 * should ever be installed at a time. The initial hero->project0 reveal is
 * always a discrete, triggered animation (see settleCurtain below).
 */
export const MODE_RIDEAU: 'A' | 'B' = 'A';

const BAR_DURATION = 0.4;
const BAR_STAGGER = 0.04;
const VH_PER_INTERVAL = 1;
const CURSOR_LAG = 0.15;
const CURSOR_RADIUS = 18;
const PARALLAX_PERCENT = 12;

/**
 * Another A/B flag, same spirit as MODE_RIDEAU: how the hero recedes into
 * the dark before the text/grid/curtain sequence. 'fade' is a plain
 * cross-fade to the ink overlay. 'blur-dark' additionally blurs and darkens
 * the hero image as the fade progresses, reading as it losing focus/depth
 * rather than just dissolving flat. Deliberately no scale change: shrinking
 * the image (tried first) reveals the section's background at its edges
 * inside the fixed-size frame, which looks like a bug more than an effect.
 * Flip to compare; only one should be "live" at a time.
 */
const HERO_TRANSITION: 'fade' | 'blur-dark' = 'blur-dark';
const HERO_BLUR_PX = 16; // max blur at full fade, blur-dark only
const HERO_DARKEN = 0.6; // extra brightness reduction on top of the fade, blur-dark only

// The opening sequence (hero -> dark -> text -> grid lines -> curtain) gets
// its own share of the pinned scroll distance, expressed in viewport-heights
// alongside VH_PER_INTERVAL so both scale together at any viewport size.
const INTRO_VH = 3;

// Extra scroll distance held at the end, after the last project is fully
// shown, before the section unpins and normal scroll resumes - otherwise
// the pin releases the instant the last project appears, with no time to
// actually look at it.
const HOLD_VH = 1.2;

// Sub-phases within the intro, as fractions of the intro's own progress
// (0-1). Sequential, not overlapping - each finishes before the next starts.
const PHASE_HERO_END = 0.18;
const PHASE_TEXT_START = PHASE_HERO_END;
const PHASE_TEXT_END = 0.5;
const PHASE_TEXT_EXIT_START = 0.55;
const PHASE_TEXT_EXIT_END = 0.65;
const PHASE_GRID_START = 0.65;
const GRID_STAGGER_FRACTION = 0.2; // share of the grid phase spent staggering line starts
const TEXT_LINE_STAGGER_FRACTION = 0.35; // share of the text in/out phase spent staggering line starts

// Same easing language as the rest of the site's mask reveals: power3.out
// matches reveal-text.ts's EASE exactly (decelerate into place); power2.in
// mirrors project-morph.ts's CHROME_HIDE_EASE (accelerate away). Applied
// manually via parseEase since this section is scroll-scrubbed, not a
// one-shot tween - scrub still wants an eased curve, just sampled by hand.
const TEXT_REVEAL_EASE = gsap.parseEase('power3.out');
const TEXT_HIDE_EASE = gsap.parseEase('power2.in');

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

// Maps a sub-range of [0,1] to its own local 0-1 progress, clamped.
function localProgress(value: number, start: number, end: number): number {
  return clamp((value - start) / (end - start), 0, 1);
}

export function initProjectsReel(root: ParentNode = document): { destroy: () => void } | undefined {
  const section = root.querySelector<HTMLElement>('.projects-reel');
  if (!section) return undefined;

  const sticky = section.querySelector<HTMLElement>('.reel-sticky');
  const heroImage = section.querySelector<HTMLElement>('.reel-hero-image');
  const heroFade = section.querySelector<HTMLElement>('.reel-hero-fade');
  const scrollHint = section.querySelector<HTMLElement>('.reel-scroll-hint');
  const introText = section.querySelector<HTMLElement>('.reel-intro-body');
  // Split into lines, each wrapped in its own stationary overflow:clip mask
  // (SplitText's `mask` option) - the mask itself never moves, the line
  // slides vertically inside it (yPercent, see updateIntro). Same "mask
  // stays put, content moves" technique as hideInfoParts/hideChromeEl
  // elsewhere on the site (content.md §4's original spec), not reveal-
  // text.ts's clip-path sweep - that one's a different, later technique
  // (see its own "FIX" comment) and unrelated to this.
  let introLines: HTMLElement[] = [];
  if (introText) {
    SplitText.create(introText, {
      type: 'lines',
      linesClass: 'reel-intro-line',
      mask: 'lines',
      autoSplit: true,
      onSplit(self) {
        introLines = self.lines as HTMLElement[];
        introText.style.visibility = 'visible';
      },
    });
  }
  const projectEls = Array.from(section.querySelectorAll<HTMLElement>('.reel-project'));
  const gridLinesContainer = section.querySelector<HTMLElement>('.reel-grid-lines');
  const counterCurrent = section.querySelector<HTMLElement>('.reel-counter-current');
  const cursor = section.querySelector<HTMLElement>('.reel-cursor');
  const cursorProgressCircle = section.querySelector<SVGCircleElement>('.reel-cursor-progress');
  const counterEl = section.querySelector<HTMLElement>('.reel-counter');

  const n = projectEls.length;
  if (!sticky || n === 0) return undefined;

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function buildBars(projectEl: HTMLElement): HTMLElement[] {
    const container = projectEl.querySelector<HTMLElement>('.reel-bars');
    if (!container) return [];
    container.innerHTML = '';
    const cols = parseInt(getComputedStyle(projectEl).getPropertyValue('--cols'), 10) || 5;
    const bars: HTMLElement[] = [];
    for (let i = 0; i < cols; i++) {
      const bar = document.createElement('span');
      bar.className = 'reel-bar';
      // Curtain wipes horizontally per column (left edge), not vertically.
      bar.style.transformOrigin = 'left';
      container.appendChild(bar);
      bars.push(bar);
    }
    return bars;
  }

  let barsByProject = projectEls.map(buildBars);

  function buildGridlines(): HTMLElement[] {
    if (!gridLinesContainer) return [];
    gridLinesContainer.innerHTML = '';
    const cols = parseInt(getComputedStyle(sticky!).getPropertyValue('--cols'), 10) || 5;
    const lines: HTMLElement[] = [];
    for (let i = 0; i < cols; i++) {
      const line = document.createElement('span');
      line.className = 'reel-gridline';
      gridLinesContainer.appendChild(line);
      lines.push(line);
    }
    return lines;
  }

  let gridlines = buildGridlines();

  function showProject(index: number): void {
    projectEls.forEach((el, i) => {
      gsap.set(el, { autoAlpha: i === index ? 1 : 0, zIndex: i === index ? 2 : 1 });
      const info = el.querySelector<HTMLElement>('.reel-info');
      if (info) gsap.set(info, { autoAlpha: i === index ? 1 : 0 });
    });
    if (counterCurrent) counterCurrent.textContent = String(index + 1);
  }

  if (reducedMotion) {
    gsap.set(gridlines, { scaleY: 1, opacity: 1 });
    gsap.set(barsByProject.flat(), { scaleX: 0 });
    if (heroFade) gsap.set(heroFade, { opacity: 1 });
    if (scrollHint) gsap.set(scrollHint, { opacity: 0 });
    if (introLines.length > 0) gsap.set(introLines, { yPercent: 0 });
    showProject(0);
    return undefined;
  }

  // The whole project-0 panel (image + bars) stays invisible during the
  // intro: it sits above the hero in stacking order, and its bars are an
  // opaque, permanently-closed layer, so merely closing them over the image
  // is not enough to let the hero show through underneath - the panel
  // itself must not render at all until the curtain actually opens.
  gsap.set(projectEls, { autoAlpha: 0 });
  gsap.set(barsByProject[0], { scaleX: 1 });
  gsap.set(gridlines, { scaleY: 0 });
  if (counterCurrent) counterCurrent.textContent = '1';
  if (counterEl) gsap.set(counterEl, { autoAlpha: 0 });

  function buildTransition(fromIndex: number, toIndex: number): gsap.core.Timeline {
    const fromBars = barsByProject[fromIndex];
    const toBars = barsByProject[toIndex];
    let tl!: gsap.core.Timeline;
    tl = gsap.timeline({
      paused: true,
      onUpdate: () => showProject(tl.progress() < 0.5 ? fromIndex : toIndex),
    })
      .set(toBars, { scaleX: 1 })
      .to(fromBars, { scaleX: 1, duration: BAR_DURATION, stagger: BAR_STAGGER, ease: 'power3.inOut' })
      .to(toBars, { scaleX: 0, duration: BAR_DURATION, stagger: BAR_STAGGER, ease: 'power3.inOut' });
    return tl;
  }

  let transitions = Array.from({ length: n - 1 }, (_, i) => buildTransition(i, i + 1));

  const curtainOpenTl = gsap.timeline({ paused: true }).to(barsByProject[0], {
    scaleX: 0,
    duration: BAR_DURATION,
    stagger: BAR_STAGGER,
    ease: 'power3.inOut',
  });

  let resizeTimer: number;
  const handleResize = () => {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      const openIndex = curtainTarget === 'open' ? displayedIndex : -1;
      barsByProject = projectEls.map(buildBars);
      if (openIndex >= 0) gsap.set(barsByProject[openIndex], { scaleX: 0 });
      transitions = Array.from({ length: n - 1 }, (_, i) => buildTransition(i, i + 1));

      // Grid lines are only ever fully grown once the curtain has opened
      // (they finish exactly as the intro ends) - same signal as openIndex
      // above, reused here so a resize mid-reel doesn't reset them to 0.
      gridlines = buildGridlines();
      gsap.set(gridlines, { scaleY: curtainTarget === 'open' ? 1 : 0 });
    }, 200);
  };
  window.addEventListener('resize', handleResize);

  let displayedIndex = 0;
  let transitioning = false;
  // Tracks the ad-hoc close/open tweens settleModeA creates, so a fast
  // reverse crossing back below introFraction (handled a bit further down)
  // can kill whichever one is in flight - otherwise its onComplete still
  // fires after that reset and calls showProject again, resurrecting a
  // project the reset just hid.
  let modeATweens: gsap.core.Tween[] = [];
  let curtainTarget: 'open' | 'closed' = 'closed';
  let pinTrigger: ScrollTrigger | undefined;

  function setRingProgress(p: number): void {
    if (!cursorProgressCircle) return;
    const circumference = 2 * Math.PI * CURSOR_RADIUS;
    cursorProgressCircle.style.strokeDashoffset = String(circumference * (1 - clamp(p, 0, 1)));
  }

  function setChromeVisible(visible: boolean): void {
    const info = projectEls[displayedIndex]?.querySelector<HTMLElement>('.reel-info');
    if (info) gsap.to(info, { autoAlpha: visible ? 1 : 0, duration: 0.3 });
    if (counterEl) gsap.to(counterEl, { autoAlpha: visible ? 1 : 0, duration: 0.3 });
  }

  // Uses .play()/.reverse() (resume from wherever the timeline currently
  // sits) rather than .play(0), and no "is it already animating" guard: if
  // the scroll direction reverses mid-flight, GSAP just smoothly redirects
  // the same tween instead of the request being dropped. An earlier version
  // guarded with a boolean flag that ignored a close request arriving while
  // the open animation was still playing - the flag then never got reset by
  // that open animation's own completion once the desired state had already
  // moved on, leaving the curtain stuck "open" (and the hero gone for good)
  // after a quick down-then-up scroll.
  function settleCurtain(introComplete: boolean): void {
    const desired: 'open' | 'closed' = introComplete ? 'open' : 'closed';
    if (desired === curtainTarget) return;
    curtainTarget = desired;

    if (desired === 'open') {
      gsap.set(projectEls[0], { autoAlpha: 1, zIndex: 2 });
      curtainOpenTl
        .eventCallback('onComplete', () => {
          setChromeVisible(true);
          // A big instant jump (rather than a gradual scroll) can land past
          // introFraction on the very first update, before this animation
          // has had a chance to play - catch up to wherever the scroll
          // position actually is now that the bars are free again.
          if (MODE_RIDEAU === 'A') settleModeA();
        })
        .play();
    } else {
      setChromeVisible(false);
      curtainOpenTl
        .eventCallback('onReverseComplete', () => {
          // Back to pure hero: hide the panel again rather than leaving it
          // sitting there closed (it would otherwise still block the hero,
          // since it's stacked above it regardless of its own bars' state).
          gsap.set(projectEls[0], { autoAlpha: 0 });
        })
        .reverse();
    }
  }

  // Closes the current project's bars, then - only once that's actually
  // finished - checks the scroll position again and opens directly onto
  // whatever project is current *now*, not necessarily the adjacent one.
  // A fast scroll covering several projects during the close plays as a
  // single close+open, landing straight on the right one, rather than
  // queuing a full close+open for every project in between (previously)
  // or skipping the closed ones with no animation at all (tried next,
  // looked like a glitchy instant swap). If the scroll keeps moving during
  // the open phase too, another full cycle follows once it settles.
  function settleModeA(): void {
    if (transitioning || !pinTrigger) return;
    const { targetIndex } = readProgress(remainingProgress(pinTrigger.progress));
    if (targetIndex === displayedIndex) return;

    transitioning = true;
    const fromBars = barsByProject[displayedIndex];

    const closeTween = gsap.to(fromBars, {
      scaleX: 1,
      duration: BAR_DURATION,
      stagger: BAR_STAGGER,
      ease: 'power3.inOut',
      onComplete: () => {
        const { targetIndex: toIndex } = readProgress(remainingProgress(pinTrigger!.progress));
        showProject(toIndex);
        const toBars = barsByProject[toIndex];
        gsap.set(toBars, { scaleX: 1 });
        const openTween = gsap.to(toBars, {
          scaleX: 0,
          duration: BAR_DURATION,
          stagger: BAR_STAGGER,
          ease: 'power3.inOut',
          onComplete: () => {
            displayedIndex = toIndex;
            transitioning = false;
            modeATweens = [];
            settleModeA();
          },
        });
        modeATweens.push(openTween);
      },
    });
    modeATweens.push(closeTween);
  }

  function readProgress(rawProgress: number) {
    const floatIndex = clamp(rawProgress * (n - 1), 0, n - 1);
    const targetIndex = Math.min(n - 1, Math.floor(floatIndex));
    const intervalProgress = targetIndex >= n - 1 ? 1 : floatIndex - targetIndex;
    return { floatIndex, targetIndex, intervalProgress };
  }

  const contentVH = INTRO_VH + (n - 1) * VH_PER_INTERVAL;
  const totalVH = contentVH + HOLD_VH;
  const introFraction = INTRO_VH / totalVH;
  const contentFraction = contentVH / totalVH;

  // Progress across the (n-1) project-to-project intervals, 0 at "project 0
  // just revealed" to 1 at "last project fully shown" - reached before the
  // pin's own end, so the remaining scroll (the HOLD_VH share) just holds
  // there instead of immediately releasing the pin.
  function remainingProgress(rawProgress: number): number {
    return clamp((rawProgress - introFraction) / (contentFraction - introFraction), 0, 1);
  }

  function updateIntro(introProgress: number): void {
    const heroP = localProgress(introProgress, 0, PHASE_HERO_END);
    if (heroImage) {
      const yPercent = -PARALLAX_PERCENT / 2 + PARALLAX_PERCENT * heroP;
      if (HERO_TRANSITION === 'blur-dark') {
        gsap.set(heroImage, {
          yPercent,
          filter: `blur(${HERO_BLUR_PX * heroP}px) brightness(${1 - HERO_DARKEN * heroP})`,
        });
      } else {
        gsap.set(heroImage, { yPercent });
      }
    }
    if (heroFade) gsap.set(heroFade, { opacity: heroP });
    if (scrollHint) gsap.set(scrollHint, { opacity: 1 - heroP });

    const textInP = localProgress(introProgress, PHASE_TEXT_START, PHASE_TEXT_END);
    const textOutP = localProgress(introProgress, PHASE_TEXT_EXIT_START, PHASE_TEXT_EXIT_END);
    // The mask (each line's auto-generated overflow:clip wrapper, see the
    // SplitText call above) never moves - the line itself translates inside
    // it, rising up from fully below (yPercent 100, out of the mask's view)
    // to rest (yPercent 0). While translated out, it's also not hit-testable
    // - a child positioned outside a clipping ancestor's visible region
    // isn't hit-tested there, same as hideInfoParts elsewhere on the site.
    // Each line gets its own local progress within textInP/textOutP (same
    // double-localization as the gridlines' stagger below), so lines rise
    // independently with a slight delay between them instead of the whole
    // paragraph moving as one block.
    if (introLines.length > 0) {
      const lineWindow = 1 - TEXT_LINE_STAGGER_FRACTION;
      introLines.forEach((line, i) => {
        const lineStart =
          introLines.length > 1 ? (i / (introLines.length - 1)) * TEXT_LINE_STAGGER_FRACTION : 0;
        const lineInP = TEXT_REVEAL_EASE(localProgress(textInP, lineStart, lineStart + lineWindow));
        const lineOutP = TEXT_HIDE_EASE(localProgress(textOutP, lineStart, lineStart + lineWindow));
        const lineReveal = clamp(lineInP - lineOutP, 0, 1);
        gsap.set(line, { yPercent: (1 - lineReveal) * 100 });
      });
    }

    const gridP = localProgress(introProgress, PHASE_GRID_START, 1);
    const lineWindow = 1 - GRID_STAGGER_FRACTION;
    gridlines.forEach((line, i) => {
      const lineStart = gridlines.length > 1 ? (i / (gridlines.length - 1)) * GRID_STAGGER_FRACTION : 0;
      const lineProgress = localProgress(gridP, lineStart, lineStart + lineWindow);
      gsap.set(line, { scaleY: lineProgress });
    });
  }

  pinTrigger = ScrollTrigger.create({
    trigger: section,
    start: 'top top',
    end: () => `+=${Math.round(window.innerHeight * totalVH)}`,
    pin: sticky,
    pinSpacing: true,
    onUpdate(self) {
      cursor?.classList.toggle('is-active', self.isActive && self.progress >= introFraction);

      if (self.progress < introFraction) {
        updateIntro(self.progress / introFraction);

        // A very fast scroll can cross back below introFraction in a single
        // tick, skipping the step-by-step chain (settleModeA calling itself
        // on each transition's completion) that would normally walk
        // displayedIndex back down to 0 first. settleCurtain only ever
        // touches project 0 specifically, so without this, whichever
        // project was last on screen (or mid-transition) is never told to
        // hide and stays stuck on top of everything. Hard-reset instead of
        // trying to reconstruct the skipped steps.
        if (displayedIndex !== 0 || transitioning) {
          transitions.forEach((tl) => tl.kill());
          transitions = Array.from({ length: n - 1 }, (_, i) => buildTransition(i, i + 1));
          modeATweens.forEach((t) => t.kill());
          modeATweens = [];
          curtainOpenTl.pause(0);
          curtainTarget = 'closed';
          gsap.set(projectEls, { autoAlpha: 0 });
          barsByProject.forEach((bars) => gsap.set(bars, { scaleX: 1 }));
          if (counterEl) gsap.set(counterEl, { autoAlpha: 0 });
          projectEls.forEach((el) => {
            const info = el.querySelector<HTMLElement>('.reel-info');
            if (info) gsap.set(info, { autoAlpha: 0 });
          });
          displayedIndex = 0;
          transitioning = false;
        }

        settleCurtain(false);
        setRingProgress(0);
        return;
      }

      // Past the threshold: force the intro to its exact settled end state,
      // in case it was crossed in a single jump rather than scrolled through.
      updateIntro(1);
      settleCurtain(true);

      // Don't fight the curtain-open animation for control of project 0's
      // bars: on a big instant jump (rather than a gradual scroll), this can
      // otherwise run in the same tick as settleCurtain just kicking that
      // animation off. It catches up on its own via settleCurtain's own
      // onComplete once the bars are free again.
      if (curtainOpenTl.progress() < 1) {
        setRingProgress(0);
        return;
      }

      const { floatIndex, intervalProgress } = readProgress(remainingProgress(self.progress));
      setRingProgress(intervalProgress);

      if (MODE_RIDEAU === 'B') {
        transitions.forEach((tl, i) => tl.progress(clamp(floatIndex - i, 0, 1)));
      } else {
        settleModeA();
      }
    },
    onLeave: () => cursor?.classList.remove('is-active'),
    onLeaveBack: () => cursor?.classList.remove('is-active'),
  });

  // Pointer-following progress indicator, with a slight lag; fixed placement
  // when there is no fine pointer (touch/mobile).
  const hasFinePointer = window.matchMedia('(pointer: fine)').matches;

  let handleMouseMove: ((event: MouseEvent) => void) | undefined;
  let updateCursor: (() => void) | undefined;

  if (cursor && hasFinePointer) {
    let mouseX = 0;
    let mouseY = 0;
    let curX = 0;
    let curY = 0;

    handleMouseMove = (event: MouseEvent) => {
      mouseX = event.clientX;
      mouseY = event.clientY;
    };
    window.addEventListener('mousemove', handleMouseMove);

    updateCursor = () => {
      curX += (mouseX - curX) * CURSOR_LAG;
      curY += (mouseY - curY) * CURSOR_LAG;
      cursor.style.transform = `translate(${curX}px, ${curY}px)`;
    };
    gsap.ticker.add(updateCursor);
  } else if (cursor) {
    cursor.classList.add('is-fixed-position');
  }

  return {
    destroy: () => {
      window.removeEventListener('resize', handleResize);
      if (handleMouseMove) window.removeEventListener('mousemove', handleMouseMove);
      if (updateCursor) gsap.ticker.remove(updateCursor);
      pinTrigger?.kill();
      transitions.forEach((tl) => tl.kill());
      curtainOpenTl.kill();
      modeATweens.forEach((t) => t.kill());
    },
  };
}
