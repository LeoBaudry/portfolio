/// <reference lib="webworker" />
// Prototype (src/pages/dev/webcodecs-test.astro): muted looping videos
// decoded in this worker with WebCodecs and drawn onto OffscreenCanvases, so
// the page's main thread never touches a video decoder - the ~120ms
// "(no script)" long frames measured in vue 2 came from <video> elements
// setting theirs up. Only the playing clip holds a decoder; a paused one
// keeps its last picture on its canvas and gives the decoder back.

import { createFile, DataStream, Endianness, MP4BoxBuffer, type Sample } from 'mp4box';

type Encoded = { data: Uint8Array; timestamp: number; duration: number; key: boolean };

type Clip = {
  id: number;
  canvas: OffscreenCanvas;
  ctx: OffscreenCanvasRenderingContext2D;
  config: VideoDecoderConfig | null;
  chunks: Encoded[];
  duration: number; // one loop, microseconds
  decoder: VideoDecoder | null;
  frames: VideoFrame[]; // decoded, not shown yet, in timestamp order
  next: number; // next chunk to feed
  loopOffset: number; // added to fed timestamps, grows by `duration` per loop
  time: number; // playhead, microseconds (loop offsets included)
  playing: boolean;
  wantPlay: boolean; // play asked before the file was ready
};

type InMessage =
  | { type: 'add'; id: number; url: string; canvas: OffscreenCanvas }
  | { type: 'size'; id: number; width: number; height: number }
  | { type: 'play'; id: number }
  | { type: 'pause'; id: number };

const clips = new Map<number, Clip>();
// Frames decoded ahead of the playhead - enough to ride out a slow decode,
// few enough not to hold many decoder buffers.
const MAX_AHEAD = 6;

function log(message: string): void {
  self.postMessage({ type: 'log', message });
}

// avcC / hvcC / vpcC / av1C box -> the decoder's `description` (the box
// without its 8-byte header).
function descriptionOf(entry: any): Uint8Array | undefined {
  const box = entry.avcC ?? entry.hvcC ?? entry.vpcC ?? entry.av1C;
  if (!box) return undefined;
  const stream = new DataStream(undefined, 0, Endianness.BIG_ENDIAN);
  box.write(stream);
  return new Uint8Array(stream.buffer as ArrayBuffer, 8);
}

// One download at a time (all 8 at once: two failed on the dev server),
// retried once.
let queue: Promise<void> = Promise.resolve();
function enqueueLoad(clip: Clip, url: string): void {
  queue = queue.then(() =>
    load(clip, url).catch(() => load(clip, url)).catch((e) => log(`#${clip.id}: ${e}`))
  );
}

async function load(clip: Clip, url: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const buffer = await response.arrayBuffer();
  const file = createFile();
  const samples: Sample[] = [];
  let trackInfo: { id: number; codec: string; width: number; height: number; timescale: number } | null = null;
  file.onReady = (info) => {
    const track = info.videoTracks[0];
    if (!track) return;
    trackInfo = { id: track.id, codec: track.codec, width: track.video!.width, height: track.video!.height, timescale: track.timescale };
    file.setExtractionOptions(track.id, undefined, { nbSamples: Infinity });
    file.start();
  };
  file.onSamples = (_id, _user, batch) => {
    samples.push(...batch);
  };
  file.appendBuffer(MP4BoxBuffer.fromArrayBuffer(buffer, 0));
  file.flush();
  if (!trackInfo) {
    log(`#${clip.id}: no video track`);
    return;
  }
  const info = trackInfo as { id: number; codec: string; width: number; height: number; timescale: number };
  const entry = file.getTrackById(info.id).mdia.minf.stbl.stsd.entries[0];
  const config: VideoDecoderConfig = {
    codec: info.codec,
    codedWidth: info.width,
    codedHeight: info.height,
    description: descriptionOf(entry),
    optimizeForLatency: true,
  };
  const support = await VideoDecoder.isConfigSupported(config);
  if (!support.supported) {
    log(`#${clip.id}: codec ${info.codec} not supported`);
    return;
  }
  const us = (value: number) => Math.round((value * 1e6) / info.timescale);
  clip.chunks = samples.map((s) => ({
    data: s.data!,
    timestamp: us(s.cts),
    duration: us(s.duration),
    key: s.is_sync,
  }));
  clip.duration = clip.chunks.reduce((sum, c) => sum + c.duration, 0);
  clip.config = config;
  const keys = clip.chunks.filter((c) => c.key).length;
  log(`#${clip.id}: ${info.codec} ${info.width}x${info.height}, ${clip.chunks.length} frames, ${keys} keyframes, ${(clip.duration / 1e6).toFixed(1)}s`);
  await drawFirstFrame(clip);
  if (clip.wantPlay) play(clip);
}

// The poster: decode the first keyframe once, draw it, let the decoder go.
async function drawFirstFrame(clip: Clip): Promise<void> {
  if (!clip.config) return;
  let first: VideoFrame | null = null;
  const decoder = new VideoDecoder({
    output: (frame) => {
      if (first) frame.close();
      else first = frame;
    },
    error: (e) => log(`#${clip.id} poster: ${e.message}`),
  });
  decoder.configure(clip.config);
  const c = clip.chunks[0];
  decoder.decode(new EncodedVideoChunk({ type: 'key', timestamp: c.timestamp, duration: c.duration, data: c.data }));
  await decoder.flush().catch(() => {});
  decoder.close();
  if (first) {
    draw(clip, first);
    (first as VideoFrame).close();
  }
}

function draw(clip: Clip, frame: VideoFrame): void {
  const { width, height } = clip.canvas;
  if (width === 0 || height === 0) return;
  // object-fit: cover
  const scale = Math.max(width / frame.displayWidth, height / frame.displayHeight);
  const sw = width / scale;
  const sh = height / scale;
  const sx = (frame.displayWidth - sw) / 2;
  const sy = (frame.displayHeight - sh) / 2;
  clip.ctx.drawImage(frame, sx, sy, sw, sh, 0, 0, width, height);
}

function play(clip: Clip): void {
  clip.wantPlay = true;
  if (clip.playing || !clip.config) return;
  clip.playing = true;
  clip.decoder = new VideoDecoder({
    output: (frame) => {
      // A frame from before a pause/reset that still came out: drop it.
      if (!clip.playing) frame.close();
      else clip.frames.push(frame);
    },
    error: (e) => log(`#${clip.id}: ${e.message}`),
  });
  clip.decoder.configure(clip.config);
  // Resume where it paused: restart decoding at the keyframe at or before
  // the playhead; frames before the playhead are dropped as they come out.
  const inLoop = clip.time - clip.loopOffset;
  let key = 0;
  clip.chunks.forEach((c, i) => {
    if (c.key && c.timestamp <= inLoop) key = i;
  });
  clip.next = key;
  lastTick = performance.now();
}

function pause(clip: Clip): void {
  clip.wantPlay = false;
  if (!clip.playing) return;
  clip.playing = false;
  clip.frames.forEach((f) => f.close());
  clip.frames = [];
  if (clip.decoder && clip.decoder.state !== 'closed') clip.decoder.close();
  clip.decoder = null;
}

function feed(clip: Clip): void {
  const decoder = clip.decoder;
  if (!decoder || decoder.state !== 'configured') return;
  for (;;) {
    const c = clip.chunks[clip.next];
    // Resuming from the keyframe before the playhead: those frames are only
    // decoded to be dropped, so feed them without the look-ahead cap.
    const catchingUp = c.timestamp + clip.loopOffset < clip.time;
    if (catchingUp ? decoder.decodeQueueSize >= 16 : decoder.decodeQueueSize >= 2 || clip.frames.length + decoder.decodeQueueSize >= MAX_AHEAD) break;
    decoder.decode(
      new EncodedVideoChunk({
        type: c.key ? 'key' : 'delta',
        timestamp: c.timestamp + clip.loopOffset,
        duration: c.duration,
        data: c.data,
      })
    );
    clip.next++;
    if (clip.next >= clip.chunks.length) {
      clip.next = 0;
      clip.loopOffset += clip.duration;
    }
  }
}

function present(clip: Clip, dt: number): void {
  // Nothing decoded yet (just started / resumed): hold the playhead rather
  // than run ahead of the pictures.
  if (clip.frames.length === 0) return;
  clip.time += dt;
  clip.frames.sort((a, b) => a.timestamp - b.timestamp);
  // Resuming: frames from the keyframe up to the playhead are skipped.
  let shown: VideoFrame | null = null;
  while (clip.frames.length > 0 && clip.frames[0].timestamp <= clip.time) {
    shown?.close();
    shown = clip.frames.shift()!;
  }
  if (shown) {
    draw(clip, shown);
    shown.close();
  } else if (clip.frames[0].timestamp - clip.time > 500_000) {
    // Far behind the next frame (it jumped a loop): catch up.
    clip.time = clip.frames[0].timestamp;
  }
}

let lastTick = performance.now();
const scheduleTick: (cb: () => void) => void =
  'requestAnimationFrame' in self
    ? (cb) => (self as any).requestAnimationFrame(cb)
    : (cb) => setTimeout(cb, 16);

function tick(): void {
  const now = performance.now();
  const dt = Math.min(now - lastTick, 100) * 1000;
  lastTick = now;
  clips.forEach((clip) => {
    if (!clip.playing) return;
    feed(clip);
    present(clip, dt);
  });
  scheduleTick(tick);
}
scheduleTick(tick);

self.onmessage = (event: MessageEvent<InMessage>) => {
  const msg = event.data;
  if (msg.type === 'add') {
    const ctx = msg.canvas.getContext('2d');
    if (!ctx) return;
    const clip: Clip = {
      id: msg.id,
      canvas: msg.canvas,
      ctx,
      config: null,
      chunks: [],
      duration: 0,
      decoder: null,
      frames: [],
      next: 0,
      loopOffset: 0,
      time: 0,
      playing: false,
      wantPlay: false,
    };
    clips.set(msg.id, clip);
    enqueueLoad(clip, msg.url);
    return;
  }
  const clip = clips.get(msg.id);
  if (!clip) return;
  if (msg.type === 'size') {
    if (clip.canvas.width === msg.width && clip.canvas.height === msg.height) return;
    // Resizing clears a canvas: carry its picture over (a paused clip would
    // otherwise go blank until it plays again).
    const previous = clip.canvas.width > 0 && clip.canvas.height > 0 ? clip.canvas.transferToImageBitmap() : null;
    clip.canvas.width = msg.width;
    clip.canvas.height = msg.height;
    if (previous) {
      clip.ctx.drawImage(previous, 0, 0, msg.width, msg.height);
      previous.close();
    }
  } else if (msg.type === 'play') {
    play(clip);
  } else if (msg.type === 'pause') {
    pause(clip);
  }
};
