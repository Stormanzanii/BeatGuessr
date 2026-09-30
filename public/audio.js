export const CLIP_LENGTHS = [0.1, 0.5, 2, 8, 15];

export class ClipPlayer {
  constructor(onProgress, onPlaying) {
    this.onProgress = onProgress;
    this.onPlaying = onPlaying;
    this.volume = 0.6;
    this.generation = 0;
  }
  async unlock() {
    if (!this.context || this.context.state === "closed") {
      this.context = new AudioContext();
      this.gain = this.context.createGain();
      this.gain.gain.value = this.volume;
      this.gain.connect(this.context.destination);
    }
    if (this.context.state !== "running") await this.context.resume();
  }
  async decode(bytes) {
    // Decoding does not start playback or require an autoplay exemption.
    if (!this.context) {
      this.context = new AudioContext();
      this.gain = this.context.createGain();
      this.gain.gain.value = this.volume;
      this.gain.connect(this.context.destination);
    }
    return this.context.decodeAudioData(bytes.slice(0));
  }
  setBuffer(buffer, randomStart = false) {
    this.stop();
    this.buffer = buffer;
    this.setStart(randomStart);
  }
  setStart(randomStart) {
    this.stop();
    this.offset = randomStart
      ? Math.random() * Math.max(0, this.buffer.duration - 15)
      : 0;
  }
  setVolume(value) {
    this.volume = value;
    if (this.gain)
      this.gain.gain.setTargetAtTime(value, this.context.currentTime, 0.015);
  }
  async play(seconds) {
    const request = ++this.generation;
    await this.unlock();
    if (request !== this.generation || !this.buffer) return;
    this.stop(false);
    const duration = Math.min(seconds, this.buffer.duration - this.offset);
    if (duration <= 0)
      throw new Error("No audio is available at this starting point.");
    const source = this.context.createBufferSource();
    source.buffer = this.buffer;
    const envelope = this.context.createGain();
    source.connect(envelope);
    envelope.connect(this.gain);
    const at = this.context.currentTime + 0.02;
    const fade = Math.min(0.003, duration / 10);
    envelope.gain.setValueAtTime(0, at);
    envelope.gain.linearRampToValueAtTime(1, at + fade);
    envelope.gain.setValueAtTime(1, at + duration - fade);
    envelope.gain.linearRampToValueAtTime(0, at + duration);
    this.source = source;
    this.playing = true;
    this.lastSchedule = {
      seconds: duration,
      offset: this.offset,
      at,
      endsAt: at + duration,
    };
    this.onPlaying(true);
    source.onended = () => {
      source.disconnect();
      envelope.disconnect();
      if (this.source !== source) return;
      this.source = null;
      this.playing = false;
      cancelAnimationFrame(this.frame);
      this.onProgress(1);
      this.onPlaying(false);
    };
    // The audio clock enforces the duration even when animation frames are throttled.
    source.start(at, this.offset, duration);
    const animate = () => {
      if (this.source !== source) return;
      this.onProgress(
        Math.max(0, Math.min(1, (this.context.currentTime - at) / duration)),
      );
      this.frame = requestAnimationFrame(animate);
    };
    animate();
  }
  stop(invalidate = true) {
    if (invalidate) this.generation++;
    cancelAnimationFrame(this.frame);
    const source = this.source;
    this.source = null;
    if (source) {
      try {
        source.stop();
      } catch {}
    }
    this.playing = false;
    this.onProgress(0);
    this.onPlaying(false);
  }
}
