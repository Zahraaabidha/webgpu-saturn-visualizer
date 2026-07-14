/**
 * Background music: looping <audio> element with volume/mute controls.
 * Browsers block autoplay with sound until the user interacts with the page,
 * so playback is kicked off on the first pointer/key event.
 */

export class BackgroundAudio {
  constructor(src, { volume = 0.4 } = {}) {
    this.el = new Audio(src);
    this.el.loop = true;
    this.el.volume = volume;
    this.el.preload = 'auto';

    this._startOnGesture = () => {
      this.el.play().catch(() => {});
      window.removeEventListener('pointerdown', this._startOnGesture);
      window.removeEventListener('keydown', this._startOnGesture);
    };
    window.addEventListener('pointerdown', this._startOnGesture);
    window.addEventListener('keydown', this._startOnGesture);
  }

  setVolume(v) {
    this.el.volume = Math.min(1, Math.max(0, v));
  }

  setMuted(muted) {
    this.el.muted = muted;
  }
}
