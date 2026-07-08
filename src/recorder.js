import { Muxer, ArrayBufferTarget } from 'mp4-muxer';
import { zipSync } from 'fflate';

const FALLBACK_TYPES = [
  'video/mp4',
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm',
];

export const RECORD_WIDTH = 1920;
export const RECORD_HEIGHT = 1080;
export const RECORD_FPS = 30;

export function isWebCodecsMp4Supported() {
  return typeof VideoEncoder !== 'undefined' && typeof VideoFrame !== 'undefined';
}

export function pickMediaRecorderMimeType() {
  if (typeof MediaRecorder === 'undefined') return null;
  return FALLBACK_TYPES.find((type) => MediaRecorder.isTypeSupported(type)) ?? null;
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function createRecordSurface(width, height) {
  const recordCanvas = document.createElement('canvas');
  recordCanvas.width = width;
  recordCanvas.height = height;
  const recordCtx = recordCanvas.getContext('2d', { alpha: false });
  return { recordCanvas, recordCtx };
}

function blitToRecordSurface(sourceCanvas, recordCtx, width, height) {
  recordCtx.drawImage(sourceCanvas, 0, 0, width, height);
}

export class CanvasMp4Recorder {
  constructor(
    canvas,
    { fps = RECORD_FPS, width = RECORD_WIDTH, height = RECORD_HEIGHT } = {},
  ) {
    this.canvas = canvas;
    this.fps = fps;
    this.width = width;
    this.height = height;
    this.frameIndex = 0;
    this.active = false;
    this.encoder = null;
    this.muxer = null;
    this.target = null;
    const { recordCanvas, recordCtx } = createRecordSurface(width, height);
    this.recordCanvas = recordCanvas;
    this.recordCtx = recordCtx;
  }

  start() {
    if (!isWebCodecsMp4Supported()) {
      throw new Error('WebCodecs MP4 encoding is not supported in this browser.');
    }

    const { width, height } = this;

    this.target = new ArrayBufferTarget();
    this.muxer = new Muxer({
      target: this.target,
      video: {
        codec: 'avc',
        width,
        height,
      },
      fastStart: 'in-memory',
    });

    this.encoder = new VideoEncoder({
      output: (chunk, meta) => this.muxer.addVideoChunk(chunk, meta),
      error: (error) => {
        console.error('VideoEncoder error:', error);
        this.active = false;
      },
    });

    this.encoder.configure({
      codec: 'avc1.42E028',
      width,
      height,
      bitrate: 8_000_000,
    });

    this.frameIndex = 0;
    this.active = true;
  }

  captureFrame() {
    if (!this.active || !this.encoder || this.encoder.state === 'closed') return;

    try {
      blitToRecordSurface(this.canvas, this.recordCtx, this.width, this.height);
      const timestamp = Math.round((this.frameIndex * 1_000_000) / this.fps);
      const frame = new VideoFrame(this.recordCanvas, { timestamp });
      this.encoder.encode(frame, { keyFrame: this.frameIndex % this.fps === 0 });
      frame.close();
      this.frameIndex += 1;
    } catch (error) {
      console.error('captureFrame failed:', error);
      this.active = false;
    }
  }

  async stop() {
    if (!this.encoder) return null;

    this.active = false;

    try {
      if (this.encoder.state === 'configured') {
        await this.encoder.flush();
      }
      if (this.encoder.state !== 'closed') {
        this.encoder.close();
      }
      this.muxer?.finalize();
      const blob = new Blob([this.target.buffer], { type: 'video/mp4' });
      return blob;
    } catch (error) {
      console.error('Recorder stop failed:', error);
      return null;
    } finally {
      this.encoder = null;
      this.muxer = null;
      this.target = null;
    }
  }
}

export class CanvasMediaRecorder {
  constructor(
    canvas,
    { fps = RECORD_FPS, mimeType, width = RECORD_WIDTH, height = RECORD_HEIGHT } = {},
  ) {
    this.canvas = canvas;
    this.fps = fps;
    this.mimeType = mimeType;
    this.width = width;
    this.height = height;
    this.recorder = null;
    this.chunks = [];
    this.active = false;
    const { recordCanvas, recordCtx } = createRecordSurface(width, height);
    this.recordCanvas = recordCanvas;
    this.recordCtx = recordCtx;
  }

  start() {
    blitToRecordSurface(this.canvas, this.recordCtx, this.width, this.height);
    const stream = this.recordCanvas.captureStream(this.fps);
    this.chunks = [];
    this.recorder = new MediaRecorder(stream, { mimeType: this.mimeType });
    this.recorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        this.chunks.push(event.data);
      }
    };
    this.recorder.start(100);
    this.active = true;
  }

  captureFrame() {
    if (!this.active) return;
    blitToRecordSurface(this.canvas, this.recordCtx, this.width, this.height);
  }

  stop() {
    return new Promise((resolve) => {
      if (!this.active || !this.recorder) {
        resolve(null);
        return;
      }

      this.recorder.onstop = () => {
        const blob = new Blob(this.chunks, { type: this.mimeType });
        this.active = false;
        this.recorder = null;
        this.chunks = [];
        resolve(blob);
      };

      this.recorder.stop();
    });
  }
}

function frameFileName(index) {
  return `frame_${String(index + 1).padStart(5, '0')}.png`;
}

export class CanvasPngSequenceRecorder {
  constructor(
    canvas,
    { width = RECORD_WIDTH, height = RECORD_HEIGHT } = {},
  ) {
    this.canvas = canvas;
    this.width = width;
    this.height = height;
    this.frameIndex = 0;
    this.active = false;
    this.snapshots = [];
    const { recordCanvas, recordCtx } = createRecordSurface(width, height);
    this.recordCanvas = recordCanvas;
    this.recordCtx = recordCtx;
  }

  start() {
    this.frameIndex = 0;
    this.snapshots = [];
    this.active = true;
  }

  captureFrame() {
    if (!this.active) return;

    blitToRecordSurface(this.canvas, this.recordCtx, this.width, this.height);

    const snapshot = document.createElement('canvas');
    snapshot.width = this.width;
    snapshot.height = this.height;
    snapshot.getContext('2d').drawImage(this.recordCanvas, 0, 0);

    this.snapshots.push({ index: this.frameIndex, canvas: snapshot });
    this.frameIndex += 1;
  }

  async stop() {
    if (!this.snapshots.length) return null;

    this.active = false;

    try {
      const zipEntries = {};
      for (const { index, canvas } of this.snapshots) {
        const blob = await new Promise((resolve, reject) => {
          canvas.toBlob((result) => {
            if (!result) {
              reject(new Error(`PNG frame capture failed (${frameFileName(index)})`));
              return;
            }
            resolve(result);
          }, 'image/png');
        });
        zipEntries[frameFileName(index)] = new Uint8Array(await blob.arrayBuffer());
      }

      const zipped = zipSync(zipEntries);
      return new Blob([zipped], { type: 'application/zip' });
    } catch (error) {
      console.error('PNG sequence packaging failed:', error);
      return null;
    } finally {
      this.snapshots = [];
      this.frameIndex = 0;
    }
  }
}

export function getRecordingDownloadName(loops, format, stamp = new Date().toISOString().replace(/[:.]/g, '-')) {
  if (format === 'png') {
    return `polyrig-${loops}loop-${stamp}-png.zip`;
  }

  return `polyrig-${loops}loop-${stamp}.mp4`;
}
