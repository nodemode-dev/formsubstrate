import { el, q, setClass, setHidden, setText, setTitle } from '../dom';
import { t } from '../i18n';
import { icon } from '../icons';
import type { EditorPrefs, ViewDoc } from '../review/views';
import { formatBytes, formatDuration, mediaInfo, mediaUrl, type MediaKind } from './media';

type ImageFit = 'fit' | 'actual';

let lastFit: ImageFit = 'fit';

const DASH = '-';

export class MediaTab implements ViewDoc {
  readonly root = el<HTMLElement>(`<div class="cv-media">
<div class="cv-media-bar">
<span class="cv-media-file"></span>
<div class="cv-media-tools">
<div class="cv-seg cv-media-fit" role="group">
<button class="cv-seg-btn" type="button" data-fit="fit">${icon('fitScreen', 14)}<span class="cv-media-fit-t"></span></button>
<button class="cv-seg-btn" type="button" data-fit="actual">${icon('actualSize', 14)}<span class="cv-media-actual-t"></span></button>
</div>
<button class="cv-wb-tool cv-media-refresh" type="button">${icon('refresh', 14)}</button>
</div>
</div>
<div class="cv-media-stage"></div>
<div class="cv-media-foot">
<span class="cv-media-dims cv-note"></span>
<span class="cv-media-size cv-note"></span>
<span class="cv-media-type cv-note"></span>
</div>
</div>`);
  private readonly stage = q(this.root, '.cv-media-stage');
  private readonly msg = el<HTMLElement>('<p class="cv-media-msg cv-note" hidden></p>');
  private readonly fitSeg = q(this.root, '.cv-media-fit');
  private readonly fitBtns = Array.from(this.root.querySelectorAll<HTMLButtonElement>('[data-fit]'));
  private readonly refreshBtn = q<HTMLButtonElement>(this.root, '.cv-media-refresh');
  private readonly dims = q(this.root, '.cv-media-dims');
  private readonly size = q(this.root, '.cv-media-size');
  private readonly type = q(this.root, '.cv-media-type');
  private media: HTMLImageElement | HTMLVideoElement | HTMLAudioElement | HTMLIFrameElement | null = null;
  private started = false;
  private disposed = false;
  private fit: ImageFit = lastFit;
  private seq = 0;
  private bytes = 0;
  private readonly watch: MutationObserver;

  constructor(private readonly path: string, private readonly kind: MediaKind) {
    setText(q(this.root, '.cv-media-file'), path);
    setText(q(this.root, '.cv-media-fit-t'), t('Fit'));
    setText(q(this.root, '.cv-media-actual-t'), t('100%'));
    setTitle(this.refreshBtn, t('Reload from disk'));
    this.refreshBtn.setAttribute('aria-label', t('Reload from disk'));
    this.root.dataset.kind = kind;
    setText(this.dims, DASH);
    setText(this.size, DASH);
    setText(this.type, kind);
    setClass(this.fitSeg, 'is-off', kind !== 'image');
    this.build();
    this.stage.append(this.msg);
    this.paintFit();
    for (const b of this.fitBtns) b.addEventListener('click', () => { this.fit = b.dataset.fit === 'actual' ? 'actual' : 'fit'; lastFit = this.fit; this.paintFit(); });
    this.refreshBtn.addEventListener('click', () => this.load(true));
    this.watch = new MutationObserver(() => { if (this.root.hidden) this.pause(); });
    this.watch.observe(this.root, { attributes: true, attributeFilter: ['hidden'] });
  }

  activate(): void {
    if (this.started) return;
    this.started = true;
    this.load(false);
  }

  save(): Promise<boolean> { return Promise.resolve(true); }

  setOptions(o: EditorPrefs): void { void o; }

  dispose(): void {
    this.disposed = true;
    this.watch.disconnect();
    this.pause();
    if (this.media instanceof HTMLVideoElement || this.media instanceof HTMLAudioElement) {
      this.media.removeAttribute('src');
      this.media.load();
    }
  }

  private pause(): void {
    if (this.media instanceof HTMLVideoElement || this.media instanceof HTMLAudioElement) this.media.pause();
  }

  private paintFit(): void {
    for (const b of this.fitBtns) {
      const on = b.dataset.fit === this.fit;
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
      setClass(b, 'is-on', on);
    }
    setClass(this.root, 'is-actual', this.fit === 'actual');
  }

  private build(): void {
    if (this.kind === 'image') {
      const view = el<HTMLElement>('<div class="cv-media-view"></div>');
      const img = document.createElement('img');
      img.className = 'cv-media-img';
      img.alt = this.path;
      img.decoding = 'async';
      img.draggable = false;
      view.append(img);
      this.stage.append(view);
      this.media = img;
    } else if (this.kind === 'video') {
      const v = document.createElement('video');
      v.className = 'cv-media-video';
      v.controls = true;
      v.preload = 'metadata';
      v.playsInline = true;
      this.stage.append(v);
      this.media = v;
    } else if (this.kind === 'audio') {
      const card = el<HTMLElement>(`<div class="cv-media-audio">${icon('audioWave', 40)}<span class="cv-media-audio-name"></span></div>`);
      setText(q(card, '.cv-media-audio-name'), this.path.slice(this.path.lastIndexOf('/') + 1));
      const a = document.createElement('audio');
      a.className = 'cv-media-audio-el';
      a.controls = true;
      a.preload = 'metadata';
      card.append(a);
      this.stage.append(card);
      this.media = a;
    } else {
      const f = document.createElement('iframe');
      f.className = 'cv-media-pdf';
      f.title = this.path;
      this.stage.append(f);
      this.media = f;
    }
  }

  private fail(text: string): void {
    setText(this.msg, text);
    setHidden(this.msg, false);
  }

  private load(reload: boolean): void {
    const media = this.media;
    if (!media || this.disposed) return;
    const seq = ++this.seq;
    setHidden(this.msg, true);
    void mediaInfo(this.path).then((info) => {
      if (seq !== this.seq || this.disposed) return;
      this.bytes = info.size;
      setText(this.size, formatBytes(info.size));
      setText(this.type, info.type);
      const src = mediaUrl(this.path, info.mtime);
      if (this.kind === 'pdf') {
        if (navigator.pdfViewerEnabled === false) { this.fail(t('This window has no built-in PDF viewer.')); return; }
        if (reload || (media as HTMLIFrameElement).getAttribute('src') !== src) (media as HTMLIFrameElement).src = src;
        setText(this.dims, DASH);
        return;
      }
      this.wire(media as HTMLImageElement | HTMLVideoElement | HTMLAudioElement, src, seq);
    }, (err: unknown) => {
      if (seq !== this.seq || this.disposed) return;
      this.fail(err instanceof Error ? err.message.replace(/^\d{3}\s*/, '') : t('Could not read this file.'));
    });
  }

  private wire(media: HTMLImageElement | HTMLVideoElement | HTMLAudioElement, src: string, seq: number): void {
    if (media instanceof HTMLImageElement) {
      if (media.getAttribute('src') === src && media.complete && media.naturalWidth > 0) return;
      media.onload = () => {
        if (seq !== this.seq) return;
        setText(this.dims, media.naturalWidth > 0 ? `${media.naturalWidth} × ${media.naturalHeight}` : DASH);
        setClass(this.root, 'is-ready', true);
      };
      media.onerror = () => { if (seq === this.seq) this.fail(t('This image could not be displayed.')); };
      media.src = src;
      return;
    }
    media.onloadedmetadata = () => {
      if (seq !== this.seq) return;
      const d = formatDuration(media.duration);
      if (media instanceof HTMLVideoElement) setText(this.dims, `${media.videoWidth} × ${media.videoHeight}${d ? `  ·  ${d}` : ''}`);
      else setText(this.dims, d || DASH);
      setClass(this.root, 'is-ready', true);
    };
    media.onerror = () => { if (seq === this.seq) this.fail(t('This window cannot play this file; the format may need a codec it does not have.')); };
    media.src = src;
  }
}
