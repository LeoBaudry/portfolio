// A project's `images` entry (projets.json): an image path, or a video - a
// path ending in .mp4/.webm, or { desktop, mobile? } when it has a mobile
// (portrait) version, same idea as `main`.
export type MediaEntry = string | { desktop: string; mobile?: string };

const VIDEO_EXT = /\.(mp4|webm)$/i;

export function mediaSources(entry: MediaEntry): { desktop: string; mobile?: string } {
  return typeof entry === 'string' ? { desktop: entry } : entry;
}

export function isVideo(entry: MediaEntry): boolean {
  return VIDEO_EXT.test(mediaSources(entry).desktop);
}

export function videoType(src: string): string {
  return src.toLowerCase().endsWith('.webm') ? 'video/webm' : 'video/mp4';
}
