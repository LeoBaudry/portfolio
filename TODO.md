# TODO / Known issues — /projets page

`src/pages/projets.astro` and `src/scripts/projets-page.ts` hold the current
three-view (carousel / dezoom / liste) implementation with a working
vue1<->vue2 morph transition. Vue3 (liste) is done, no changes needed there.

The items below are open feedback from 2026-09-20's session, left unfinished
to save tokens - pick up here. All of it lives in
`morphBetweenCarouselAndDezoom()` in `src/scripts/projets-page.ts`.

## 1. Sibling cards' text must NOT be part of the image mask - it currently is

The vue2 sibling cards (`.dezoom-item`) are masked in/out via `clip-path` on
the **whole item**, top-to-bottom growing/closing. `.dezoom-item` contains
both `.item-info` (text) and the `<img>` as children of the same flex
column, so clip-path on the item visually clips the text along with the
image - even though the text has its own separate, untouched
translateY-under-mask animation in code, it's still being cropped as a side
effect of the parent's clip-path. User has now said explicitly (twice) this
is wrong: **the image mask must only ever affect the image**, never the
text.

**Fix:** stop putting `clip-path` on `.dezoom-item` itself. Either:
- move `clip-path` onto just the `<img>` (or a wrapper div around only the
  image, not `.item-info`), or
- restructure so `.item-info` sits outside whatever element gets the
  clip-path.
Either way, `.item-info`'s own show/hide (`hideDezoomItemInfo` /
`showDezoomItemInfo`, already correct and untouched) should keep working
unmodified once it's no longer nested inside the clipped element.

## 2. ~5% of the image stays hidden after the entering reveal "finishes"

Reported: vue2 entry, sibling images grow in from the bottom as intended,
but once the reveal animation visually stops, a thin strip (~5%, sounds
like the very bottom edge) of the image is still not shown - it only
appears under some later event. This is very likely a rounding/edge-case
variant of the same class of bug fixed earlier tonight (`settle()`'s
`commitStyles()` lagging the real end state - see
`feedback_waapi_settle_pattern` memory, gotcha #4). That fix forces
`el.style.clipPath = ''` after `settle()` resolves for the *whole-item*
reveal; once fix #1 above moves the mask onto just the image element, make
sure the same "force the final value after settle()" treatment is applied
to whatever new element actually owns the clip-path - it's easy for this to
silently stop happening across a refactor.

Also worth double-checking once #1 is done: verify with an actual DOM read
(`getComputedStyle` / `getBoundingClientRect`, not just eyeballing - see
`feedback_browser_test_tooling_flaky` memory for why) that the fully-open
end keyframe truly clips nothing, at the *new* element's own box, not the
old `.dezoom-item`'s.

## 3. Entering choreography needs re-sequencing and a stronger ease-out

Current (wrong per latest feedback): image reveal and text reveal are
already two separate animations, but they start on close to the same
schedule (text has only `DEZOOM_OTHERS_STAGGER` = 150ms extra delay), and
the image reveal uses plain CSS `'ease-out'`.

Wanted:
- Sibling images reveal first, alone (no text).
- Sibling text should only start revealing once the image reveal is
  **"almost" done** - i.e. a delay close to (not equal to) the image
  reveal's own duration (`MORPH_SIBLING_FADE_DURATION`), not the current
  small fixed stagger.
- The image reveal itself should read as "less linear" - swap the plain
  `'ease-out'` for a more pronounced curve, e.g. something like
  `cubic-bezier(0.16, 1, 0.3, 1)` (a strong expo-out) and tune from there.

## 4. Leaving choreography needs an explicit extra phase for siblings' text

Latest exact spec from the user, leaving dezoom for carousel:

1. "Current" project's own text disappears (already correct, unchanged -
   `hideDezoomItemInfo(dezoomItems[heroIndex], DEZOOM_INFO_HIDE_DELAY)`).
2. **New, currently missing:** the *other* (sibling) projects' text
   disappears next, as its own distinct phase - only after step 1, not
   concurrent with step 3.
3. Only then: the hero image morphs (existing `.morph-hero` box animation)
   **at the same time as** the other projects' cards animate out (the
   existing top+bottom clip-path crop-to-a-line, unchanged in spirit, just
   needs to now run on image-only per fix #1).

Earlier tonight the separate "others' text hide" step for the leaving side
was deliberately removed on the assumption the whole-card crop made it
redundant - per fix #1 that assumption no longer holds once text is pulled
out of the clip entirely, *and* the user wants it as its own sequenced beat
regardless. Re-add a `hideDezoomItemInfo(el, ...)` pass over
`visibleDezoomItems(heroIndex)` (the pre-fix code already had this, it was
removed - check git history / the previous conversation for the exact
shape) positioned as its own awaited step between the hero's own text hide
and the DOM swap / morph / crop-out phase.

## Reference

Recent related memories worth re-reading before touching this again:
- `feedback_waapi_settle_pattern` (gotcha #4 especially - settle() timeout
  tuning and the "force final value after settle()" pattern)
- `feedback_browser_test_tooling_flaky`
- `project_projets_page_v2`

penser à animer la vue 3 aussi, et transition vue 3.

images selon width : picture d'astro etc voir gemini et lui demander


---- partie de Gemini (à transmettre à claude code), pour l'optimisation de la vue2 et de l'animation en sortie et entrée de viewport des éléments : 
❌ Le mythe : Animer la disparition des éléments hors écran n'économise pas de ressources, ça en consomme plus (calculs JS/GPU). Le navigateur ne calcule déjà pas le rendu de ce qui est hors viewport.

✅ Les VRAIES optimisations (Zéro coût JS) :

HTML : Ajoute loading="lazy" decoding="async" sur tes <img> (chargement différé sans bloquer la page).

CSS : Ajoute content-visibility: auto; sur .dezoom-item (le navigateur suspend complètement le rendu des cartes hors-champ).

✨ Si tu veux animer juste pour l'esthétique ("Wow effect") :

Utilise GSAP ScrollTrigger ou un IntersectionObserver.

N'anime que transform et opacity.

Évite le clip-path pendant le scroll (trop lourd) et ne fais jamais de display: none (ça casserait les calculs de défilement de Lenis).