# Contenu & structure — prochaines étapes

Suite à `content.md` (le brief technique initial, largement réalisé) et
`TODO.md` (le journal de bord des sessions transitions/animations, terminé
pour l'essentiel). Ce fichier couvre ce qui reste : des questions de
**contenu et d'architecture de l'information**, pas de technique. Rien
ci-dessous n'est urgent ni bloquant — à traiter quand l'envie/l'inspiration
est là.

---

## 1. Page d'accueil — les deux blocs de texte

Structure actuelle : hero (`.reel-hero`, avec son propre texte d'intro
`.reel-intro-body` déjà superposé) → section projets (`ProjectsReel`) →
un seul bloc texte (`text-block--pre-footer` dans `index.astro`) → footer.

Le brief initial (`content.md` §5) prévoyait deux blocs de texte distincts
(un avant la section projets, un après) comme simples respirations entre
les blocs animés. En pratique, l'intro du hero (`reel-intro-body`) joue
déjà ce rôle de "premier bloc" — il n'y a donc qu'un texte à écrire pour de
vrai : celui avant le footer.

**Ce qu'il faut décider :**
- Le texte du hero (`reel-intro-body`, actuellement un placeholder
  générique) — une ligne de positionnement : qui je suis / quel type de
  travail suit.
- Le texte pré-footer — actuellement aussi un placeholder. Deux directions
  possibles :
  - **Une respiration courte**, dans l'esprit du brief initial (2-3
    phrases, rien de plus) — cohérent avec l'intention "brutaliste sobre"
    du reste du site.
  - **Un texte qui travaille un peu plus** : contexte perso/méthode,
    et qui sert de pont vers une page About (si elle existe — voir §4) ou
    vers le contact.

**Mon avis :** vu que le hero porte déjà une intro courte, dupliquer un
deuxième "texte de mission" générique avant le footer serait redondant.
Plus logique de garder ce bloc court mais de lui donner un rôle précis —
soit une phrase de transition vers "qui je suis" (si About existe), soit
directement vers le contact. Mais à trancher une fois que tu sais si tu
fais une page About ou pas (§4) — l'un dépend de l'autre.

---

## 2. Page /projets — texte

Actuellement aucun texte de présentation sur la page (les 3 vues vont
droit aux projets — titre/catégorie/année par item seulement, pas de
paragraphe d'intro).

**Question ouverte :** est-ce que la page mérite une courte accroche en
haut (contexte, méthode, nombre de projets) avant les vues, ou est-ce que
l'absence de texte sert justement le côté "direct, pas de blabla" du
site ? Les deux se défendent — dépend de ce que tu veux que la page
raconte en plus des images.

---

## 3. Pages [slug] — agencement texte/images

C'est probablement le plus gros chantier de contenu des trois.

Structure actuelle (`[slug].astro`) : bloc intro (catégorie/secteur/année,
titre, description courte) → image hero plein écran → images
supplémentaires empilées une par une, sans texte entre elles.

**Ce qui manque pour que ça raconte quelque chose :**
- Les images supplémentaires n'ont aucune légende/contexte — c'est une
  suite de photos, pas un récit de projet.
- Pas de structure narrative (brief → démarche → résultat, ou équivalent)
  — actuellement tout le texte est dans le bloc d'intro, le reste n'est
  que visuel.

**Question ouverte :** veux-tu introduire des sous-sections de texte entre
certains blocs d'images (même courtes — un titre de section + une phrase),
ou rester purement visuel avec juste des légendes discrètes par image ? Ça
détermine si `projets.json` a besoin de nouveaux champs (légendes,
sous-sections) en plus de `images[]`.

---

## 4. Vrai menu (navigation)

`#temp-nav` dans `Layout.astro` est explicitement marqué comme temporaire
dans son propre commentaire ("Temporary nav, until the real one is
designed") — actuellement juste deux liens texte (Index / Projets).

**À décider :**
- Contenu : Index, Projets, About (si elle existe), Contact ?
- Comportement : reste-t-il un simple lien texte fixe, ou un vrai menu
  (burger mobile, overlay, etc.) maintenant que 3 pages-types différentes
  (accueil, /projets à 3 vues, [slug]) doivent toutes s'y retrouver ?
- Il est actuellement masqué/révélé pendant les morphs
  (`hideChromeEl`/`revealChromeEl` dans `project-morph.ts`) — un menu plus
  complexe (overlay plein écran, sous-menu) devra probablement repasser
  par cette même logique de mask.

---

## 5. Page "About" / "À propos"

N'existe pas encore. Se pose seulement si tu veux séparer "qui je suis/mon
parcours" du footer (qui contient déjà nom, pitch, contact — actuellement
tout en placeholder dans `SiteFooter.astro`).

**À décider :**
- Le footer suffit-il (nom, pitch une ligne, contact) ou une vraie page
  About a-t-elle sa place (parcours, méthode de travail, stack, photo) ?
- Si About existe, elle change la réponse à §1 (le texte pré-footer peut
  pointer vers elle plutôt que tout dire lui-même).

---

## Ordre suggéré

1. Trancher About oui/non (§5) — ça conditionne §1 et §4.
2. Écrire les textes homepage (§1) une fois §5 tranché.
3. [slug] (§3) — le plus gros morceau, à faire quand tu as du vrai contenu
   projet (texte + images) pour au moins un ou deux projets à traiter en
   exemple.
4. Menu réel (§4) et texte /projets (§2) — les deux plus légers,
   peuvent se faire en dernier.
