# Brief — portfolio perso

Projet neuf, dossier VSCode vide. On monte **un seul prototype fonctionnel**, avec des placeholders, qu'on ajustera ensuite au fil des sessions. Pas de design abouti, pas de contenu réel, pas de PocketBase pour l'instant.

L'objectif est d'avoir la page d'accueil et la page projets qui tournent vraiment, pour pouvoir régler les interactions à la main.

---

## 1. Initialisation

Astro avec TypeScript, dans le dossier courant, template vide.

```bash
npm create astro@latest .
```

Répondre : template "Empty", TypeScript "Strict", installer les dépendances.

```bash
npx astro add tailwind
npm i gsap lenis three pocketbase
npm i -D @types/three
```

`gsap` inclut ScrollTrigger. `pocketbase` est le SDK JavaScript, installé maintenant pour ne pas y revenir mais **non utilisé dans cette session**. Le serveur PocketBase est un exécutable séparé, à récupérer plus tard.

### Transitions de page : ClientRouter, avec Barba en réserve

On part sur `ClientRouter` d'Astro (anciennement `ViewTransitions` avant Astro 5), importé depuis `astro:transitions`.

À savoir, parce que ça va se jouer sur la transition vers les pages projet. ClientRouter s'appuie sur l'API View Transitions du navigateur, qui est déclarative : on décrit l'état de départ et d'arrivée, et le navigateur interpole. Astro permet de passer une animation personnalisée, donc ce n'est pas fermé, mais on reste dans un cadre.

Barba fonctionne autrement. Il donne des points d'accroche en JavaScript (avant de quitter, pendant la sortie, pendant l'entrée) dans lesquels on écrit sa propre timeline GSAP, image par image. Plus de travail, mais contrôle total, et l'état JavaScript reste vivant entre les pages.

**Décision pour cette session** : ClientRouter. Si le reveal par le bas vers les pages projet résiste, on bascule sur Barba. Ne pas installer les deux en même temps, ils se marchent dessus.

```bash
# uniquement si on bascule
npm i @barba/core
```

---

## 2. Typographie

Choix arrêté : **DM Sans** pour le sans-serif, **DM Mono** pour la mono.

Les deux viennent de Colophon Foundry et DM Mono est dérivée de DM Sans, avec un contraste réduit et des proportions moins géométriques. Le couple est donc cohérent d'origine. Les deux sont sous licence libre SIL Open Font License, donc auto-hébergeables sans dépendre d'un abonnement ni d'un service extérieur.

DM Sans existe en version variable, avec des axes de graisse, d'italique et de taille optique. DM Mono compte trois graisses et trois styles, sans version variable.

### Mise en place

Télécharger les fichiers depuis Google Fonts, prendre le woff2 variable pour DM Sans et les trois graisses de DM Mono, et les poser dans `public/fonts`. Pas d'appel à l'API Google Fonts : on héberge soi-même.

Déclarer deux variables CSS et ne jamais écrire un nom de police ailleurs dans le code :

```css
:root {
  --font-sans: 'DM Sans', system-ui, sans-serif;
  --font-mono: 'DM Mono', ui-monospace, monospace;
}
```

Ce choix n'est pas définitif, il sera peut-être revu une fois le site rempli de vrai contenu. Ces deux variables doivent donc rester le seul endroit à modifier.

Trois réglages à ne pas oublier : woff2 uniquement, `font-display: swap`, et un en-tête de cache très long sur les fichiers de police.

### Emploi

DM Sans pour les titres et le texte courant.

DM Mono uniquement pour les informations de service : compteurs `03 / 08`, catégories, années, libellés de boutons, légendes.

---

## 3. Socle technique

### Lenis et ScrollTrigger

Lenis remplace le défilement natif, donc ScrollTrigger ne voit plus rien si on ne les branche pas ensemble. Premier piège de la stack, à régler d'entrée.

```ts
import Lenis from 'lenis'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'

gsap.registerPlugin(ScrollTrigger)

const lenis = new Lenis({ duration: 1.1 })
lenis.on('scroll', ScrollTrigger.update)
gsap.ticker.add((time) => lenis.raf(time * 1000))
gsap.ticker.lagSmoothing(0)
```

### Accessibilité

Respecter `prefers-reduced-motion` partout : pas de parallaxe, pas de rideau, pas d'inertie, le contenu s'affiche directement. Le site doit rester intégralement utilisable dans ce mode.

### Hauteurs

Utiliser `100dvh` et jamais `100vh`. Sur mobile, `100vh` ignore la barre d'adresse et le contenu passe dessous.

### Placeholders

Huit projets factices dans `src/data/projets.json` : titre, slug, catégorie, secteur, année, courte description, et 4 à 6 images. Générer les images en SVG de couleur unie, en local, pour que tout marche hors ligne. Pas de vidéo pour l'instant.

---

## 4. Animation d'apparition du texte

Motif réutilisable sur tout le site, à écrire une fois comme composant ou comme directive.

Chaque ligne de texte est placée dans un conteneur en `overflow: hidden`. Le texte démarre décalé vers le bas, en dehors du conteneur, et remonte à sa place. Visuellement, les caractères sortent de derrière une arête invisible.

Découper par ligne d'abord, pas par caractère. Un découpage caractère par caractère sur un paragraphe entier produit des centaines d'éléments et rame. Réserver le caractère par caractère aux très gros titres de trois ou quatre mots.

Attention au recalcul au redimensionnement : les lignes changent, donc le découpage doit être refait. Et garder le texte lisible pour les lecteurs d'écran et les moteurs de recherche, donc ne pas remplacer le contenu par des fragments vides.

---

## 5. Page d'accueil

Dans l'ordre : hero, section texte courte, section projets, section texte courte, footer.

### Hero

Image plein écran en `100dvh`, avec parallaxe. Pas de vidéo pour l'instant.

Le mouvement reste discret : de l'ordre de 10 à 15 pour cent de la hauteur sur toute la traversée. Au-delà, ça devient un effet et ça fatigue.

Prévoir un indicateur de scroll, la section occupant tout l'écran sans indice de ce qui suit.

### Sections texte

Courtes, deux ou trois phrases. Elles servent de respiration entre les blocs animés. Le texte apparaît avec l'animation décrite au point 4.

### Section projets

C'est le morceau principal de la page. Référence d'intention : flabbergast.agency, qui affiche 3 à 5 projets avec un compteur du type `1 2 3 4 5 / 5`, la catégorie et l'année de chacun.

**Ici on utilise bien l'épinglage.** La section se fige à l'écran, et le scroll qui ne la fait plus bouger sert à avancer de projet en projet. La durée totale est finie, donc la section se décolle ensuite et la page reprend. Pas de boucle infinie dans cette section, contrairement à la page projets.

Déroulé attendu :

Au moment où la section se fige, les lignes verticales de séparation des colonnes apparaissent en premier, avant le premier projet. Elles posent la grille.

Ensuite le premier projet se révèle en rideau, colonne par colonne avec un léger décalage entre elles.

Pour passer au projet suivant, il faut parcourir un intervalle de scroll. Pendant ce parcours, un indicateur collé au curseur se remplit progressivement. Quand il est plein, l'animation de passage au projet suivant se joue.

Une fois tous les projets passés, la section se décolle normalement.

**Le visuel du projet occupe 100 pour cent de la largeur et de la hauteur de la section.** Les informations du projet (titre, catégorie, année, compteur) se posent donc par-dessus l'image. Prévoir un voile sombre léger derrière le texte, ou une zone de protection, sinon la lisibilité dépendra entièrement de l'image chargée.

**Deux modes de déclenchement à coder, avec une bascule pour les comparer.**

Mode A, déclenchement d'un coup. L'intervalle de scroll sert uniquement de compte à rebours. Rien ne se passe pendant qu'il se remplit, à part l'indicateur au curseur. Quand il arrive au bout, l'animation de rideau se joue d'elle-même, à sa propre vitesse, et le scroll n'a plus d'influence pendant ce temps. Geste net et maîtrisé, mais le visiteur subit l'animation.

Mode B, lié à la progression. Le rideau suit directement la position de scroll. Les bandes descendent au fur et à mesure, et si on remonte, elles remontent. Contrôle direct, mais le rendu peut paraître mou quand on scrolle lentement, et le décalage entre colonnes est plus difficile à faire ressentir.

Écrire les deux derrière un même drapeau, du type `MODE_RIDEAU = 'A' | 'B'`, changeable en une ligne. Ne pas choisir maintenant, on tranchera en les ayant sous les yeux.

En mode B, penser au cas du scroll vers le haut : l'animation doit se jouer à l'envers proprement, sans sauter d'état.

**Le rideau.** Ne pas découper l'image. Une seule image entière, et par-dessus des bandes de couleur unie qu'on anime en `scaleY`. Animer des aplats coûte beaucoup moins cher que redécouper une image à chaque frame.

Le nombre de colonnes est piloté par une variable CSS, lue ensuite depuis le JavaScript, pour que le CSS reste la seule source de vérité.

```css
.reveal { --cols: 5; position: relative; overflow: hidden; }
@media (max-width: 900px) { .reveal { --cols: 3; } }
@media (max-width: 600px) { .reveal { --cols: 2; } }

.bars { position: absolute; inset: 0; display: flex; pointer-events: none; }
.bar  { flex: 1; background: var(--bg); transform-origin: top;
        margin-right: -1px; will-change: transform; }
```

Le `margin-right: -1px` n'est pas cosmétique : sans lui, des traits d'un pixel apparaissent entre les bandes parce que les largeurs tombent sur des valeurs non entières.

Le décalage total entre colonnes doit rester nettement plus court que la durée d'une bande, sinon on perçoit plusieurs animations successives au lieu d'un seul geste. Exposer ce décalage en constante pour le régler à la main.

**L'indicateur au curseur.** Un petit élément en `position: fixed` qui suit le pointeur, contenant un cercle de progression en SVG animé via `stroke-dashoffset`. Sa valeur suit la progression dans l'intervalle courant, de 0 à 1.

Trois points de vigilance. Suivre le curseur avec un léger retard plutôt qu'à la position exacte, sinon le mouvement paraît sec. Prévoir un repli quand il n'y a pas de pointeur, donc sur mobile : dans ce cas l'indicateur se place à un endroit fixe de l'écran. Et le masquer quand la section n'est pas épinglée.

---

## 6. Footer

Révélation par le dessous avec parallaxe. La dernière section glisse vers le haut et découvre le footer qui était déjà là, en dessous, et qui se déplace plus lentement.

En pratique le footer est en `position: sticky` collé en bas, avec la section précédente qui passe par-dessus. Attention à la hauteur totale de la page, ce montage la fausse facilement.

Contenu : nom complet, ce que je cherche, contact, réseaux. C'est le bloc qui sert aux recruteurs, il doit être clair et pas seulement décoratif.

---

## 7. Page projets

Huit projets, trois vues, avec un bouton de bascule.

### Vue 1 — Grand carrousel

Un projet occupe 100 pour cent de la largeur et de la hauteur.

Le passage au projet suivant se déclenche au premier petit mouvement de scroll. On avance projet par projet, pas en défilement continu. C'est un pas, pas un glissement.

**Boucle infinie** : arrivé au huitième, continuer dans le même sens ramène au premier, et inversement.

**Le piège critique** : un geste de trackpad envoie des dizaines d'événements de scroll d'affilée. Sans verrou, un seul mouvement fait défiler vingt projets. Il faut donc un verrou booléen posé au déclenchement et relâché à la fin de l'animation, plus un seuil minimal en dessous duquel l'événement est ignoré. À exposer en constantes, c'est le premier réglage à faire à la main.

### Vue 2 — Carrousel dézoomé

Les projets sont plus petits, collés les uns aux autres, et le défilement horizontal est **continu** et non par pas.

**Pas de boucle ici.** Le défilement s'arrête au premier et au dernier projet.

Les deux vues ne partagent donc pas le même modèle : la vue 1 replie sa valeur de position, la vue 2 la borne. Prévoir ça dès le départ avec un drapeau de mode plutôt que de coller une exception après coup.

### Vue 3 — Liste

Défilement vertical classique. Une ligne par projet.

Chaque ligne commence par une ligne d'informations sur toute la largeur : le nom du projet à gauche, puis la catégorie, puis le secteur, et le numéro aligné à droite entre parenthèses, du type `(01)`.

En dessous, une bande d'images de même hauteur, occupant toute la largeur de l'écran bord à bord, séparées par un trait fin. Les images ne sont pas dans une grille avec des marges, elles se touchent.

Un trait horizontal fin sépare chaque projet du suivant.

Le nombre d'images par ligne suit la résolution : 4 en grand écran, 3 en intermédiaire, 2 en petit. Le JSON en prévoit jusqu'à 6, on prend les premières selon la place.

### Bascule entre les vues

Trois icônes distinctes, une par état : grand carrousel, petit carrousel, liste. Le mode courant est visiblement actif.

Une animation joue à chaque changement. Les vues 1 et 2 partagent la même structure, donc la transition entre elles se fait en animant la largeur et la hauteur des projets, pas en remplaçant le contenu. Vers la liste, la disposition change vraiment : prévoir une sortie puis une entrée, avec un décalage entre les lignes.

La bascule doit conserver le projet courant. Passer en liste depuis le projet 5 doit arriver sur le projet 5, pas en haut.

Mettre la vue dans l'URL, du type `/projets?vue=liste`. Le lien devient partageable, le choix survit à un rechargement, et on peut envoyer directement la vue liste dans une candidature.

Une seule liste de projets dans le HTML, partagée par les trois vues. Ne pas dupliquer le contenu.

---

## 8. Transition vers une page projet

Reveal par le bas : la page projet monte et recouvre la page courante.

Premier essai avec ClientRouter et une animation personnalisée. Si le contrôle est insuffisant, on bascule sur Barba comme prévu au point 1.

Ne pas casser le bouton retour du navigateur ni les adresses directes. Chaque projet doit avoir sa propre URL et s'ouvrir correctement quand on y arrive sans passer par la liste.

---

## 9. Réglages à exposer en constantes

Rassembler en haut des fichiers concernés, ce sont les valeurs qu'on va ajuster à la main pendant les tests.

Amplitude de la parallaxe du hero. Durée d'une bande de rideau et décalage entre colonnes. Mode de rideau, A ou B. Longueur de l'intervalle de scroll entre deux projets sur la page d'accueil. Retard de suivi de l'indicateur au curseur. Seuil de scroll et durée du verrou pour la vue 1 de la page projets. Largeur et hauteur des projets en vue 2. Durée des transitions entre vues.

---

## 10. Hors périmètre

Identité visuelle définitive, logo, couleurs. Contenu réel. Configuration de PocketBase. Déploiement. Vidéos. Three.js, installé pour plus tard mais utilisé nulle part ici.