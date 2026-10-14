import fs from 'fs';
import path from 'path';
import { SOUNDS_DIR, ASSET_CDN_URL } from '../config/constants';
import { SoundCatalogItem } from '../types';

export interface SoundIndex {
  byFileName: Map<string, SoundCatalogItem>;
  byRelativePath: Map<string, SoundCatalogItem>;
  allSounds: SoundCatalogItem[];
}

// Cache thời lượng âm thanh (giây) từ catalog.json
export const durationCache = new Map<string, number>();

// Cache index tra cứu file âm thanh theo tên file hoặc relativePath (pack/fileName)
let soundIndexCache: SoundIndex | null = null;

/**
 * Tạo URL truy cập file âm thanh trên Cloudflare R2 CDN
 */
export function getSoundUrl(relativePath?: string | null): string {
  const cleanRel = String(relativePath || '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '');
  const encodedPath = cleanRel
    .split('/')
    .map(part => encodeURIComponent(part))
    .join('/');
  return `${ASSET_CDN_URL}/${encodedPath}`;
}

/**
 * Nạp danh mục 251 âm thanh và thời lượng đã tính sẵn từ sounds/catalog.json
 */
export function buildSoundIndex(forceRebuild = false): SoundIndex {
  if (soundIndexCache && !forceRebuild) {
    return soundIndexCache;
  }

  const byFileName = new Map<string, SoundCatalogItem>();
  const byRelativePath = new Map<string, SoundCatalogItem>();
  const allSounds: SoundCatalogItem[] = [];

  const catalogPath = path.join(SOUNDS_DIR, 'catalog.json');
  if (fs.existsSync(catalogPath)) {
    try {
      const cat = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
      const catalogSounds = cat.sounds || [];
      for (const s of catalogSounds) {
        if (!s.relativePath) continue;
        const item: SoundCatalogItem = {
          id: s.id || path.parse(s.fileName).name,
          pack: s.pack || 'general',
          fileName: s.fileName,
          relativePath: s.relativePath,
          url: getSoundUrl(s.relativePath)
        };
        if (typeof s.duration === 'number') {
          const clamped = parseFloat(Math.max(1.5, Math.min(12.0, s.duration)).toFixed(1));
          durationCache.set(s.relativePath, clamped);
          durationCache.set(s.fileName, clamped);
        }
        byRelativePath.set(s.relativePath, item);
        if (!byFileName.has(s.fileName)) {
          byFileName.set(s.fileName, item);
        }
        allSounds.push(item);
      }
    } catch {
      // Bỏ qua nếu catalog.json lỗi
    }
  }

  soundIndexCache = { byFileName, byRelativePath, allSounds };
  return soundIndexCache;
}

/**
 * Tra cứu thông tin file âm thanh từ tên file ("cat-two.mp3") hoặc đường dẫn tương đối ("animals/cat-two.mp3")
 */
export function resolveSoundFile(fileNameOrRelativePath?: string | null): SoundCatalogItem | null {
  if (!fileNameOrRelativePath) return null;
  const normalized = String(fileNameOrRelativePath).replace(/\\/g, '/').replace(/^\/+/, '');
  const index = buildSoundIndex();

  if (index.byRelativePath.has(normalized)) {
    return index.byRelativePath.get(normalized) || null;
  }
  const base = path.basename(normalized);
  if (index.byFileName.has(base)) {
    return index.byFileName.get(base) || null;
  }
  const strippedBase = base.replace(/^(animals|anime|meme|voices|voice1|robots|yankee|everyday|melody|funny|signals|space|vehicles|common)_/i, '');
  if (strippedBase !== base && index.byFileName.has(strippedBase)) {
    return index.byFileName.get(strippedBase) || null;
  }

  return null;
}

/**
 * Lấy danh sách toàn bộ file âm thanh theo từng pack từ catalog.json
 */
export function getAllDownloadedSounds(packFilter: string | null = null): SoundCatalogItem[] {
  const index = buildSoundIndex();
  let list = index.allSounds;
  if (packFilter) {
    const target = String(packFilter).toLowerCase();
    list = list.filter(s => s.pack.toLowerCase() === target);
  }
  return list.map(s => ({
    id: s.id,
    pack: s.pack,
    fileName: s.fileName,
    relativePath: s.relativePath,
    name: s.id.replace(/[-_]/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
    url: s.url
  }));
}

/**
 * Lấy thời lượng thực tế (giây) của file âm thanh từ catalog.json
 */
export function getSoundDuration(fileNameOrRelativePath?: string | null): number {
  if (!fileNameOrRelativePath) return 4.0;
  if (durationCache.has(fileNameOrRelativePath)) {
    return durationCache.get(fileNameOrRelativePath) ?? 4.0;
  }

  const resolved = resolveSoundFile(fileNameOrRelativePath);
  if (resolved) {
    if (durationCache.has(resolved.relativePath)) {
      return durationCache.get(resolved.relativePath) ?? 4.0;
    }
    if (durationCache.has(resolved.fileName)) {
      return durationCache.get(resolved.fileName) ?? 4.0;
    }
  }

  return 4.0;
}
