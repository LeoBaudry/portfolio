import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { SplitText } from 'gsap/SplitText';
import { CustomEase } from 'gsap/CustomEase';
import { lenis } from './smooth-scroll';
import { refreshMainVideos } from './main-video';
import { registerMorphLeaveHook } from './project-morph';
import { saveProjetsState } from './projets/state';
import {
  INFO_HIDE_DURATION,
  INFO_HIDE_EASE,
  INFO_PART_STAGGER,
  INFO_REVEAL_DURATION,
  INFO_REVEAL_EASE,
} from './projets/timing';

gsap.registerPlugin(ScrollTrigger, SplitText, CustomEase);

const BAR_DURATION = 0.4;
const BAR_STAGGER = 0.04;
// Project text (category / title / year) and the counter: each line sinks
// under its own mask and rises out of it in quick succession, left to
// right - the same timing and curves as the /projets info text
// (projets/timing.ts), so both read as one motion language.
const INFO_LINE_HIDDEN = 110; // yPercent - fully below its mask
const INFO_OUT_DURATION = INFO_HIDE_DURATION / 1000;
const INFO_IN_DURATION = INFO_REVEAL_DURATION / 1000;
const INFO_STAGGER = INFO_PART_STAGGER / 1000;
// The CSS cubic-bezier() strings as GSAP eases.
const bezier = (css: string) => css.replace(/^cubic-bezier\(|\)$/g, '');
const INFO_OUT_EASE = CustomEase.create('reelInfoOut', bezier(INFO_HIDE_EASE));
const INFO_IN_EASE = CustomEase.create('reelInfoIn', bezier(INFO_REVEAL_EASE));
const VH_PER_INTERVAL = 1;
const CURSOR_LAG = 0.15;
const PARALLAX_PERCENT = 12;

/**
 * A/B comparison flag (content.md §5): how the hero recedes into
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
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let introLines: HTMLElement[] = [];
  // Last intro progress applied (updateIntro). autoSplit re-splits on every
  // width change, and the fresh lines come in unmasked (yPercent 0) - left
  // alone they sat in the middle of the screen until the next scroll
  // update. Each split puts them straight back where the scroll says.
  let introProgressNow = 0;
  if (introText) {
    SplitText.create(introText, {
      type: 'lines',
      linesClass: 'reel-intro-line',
      mask: 'lines',
      autoSplit: true,
      onSplit(self) {
        introLines = self.lines as HTMLElement[];
        if (!reducedMotion) placeIntroLines(introProgressNow);
        introText.style.visibility = 'visible';
      },
    });
  }
  const projectEls = Array.from(section.querySelectorAll<HTMLElement>('.reel-project'));
  // Projects are shown/hidden with autoAlpha (visibility), from several
  // places incl. timelines - invisible to main-video.ts's
  // IntersectionObserver. Any style change on a project re-checks which
  // main-visual videos should play (GSAP only touches these on show/hide;
  // the scrubbed bars are separate elements).
  const videoVisibilityWatch = new MutationObserver(() => refreshMainVideos());
  projectEls.forEach((el) => videoVisibilityWatch.observe(el, { attributes: true, attributeFilter: ['style'] }));
  const gridLinesContainer = section.querySelector<HTMLElement>('.reel-grid-lines');
  const counterCurrent = section.querySelector<HTMLElement>('.reel-counter-current');
  const cursor = section.querySelector<HTMLElement>('.reel-cursor');
  const cursorPill = cursor?.querySelector<HTMLElement>('.reel-cursor-pill') ?? null;
  const cursorFill = cursor?.querySelector<HTMLElement>('.reel-cursor-fill') ?? null;
  const cursorTexts = Array.from(cursor?.querySelectorAll<HTMLElement>('.reel-cursor-text') ?? []);
  const counterEl = section.querySelector<HTMLElement>('.reel-counter');

  const n = projectEls.length;
  if (!sticky || n === 0) return undefined;

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
  // Every project's text starts under its mask: it only ever arrives
  // through revealInfoLines (curtain open / next project). Left in place,
  // the first project's text showed instantly as the curtain opened, then
  // dropped and rose again when the reveal started.
  gsap.set(section.querySelectorAll('.reel-line'), { yPercent: INFO_LINE_HIDDEN });
  gsap.set(barsByProject[0], { scaleX: 1 });
  gsap.set(gridlines, { scaleY: 0 });
  // Same hidden states the CSS starts them in, now owned by GSAP (y: 0 -
  // otherwise the CSS translateY(110%) is read in as px and stays on top).
  gsap.set(cursorTexts, { y: 0, yPercent: INFO_LINE_HIDDEN });
  if (cursorPill) gsap.set(cursorPill, { scale: 0 });
  if (counterCurrent) counterCurrent.textContent = '1';
  if (counterEl) gsap.set(counterEl, { autoAlpha: 0 });

  function buildCurtainOpen(): gsap.core.Timeline {
    return gsap.timeline({ paused: true }).to(barsByProject[0], {
      scaleX: 0,
      duration: BAR_DURATION,
      stagger: BAR_STAGGER,
      ease: 'power3.inOut',
    });
  }

  let curtainOpenTl = buildCurtainOpen();

  // Bars and grid lines are flex children - they follow the new size on
  // their own. Only a column-count change (--cols breakpoints) rebuilds
  // them. The curtain timeline is rebuilt with them: it holds project 0's
  // bars, and one left on the old (removed) bars animated nothing, so
  // project 0 lost its entry/leave curtain after a resize.
  let builtCols = barsByProject[0].length;
  let resizeTimer: number;
  const handleResize = () => {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      const cols = parseInt(getComputedStyle(sticky!).getPropertyValue('--cols'), 10) || 5;
      if (cols === builtCols) return;
      builtCols = cols;

      const openIndex = curtainTarget === 'open' ? displayedIndex : -1;
      barsByProject = projectEls.map(buildBars);
      if (openIndex >= 0) gsap.set(barsByProject[openIndex], { scaleX: 0 });

      // Same progress, direction and callbacks as the one it replaces, so a
      // curtain caught mid-open/close finishes on the new bars.
      const old = curtainOpenTl;
      curtainOpenTl = buildCurtainOpen();
      curtainOpenTl.progress(old.progress());
      curtainOpenTl.eventCallback('onComplete', old.eventCallback('onComplete'));
      curtainOpenTl.eventCallback('onReverseComplete', old.eventCallback('onReverseComplete'));
      if (old.isActive()) {
        if (old.reversed()) curtainOpenTl.reverse();
        else curtainOpenTl.play();
      }
      old.kill();

      // Grid lines are only ever fully grown once the curtain has opened
      // (they finish exactly as the intro ends); during the intro they
      // follow the scroll, so re-apply it.
      gridlines = buildGridlines();
      if (curtainTarget === 'open') gsap.set(gridlines, { scaleY: 1 });
      else if (pinTrigger && pinTrigger.progress < introFraction) updateIntro(pinTrigger.progress / introFraction);
      else gsap.set(gridlines, { scaleY: 0 });
    }, 200);
  };
  window.addEventListener('resize', handleResize);

  let displayedIndex = 0;
  let transitioning = false;
  // Tracks the ad-hoc close/open tweens settleProject creates, so a fast
  // reverse crossing back below introFraction (handled a bit further down)
  // can kill whichever one is in flight - otherwise its onComplete still
  // fires after that reset and calls showProject again, resurrecting a
  // project the reset just hid.
  let projectTweens: gsap.core.Tween[] = [];
  let curtainTarget: 'open' | 'closed' = 'closed';
  let pinTrigger: ScrollTrigger | undefined;
  let indicatorShown = false;
  // A project was clicked: the indicator is unwinding, scroll updates keep
  // their hands off it.
  let leaving = false;

  // Progress to the next project, shown as the pill's fill.
  let fillP = 0;
  function setCursorFill(p: number): void {
    fillP = clamp(p, 0, 1);
    if (cursorFill) cursorFill.style.clipPath = `inset(0 ${(1 - fillP) * 100}% 0 0)`;
  }

  function setProgress(p: number): void {
    if (!leaving) setCursorFill(p);
  }

  // In: the pill grows (from the pointer, or up from the bottom edge on
  // touch) and its label rises. Out: the reverse, no opacity anywhere.
  function setIndicatorShown(shown: boolean): Promise<void> {
    if (shown === indicatorShown) return Promise.resolve();
    indicatorShown = shown;
    const pill = cursorPill ? [cursorPill] : [];
    gsap.killTweensOf([...pill, ...cursorTexts]);
    if (shown) {
      gsap.to(pill, { scale: 1, duration: INFO_IN_DURATION, ease: INFO_IN_EASE });
      gsap.to(cursorTexts, { yPercent: 0, duration: INFO_IN_DURATION, ease: INFO_IN_EASE, delay: 0.1 });
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      gsap
        .timeline({ onComplete: resolve, onInterrupt: resolve })
        .to(cursorTexts, { yPercent: INFO_LINE_HIDDEN, duration: INFO_OUT_DURATION, ease: INFO_OUT_EASE }, 0)
        .to(pill, { scale: 0, duration: INFO_OUT_DURATION, ease: INFO_OUT_EASE }, INFO_OUT_DURATION * 0.5);
    });
  }

  // Clicking a project: the fill unwinds back to empty, then the pill goes.
  function unwindIndicator(): Promise<void> {
    leaving = true;
    const fill = { p: fillP };
    const unwind = new Promise<void>((resolve) => {
      gsap.to(fill, {
        p: 0,
        duration: 0.35,
        ease: 'power2.inOut',
        onUpdate: () => setCursorFill(fill.p),
        onComplete: resolve,
        onInterrupt: resolve,
      });
    });
    return unwind.then(() => setIndicatorShown(false));
  }

  function infoLines(index: number): HTMLElement[] {
    return Array.from(projectEls[index]?.querySelectorAll<HTMLElement>('.reel-line') ?? []);
  }
  const counterLine = counterEl?.querySelector<HTMLElement>('.reel-line') ?? null;

  // Each call kills whatever its lines were doing, so a fast scroll that
  // chains transitions never leaves a line stuck halfway.
  function maskOut(lines: HTMLElement[]): Promise<void> {
    gsap.killTweensOf(lines);
    return new Promise((resolve) => {
      gsap.to(lines, {
        yPercent: INFO_LINE_HIDDEN,
        duration: INFO_OUT_DURATION,
        stagger: INFO_STAGGER,
        ease: INFO_OUT_EASE,
        onComplete: resolve,
        onInterrupt: resolve,
      });
    });
  }

  function maskIn(lines: HTMLElement[], delay = 0): void {
    gsap.killTweensOf(lines);
    gsap.fromTo(
      lines,
      { yPercent: INFO_LINE_HIDDEN },
      { yPercent: 0, duration: INFO_IN_DURATION, stagger: INFO_STAGGER, ease: INFO_IN_EASE, delay }
    );
  }

  function hideInfoLines(index: number): void {
    void maskOut(infoLines(index));
  }

  function revealInfoLines(index: number, delay = 0): void {
    maskIn(infoLines(index), delay);
  }

  function setChromeVisible(visible: boolean): void {
    const info = projectEls[displayedIndex]?.querySelector<HTMLElement>('.reel-info');
    if (info && visible) {
      gsap.set(info, { autoAlpha: 1 });
      revealInfoLines(displayedIndex);
    } else if (info) {
      hideInfoLines(displayedIndex);
    }
    if (counterEl && counterLine && visible) {
      gsap.set(counterEl, { autoAlpha: 1 });
      maskIn([counterLine]);
    } else if (counterLine) {
      void maskOut([counterLine]);
    }
  }

  // Clicking a project (-> its page, project-morph.ts): its text and the
  // counter sink into their masks and the grid lines retract, while the
  // clicked image stays for the morph. Also remembers the project so
  // /projets opens on it (vue 1) when coming back.
  registerMorphLeaveHook(async (clickedItem) => {
    const index = projectEls.indexOf(clickedItem);
    if (index < 0) return;
    saveProjetsState('carousel', index);
    gsap.set(gridlines, { transformOrigin: 'bottom' });
    await Promise.all([
      unwindIndicator(),
      maskOut([...infoLines(index), ...(counterLine ? [counterLine] : [])]),
      new Promise<void>((resolve) => {
        gsap.to(gridlines, { scaleY: 0, duration: 0.5, stagger: 0.02, ease: 'power3.inOut', onComplete: resolve });
      }),
    ]);
  });

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
          settleProject();
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
  function settleProject(): void {
    if (transitioning || !pinTrigger) return;
    const { targetIndex } = readProgress(remainingProgress(pinTrigger.progress));
    if (targetIndex === displayedIndex) return;

    transitioning = true;
    const fromBars = barsByProject[displayedIndex];
    hideInfoLines(displayedIndex);

    const closeTween = gsap.to(fromBars, {
      scaleX: 1,
      duration: BAR_DURATION,
      stagger: BAR_STAGGER,
      ease: 'power3.inOut',
      onComplete: () => {
        const { targetIndex: toIndex } = readProgress(remainingProgress(pinTrigger!.progress));
        showProject(toIndex);
        // Hidden before its project shows, then rising as the bars open.
        gsap.set(infoLines(toIndex), { yPercent: INFO_LINE_HIDDEN });
        revealInfoLines(toIndex, BAR_DURATION * 0.5);
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
            projectTweens = [];
            settleProject();
          },
        });
        projectTweens.push(openTween);
      },
    });
    projectTweens.push(closeTween);
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

    placeIntroLines(introProgress);

    const gridP = localProgress(introProgress, PHASE_GRID_START, 1);
    const lineWindow = 1 - GRID_STAGGER_FRACTION;
    gridlines.forEach((line, i) => {
      const lineStart = gridlines.length > 1 ? (i / (gridlines.length - 1)) * GRID_STAGGER_FRACTION : 0;
      const lineProgress = localProgress(gridP, lineStart, lineStart + lineWindow);
      gsap.set(line, { scaleY: lineProgress });
    });
  }

  function placeIntroLines(introProgress: number): void {
    introProgressNow = introProgress;
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
  }

  pinTrigger = ScrollTrigger.create({
    trigger: section,
    start: 'top top',
    end: () => `+=${Math.round(window.innerHeight * totalVH)}`,
    pin: sticky,
    pinSpacing: true,
    onUpdate(self) {
      if (!leaving) void setIndicatorShown(self.isActive && self.progress >= introFraction);

      if (self.progress < introFraction) {
        updateIntro(self.progress / introFraction);

        // A very fast scroll can cross back below introFraction in a single
        // tick, skipping the step-by-step chain (settleProject calling itself
        // on each transition's completion) that would normally walk
        // displayedIndex back down to 0 first. settleCurtain only ever
        // touches project 0 specifically, so without this, whichever
        // project was last on screen (or mid-transition) is never told to
        // hide and stays stuck on top of everything. Hard-reset instead of
        // trying to reconstruct the skipped steps.
        if (displayedIndex !== 0 || transitioning) {
          projectTweens.forEach((t) => t.kill());
          projectTweens = [];
          curtainOpenTl.pause(0);
          curtainTarget = 'closed';
          gsap.set(projectEls, { autoAlpha: 0 });
          const allLines = section.querySelectorAll('.reel-line');
          gsap.killTweensOf(allLines);
          gsap.set(allLines, { yPercent: INFO_LINE_HIDDEN });
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
        setProgress(0);
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
        setProgress(0);
        return;
      }

      const { targetIndex, intervalProgress } = readProgress(remainingProgress(self.progress));
      // No next project after the last: its fill runs over the hold instead
      // (the scroll left before the section lets go), not straight to full.
      setProgress(targetIndex >= n - 1 ? localProgress(self.progress, contentFraction, 1) : intervalProgress);
      settleProject();
    },
    onLeave: () => {
      if (!leaving) void setIndicatorShown(false);
    },
    onLeaveBack: () => {
      if (!leaving) void setIndicatorShown(false);
    },
  });

  // The pin's scroll length is innerHeight * totalVH px, so any viewport
  // height change (browser zoom above all) changes it - while the scroll
  // position, in px, stays put. Left alone, zooming out from project 3/5
  // lands back in the intro. Keep the *progress* instead: note it before
  // ScrollTrigger re-measures (still against the old layout at that
  // point), put the scroll back at the same progress once it has.
  let progressBeforeRefresh: number | null = null;
  const handleRefreshInit = () => {
    progressBeforeRefresh = pinTrigger?.isActive ? pinTrigger.progress : null;
  };
  const handleRefresh = () => {
    if (progressBeforeRefresh === null || !pinTrigger) return;
    const y = pinTrigger.start + progressBeforeRefresh * (pinTrigger.end - pinTrigger.start);
    progressBeforeRefresh = null;
    if (lenis) lenis.scrollTo(y, { immediate: true, force: true });
    else window.scrollTo(0, y);
  };
  ScrollTrigger.addEventListener('refreshInit', handleRefreshInit);
  ScrollTrigger.addEventListener('refresh', handleRefresh);

  // Pointer-following "Voir le projet" pill, with a slight lag. No fine
  // pointer (touch): the pill stays put at the bottom centre (CSS). Checked
  // live, not once at init: the pointer type can change mid-session (device
  // emulation, a tablet with a mouse plugged in) - read once, a pill set up
  // on touch never started following, stuck top left on switching to a mouse.
  const finePointer = window.matchMedia('(pointer: fine)');

  let handleMouseMove: ((event: MouseEvent) => void) | undefined;
  let updateCursor: ((time?: number, deltaMs?: number) => void) | undefined;

  if (cursor) {
    // Screen centre until the pointer first moves, not the top-left corner.
    let mouseX = window.innerWidth / 2;
    let mouseY = window.innerHeight / 2;
    let curX = mouseX;
    let curY = mouseY;
    let following = false;

    handleMouseMove = (event: MouseEvent) => {
      mouseX = event.clientX;
      mouseY = event.clientY;
    };
    window.addEventListener('mousemove', handleMouseMove);

    // CURSOR_LAG is the share of the gap closed per 60Hz frame; scaled by
    // the real frame time so the lag feels the same at 120Hz (or 30).
    updateCursor = (_time?: number, deltaMs = 1000 / 60) => {
      if (!finePointer.matches) {
        // Touch layout: CSS places it; an inline translate left over from
        // following would stack on top of that.
        if (following) {
          following = false;
          cursor.style.transform = '';
        }
        return;
      }
      if (!following) {
        // Switching (back) to a mouse: start from where the pointer is, no
        // glide across the screen from wherever it was last.
        following = true;
        curX = mouseX;
        curY = mouseY;
      }
      const k = 1 - Math.pow(1 - CURSOR_LAG, deltaMs / (1000 / 60));
      curX += (mouseX - curX) * k;
      curY += (mouseY - curY) * k;
      cursor.style.transform = `translate(${curX}px, ${curY}px)`;
    };
    gsap.ticker.add(updateCursor);
  }

  return {
    destroy: () => {
      registerMorphLeaveHook(null);
      videoVisibilityWatch.disconnect();
      window.removeEventListener('resize', handleResize);
      ScrollTrigger.removeEventListener('refreshInit', handleRefreshInit);
      ScrollTrigger.removeEventListener('refresh', handleRefresh);
      if (handleMouseMove) window.removeEventListener('mousemove', handleMouseMove);
      if (updateCursor) gsap.ticker.remove(updateCursor);
      pinTrigger?.kill();
      curtainOpenTl.kill();
      projectTweens.forEach((t) => t.kill());
    },
  };
}
