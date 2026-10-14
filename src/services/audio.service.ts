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
 * Tạo chuỗi số giả ngẫu nhiên tất định (deterministic PRNG) từ seed để mỗi Bot có hiệu ứng/tạp âm riêng
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
 * Tổng hợp Buffer WAV (PCM 16-bit Mono, 8000 Hz) mô phỏng sound gốc đã qua biến đổi (pitch, speed)
 * và trộn thêm tạp âm (white/pink noise, mic breath, crackle/clipping, ngắt quãng) như 1 user thu âm thật
 */
function synthesizeTransformedSoundWav(
  baseFileName: string,
  durationSec: number,
  effects: BotAudioEffects,
  botSeed: number
): Buffer {
  const sampleRate = 8000;
  const clampedDuration = Math.max(1.2, Math.min(4.0, durationSec / Math.max(0.7, effects.speed)));
  const numSamples = Math.floor(sampleRate * clampedDuration);
  const dataSize = numSamples * 2;
  const buffer = Buffer.alloc(44 + dataSize);

  // Ghi WAV Header (44 bytes)
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16); // PCM chunk size
  buffer.writeUInt16LE(1, 20);  // AudioFormat = 1 (PCM)
  buffer.writeUInt16LE(1, 22);  // NumChannels = 1 (Mono)
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28); // ByteRate
  buffer.writeUInt16LE(2, 32);  // BlockAlign
  buffer.writeUInt16LE(16, 34); // BitsPerSample = 16
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);

  // Rút trích đặc trưng tần số cơ bản (F0) từ tên file gốc để giữ "hồn" của sound gốc
  let nameHash = 0;
  for (let i = 0; i < baseFileName.length; i++) {
    nameHash = (nameHash * 31 + baseFileName.charCodeAt(i)) & 0x7fffffff;
  }
  const baseF0 = 180 + (nameHash % 260); // 180Hz .. 440Hz
  const shiftedF0 = baseF0 * effects.pitch;
  const rand = createSeededRandom(botSeed * 997 + nameHash);

  const delaySamples = Math.floor((effects.startDelayMs / 1000) * sampleRate);
  let pinkState = 0;
  let prevFiltered = 0;
  let phase = 0;

  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;

    // 1. Tạo tạp âm nền (White + Pink Noise + Tiếng thở/sôi mic)
    const white = rand() * 2 - 1;
    pinkState = 0.92 * pinkState + 0.08 * white;
    const crackle = rand() < effects.distortion * 0.08 ? (rand() * 2 - 1) * 0.9 : 0;
    const noiseSample = (pinkState * 0.7 + white * 0.3) * effects.noiseLevel + crackle;

    if (i < delaySamples) {
      // Khoảng trễ đầu file chỉ có tiếng ồn nền micro
      const delayedVal = Math.max(-1, Math.min(1, noiseSample * 0.6));
      buffer.writeInt16LE(Math.round(delayedVal * 32767), 44 + i * 2);
      continue;
    }

    // 2. Đường bao âm lượng (Envelope) & hiệu ứng hụt hơi/ngắt quãng (Dropouts)
    const activeTime = (i - delaySamples) / Math.max(1, numSamples - delaySamples);
    let envelope = Math.sin(Math.min(1, activeTime) * Math.PI);
    envelope *= 0.75 + 0.25 * Math.sin(2 * Math.PI * (2.5 * effects.speed) * t + (nameHash % 7));

    if (effects.dropoutCount > 0) {
      for (let d = 1; d <= effects.dropoutCount; d++) {
        const center = d / (effects.dropoutCount + 1);
        if (Math.abs(activeTime - center) < 0.045) {
          envelope *= 0.12; // Hụt hơi / ngắt quãng giữa chừng
        }
      }
    }

    // 3. Độ rung giọng (Tremolo & Pitch Wobble)
    const tremolo = 1 - effects.tremoloDepth * 0.5 * (1 + Math.sin(2 * Math.PI * 5.5 * t));
    const freqMod =
      shiftedF0 *
      (1 + 0.08 * Math.sin(2 * Math.PI * 1.8 * t * effects.speed) + effects.tremoloDepth * 0.12 * Math.sin(2 * Math.PI * 6.2 * t));

    phase += (2 * Math.PI * freqMod) / sampleRate;

    // Tổ hợp sóng hài (Harmonics) của sound gốc
    let signal =
      0.6 * Math.sin(phase) +
      0.25 * Math.sin(phase * 2 + 0.3) +
      0.15 * Math.sin(phase * 3 + 0.7);

    signal = signal * envelope * tremolo;

    // 4. Biến dạng / Rè mic (Soft clipping distortion) + Trộn tạp âm
    const drive = 1 + effects.distortion * 3.2;
    let mixed = Math.tanh(signal * drive) * (1 - effects.noiseLevel * 0.35) + noiseSample;

    // 5. Bộ lọc thông dải đơn giản mô phỏng micro
    const alpha = Math.min(0.95, Math.max(0.15, effects.bandpassHz[1] / (sampleRate * 0.8)));
    mixed = prevFiltered + alpha * (mixed - prevFiltered);
    prevFiltered = mixed;

    const clamped = Math.max(-1, Math.min(1, mixed));
    buffer.writeInt16LE(Math.round(clamped * 32767), 44 + i * 2);
  }

  return buffer;
}

/**
 * Biến đổi trực tiếp từ `targetSound` (sound gốc) theo 3 mode của Bot:
 * - EASY (Yếu): Biến đổi nhiều (lệch cao độ & tốc độ mạnh), thêm nhiều tạp âm/tiếng ồn, rè mic, vào nhịp trễ và đứt quãng.
 * - NORMAL (Thông thường): Biến đổi vừa phải, có tạp âm nền phòng tự nhiên và lệch nhẹ cao độ/nhịp độ.
 * - HARD (Khó): Biến đổi rất ít (bám sát sound gốc), tạp âm cực thấp, bắt nhịp chuẩn xác.
 * Đồng thời sinh ra `audioBuffer` + `audioBase64` và `metrics` thực tế để Bot nộp bài & chấm điểm y hệt 1 User thông thường.
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
  audioBuffer: Buffer;
  audioBase64: string;
  mimeType: string;
  metrics: ClientMetrics;
} {
  const difficulty = normalizeBotDifficulty(difficultyInput);
  const index = buildSoundIndex();
  const targetResolved = resolveSoundFile(targetFileNameOrPath);
  const targetRel = targetResolved
    ? targetResolved.relativePath
    : String(targetFileNameOrPath || 'animals/cat-two.mp3').replace(/\\/g, '/').replace(/^\/+/, '');
  const targetFile = targetResolved ? targetResolved.fileName : path.basename(targetRel);
  const targetPack = (packId || (targetResolved && targetResolved.pack) || 'animals').toLowerCase();

  // Luôn sử dụng CHÍNH SOUND GỐC làm nền tảng để biến đổi (không lấy sound khác)
  const baseSound: SoundCatalogItem = targetResolved || {
    id: path.parse(targetFile).name || 'sample',
    pack: targetPack,
    fileName: targetFile,
    relativePath: targetRel,
    url: getSoundUrl(targetRel)
  };

  const targetDur = getSoundDuration(baseSound.relativePath || baseSound.fileName);
  const rand = createSeededRandom(botSeed * 131 + targetFile.length * 17 + (difficulty === 'HARD' ? 3 : difficulty === 'NORMAL' ? 7 : 13));
  const direction = rand() >= 0.5 ? 1 : -1;

  let pitch = 1.0;
  let speed = 1.0;
  let noiseLevel = 0.05;
  let noiseType: BotNoiseType = 'room_ambience';
  let distortion = 0.05;
  let tremoloDepth = 0.08;
  let dropoutCount = 0;
  let startDelayMs = 80;
  let bandpassHz: [number, number] = [250, 3600];

  if (difficulty === 'HARD') {
    // Mode KHÓ: Biến đổi rất ít, bám cực sát sound gốc, tạp âm cực thấp
    const pitchDelta = 0.01 + rand() * 0.025; // lệch 1% .. 3.5%
    const speedDelta = 0.01 + rand() * 0.02;  // lệch 1% .. 3%
    pitch = Number((1.0 + direction * pitchDelta).toFixed(2));
    speed = Number((1.0 - direction * speedDelta).toFixed(2));
    noiseLevel = Number((0.01 + rand() * 0.025).toFixed(3));
    noiseType = 'clean_mic';
    distortion = Number((0.01 + rand() * 0.03).toFixed(3));
    tremoloDepth = Number((0.02 + rand() * 0.03).toFixed(3));
    dropoutCount = 0;
    startDelayMs = Math.round(12 + rand() * 28); // 12ms .. 40ms
    bandpassHz = [150, 5800];
  } else if (difficulty === 'NORMAL') {
    // Mode THÔNG THƯỜNG: Biến đổi vừa phải, có tạp âm nền tự nhiên
    const pitchDelta = 0.06 + rand() * 0.06; // lệch 6% .. 12%
    const speedDelta = 0.05 + rand() * 0.05; // lệch 5% .. 10%
    pitch = Number((1.0 + direction * pitchDelta).toFixed(2));
    speed = Number((1.0 + direction * speedDelta * 0.8).toFixed(2));
    noiseLevel = Number((0.07 + rand() * 0.05).toFixed(3));
    noiseType = 'room_ambience';
    distortion = Number((0.06 + rand() * 0.06).toFixed(3));
    tremoloDepth = Number((0.08 + rand() * 0.05).toFixed(3));
    dropoutCount = rand() > 0.55 ? 1 : 0;
    startDelayMs = Math.round(75 + rand() * 75); // 75ms .. 150ms
    bandpassHz = [260, 3600];
  } else {
    // Mode YẾU (EASY): Biến đổi nhiều, lệch tông/nhịp mạnh, nhiều tạp âm/tiếng ồn và hụt hơi
    const pitchDelta = 0.18 + rand() * 0.14; // lệch 18% .. 32%
    const speedDelta = 0.15 + rand() * 0.12; // lệch 15% .. 27%
    pitch = Number((1.0 + direction * pitchDelta).toFixed(2));
    speed = Number((1.0 - direction * speedDelta).toFixed(2));
    noiseLevel = Number((0.20 + rand() * 0.12).toFixed(3));
    noiseType = 'mic_static_and_breath';
    distortion = Number((0.20 + rand() * 0.14).toFixed(3));
    tremoloDepth = Number((0.18 + rand() * 0.10).toFixed(3));
    dropoutCount = rand() > 0.4 ? 2 : 3;
    startDelayMs = Math.round(230 + rand() * 220); // 230ms .. 450ms
    bandpassHz = [360, 2500];
  }

  const effects: BotAudioEffects = {
    difficulty,
    baseSoundUrl: baseSound.url || getSoundUrl(baseSound.relativePath),
    pitch,
    speed,
    noiseLevel,
    noiseType,
    distortion,
    tremoloDepth,
    dropoutCount,
    startDelayMs,
    bandpassHz
  };

  // Tạo Buffer WAV thực tế từ sound gốc đã qua biến đổi + trộn tạp âm
  const audioBuffer = synthesizeTransformedSoundWav(baseSound.fileName, targetDur, effects, botSeed);
  const audioBase64 = `data:audio/wav;base64,${audioBuffer.toString('base64')}`;

  // Tính toán chỉ số ClientMetrics trực tiếp từ độ biến dạng & mức tạp âm so với sound gốc
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
    audioBuffer,
    audioBase64,
    mimeType: 'audio/wav',
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
): {
  sound: SoundCatalogItem;
  pitch: number;
  speed: number;
  effects: BotAudioEffects;
  audioBuffer: Buffer;
  audioBase64: string;
  mimeType: string;
  metrics: ClientMetrics;
} {
  return transformTargetSoundForBot(targetFileNameOrPath, packId, difficulty, botSeed);
}
