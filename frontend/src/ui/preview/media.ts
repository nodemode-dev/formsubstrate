import { request } from '../../io/api';

export type MediaKind = 'image' | 'video' | 'audio' | 'pdf';

const KINDS: Record<MediaKind, readonly string[]> = {
  image: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif'],
  video: ['mp4', 'm4v', 'webm', 'mov', 'mkv', 'ogv'],
  audio: ['mp3', 'wav', 'ogg', 'oga', 'opus', 'flac', 'm4a', 'aac'],
  pdf: ['pdf'],
};

const BY_EXT = new Map<string, MediaKind>();
for (const kind of Object.keys(KINDS) as MediaKind[]) for (const ext of KINDS[kind]) BY_EXT.set(ext, kind);

export interface MediaInfo { path: string; kind: MediaKind; type: string; size: number; mtime: number }

export function mediaKindOf(path: string): MediaKind | null {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  return dot > 0 ? BY_EXT.get(name.slice(dot + 1).toLowerCase()) ?? null : null;
}

export function mediaUrl(path: string, version?: number): string {
  const v = version === undefined ? '' : `&v=${encodeURIComponent(String(version))}`;
  return `/api/media/raw?path=${encodeURIComponent(path)}${v}`;
}

export function mediaInfo(path: string): Promise<MediaInfo> {
  return request<MediaInfo>(`/api/media/info?path=${encodeURIComponent(path)}`);
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = n / 1024, i = 0;
  while (value >= 1024 && i < units.length - 1) { value /= 1024; i++; }
  return `${value >= 100 ? Math.round(value) : value.toFixed(1)} ${units[i]}`;
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '';
  const s = Math.round(seconds), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  const two = (x: number): string => String(x).padStart(2, '0');
  return h > 0 ? `${h}:${two(m)}:${two(r)}` : `${m}:${two(r)}`;
}
