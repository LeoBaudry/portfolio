// /projets: every duration, easing, delay and mask shape the views use.

export const WHEEL_THRESHOLD = 18;
export const STEP_DURATION = 850;
export const STEP_EASE = 'cubic-bezier(0.77, 0, 0.175, 1)';

export const INFO_HIDE_DURATION = 320;
export const INFO_HIDE_EASE = 'cubic-bezier(0.4, 0, 1, 1)';
export const INFO_REVEAL_DURATION = 380;
export const INFO_REVEAL_EASE = 'cubic-bezier(0, 0, 0.2, 1)';
export const INFO_PART_STAGGER = 70;
export const INFO_HIDE_TOTAL = INFO_HIDE_DURATION + INFO_PART_STAGGER;
export const STEP_INFO_HIDE_DELAY = 150;
export const STEP_INFO_REVEAL_DELAY = STEP_DURATION * 0.85;

export const DEZOOM_INFO_HIDE_DELAY = 450;
export const CAROUSEL_INFO_HIDE_DELAY = 350;

export const MORPH_DURATION = 700;
export const MORPH_EASE = 'cubic-bezier(0.4, 0, 0.2, 1)';
export const MORPH_SIBLING_FADE_DURATION = 650;
export const MORPH_SIBLING_EASE = 'cubic-bezier(0.16, 1, 0.3, 1)';
// A main-visual video flying with .morph-hero sits just above it (15).
export const MORPH_VIDEO_Z = 16;

export const DEZOOM_OTHERS_IMAGE_DELAY = 150;
export const DEZOOM_OTHERS_TEXT_DELAY = MORPH_SIBLING_FADE_DURATION * 0.85;

export const DEZOOM_CROP_CLOSED = 'inset(50% 0 50% 0)';
export const DEZOOM_MASK_HIDDEN = 'inset(100% 0 0 0)';
export const DEZOOM_MASK_VISIBLE = 'inset(0 0 0 0)';

export const LISTE_ROW_STAGGER = 60;
// Share of a vue 3 row that must be on screen before it reveals.
export const LISTE_REVEAL_THRESHOLD = 0.4;
// A vue 3 title comes in last, as its row's caption: this long after all
// the row's images have loaded (they're still opening by then).
export const LISTE_TITLE_AFTER_IMAGES = 120;
// Vue 3 title parts (name, then meta) rise out of the .item-info mask -
// same idea as vue 2's, a touch slower and softer so it reads.
export const LISTE_TITLE_REVEAL_DURATION = 750;
export const LISTE_TITLE_PART_STAGGER = 90;
// Fully below the mask: the part's own height plus more than the mask's
// bottom padding (1rem, see .liste-row .item-info in projets.astro). In CSS
// terms on purpose, not measured - rows are set closed while vue 3 is
// display:none, where every measured height is 0.
export const LISTE_TITLE_HIDDEN = 'translateY(calc(100% + 1.5rem))';

// Vue 1/2 leaving for vue 3, or arriving from it: the same ink curtains
// (.view-curtain, transform only - clip-path repaints every frame and lags)
// and the same text masks as vue 3's rows. Leaving: text sinks first, then
// the curtains close upward. Arriving: curtains open upward, text rises last.
export const VIEW_IMAGE_AFTER_INFO = 120;
export const VIEW_IMAGE_STAGGER = 100;
// Arriving is slower and eased both ways (the carousel step's curtain ease),
// not the quick ease-out the post-morph siblings use - that one read as
// fast and flat for a whole view coming in.
export const VIEW_REVEAL_DURATION = 1000;
export const VIEW_REVEAL_EASE = STEP_EASE;
export const VIEW_REVEAL_STAGGER = 180;
export const VIEW_TEXT_AFTER_REVEAL = VIEW_REVEAL_DURATION * 0.6;
export const LISTE_IMAGE_STAGGER = 100;
export const LISTE_TITLE_ROW_STAGGER = 80;
