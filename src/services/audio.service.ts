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

/**
 * Chọn 1 file âm thanh biến thể (khác với file gốc `targetSound`) nhưng cùng luồng chủ đề/thời lượng
 * dành riêng cho từng AI Bot, đảm bảo Bot không dùng lại y nguyên file gốc và mỗi Bot trong phòng có 1 sound riêng biệt!
 */
export function pickBotVariantSound(
  targetFileNameOrPath?: string | null,
  packId?: string | null,
  difficulty: 'EASY' | 'NORMAL' | 'HARD' = 'NORMAL',
  excludeRelativePaths: Set<string> = new Set(),
  botSeed = 0
): {
  sound: SoundCatalogItem;
  pitch: number;
  speed: number;
} {
  const index = buildSoundIndex();
  const targetResolved = resolveSoundFile(targetFileNameOrPath);
  const targetRel = targetResolved ? targetResolved.relativePath : String(targetFileNameOrPath || '');
  const targetFile = targetResolved ? targetResolved.fileName : path.basename(targetRel);
  const targetPack = (packId || (targetResolved && targetResolved.pack) || 'animals').toLowerCase();
  const targetDur = getSoundDuration(targetRel || targetFile);

  // Tách từ khóa ngữ nghĩa từ tên file gốc (VD: "cat-two.mp3" -> ["cat", "two"])
  const targetTokens = path
    .parse(targetFile)
    .name.toLowerCase()
    .split(/[-_]+/)
    .filter(t => t.length >= 3 && !['sound', 'voice', 'animals', 'meme', 'anime'].includes(t));

  // 1. Lấy tất cả các sound khác với sound gốc và chưa được Bot khác chọn trong vòng này
  const allOtherSounds = index.allSounds.filter(
    s =>
      s.relativePath !== targetRel &&
      s.fileName !== targetFile &&
      !excludeRelativePaths.has(s.relativePath)
  );

  const samePackSounds = allOtherSounds.filter(s => s.pack.toLowerCase() === targetPack);
  const pool = samePackSounds.length > 0 ? samePackSounds : allOtherSounds;

  // Chấm điểm mức độ tương đồng (flow theo sound gốc) cho từng ứng viên trong pool
  const scoredCandidates = pool.map(candidate => {
    const candDur = getSoundDuration(candidate.relativePath);
    const durDiff = Math.abs(candDur - targetDur);
    const candName = path.parse(candidate.fileName).name.toLowerCase();
    const hasSharedToken = targetTokens.some(tok => candName.includes(tok));
    // Điểm tương đồng càng cao thì càng sát với sound gốc (cùng từ khóa + thời lượng gần bằng nhau)
    const similarityScore = (hasSharedToken ? 50 : 0) - durDiff * 5;
    return { candidate, similarityScore, durDiff };
  });

  // Sắp xếp từ giống nhất (flow sát nhất) đến khác biệt nhất
  scoredCandidates.sort((a, b) => b.similarityScore - a.similarityScore);

  let chosen: SoundCatalogItem;
  if (scoredCandidates.length === 0) {
    chosen = targetResolved || index.allSounds[0];
  } else if (difficulty === 'HARD') {
    // Bot HARD: chọn các sound có nhịp/chủ đề sát nhất với sound gốc (top đầu)
    const topSlice = scoredCandidates.slice(0, Math.min(3, scoredCandidates.length));
    chosen = topSlice[Math.abs(botSeed) % topSlice.length].candidate;
  } else if (difficulty === 'NORMAL') {
    // Bot NORMAL: chọn các sound cùng pack ở nhóm giữa
    const midSlice = scoredCandidates.slice(0, Math.min(6, scoredCandidates.length));
    chosen = midSlice[Math.abs(botSeed + 1) % midSlice.length].candidate;
  } else {
    // Bot EASY: chọn các sound biến tấu hài hước/lệch nhịp hơn trong cùng pack (hoặc pack voices/funny)
    const tailSlice = scoredCandidates.slice(Math.max(0, scoredCandidates.length - 5));
    chosen = tailSlice[Math.abs(botSeed + 2) % tailSlice.length].candidate;
  }

  // Tạo thông số biến điệu giọng (pitch & speed) đặc trưng theo độ khó của Bot
  let pitch = 1.0;
  let speed = 1.0;
  const jitter = ((Math.abs(botSeed) % 7) - 3) * 0.02; // -0.06 .. +0.06
  if (difficulty === 'HARD') {
    pitch = Number((0.97 + jitter).toFixed(2));
    speed = Number((0.98 - jitter * 0.5).toFixed(2));
  } else if (difficulty === 'NORMAL') {
    pitch = Number((1.06 + jitter).toFixed(2));
    speed = Number((1.04 + jitter * 0.5).toFixed(2));
  } else {
    pitch = Number((1.15 + jitter).toFixed(2));
    speed = Number((0.9 + jitter * 0.5).toFixed(2));
  }

  return { sound: chosen, pitch, speed };
}
