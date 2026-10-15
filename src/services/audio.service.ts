import fs from 'fs';
import path from 'path';
import { SOUNDS_DIR, ASSET_CDN_URL } from '../config/constants';
import {
  BotAudioEffects,
  BotDifficulty,
  BotNoiseType,
  ClientMetrics,
  SoundCatalogItem
} from '../types';

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
  const strippedBase = base.replace(
    /^(animals|anime|meme|voices|voice1|robots|yankee|everyday|melody|funny|signals|space|vehicles|common)_/i,
    ''
  );
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
 * Chuẩn hóa mode độ khó của AI Bot:
 * - Yếu: 'EASY' | 'WEAK' | 'YEU' | 'YẾU' -> 'EASY'
 * - Thông thường: 'NORMAL' | 'MEDIUM' | 'THONG_THUONG' | 'THÔNG THƯỜNG' -> 'NORMAL'
 * - Khó: 'HARD' | 'DIFFICULT' | 'KHO' | 'KHÓ' -> 'HARD'
 */
export function normalizeBotDifficulty(input?: string | null): BotDifficulty {
  const raw = String(input || 'NORMAL').trim().toUpperCase();
  if (raw === 'EASY' || raw === 'WEAK' || raw === 'YEU' || raw === 'YẾU' || raw === 'LOW') {
    return 'EASY';
  }
  if (raw === 'HARD' || raw === 'DIFFICULT' || raw === 'KHO' || raw === 'KHÓ' || raw === 'HIGH' || raw === 'PRO') {
    return 'HARD';
  }
  return 'NORMAL';
}

/**
 * Tạo chuỗi số giả ngẫu nhiên tất định (deterministic PRNG) từ seed để mỗi Bot có màu giọng riêng
 */
function createSeededRandom(seed: number): () => number {
  let state = (Math.abs(Math.floor(seed)) || 1) % 2147483647;
  if (state <= 0) state += 2147483646;
  return () => {
    state = (state * 16807) % 2147483647;
    return (state - 1) / 2147483646;
  };
}

/**
 * Sinh thông số hiệu ứng âm thanh người thật (Client-Side DSP Recipe `BotAudioEffects` + `ClientMetrics`)
 * từ chính `targetSound` (sound gốc) theo 3 mode của Bot với chi phí CPU/RAM Server = 0%:
 * - EASY (Yếu): Lệch cao độ & nhịp độ rõ (trong quãng giọng người), vào nhịp trễ, có tiếng lấy hơi & ngập ngừng tự nhiên.
 * - NORMAL (Thông thường): Biến đổi vừa phải, âm sắc micro điện thoại và âm nền phòng tự nhiên.
 * - HARD (Khó): Bám rất sát sound gốc, bắt nhịp nhanh, thu âm micro trong trẻo.
 *
 * Client sử dụng trực tiếp file `targetSound` đã tải sẵn ở pha `PLAYING_SAMPLE` và áp bộ lọc thời gian thực
 * theo đúng công thức `effects` mà không cần Server giải mã MP3 hay stream file WAV.
 */
export function transformTargetSoundForBot(
  targetFileNameOrPath?: string | null,
  packId?: string | null,
  difficultyInput: BotDifficulty | string = 'NORMAL',
  botSeed = 0
): {
  sound: SoundCatalogItem;
  pitch: number;
  speed: number;
  effects: BotAudioEffects;
  clientPlaybackUrl: string;
  mimeType: string;
  metrics: ClientMetrics;
} {
  const difficulty = normalizeBotDifficulty(difficultyInput);
  buildSoundIndex();
  const targetResolved = resolveSoundFile(targetFileNameOrPath);
  const targetRel = targetResolved
    ? targetResolved.relativePath
    : String(targetFileNameOrPath || 'animals/cat-two.mp3')
        .replace(/\\/g, '/')
        .replace(/^\/+/, '');
  const targetFile = targetResolved ? targetResolved.fileName : path.basename(targetRel);
  const targetPack = (packId || (targetResolved && targetResolved.pack) || 'animals').toLowerCase();

  // Luôn sử dụng CHÍNH SOUND GỐC làm nền tảng để Client biến đổi
  const baseSound: SoundCatalogItem = targetResolved || {
    id: path.parse(targetFile).name || 'sample',
    pack: targetPack,
    fileName: targetFile,
    relativePath: targetRel,
    url: getSoundUrl(targetRel)
  };

  const rand = createSeededRandom(
    botSeed * 131 + targetFile.length * 17 + (difficulty === 'HARD' ? 3 : difficulty === 'NORMAL' ? 7 : 13)
  );
  const direction = rand() >= 0.5 ? 1 : -1;
  const scoopSign = rand() >= 0.5 ? -1 : 1;

  let pitch = 1.0;
  let speed = 1.0;
  let pitchScoopCents = -15;
  let vibratoRateHz = 1.6;
  let noiseLevel = 0.04;
  let noiseType: BotNoiseType = 'room_ambience';
  let inhaleBreathMs = 55;
  let inhaleBreathGain = 0.018;
  let distortion = 0.04;
  let tremoloDepth = 0.04;
  let dropoutCount = 0;
  let startDelayMs = 80;
  let bandpassHz: [number, number] = [220, 4200];
  let vocalPresenceHz = 1450;
  let vocalPresenceGainDb = 2.8;

  if (difficulty === 'HARD') {
    // Mode KHÓ: Bám rất sát sound gốc, âm sắc micro smartphone chất lượng cao
    const pitchDelta = 0.01 + rand() * 0.022; // lệch 1% .. 3.2%
    const speedDelta = 0.01 + rand() * 0.02;  // lệch 1% .. 3.0%
    pitch = Number((1.0 + direction * pitchDelta).toFixed(2));
    speed = Number((1.0 - direction * speedDelta).toFixed(2));
    pitchScoopCents = Math.round(scoopSign * (8 + rand() * 10)); // ±8 .. 18 cents
    vibratoRateHz = Number((1.4 + rand() * 0.6).toFixed(2));     // 1.4 .. 2.0 Hz
    noiseLevel = Number((0.008 + rand() * 0.012).toFixed(3));
    noiseType = 'clean_mic';
    inhaleBreathMs = Math.round(15 + rand() * 20);               // 15ms .. 35ms
    inhaleBreathGain = Number((0.006 + rand() * 0.006).toFixed(3));
    distortion = Number((0.01 + rand() * 0.018).toFixed(3));
    tremoloDepth = Number((0.012 + rand() * 0.018).toFixed(3));
    dropoutCount = 0;
    startDelayMs = Math.round(15 + rand() * 25);                 // 15ms .. 40ms
    bandpassHz = [150, 6000];
    vocalPresenceHz = 1450;
    vocalPresenceGainDb = 1.8;
  } else if (difficulty === 'NORMAL') {
    // Mode THÔNG THƯỜNG: Lệch cao độ/nhịp độ tự nhiên như người chơi trung bình thu qua điện thoại
    const pitchDelta = 0.045 + rand() * 0.045; // lệch 4.5% .. 9%
    const speedDelta = 0.04 + rand() * 0.045;  // lệch 4% .. 8.5%
    pitch = Number((1.0 + direction * pitchDelta).toFixed(2));
    speed = Number((1.0 + direction * speedDelta * 0.8).toFixed(2));
    pitchScoopCents = Math.round(scoopSign * (18 + rand() * 16)); // ±18 .. 34 cents
    vibratoRateHz = Number((1.5 + rand() * 0.7).toFixed(2));      // 1.5 .. 2.2 Hz
    noiseLevel = Number((0.032 + rand() * 0.022).toFixed(3));
    noiseType = 'room_ambience';
    inhaleBreathMs = Math.round(45 + rand() * 25);                // 45ms .. 70ms
    inhaleBreathGain = Number((0.014 + rand() * 0.008).toFixed(3));
    distortion = Number((0.042 + rand() * 0.03).toFixed(3));
    tremoloDepth = Number((0.035 + rand() * 0.025).toFixed(3));
    dropoutCount = rand() > 0.65 ? 1 : 0;
    startDelayMs = Math.round(70 + rand() * 70);                  // 70ms .. 140ms
    bandpassHz = [220, 4200];
    vocalPresenceHz = 1400;
    vocalPresenceGainDb = 2.8;
  } else {
    // Mode YẾU (EASY): Lệch tông & nhịp trong ngưỡng giọng người thật (không biến dạng thành âm thanh kinh dị)
    const pitchDelta = 0.11 + rand() * 0.07; // lệch 11% .. 18%
    const speedDelta = 0.10 + rand() * 0.07; // lệch 10% .. 17%
    pitch = Number((1.0 + direction * pitchDelta).toFixed(2));
    speed = Number((1.0 - direction * speedDelta).toFixed(2));
    pitchScoopCents = Math.round(scoopSign * (28 + rand() * 22)); // ±28 .. 50 cents
    vibratoRateHz = Number((1.6 + rand() * 0.8).toFixed(2));      // 1.6 .. 2.4 Hz
    noiseLevel = Number((0.075 + rand() * 0.045).toFixed(3));
    noiseType = 'mic_static_and_breath';
    inhaleBreathMs = Math.round(65 + rand() * 25);                // 65ms .. 90ms
    inhaleBreathGain = Number((0.024 + rand() * 0.012).toFixed(3));
    distortion = Number((0.095 + rand() * 0.055).toFixed(3));
    tremoloDepth = Number((0.075 + rand() * 0.045).toFixed(3));
    dropoutCount = rand() > 0.45 ? 1 : 2;
    startDelayMs = Math.round(180 + rand() * 160);                // 180ms .. 340ms
    bandpassHz = [280, 3100];
    vocalPresenceHz = 1150;
    vocalPresenceGainDb = 3.4;
  }

  const pitchSemitones = Number((12 * Math.log2(pitch)).toFixed(2));
  const baseSoundUrl = baseSound.url || getSoundUrl(baseSound.relativePath);

  const effects: BotAudioEffects = {
    difficulty,
    baseSoundUrl,
    botSeed,
    pitch,
    pitchSemitones,
    speed,
    pitchScoopCents,
    vibratoRateHz,
    noiseLevel,
    noiseType,
    inhaleBreathMs,
    inhaleBreathGain,
    distortion,
    tremoloDepth,
    dropoutCount,
    startDelayMs,
    bandpassHz,
    vocalPresenceHz,
    vocalPresenceGainDb
  };

  // URL định danh riêng cho từng Bot trỏ về CDN sound gốc kèm query params DSP để Client nhận diện nhanh
  const clientPlaybackUrl = `${baseSoundUrl}?bot=1&d=${difficulty}&p=${pitch}&s=${speed}&delay=${startDelayMs}&seed=${botSeed}`;

  // Tính toán chỉ số ClientMetrics trực tiếp từ độ lệch so với sound gốc
  let matchPct: number;
  let rhythmScore: number;
  let energyScore: number;
  let activeRatio: number;

  if (difficulty === 'HARD') {
    matchPct = Math.round(85 + rand() * 11);      // 85 .. 96
    rhythmScore = Math.round(84 + rand() * 12);   // 84 .. 96
    energyScore = Math.round(85 + rand() * 12);   // 85 .. 97
    activeRatio = Number((0.78 + rand() * 0.16).toFixed(2));
  } else if (difficulty === 'NORMAL') {
    matchPct = Math.round(70 + rand() * 15);      // 70 .. 85
    rhythmScore = Math.round(68 + rand() * 16);   // 68 .. 84
    energyScore = Math.round(71 + rand() * 15);   // 71 .. 86
    activeRatio = Number((0.62 + rand() * 0.18).toFixed(2));
  } else {
    matchPct = Math.round(52 + rand() * 18);      // 52 .. 70
    rhythmScore = Math.round(48 + rand() * 20);   // 48 .. 68
    energyScore = Math.round(50 + rand() * 20);   // 50 .. 70
    activeRatio = Number((0.38 + rand() * 0.22).toFixed(2));
  }

  const metrics: ClientMetrics = {
    matchPct,
    rhythmScore,
    energyScore,
    activeRatio
  };

  return {
    sound: baseSound,
    pitch,
    speed,
    effects,
    clientPlaybackUrl,
    mimeType: 'audio/mpeg',
    metrics
  };
}

/**
 * Hàm tương thích ngược: Biến đổi trực tiếp từ `targetSound` theo độ khó của Bot
 */
export function pickBotVariantSound(
  targetFileNameOrPath?: string | null,
  packId?: string | null,
  difficulty: BotDifficulty | string = 'NORMAL',
  _excludeRelativePaths: Set<string> = new Set(),
  botSeed = 0
): ReturnType<typeof transformTargetSoundForBot> {
  return transformTargetSoundForBot(targetFileNameOrPath, packId, difficulty, botSeed);
}
