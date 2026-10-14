// ==========================================
// 1. ĐỊNH NGHĨA GAME STATES (STATE ENUMS)
// ==========================================
const GAME_STATES = {
  IDLE: 'IDLE',                           // Chờ người chơi
  THEME_SELECTION: 'THEME_SELECTION',     // Random chủ đề (Sound Pack)
  PLAYING_SAMPLE: 'PLAYING_SAMPLE',       // Phát audio mẫu
  PREPARE_RECORDING: 'PREPARE_RECORDING', // Thời gian đệm chuẩn bị nhại lại (3s)
  USER_RECORDING: 'USER_RECORDING',       // User bật mic nhại lại
  AI_SCORING: 'AI_SCORING',               // AI chấm điểm & phân tích
  SHOWDOWN_REVEAL: 'SHOWDOWN_REVEAL',     // Nghe lại bản thu & reaction
  ROUND_RESULT: 'ROUND_RESULT',           // Bảng xếp hạng vòng
  GAME_OVER: 'GAME_OVER'                  // Kết thúc trận đấu
};

const STATE_LABELS = {
  [GAME_STATES.IDLE]: 'Đang chờ tại sảnh',
  [GAME_STATES.THEME_SELECTION]: 'Đang quay chọn chủ đề âm thanh',
  [GAME_STATES.PLAYING_SAMPLE]: 'Đang phát âm thanh mẫu',
  [GAME_STATES.PREPARE_RECORDING]: 'Chuẩn bị lấy hơi & sẵn sàng micro (3s)',
  [GAME_STATES.USER_RECORDING]: 'Tới lượt người chơi nhại lại',
  [GAME_STATES.AI_SCORING]: 'AI đang phân tích & chấm điểm',
  [GAME_STATES.SHOWDOWN_REVEAL]: 'Showdown & Nghe lại các bản thu',
  [GAME_STATES.ROUND_RESULT]: 'Bảng xếp hạng vòng đấu',
  [GAME_STATES.GAME_OVER]: 'Trận đấu kết thúc'
};

// ==========================================
// 2. DANH MỤC SOUND PACKS THEO CHỦ ĐỀ (PACK FOLDERS)
// ==========================================
const SOUND_PACKS = [
  {
    id: 'animals',
    folder: 'animals',
    name: '🐾 Thế Giới Động Vật',
    emoji: '🐾',
    description: 'Tiếng kêu đặc trưng của các loài muôn thú và thú cưng!',
    sounds: [
      { id: 'cat-meow', name: 'Mèo con kêu Meo Meo', fileName: 'cat-two.mp3', relativePath: 'animals/cat-two.mp3', emoji: '🐱', hint: 'Kêu "Meo meo" điệu đà, vuốt cao giọng ở cuối!' },
      { id: 'animals_dog-bark', name: 'Chó sủa đanh thép', fileName: 'dog-bark.mp3', relativePath: 'animals/dog-bark.mp3', emoji: '🐶', hint: 'Sủa dứt khoát "Gâu! Gâu!" với năng lượng cao!' },
      { id: 'angry-cat', name: 'Mèo cáu gắt rít lên', fileName: 'angry-cat.mp3', relativePath: 'animals/angry-cat.mp3', emoji: '😾', hint: 'Khè thật to và gắt giọng như sắp cào!' },
      { id: 'animals_duck-quack', name: 'Vịt cạp cạp', fileName: 'duck-quack.mp3', relativePath: 'animals/duck-quack.mp3', emoji: '🦆', hint: 'Bóp mũi lại và kêu "Cạp cạp cạp" liên tục!' },
      { id: 'animals_rooster', name: 'Gà trống gáy sáng', fileName: 'rooster.mp3', relativePath: 'animals/rooster.mp3', emoji: '🐓', hint: 'Hít sâu và "Ò ó o oooo" ngân dài!' },
      { id: 'animals_wolf-howl', name: 'Sói hú đêm trăng', fileName: 'wolf-howl.mp3', relativePath: 'animals/wolf-howl.mp3', emoji: '🐺', hint: 'Hú trầm rồi ngân cao "Aooooooo" kéo dài!' },
      { id: 'animals_frog-croak', name: 'Ếch ộp ồm ồm', fileName: 'frog-croak.mp3', relativePath: 'animals/frog-croak.mp3', emoji: '🐸', hint: 'Dùng cuống họng phát ra âm ồm ồm "Ộp... ộp..."!' },
      { id: 'animals_lion-roar', name: 'Sư tử gầm vang', fileName: 'lion-roar.mp3', relativePath: 'animals/lion-roar.mp3', emoji: '🦁', hint: 'Gầm gừ từ đáy lồng ngực với âm lượng cực lớn!' },
      { id: 'animals_horse-neigh', name: 'Ngựa hí vang trời', fileName: 'horse-neigh.mp3', relativePath: 'animals/horse-neigh.mp3', emoji: '🐴', hint: 'Rung môi và hí cao giọng dồn dập!' },
      { id: 'tiger', name: 'Hổ gầm chúa sơn lâm', fileName: 'tiger.mp3', relativePath: 'animals/tiger.mp3', emoji: '🐯', hint: 'Gầm trầm và khàn đầy uy lực!' },
      { id: 'turkey', name: 'Gà tây kêu 골골', fileName: 'turkey.mp3', relativePath: 'animals/turkey.mp3', emoji: '🦃', hint: 'Rung lưỡi liên thanh cực hài hước!' }
    ]
  },
  {
    id: 'meme',
    folder: 'meme',
    name: '🎉 Meme Siêu Bựa',
    emoji: '🎉',
    description: 'Các hiệu ứng âm thanh viral huyền thoại trên Internet!',
    sounds: [
      { id: 'airhorn-triple', name: 'Còi hơi tiệc tùng', fileName: 'airhorn-triple.mp3', relativePath: 'meme/airhorn-triple.mp3', emoji: '🎺', hint: 'Phát âm "Bắp bắp bắp... bùm!" dồn dập!' },
      { id: 'emotional-damage', name: 'Emotional Damage!', fileName: 'emotional-damage.mp3', relativePath: 'meme/emotional-damage.mp3', emoji: '💔', hint: 'Nhấn mạnh giọng "E-MO-TION-AL DA-MAGE!" cực gắt!' },
      { id: 'bonk-metal', name: 'Tiếng gõ đầu Bonk', fileName: 'bonk-metal.mp3', relativePath: 'meme/bonk-metal.mp3', emoji: '🔨', hint: 'Phát âm chữ "Boong!" thật đanh và ngắn gọn!' },
      { id: 'bruh-sound', name: 'Bruh huyền thoại', fileName: 'bruh-sound.mp3', relativePath: 'meme/bruh-sound.mp3', emoji: '😑', hint: 'Thở dài trầm giọng "Bruhhhh..." bất lực!' },
      { id: 'vine-boom', name: 'Tiếng trầm Vine Boom', fileName: 'vine-boom.mp3', relativePath: 'meme/vine-boom.mp3', emoji: '💥', hint: 'Hạ giọng trầm hết cỡ kêu "BÙM" sâu thẳm!' },
      { id: 'yeah-boi', name: 'Yeah Boiiii ngân dài', fileName: 'yeah-boi.mp3', relativePath: 'meme/yeah-boi.mp3', emoji: '😎', hint: 'Hít hơi thật sâu và kéo dài "Yeah Boiiiiii"!' },
      { id: 'screaming-goat', name: 'Dê hét thất thanh', fileName: 'screaming-goat.mp3', relativePath: 'meme/screaming-goat.mp3', emoji: '🐐', hint: 'Hét cao giọng "Áaaaa" như dê bị giật mình!' },
      { id: 'oof-roblox', name: 'Roblox OOF!', fileName: 'oof-roblox.mp3', relativePath: 'meme/oof-roblox.mp3', emoji: '🧱', hint: 'Phát âm "Uff!" ngắn, gọn, dứt khoát!' }
    ]
  },
  {
    id: 'voice1',
    folder: 'voice1',
    name: '🎙️ Meme Voice Viral',
    emoji: '🎙️',
    description: 'Những câu thoại meme chấn động mạng xã hội!',
    sounds: [
      { id: 'fbi-open-up', name: 'FBI Open Up!', fileName: 'fbi-open-up.mp3', relativePath: 'voice1/fbi-open-up.mp3', emoji: '🚓', hint: 'Hét dõng dạc "FBI OPEN UP!" kèm tiếng đạp cửa!' },
      { id: 'why-are-you-running', name: 'Why Are You Running?', fileName: 'why-are-you-running.mp3', relativePath: 'voice1/why-are-you-running.mp3', emoji: '🏃', hint: 'Hỏi dồn dập với giọng hoảng hốt hài hước!' },
      { id: 'what-the-dog-doin', name: 'What Da Dog Doin?', fileName: 'what-the-dog-doin.mp3', relativePath: 'voice1/what-the-dog-doin.mp3', emoji: '🐕', hint: 'Hỏi ngơ ngác "What the dog doin?!"' },
      { id: 'bing-chilling', name: 'Zǎoshang hǎo Bing Chilling', fileName: 'bing-chilling.mp3', relativePath: 'voice1/bing-chilling.mp3', emoji: '🍦', hint: 'Nhấn chữ "BING CHILLING" thật rõ và hào hứng!' },
      { id: 'he-need-some-milk', name: 'He Need Some Milk!', fileName: 'he-need-some-milk.mp3', relativePath: 'voice1/he-need-some-milk.mp3', emoji: '🥛', hint: 'Hốt hoảng kêu lên "He need some milk!"' },
      { id: 'among-us', name: 'Kẻ giả mạo Among Us', fileName: 'among-us.mp3', relativePath: 'voice1/among-us.mp3', emoji: '📮', hint: 'Kêu bí ẩn theo điệu nhạc kịch tính!' }
    ]
  },
  {
    id: 'anime',
    folder: 'anime',
    name: '⚡ Anime & Tuyệt Kỹ',
    emoji: '⚡',
    description: 'Những câu thoại và tuyệt chiêu kinh điển trong thế giới Anime!',
    sounds: [
      { id: 'tuturu', name: 'Tuturu~ Mayushii', fileName: 'tuturu.mp3', relativePath: 'anime/tuturu.mp3', emoji: '🌟', hint: 'Ngân cao giọng dễ thương "Tu-tu-ruuuu~"!' },
      { id: 'anime-wow', name: 'Anime Kawaii Wow', fileName: 'anime-wow.mp3', relativePath: 'anime/anime-wow.mp3', emoji: '🌸', hint: 'Giọng nữ anime thốt lên "Woooooow" cực dễ thương!' },
      { id: 'sukuna-laugh', name: 'Điệu cười Sukuna', fileName: 'sukuna-laugh.mp3', relativePath: 'anime/sukuna-laugh.mp3', emoji: '👹', hint: 'Cười ngạo nghễ và ma mị từ cổ họng!' },
      { id: 'titan-roar', name: 'Tiếng gầm Titan', fileName: 'titan-roar.mp3', relativePath: 'anime/titan-roar.mp3', emoji: '🔥', hint: 'Hét vang trời với toàn bộ nội lực!' },
      { id: 'teleport', name: 'Dịch chuyển tức thời', fileName: 'teleport.mp3', relativePath: 'anime/teleport.mp3', emoji: '✨', hint: 'Phát âm "Xoẹt!" sắc gọn ở tần số cao!' },
      { id: 'sword-slash', name: 'Kiếm khí chém gió', fileName: 'sword-slash.mp3', relativePath: 'anime/sword-slash.mp3', emoji: '⚔️', hint: 'Kêu "Xẹt... keng!" thật nhanh và sắc!' },
      { id: 'kono-dio-da', name: 'Kono Dio Da!', fileName: 'kono-dio-da.mp3', relativePath: 'anime/kono-dio-da.mp3', emoji: '🧛', hint: 'Hét lớn đầy tự hào "KONO DIO DA!"' }
    ]
  },
  {
    id: 'voices',
    folder: 'voices',
    name: '🗣️ Giọng Người & Cảm Xúc',
    emoji: '🗣️',
    description: 'Tiếng cười, tiếng hét, ngáy ngủ và biểu cảm con người!',
    sounds: [
      { id: 'voices_evil-laugh', name: 'Điệu cười phản diện', fileName: 'evil-laugh.mp3', relativePath: 'voices/evil-laugh.mp3', emoji: '😈', hint: 'Cười "Muahahaha" đầy âm mưu!' },
      { id: 'goofy-laugh', name: 'Cười ngố Goofy', fileName: 'goofy-laugh.mp3', relativePath: 'voices/goofy-laugh.mp3', emoji: '🤪', hint: 'Cười "Hyuk hyuk a-hyuk" ngộ nghĩnh!' },
      { id: 'wheeze', name: 'Cười nín thở khàn cổ', fileName: 'wheeze.mp3', relativePath: 'voices/wheeze.mp3', emoji: '🤣', hint: 'Rít hơi cười khì khì như ấm nước sôi!' },
      { id: 'snoring', name: 'Tiếng ngáy ngủ sấm rền', fileName: 'snoring.mp3', relativePath: 'voices/snoring.mp3', emoji: '😴', hint: 'Khò... khò... rồi huýt nhẹ như đang ngủ say!' },
      { id: 'tada', name: 'Hiệu ứng Ta-da!', fileName: 'tada.mp3', relativePath: 'voices/tada.mp3', emoji: '🎩', hint: 'Hô vang "Ta-daaa~" thật rạng rỡ!' }
    ]
  },
  {
    id: 'robots',
    folder: 'robots',
    name: '🤖 Robot & Sci-Fi',
    emoji: '🤖',
    description: 'Âm thanh máy móc, R2D2, Wall-E và tia laser tương lai!',
    sounds: [
      { id: 'r2d2', name: 'Robot R2-D2 líu lo', fileName: 'r2d2.mp3', relativePath: 'robots/r2d2.mp3', emoji: '🤖', hint: 'Huýt sáo kết hợp bíp bíp luyến láy cực nhanh!' },
      { id: 'walle', name: 'Wall-E gọi tên', fileName: 'walle.mp3', relativePath: 'robots/walle.mp3', emoji: '🌱', hint: 'Giọng máy móc ngân nhẹ "Waaall-E~"!' },
      { id: 'transformer', name: 'Robot biến hình', fileName: 'transformer.mp3', relativePath: 'robots/transformer.mp3', emoji: '🦾', hint: 'Làm tiếng bánh răng "Chừ-chừ-chừ-keng-keng"!' },
      { id: 'laser-blast', name: 'Súng Laser bắn liên thanh', fileName: 'laser-blast.mp3', relativePath: 'robots/laser-blast.mp3', emoji: '🔫', hint: 'Kêu "Chiu! Chiu! Chiu!" thật sắc!' }
    ]
  },
  {
    id: 'yankee',
    folder: 'yankee',
    name: '💢 Giang Hồ Yankee Nhật',
    emoji: '💢',
    description: 'Khí chất bất lương học đường Nhật Bản cực ngầu!',
    sounds: [
      { id: 'kisama', name: 'Kisama!! (Mày dám à!)', fileName: 'kisama.mp3', relativePath: 'yankee/kisama.mp3', emoji: '💢', hint: 'Gằn giọng trầm khàn "KI-SA-MA!"' },
      { id: 'temee', name: 'Temee!! (Tên khốn!)', fileName: 'temee.mp3', relativePath: 'yankee/temee.mp3', emoji: '🔥', hint: 'Quát lớn cuốn lưỡi "Temeeeee!"' },
      { id: 'motorcycle-rev', name: 'Nẹt pô xe phân khối lớn', fileName: 'motorcycle-rev.mp3', relativePath: 'yankee/motorcycle-rev.mp3', emoji: '🏍️', hint: 'Rung môi "Brừm... brừm brừmmmm!"' }
    ]
  },
  {
    id: 'vehicles',
    folder: 'vehicles',
    name: '🚗 Xe Cộ & Còi Hơi',
    emoji: '🚗',
    description: 'Âm thanh đường phố, còi xe và tiếng chuông hối hả!',
    sounds: [
      { id: 'car-horn-honk', name: 'Còi ô tô Bim Bim', fileName: 'car-horn-honk.mp3', relativePath: 'vehicles/car-horn-honk.mp3', emoji: '🚗', hint: 'Kêu "Bim bim" dứt khoát 2 nhịp!' },
      { id: 'ship-foghorn', name: 'Còi tàu thủy rền vang', fileName: 'ship-foghorn.mp3', relativePath: 'vehicles/ship-foghorn.mp3', emoji: '🚢', hint: 'Hú trầm "Tuuuuu" ngân dài đầy uy lực!' },
      { id: 'air-raid-horn', name: 'Còi báo động không kích', fileName: 'air-raid-horn.mp3', relativePath: 'vehicles/air-raid-horn.mp3', emoji: '🚨', hint: 'Hú uốn lượn từ trầm lên cao vút liên tục!' },
      { id: 'boxing-bell', name: 'Chuông đài quyền anh', fileName: 'boxing-bell.mp3', relativePath: 'vehicles/boxing-bell.mp3', emoji: '🥊', hint: 'Keng keng keng sắc lạnh báo hiệu vào trận!' },
      { id: 'train-horn', name: 'Còi tàu hỏa vượt đèo', fileName: 'train-horn.mp3', relativePath: 'vehicles/train-horn.mp3', emoji: '🚂', hint: 'Hú vang 2 tông chồng lên nhau cực mạnh!' }
    ]
  },
  {
    id: 'funny',
    folder: 'funny',
    name: '😂 Hài Hước & Đời Sống',
    emoji: '😂',
    description: 'Những âm thanh khó đỡ khiến cả phòng cười ngả nghiêng!',
    sounds: [
      { id: 'burp-slide', name: 'Tiếng ợ sảng khoái', fileName: 'burp-slide.mp3', relativePath: 'funny/burp-slide.mp3', emoji: '🍺', hint: 'Ợ hơi một tràng thật vang và hài hước!' },
      { id: 'boing-spring', name: 'Lò xo nảy tưng tưng', fileName: 'boing-spring.mp3', relativePath: 'funny/boing-spring.mp3', emoji: '🪀', hint: 'Kêu "Boong... óing... óing" uốn lượn!' },
      { id: 'crazy-whistle', name: 'Huýt sáo lả lướt', fileName: 'crazy-whistle.mp3', relativePath: 'funny/crazy-whistle.mp3', emoji: '😗', hint: 'Huýt sáo một tràng dài lả lơi vui nhộn!' },
      { id: 'baby-giggle', name: 'Em bé cười khúc khích', fileName: 'baby-giggle.mp3', relativePath: 'funny/baby-giggle.mp3', emoji: '👶', hint: 'Cười "Hi hi ha ha" trong trẻo như em bé!' },
      { id: 'whip-crack', name: 'Tiếng roi quất vun vút', fileName: 'whip-crack.mp3', relativePath: 'funny/whip-crack.mp3', emoji: '🤠', hint: 'Giật giọng "Vụt... CHÁT!" thật nhanh!' }
    ]
  }
];

const AI_REMARKS = {
  legendary: [
    '🔥 THÁNH NHẠI ÂM! Giống đến mức bản gốc phải xin chữ ký!',
    '🌟 10 điểm không có nhưng! Quá xuất thần!',
    '👑 Đỉnh cao thanh nhạc đường phố! Giống y đúc!'
  ],
  good: [
    '👏 Rất mượt mà! Khá giống bản gốc đấy!',
    '✨ Ấn tượng đấy, chỉ lệch một xíu cao độ thôi!',
    '🎉 Khá lắm, nghe có nét rất riêng!'
  ],
  funny: [
    '😂 Âm thanh này nghe giống tiếng bị nghẹt mũi hơn!',
    '🤔 Có gì đó sai sai... nhưng rất giải trí!',
    '🤣 Nghe như phiên bản remix bị lỗi vậy!',
    '🚑 Cần gọi cấp cứu cho thanh quản của bạn không?'
  ],
  terrible: [
    '💀 Tiếng gì đây trời?! AI xin phép từ chối nhận dạng!',
    '👻 Đang giả tiếng sinh vật ngoài hành tinh à?',
    '🤐 Quên bật tiếng hay đang nhai micro vậy?'
  ]
};

module.exports = {
  GAME_STATES,
  STATE_LABELS,
  SOUND_PACKS,
  AI_REMARKS
};
