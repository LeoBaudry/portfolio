# TODO / Known issues — /projets page

`src/pages/projets.astro` and `src/scripts/projets-page.ts` were rewritten from scratch on 2026-09-20 as a simple, transition-free baseline: three separate view panels (carousel, dezoom, liste) toggled via `hidden`, no shared/reparented DOM elements between them, no view-to-view transition animation yet.

The previous entries here (font flash during transitions, step speed) referenced the old GSAP Flip-based implementation and no longer apply - that code path doesn't exist anymore.

## Next up

Transitions between the three views, once the current baseline is confirmed solid. Deliberately deferred - see project memory `project_projets_page_v2` for the reasoning and a note to avoid re-introducing GSAP Flip morphing across shared elements, which is what made the previous version fragile.
