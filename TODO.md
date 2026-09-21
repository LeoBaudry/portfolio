# TODO / Known issues — /projets page

`src/pages/projets.astro` and `src/scripts/projets-page.ts` hold the current
three-view (carousel / dezoom / liste) implementation with a working
vue1<->vue2 morph transition. Vue3 (liste) is done, no changes needed there.

Previous items 1-4 (sibling text caught in image mask, ~5% image left
hidden after reveal, entering choreography sequencing/easing, leaving
choreography's extra siblings'-text phase) are done - fixed in
`morphBetweenCarouselAndDezoom()` / `initDezoomObserver()`.

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