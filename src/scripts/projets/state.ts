// /projets: which view/project to restore, and whether this load is a reload.

export type ViewMode = 'carousel' | 'dezoom' | 'liste';

const PROJETS_STATE_KEY = 'projets-view-state';

export function saveProjetsState(view: ViewMode, current: number): void {
  try {
    sessionStorage.setItem(PROJETS_STATE_KEY, JSON.stringify({ view, current }));
  } catch {}
}

// A project page just opened - however it was reached (from /projets, the
// homepage reel, the menu, another project): it's the one /projets comes
// back to, in the view last used. Reaching one through the menu left the
// previous project saved: `← Projets` then flashed and landed on that one
// (Leo, 2026-09-27).
export function rememberProject(current: number): void {
  saveProjetsState(readProjetsState()?.view ?? 'carousel', current);
}

export function readProjetsState(): { view: ViewMode; current: number } | null {
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

// The navigation entry describes the whole document, not each client-side
// navigation, so "reload" is only meaningful for the very first init.
let isFirstInit = true;

export function consumeIsReload(): boolean {
  const wasFirst = isFirstInit;
  isFirstInit = false;
  const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
  return wasFirst && nav?.type === 'reload';
}
