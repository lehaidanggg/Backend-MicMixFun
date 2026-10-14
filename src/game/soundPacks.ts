import {
  AiRemarkCode,
  SoundPackDescCode,
  SoundPackNameCode,
  StateLabelCode
} from '../config/messages';
import { GameStateType, SoundPack } from '../types';

// ==========================================
// 1. ĐỊNH NGHĨA GAME STATES (STATE ENUMS)
// ==========================================
export const GAME_STATES = {
  IDLE: 'IDLE',                           // Chờ người chơi
  THEME_SELECTION: 'THEME_SELECTION',     // Random chủ đề (Sound Pack)
  PLAYING_SAMPLE: 'PLAYING_SAMPLE',       // Phát audio mẫu
  PREPARE_RECORDING: 'PREPARE_RECORDING', // Thời gian đệm chuẩn bị nhại lại (3s)
  USER_RECORDING: 'USER_RECORDING',       // User bật mic nhại lại
  AI_SCORING: 'AI_SCORING',               // AI chấm điểm & phân tích
  SHOWDOWN_REVEAL: 'SHOWDOWN_REVEAL',     // Nghe lại bản thu & reaction
  ROUND_RESULT: 'ROUND_RESULT',           // Bảng xếp hạng vòng
  GAME_OVER: 'GAME_OVER'                  // Kết thúc trận đấu
} as const;

export const STATE_LABELS: Record<GameStateType, StateLabelCode> = {
  [GAME_STATES.IDLE]: StateLabelCode.STATE_LABEL_IDLE,
  [GAME_STATES.THEME_SELECTION]: StateLabelCode.STATE_LABEL_THEME_SELECTION,
  [GAME_STATES.PLAYING_SAMPLE]: StateLabelCode.STATE_LABEL_PLAYING_SAMPLE,
  [GAME_STATES.PREPARE_RECORDING]: StateLabelCode.STATE_LABEL_PREPARE_RECORDING,
  [GAME_STATES.USER_RECORDING]: StateLabelCode.STATE_LABEL_USER_RECORDING,
  [GAME_STATES.AI_SCORING]: StateLabelCode.STATE_LABEL_AI_SCORING,
  [GAME_STATES.SHOWDOWN_REVEAL]: StateLabelCode.STATE_LABEL_SHOWDOWN_REVEAL,
  [GAME_STATES.ROUND_RESULT]: StateLabelCode.STATE_LABEL_ROUND_RESULT,
  [GAME_STATES.GAME_OVER]: StateLabelCode.STATE_LABEL_GAME_OVER
};

// ==========================================
// 2. DANH MỤC SOUND PACKS THEO CHỦ ĐỀ (LOCALIZATION ENUM KEYS)
// ==========================================
export const SOUND_PACKS: SoundPack[] = [
  {
    id: 'animals',
    folder: 'animals',
    name: SoundPackNameCode.PACK_NAME_ANIMALS,
    emoji: '🐾',
    description: SoundPackDescCode.PACK_DESC_ANIMALS,
    sounds: [
      { id: 'cat-meow', name: 'SOUND_NAME_CAT_MEOW', fileName: 'cat-two.mp3', relativePath: 'animals/cat-two.mp3', emoji: '🐱', hint: 'SOUND_HINT_CAT_MEOW' },
      { id: 'animals_dog-bark', name: 'SOUND_NAME_DOG_BARK', fileName: 'dog-bark.mp3', relativePath: 'animals/dog-bark.mp3', emoji: '🐶', hint: 'SOUND_HINT_DOG_BARK' },
      { id: 'angry-cat', name: 'SOUND_NAME_ANGRY_CAT', fileName: 'angry-cat.mp3', relativePath: 'animals/angry-cat.mp3', emoji: '😾', hint: 'SOUND_HINT_ANGRY_CAT' },
      { id: 'animals_duck-quack', name: 'SOUND_NAME_DUCK_QUACK', fileName: 'duck-quack.mp3', relativePath: 'animals/duck-quack.mp3', emoji: '🦆', hint: 'SOUND_HINT_DUCK_QUACK' },
      { id: 'animals_rooster', name: 'SOUND_NAME_ROOSTER', fileName: 'rooster.mp3', relativePath: 'animals/rooster.mp3', emoji: '🐓', hint: 'SOUND_HINT_ROOSTER' },
      { id: 'animals_wolf-howl', name: 'SOUND_NAME_WOLF_HOWL', fileName: 'wolf-howl.mp3', relativePath: 'animals/wolf-howl.mp3', emoji: '🐺', hint: 'SOUND_HINT_WOLF_HOWL' },
      { id: 'animals_frog-croak', name: 'SOUND_NAME_FROG_CROAK', fileName: 'frog-croak.mp3', relativePath: 'animals/frog-croak.mp3', emoji: '🐸', hint: 'SOUND_HINT_FROG_CROAK' },
      { id: 'animals_lion-roar', name: 'SOUND_NAME_LION_ROAR', fileName: 'lion-roar.mp3', relativePath: 'animals/lion-roar.mp3', emoji: '🦁', hint: 'SOUND_HINT_LION_ROAR' },
      { id: 'animals_horse-neigh', name: 'SOUND_NAME_HORSE_NEIGH', fileName: 'horse-neigh.mp3', relativePath: 'animals/horse-neigh.mp3', emoji: '🐴', hint: 'SOUND_HINT_HORSE_NEIGH' },
      { id: 'tiger', name: 'SOUND_NAME_TIGER', fileName: 'tiger.mp3', relativePath: 'animals/tiger.mp3', emoji: '🐯', hint: 'SOUND_HINT_TIGER' },
      { id: 'turkey', name: 'SOUND_NAME_TURKEY', fileName: 'turkey.mp3', relativePath: 'animals/turkey.mp3', emoji: '🦃', hint: 'SOUND_HINT_TURKEY' }
    ]
  },
  {
    id: 'meme',
    folder: 'meme',
    name: SoundPackNameCode.PACK_NAME_MEME,
    emoji: '🎉',
    description: SoundPackDescCode.PACK_DESC_MEME,
    sounds: [
      { id: 'airhorn-triple', name: 'SOUND_NAME_AIRHORN_TRIPLE', fileName: 'airhorn-triple.mp3', relativePath: 'meme/airhorn-triple.mp3', emoji: '🎺', hint: 'SOUND_HINT_AIRHORN_TRIPLE' },
      { id: 'emotional-damage', name: 'SOUND_NAME_EMOTIONAL_DAMAGE', fileName: 'emotional-damage.mp3', relativePath: 'meme/emotional-damage.mp3', emoji: '💔', hint: 'SOUND_HINT_EMOTIONAL_DAMAGE' },
      { id: 'bonk-metal', name: 'SOUND_NAME_BONK_METAL', fileName: 'bonk-metal.mp3', relativePath: 'meme/bonk-metal.mp3', emoji: '🔨', hint: 'SOUND_HINT_BONK_METAL' },
      { id: 'bruh-sound', name: 'SOUND_NAME_BRUH_SOUND', fileName: 'bruh-sound.mp3', relativePath: 'meme/bruh-sound.mp3', emoji: '😑', hint: 'SOUND_HINT_BRUH_SOUND' },
      { id: 'vine-boom', name: 'SOUND_NAME_VINE_BOOM', fileName: 'vine-boom.mp3', relativePath: 'meme/vine-boom.mp3', emoji: '💥', hint: 'SOUND_HINT_VINE_BOOM' },
      { id: 'yeah-boi', name: 'SOUND_NAME_YEAH_BOI', fileName: 'yeah-boi.mp3', relativePath: 'meme/yeah-boi.mp3', emoji: '😎', hint: 'SOUND_HINT_YEAH_BOI' },
      { id: 'screaming-goat', name: 'SOUND_NAME_SCREAMING_GOAT', fileName: 'screaming-goat.mp3', relativePath: 'meme/screaming-goat.mp3', emoji: '🐐', hint: 'SOUND_HINT_SCREAMING_GOAT' },
      { id: 'oof-roblox', name: 'SOUND_NAME_OOF_ROBLOX', fileName: 'oof-roblox.mp3', relativePath: 'meme/oof-roblox.mp3', emoji: '🧱', hint: 'SOUND_HINT_OOF_ROBLOX' }
    ]
  },
  {
    id: 'voice1',
    folder: 'voice1',
    name: SoundPackNameCode.PACK_NAME_VOICE1,
    emoji: '🎙️',
    description: SoundPackDescCode.PACK_DESC_VOICE1,
    sounds: [
      { id: 'fbi-open-up', name: 'SOUND_NAME_FBI_OPEN_UP', fileName: 'fbi-open-up.mp3', relativePath: 'voice1/fbi-open-up.mp3', emoji: '🚓', hint: 'SOUND_HINT_FBI_OPEN_UP' },
      { id: 'why-are-you-running', name: 'SOUND_NAME_WHY_ARE_YOU_RUNNING', fileName: 'why-are-you-running.mp3', relativePath: 'voice1/why-are-you-running.mp3', emoji: '🏃', hint: 'SOUND_HINT_WHY_ARE_YOU_RUNNING' },
      { id: 'what-the-dog-doin', name: 'SOUND_NAME_WHAT_THE_DOG_DOIN', fileName: 'what-the-dog-doin.mp3', relativePath: 'voice1/what-the-dog-doin.mp3', emoji: '🐕', hint: 'SOUND_HINT_WHAT_THE_DOG_DOIN' },
      { id: 'bing-chilling', name: 'SOUND_NAME_BING_CHILLING', fileName: 'bing-chilling.mp3', relativePath: 'voice1/bing-chilling.mp3', emoji: '🍦', hint: 'SOUND_HINT_BING_CHILLING' },
      { id: 'he-need-some-milk', name: 'SOUND_NAME_HE_NEED_SOME_MILK', fileName: 'he-need-some-milk.mp3', relativePath: 'voice1/he-need-some-milk.mp3', emoji: '🥛', hint: 'SOUND_HINT_HE_NEED_SOME_MILK' },
      { id: 'among-us', name: 'SOUND_NAME_AMONG_US', fileName: 'among-us.mp3', relativePath: 'voice1/among-us.mp3', emoji: '📮', hint: 'SOUND_HINT_AMONG_US' }
    ]
  },
  {
    id: 'anime',
    folder: 'anime',
    name: SoundPackNameCode.PACK_NAME_ANIME,
    emoji: '⚡',
    description: SoundPackDescCode.PACK_DESC_ANIME,
    sounds: [
      { id: 'tuturu', name: 'SOUND_NAME_TUTURU', fileName: 'tuturu.mp3', relativePath: 'anime/tuturu.mp3', emoji: '🌟', hint: 'SOUND_HINT_TUTURU' },
      { id: 'anime-wow', name: 'SOUND_NAME_ANIME_WOW', fileName: 'anime-wow.mp3', relativePath: 'anime/anime-wow.mp3', emoji: '🌸', hint: 'SOUND_HINT_ANIME_WOW' },
      { id: 'sukuna-laugh', name: 'SOUND_NAME_SUKUNA_LAUGH', fileName: 'sukuna-laugh.mp3', relativePath: 'anime/sukuna-laugh.mp3', emoji: '👹', hint: 'SOUND_HINT_SUKUNA_LAUGH' },
      { id: 'titan-roar', name: 'SOUND_NAME_TITAN_ROAR', fileName: 'titan-roar.mp3', relativePath: 'anime/titan-roar.mp3', emoji: '🔥', hint: 'SOUND_HINT_TITAN_ROAR' },
      { id: 'teleport', name: 'SOUND_NAME_TELEPORT', fileName: 'teleport.mp3', relativePath: 'anime/teleport.mp3', emoji: '✨', hint: 'SOUND_HINT_TELEPORT' },
      { id: 'sword-slash', name: 'SOUND_NAME_SWORD_SLASH', fileName: 'sword-slash.mp3', relativePath: 'anime/sword-slash.mp3', emoji: '⚔️', hint: 'SOUND_HINT_SWORD_SLASH' },
      { id: 'kono-dio-da', name: 'SOUND_NAME_KONO_DIO_DA', fileName: 'kono-dio-da.mp3', relativePath: 'anime/kono-dio-da.mp3', emoji: '🧛', hint: 'SOUND_HINT_KONO_DIO_DA' }
    ]
  },
  {
    id: 'voices',
    folder: 'voices',
    name: SoundPackNameCode.PACK_NAME_VOICES,
    emoji: '🗣️',
    description: SoundPackDescCode.PACK_DESC_VOICES,
    sounds: [
      { id: 'voices_evil-laugh', name: 'SOUND_NAME_EVIL_LAUGH', fileName: 'evil-laugh.mp3', relativePath: 'voices/evil-laugh.mp3', emoji: '😈', hint: 'SOUND_HINT_EVIL_LAUGH' },
      { id: 'goofy-laugh', name: 'SOUND_NAME_GOOFY_LAUGH', fileName: 'goofy-laugh.mp3', relativePath: 'voices/goofy-laugh.mp3', emoji: '🤪', hint: 'SOUND_HINT_GOOFY_LAUGH' },
      { id: 'wheeze', name: 'SOUND_NAME_WHEEZE', fileName: 'wheeze.mp3', relativePath: 'voices/wheeze.mp3', emoji: '🤣', hint: 'SOUND_HINT_WHEEZE' },
      { id: 'snoring', name: 'SOUND_NAME_SNORING', fileName: 'snoring.mp3', relativePath: 'voices/snoring.mp3', emoji: '😴', hint: 'SOUND_HINT_SNORING' },
      { id: 'tada', name: 'SOUND_NAME_TADA', fileName: 'tada.mp3', relativePath: 'voices/tada.mp3', emoji: '🎩', hint: 'SOUND_HINT_TADA' }
    ]
  },
  {
    id: 'robots',
    folder: 'robots',
    name: SoundPackNameCode.PACK_NAME_ROBOTS,
    emoji: '🤖',
    description: SoundPackDescCode.PACK_DESC_ROBOTS,
    sounds: [
      { id: 'r2d2', name: 'SOUND_NAME_R2D2', fileName: 'r2d2.mp3', relativePath: 'robots/r2d2.mp3', emoji: '🤖', hint: 'SOUND_HINT_R2D2' },
      { id: 'walle', name: 'SOUND_NAME_WALLE', fileName: 'walle.mp3', relativePath: 'robots/walle.mp3', emoji: '🌱', hint: 'SOUND_HINT_WALLE' },
      { id: 'transformer', name: 'SOUND_NAME_TRANSFORMER', fileName: 'transformer.mp3', relativePath: 'robots/transformer.mp3', emoji: '🦾', hint: 'SOUND_HINT_TRANSFORMER' },
      { id: 'laser-blast', name: 'SOUND_NAME_LASER_BLAST', fileName: 'laser-blast.mp3', relativePath: 'robots/laser-blast.mp3', emoji: '🔫', hint: 'SOUND_HINT_LASER_BLAST' }
    ]
  },
  {
    id: 'yankee',
    folder: 'yankee',
    name: SoundPackNameCode.PACK_NAME_YANKEE,
    emoji: '💢',
    description: SoundPackDescCode.PACK_DESC_YANKEE,
    sounds: [
      { id: 'kisama', name: 'SOUND_NAME_KISAMA', fileName: 'kisama.mp3', relativePath: 'yankee/kisama.mp3', emoji: '💢', hint: 'SOUND_HINT_KISAMA' },
      { id: 'temee', name: 'SOUND_NAME_TEMEE', fileName: 'temee.mp3', relativePath: 'yankee/temee.mp3', emoji: '🔥', hint: 'SOUND_HINT_TEMEE' },
      { id: 'motorcycle-rev', name: 'SOUND_NAME_MOTORCYCLE_REV', fileName: 'motorcycle-rev.mp3', relativePath: 'yankee/motorcycle-rev.mp3', emoji: '🏍️', hint: 'SOUND_HINT_MOTORCYCLE_REV' }
    ]
  },
  {
    id: 'vehicles',
    folder: 'vehicles',
    name: SoundPackNameCode.PACK_NAME_VEHICLES,
    emoji: '🚗',
    description: SoundPackDescCode.PACK_DESC_VEHICLES,
    sounds: [
      { id: 'car-horn-honk', name: 'SOUND_NAME_CAR_HORN_HONK', fileName: 'car-horn-honk.mp3', relativePath: 'vehicles/car-horn-honk.mp3', emoji: '🚗', hint: 'SOUND_HINT_CAR_HORN_HONK' },
      { id: 'ship-foghorn', name: 'SOUND_NAME_SHIP_FOGHORN', fileName: 'ship-foghorn.mp3', relativePath: 'vehicles/ship-foghorn.mp3', emoji: '🚢', hint: 'SOUND_HINT_SHIP_FOGHORN' },
      { id: 'air-raid-horn', name: 'SOUND_NAME_AIR_RAID_HORN', fileName: 'air-raid-horn.mp3', relativePath: 'vehicles/air-raid-horn.mp3', emoji: '🚨', hint: 'SOUND_HINT_AIR_RAID_HORN' },
      { id: 'boxing-bell', name: 'SOUND_NAME_BOXING_BELL', fileName: 'boxing-bell.mp3', relativePath: 'vehicles/boxing-bell.mp3', emoji: '🥊', hint: 'SOUND_HINT_BOXING_BELL' },
      { id: 'train-horn', name: 'SOUND_NAME_TRAIN_HORN', fileName: 'train-horn.mp3', relativePath: 'vehicles/train-horn.mp3', emoji: '🚂', hint: 'SOUND_HINT_TRAIN_HORN' }
    ]
  },
  {
    id: 'funny',
    folder: 'funny',
    name: SoundPackNameCode.PACK_NAME_FUNNY,
    emoji: '😂',
    description: SoundPackDescCode.PACK_DESC_FUNNY,
    sounds: [
      { id: 'burp-slide', name: 'SOUND_NAME_BURP_SLIDE', fileName: 'burp-slide.mp3', relativePath: 'funny/burp-slide.mp3', emoji: '🍺', hint: 'SOUND_HINT_BURP_SLIDE' },
      { id: 'boing-spring', name: 'SOUND_NAME_BOING_SPRING', fileName: 'boing-spring.mp3', relativePath: 'funny/boing-spring.mp3', emoji: '🪀', hint: 'SOUND_HINT_BOING_SPRING' },
      { id: 'crazy-whistle', name: 'SOUND_NAME_CRAZY_WHISTLE', fileName: 'crazy-whistle.mp3', relativePath: 'funny/crazy-whistle.mp3', emoji: '😗', hint: 'SOUND_HINT_CRAZY_WHISTLE' },
      { id: 'baby-giggle', name: 'SOUND_NAME_BABY_GIGGLE', fileName: 'baby-giggle.mp3', relativePath: 'funny/baby-giggle.mp3', emoji: '👶', hint: 'SOUND_HINT_BABY_GIGGLE' },
      { id: 'whip-crack', name: 'SOUND_NAME_WHIP_CRACK', fileName: 'whip-crack.mp3', relativePath: 'funny/whip-crack.mp3', emoji: '🤠', hint: 'SOUND_HINT_WHIP_CRACK' }
    ]
  }
];

export const AI_REMARKS: Record<'legendary' | 'good' | 'funny' | 'terrible', AiRemarkCode[]> = {
  legendary: [
    AiRemarkCode.AI_REMARK_LEGENDARY_1,
    AiRemarkCode.AI_REMARK_LEGENDARY_2,
    AiRemarkCode.AI_REMARK_LEGENDARY_3
  ],
  good: [
    AiRemarkCode.AI_REMARK_GOOD_1,
    AiRemarkCode.AI_REMARK_GOOD_2,
    AiRemarkCode.AI_REMARK_GOOD_3
  ],
  funny: [
    AiRemarkCode.AI_REMARK_FUNNY_1,
    AiRemarkCode.AI_REMARK_FUNNY_2,
    AiRemarkCode.AI_REMARK_FUNNY_3,
    AiRemarkCode.AI_REMARK_FUNNY_4
  ],
  terrible: [
    AiRemarkCode.AI_REMARK_TERRIBLE_1,
    AiRemarkCode.AI_REMARK_TERRIBLE_2,
    AiRemarkCode.AI_REMARK_TERRIBLE_3
  ]
};
