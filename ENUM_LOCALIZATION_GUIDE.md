# 🤖 AI Client Integration Guide — Localization Enums & Payload Contracts

> **Mục đích tài liệu:** File Markdown này được thiết kế tối ưu cho **AI Coding Assistant (Android Kotlin / iOS Swift / Web TypeScript)** để tích hợp tức thì hệ thống mã Enum (`ErrorCode`, `SystemMessageCode`, `GameMessageCode`, `StateLabelCode`, `AiRemarkCode`, `RoomCloseReasonCode`, `SoundPackNameCode`, `SoundPackDescCode`) từ Backend **MicMixFun & Mimic Party**.
>
> - **Localhost Dev URL:** `http://localhost:3000`
> - **Production URL:** `https://micmixfun.up.railway.app`
> - **Endpoint lấy JSON Dictionary trực tiếp:** `GET /api/enums`

---

## 1. Quy ước Chung về Payload Lỗi & Thông báo (Contract Rules)

Toàn bộ Backend **không trả về chuỗi văn bản cứng (hardcoded strings)** cho các thông báo lỗi, thông báo hệ thống hay trạng thái game. Thay vào đó, Server trả về **Mã Enum cố định** kèm theo đối tượng **`params`** (nếu chuỗi cần truyền biến động).

### 1.1. Cấu trúc Lỗi REST API & Socket Callback (`AckResponse`)
```json
{
  "error": "GAME_PLAYERS_NOT_READY",
  "message": "GAME_PLAYERS_NOT_READY",
  "params": {
    "unreadyPlayers": "Minh, Lan"
  }
}
```
- Với Socket Callback (`create_room`, `join_room`, `close_room`, `kick_player`, `game_start`, `game_update_config`, `game_submit_audio`, `confirm_showdown_skip`, `confirm_next_round_ready`):
```json
{
  "success": false,
  "error": "ROOM_FULL",
  "params": {
    "maxMembers": 12
  }
}
```

### 1.2. Cấu trúc Thông báo Hệ thống & Sự kiện Phòng (`System Broadcast`)
```json
{
  "message": "SYS_PLAYER_JOINED_ROOM",
  "params": {
    "userName": "Alex",
    "role": "player"
  }
}
```

### 1.3. Quy tắc Nội suy Biến (`params` Interpolation)
Khi văn bản mô tả chứa `{key}`, Client thay thế `{key}` bằng giá trị `params[key]` tương ứng:
- Ví dụ: `code = "ROOM_FULL"`, `params = { "maxMembers": 12 }`
- Chuỗi mẫu VI: `"Phòng đã đầy ({maxMembers}/{maxMembers} người)!"` -> `"Phòng đã đầy (12/12 người)!"`

---

## 2. Bảng Mapping `ErrorCode` (22 mã lỗi)

| Enum Code | Tham số (`params`) | Tiếng Việt (`vi`) | Tiếng Anh (`en`) | Ngữ cảnh phát sinh |
| :--- | :--- | :--- | :--- | :--- |
| `INTERNAL_SERVER_ERROR` | _Không_ | Đã xảy ra lỗi hệ thống ngoài ý muốn. Vui lòng thử lại! | An unexpected internal server error occurred. | Lỗi ngoại lệ tại REST API / Socket (HTTP 500) |
| `SOUNDS_DIRECTORY_READ_ERROR` | _Không_ | Không thể đọc danh mục âm thanh trên máy chủ. | Failed to read sound catalog on server. | Lỗi đọc `sounds/catalog.json` tại `GET /api/sounds` |
| `AUTH_FIREBASE_TOKEN_INVALID` | _Không_ | Firebase ID Token không hợp lệ hoặc đã hết hạn! | Firebase ID Token is invalid or expired. | `POST /api/auth/firebase` (HTTP 401) |
| `AUTH_CHALLENGE_SIGNATURE_INVALID` | _Không_ | Chữ ký xác thực thiết bị (Challenge-Response) không hợp lệ hoặc bị giả mạo qua trung gian! | Device challenge-response signature is invalid or replayed. | `POST /api/auth/firebase` sai HMAC / hết hạn nonce (HTTP 403) |
| `AUTH_TOKEN_INVALID_OR_EXPIRED` | _Không_ | Phiên đăng nhập không hợp lệ hoặc đã hết hạn! | Session token is invalid, expired, or fingerprint mismatched. | `GET /api/auth/verify` hoặc Socket Handshake (HTTP 401) |
| `AUTH_IP_CONNECTION_LIMIT_EXCEEDED` | _Không_ | Vượt quá số kết nối tối đa cho phép trên cùng 1 địa chỉ IP! | Maximum simultaneous connections per IP address exceeded. | Socket Handshake vượt quá 15 kết nối / IP |
| `ROOM_ID_REQUIRED` | _Không_ | Vui lòng cung cấp mã phòng! | Room ID is required. | `join_room` thiếu `roomId` |
| `ROOM_ID_ALREADY_EXISTS` | _Không_ | Mã phòng đã tồn tại. Hãy thử mã khác! | Room ID already exists. Please try another code. | `create_room` trùng `roomId` |
| `ROOM_NOT_FOUND` | _Không_ | Phòng chơi không tồn tại hoặc đã giải tán! | Room does not exist or has been closed. | `GET /api/attempts/...`, `close_room`, `game_start` |
| `ROOM_NOT_JOINED` | _Không_ | Bạn chưa tham gia phòng nào! | You have not joined any room. | Gửi chat, phát sound, chia sẻ audio khi chưa vào phòng |
| `ROOM_FULL` | `{ maxMembers: number }` | Phòng đã đầy ({maxMembers}/{maxMembers} người)! | Room is full ({maxMembers}/{maxMembers} members). | `join_room` khi đủ 12 người |
| `ROOM_HOST_ONLY_CLOSE` | _Không_ | Chỉ có Chủ phòng (Host) mới có quyền đóng phòng! | Only the room Host can close the room. | `close_room` bởi người không phải Host |
| `ROOM_HOST_ONLY_KICK` | _Không_ | Chỉ có Chủ phòng mới có quyền mời thành viên ra khỏi phòng! | Only the room Host can kick a member. | `kick_player` bởi người không phải Host |
| `ROOM_CANNOT_KICK_SELF` | _Không_ | Bạn không thể tự mời chính mình ra khỏi phòng! | You cannot kick yourself from the room. | `kick_player` truyền `targetSocketId` của chính Host |
| `ROOM_KICKED_BY_HOST` | _Không_ | Bạn đã bị Chủ phòng mời ra khỏi phòng! | You have been removed from the room by the Host. | Sự kiện `kicked_from_room` gửi tới người bị kick |
| `PLAYER_NOT_IN_ROOM` | _Không_ | Người chơi không còn trong phòng! | Player is no longer in the room. | Thao tác trên thành viên đã thoát phòng |
| `RATE_LIMIT_CHAT_EXCEEDED` | _Không_ | Bạn nhắn quá nhanh! Vui lòng đợi giây lát. | You are sending messages too fast. Please wait a moment. | Sự kiện `error_message` khi chat > 6 tin / 3s |
| `RATE_LIMIT_SOUND_EXCEEDED` | _Không_ | Thao tác phát âm thanh quá nhanh! Vui lòng đợi giây lát. | You are triggering sounds too fast. Please slow down. | Sự kiện `error_message` khi phát sound > 5 lần / 2s |
| `ATTEMPT_AUDIO_NOT_FOUND` | _Không_ | Không tìm thấy bản thu âm hoặc bản thu đã được giải phóng sau vòng đấu. | Attempt audio recording not found or already cleared. | `GET /api/attempts/:roomId/:socketId` (HTTP 404) |
| `GAME_NOT_FOUND` | _Không_ | Trận đấu không tồn tại! | Game session does not exist. | Gọi action game khi phòng chưa khởi tạo phiên chơi |
| `GAME_HOST_ONLY_START` | _Không_ | Chỉ có Chủ phòng (Host) mới có quyền bắt đầu trận đấu! | Only the room Host can start the game. | `game_start` bởi người không phải Host |
| `GAME_PLAYERS_NOT_READY` | `{ unreadyPlayers: string }` | Chưa thể bắt đầu! Còn thành viên chưa sẵn sàng: {unreadyPlayers} | Cannot start! Some players are not ready: {unreadyPlayers} | `game_start` khi `requireAllReady = true` |
| `GAME_HOST_ONLY_CONFIG` | _Không_ | Chỉ có Chủ phòng mới có quyền cấu hình trận đấu! | Only the room Host can update game configuration. | `game_update_config` bởi người không phải Host |
| `GAME_CONFIG_LOCKED_IN_PROGRESS` | _Không_ | Không thể đổi cấu hình khi trận đấu đang diễn ra! | Cannot change game configuration while a match is in progress. | `game_update_config` khi state khác `IDLE`/`GAME_OVER` |
| `GAME_NOT_IN_RECORDING_PHASE` | _Không_ | Hiện không trong thời gian thu âm! | Not currently in the voice recording phase. | `game_submit_audio` ngoài pha thu âm |
| `GAME_ALREADY_SUBMITTED_THIS_ROUND` | _Không_ | Bạn đã nộp bài trong vòng này rồi! | You have already submitted your recording for this round. | Nộp bài thu âm lần 2 trong cùng 1 vòng |
| `GAME_NOT_IN_SHOWDOWN_PHASE` | _Không_ | Chưa tới giai đoạn Showdown Reveal! | Not currently in the Showdown Reveal phase. | `confirm_showdown_skip` ngoài pha `SHOWDOWN_REVEAL` |
| `GAME_NOT_IN_READY_PHASE` | _Không_ | Chưa tới giai đoạn xác nhận sẵn sàng qua vòng! | Not currently in the Round Result or Game Over ready phase. | `confirm_next_round_ready` ngoài pha `ROUND_RESULT`/`GAME_OVER` |
| `BOT_HOST_ONLY_MANAGE` | _Không_ | Chỉ có Chủ phòng mới có quyền thêm hoặc xóa Bot AI! | Only the room Host can add or remove AI Bots. | `add_bot` hoặc `remove_bot` bởi người không phải Host |
| `BOT_CANNOT_MANAGE_IN_PROGRESS` | _Không_ | Không thể thêm hoặc xóa Bot khi trận đấu đang diễn ra! | Cannot add or remove AI Bots while a match is in progress. | `add_bot` hoặc `remove_bot` khi state khác `IDLE`/`GAME_OVER` |
| `BOT_NOT_FOUND` | _Không_ | Không tìm thấy Bot AI trong phòng! | AI Bot not found in the room. | `remove_bot` khi phòng không có Bot |

---

## 3. Bảng Mapping `SystemMessageCode` (12 mã thông báo phòng)

| Enum Code | Sự kiện Socket | Tham số (`params`) | Tiếng Việt (`vi`) | Tiếng Anh (`en`) |
| :--- | :--- | :--- | :--- | :--- |
| `SYS_HOST_JOINED_ROOM` | `user_joined` | `{ userName: string, role: "host" }` | 👑 Chủ phòng {userName} đã tham gia phòng! | 👑 Host {userName} joined the room! |
| `SYS_PLAYER_JOINED_ROOM` | `user_joined` | `{ userName: string, role: "player" }` | 🎧 {userName} đã tham gia phòng! | 🎧 {userName} joined the room! |
| `SYS_USER_LEFT_ROOM` | `user_left` | `{ userName: string }` | {userName} đã rời phòng. | {userName} left the room. |
| `SYS_HOST_CHANGED` | `host_changed` | `{ newHostName: string }` | 👑 {newHostName} đã trở thành Chủ phòng mới! | 👑 {newHostName} is now the new room Host! |
| `SYS_HOST_CLOSED_ROOM` | `room_closed` | `{ hostName: string }` | 👑 Chủ phòng {hostName} đã đóng phòng đấu! | 👑 Host {hostName} closed the room! |
| `SYS_PLAYER_READY` | `player_ready_changed` | `{ userName: string, isReady: true }` | {userName} đã SẴN SÀNG ✅ | {userName} is READY ✅ |
| `SYS_PLAYER_UNREADY` | `player_ready_changed` | `{ userName: string, isReady: false }` | {userName} đã hủy sẵn sàng ⏳ | {userName} is no longer ready ⏳ |
| `SYS_SOUND_TRIGGERED` | `receive_message` (`type="sound_trigger"`) | `{ soundId: string, soundName: string }` | đã phát âm thanh "{soundName}" | played sound "{soundName}" |
| `SYS_AUDIO_CLIP_SHARED` | `receive_message` (`type="audio_share"`) | _Không_ | đã chia sẻ một đoạn ghi âm giọng nói 🎙️ | shared a voice recording clip 🎙️ |
| `SYS_GAME_CONFIG_UPDATED` | `game_config_changed` | `{ totalRounds: number, recordDuration: number }` | ⚙️ Chủ phòng đã cập nhật: {totalRounds} vòng, thời gian nhại {recordDuration}s! | ⚙️ Host updated config: {totalRounds} rounds, {recordDuration}s recording time! |
| `SYS_BOT_JOINED_ROOM` | `bot_added` & `user_joined` | `{ botName: string, difficulty: "EASY" \| "NORMAL" \| "HARD" }` | 🤖 Bot {botName} đã tham gia phòng đấu! | 🤖 Bot {botName} joined the room! |
| `SYS_BOT_REMOVED_FROM_ROOM` | `bot_removed` & `user_left` | `{ botName: string }` | 🤖 Bot {botName} đã rời khỏi phòng. | 🤖 Bot {botName} was removed from the room. |
| `SYS_MATCHMAKING_BOTS_FILLED` | `bots_auto_filled` | `{ botsAdded: number, totalPlayers: number }` | 🤖 Không tìm thấy người chơi khác — Hệ thống đã tự động thêm {botsAdded} Bot AI vào phòng để bắt đầu trận đấu! | 🤖 No other players found — Automatically added {botsAdded} AI Bots to start the match! |

---

## 4. Bảng Mapping `GameMessageCode` (7 mã thông báo tiến trình Game)

| Enum Code | Sự kiện / State | Tham số (`params`) | Tiếng Việt (`vi`) | Tiếng Anh (`en`) |
| :--- | :--- | :--- | :--- | :--- |
| `GAME_MSG_PREPARE_RECORDING` | `game_state_change` (`PREPARE_RECORDING`) | `{ countdown: number }` | Lấy hơi! Chuẩn bị micro để nhại lại trong {countdown} giây... | Take a breath! Get your mic ready in {countdown} seconds... |
| `GAME_MSG_USER_RECORDING` | `game_state_change` (`USER_RECORDING`) | `{ duration: number }` | 🎙️ TỚI LƯỢT BẠN! HÃY NHẠI LẠI NGAY VÀO MICRO! | 🎙️ YOUR TURN! MIMIC THE SOUND INTO YOUR MIC NOW! |
| `GAME_MSG_AI_SCORING` | `game_state_change` (`AI_SCORING`) | _Không_ | 🤖 AI Voice Detector đang phân tích & đối chiếu phổ âm thanh... | 🤖 AI Voice Detector is analyzing audio spectrum... |
| `GAME_MSG_ALL_SKIP_CONFIRMED` | `all_players_ready` (khi skip Showdown) | _Không_ | 🚀 Tất cả đã đồng ý! Đang mở Bảng Điểm Vòng... | 🚀 All players agreed to skip! Opening Round Leaderboard... |
| `GAME_MSG_ALL_PLAYERS_READY_COUNTDOWN` | `all_players_ready` (qua vòng mới) | `{ countdown: number }` | 🎉 Tất cả người chơi đã SẴN SÀNG! Bắt đầu trong {countdown} giây... | 🎉 All players READY! Starting in {countdown} seconds... |
| `GAME_MSG_GAME_OVER_CHAMPION` | `game_state_change` (`GAME_OVER`) | `{ championName: string, totalScore: number }` | 🏆 Chúc mừng {championName} đã trở thành Vua Nhại Giọng! | 🏆 Congratulations to {championName} for becoming the Mimic Champion! |
| `GAME_MSG_GAME_OVER_FINISHED` | `game_state_change` (`GAME_OVER`) | _Không_ | Trận đấu kết thúc! | Match finished! |

---

## 5. Bảng Mapping `StateLabelCode` & `GAME_STATES` (9 trạng thái Game)

| `state` (`GameStateType`) | `stateLabel` (`StateLabelCode`) | Tiếng Việt (`vi`) | Tiếng Anh (`en`) |
| :--- | :--- | :--- | :--- |
| `IDLE` | `STATE_LABEL_IDLE` | Đang chờ tại sảnh | Waiting in Lobby |
| `THEME_SELECTION` | `STATE_LABEL_THEME_SELECTION` | Đang quay chọn chủ đề âm thanh | Spinning Sound Theme Roulette |
| `PLAYING_SAMPLE` | `STATE_LABEL_PLAYING_SAMPLE` | Đang phát âm thanh mẫu | Playing Sample Audio |
| `PREPARE_RECORDING` | `STATE_LABEL_PREPARE_RECORDING` | Chuẩn bị lấy hơi & sẵn sàng micro (3s) | Get Ready to Record (3s) |
| `USER_RECORDING` | `STATE_LABEL_USER_RECORDING` | Tới lượt người chơi nhại lại | Player Recording Turn |
| `AI_SCORING` | `STATE_LABEL_AI_SCORING` | AI đang phân tích & chấm điểm | AI Analyzing & Scoring |
| `SHOWDOWN_REVEAL` | `STATE_LABEL_SHOWDOWN_REVEAL` | Showdown & Nghe lại các bản thu | Showdown & Playback Reveal |
| `ROUND_RESULT` | `STATE_LABEL_ROUND_RESULT` | Bảng xếp hạng vòng đấu | Round Leaderboard |
| `GAME_OVER` | `STATE_LABEL_GAME_OVER` | Trận đấu kết thúc | Game Over |

---

## 6. Bảng Mapping `AiRemarkCode` (14 mã nhận xét chấm điểm của AI)

| Enum Code | Hạng điểm (`grade`) | Tiếng Việt (`vi`) | Tiếng Anh (`en`) |
| :--- | :--- | :--- | :--- |
| `AI_REMARK_LEGENDARY_1` | `S` (`>= 90`) | 🔥 THÁNH NHẠI ÂM! Giống đến mức bản gốc phải xin chữ ký! | 🔥 MIMIC GOD! Even the original would ask for your autograph! |
| `AI_REMARK_LEGENDARY_2` | `S` (`>= 90`) | 🌟 10 điểm không có nhưng! Quá xuất thần! | 🌟 10 out of 10! Absolutely phenomenal! |
| `AI_REMARK_LEGENDARY_3` | `S` (`>= 90`) | 👑 Đỉnh cao thanh nhạc đường phố! Giống y đúc! | 👑 Peak vocal mastery! Identical to the sample! |
| `AI_REMARK_GOOD_1` | `A` (`75 - 89`) | 👏 Rất mượt mà! Khá giống bản gốc đấy! | 👏 Very smooth! Pretty close to the original! |
| `AI_REMARK_GOOD_2` | `A` (`75 - 89`) | ✨ Ấn tượng đấy, chỉ lệch một xíu cao độ thôi! | ✨ Impressive, just a tiny pitch difference! |
| `AI_REMARK_GOOD_3` | `A` (`75 - 89`) | 🎉 Khá lắm, nghe có nét rất riêng! | 🎉 Nice job, it has your own unique flair! |
| `AI_REMARK_FUNNY_1` | `B / C` (`35 - 74`) | 😂 Âm thanh này nghe giống tiếng bị nghẹt mũi hơn! | 😂 That sounded more like a stuffy nose! |
| `AI_REMARK_FUNNY_2` | `B / C` (`35 - 74`) | 🤔 Có gì đó sai sai... nhưng rất giải trí! | 🤔 Something went wrong... but very entertaining! |
| `AI_REMARK_FUNNY_3` | `B / C` (`35 - 74`) | 🤣 Nghe như phiên bản remix bị lỗi vậy! | 🤣 Sounds like a glitched remix version! |
| `AI_REMARK_FUNNY_4` | `B / C` (`35 - 74`) | 🚑 Cần gọi cấp cứu cho thanh quản của bạn không? | 🚑 Should we call an ambulance for your vocal cords? |
| `AI_REMARK_TERRIBLE_1` | `F` (`< 35`) | 💀 Tiếng gì đây trời?! AI xin phép từ chối nhận dạng! | 💀 What was that sound?! AI refuses to recognize it! |
| `AI_REMARK_TERRIBLE_2` | `F` (`< 35`) | 👻 Đang giả tiếng sinh vật ngoài hành tinh à? | 👻 Are you mimicking an alien creature? |
| `AI_REMARK_TERRIBLE_3` | `F` (`< 35`) | 🤐 Quên bật tiếng hay đang nhai micro vậy? | 🤐 Did you forget to unmute or are you chewing the mic? |
| `AI_REMARK_MISSED_RECORDING` | `F` (`0 - Missed`) | 😴 Không kịp thu âm nhại lại! | 😴 Missed the recording window! |

---

## 7. Bảng Mapping `RoomCloseReasonCode` (5 lý do đóng phòng)

| Enum Code | Tiếng Việt (`vi`) | Tiếng Anh (`en`) |
| :--- | :--- | :--- |
| `ROOM_CLOSED` | Phòng đấu đã đóng. | Room has been closed. |
| `HOST_CLOSED` | Chủ phòng đã chủ động đóng phòng đấu. | Host closed the room. |
| `ALL_MEMBERS_LEFT` | Tất cả thành viên đã rời khỏi phòng. | All members have left the room. |
| `EMPTY_ROOM_TIMEOUT` | Phòng trống quá thời gian chờ kết nối lại (30s). | Empty room timed out after 30s grace period. |
| `GC_ORPHAN_ROOM` | Hệ thống tự động thu hồi phòng trống không còn hoạt động. | Garbage collector cleaned up inactive orphan room. |

---

## 8. Bảng Mapping `SoundPackNameCode` & `SoundPackDescCode` (9 gói chủ đề)

| Pack ID | `name` (`SoundPackNameCode`) | `description` (`SoundPackDescCode`) | Emoji | Tiếng Việt (Tên - Mô tả) | Tiếng Anh (Name - Description) |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `animals` | `PACK_NAME_ANIMALS` | `PACK_DESC_ANIMALS` | 🐾 | Vương Quốc Động Vật — Nhại lại tiếng kêu của các loài vật hoang dã & thú cưng! | Animal Kingdom — Mimic wild animals and pets! |
| `meme` | `PACK_NAME_MEME` | `PACK_DESC_MEME` | 🎉 | Meme Huyền Thoại — Những âm thanh meme triệu view trên Internet! | Legendary Memes — Viral internet meme sound effects! |
| `voice1` | `PACK_NAME_VOICE1` | `PACK_DESC_VOICE1` | 🎙️ | Giọng Nói Viral — Nhại lại các câu thoại meme kinh điển! | Viral Voices — Iconic meme voice lines! |
| `anime` | `PACK_NAME_ANIME` | `PACK_DESC_ANIME` | ⚡ | Thế Giới Anime — Hiệu ứng & câu thoại Anime cực cháy! | Anime World — Epic anime voice lines and sound effects! |
| `voices` | `PACK_NAME_VOICES` | `PACK_DESC_VOICES` | 🗣️ | Biểu Cảm Giọng Người — Tiếng cười, tiếng ngáy và cảm xúc độc lạ! | Human Expressions — Laughs, snores, and quirky vocal reactions! |
| `robots` | `PACK_NAME_ROBOTS` | `PACK_DESC_ROBOTS` | 🤖 | Kỷ Nguyên Robot — Nhại tiếng máy móc, R2D2 và vũ khí sci-fi! | Robot Era — Sci-fi droids, R2D2, and laser sounds! |
| `yankee` | `PACK_NAME_YANKEE` | `PACK_DESC_YANKEE` | 💢 | Giang Hồ Nhật Bản — Tiếng gầm rú & nẹt pô kiểu Yankee! | Japanese Yankee — Tough anime delinquent shouts and bike revs! |
| `vehicles` | `PACK_NAME_VEHICLES` | `PACK_DESC_VEHICLES` | 🚗 | Còi Xe & Báo Động — Nhại tiếng còi tàu, còi hơi và chuông võ đài! | Vehicles & Sirens — Car horns, foghorns, and boxing bells! |
| `funny` | `PACK_NAME_FUNNY` | `PACK_DESC_FUNNY` | 😂 | Hài Hước Vui Nhộn — Tiếng lò xo, huýt sáo và em bé cười! | Funny & Silly — Cartoon springs, whistles, and baby giggles! |

---

## 9. Code Mẫu Tích hợp Nhanh cho Android (Kotlin)

AI Agent bên Android (`frontend/`) có thể copy trực tiếp helper class dưới đây để parse và localize mọi thông báo từ Backend:

```kotlin
package com.micmixfun.localization

object ServerEnumLocalizer {

    private val viDictionary: Map<String, String> = mapOf(
        // ErrorCode
        "INTERNAL_SERVER_ERROR" to "Đã xảy ra lỗi hệ thống ngoài ý muốn. Vui lòng thử lại!",
        "SOUNDS_DIRECTORY_READ_ERROR" to "Không thể đọc danh mục âm thanh trên máy chủ.",
        "AUTH_FIREBASE_TOKEN_INVALID" to "Firebase ID Token không hợp lệ hoặc đã hết hạn!",
        "AUTH_CHALLENGE_SIGNATURE_INVALID" to "Chữ ký xác thực thiết bị không hợp lệ hoặc bị giả mạo!",
        "AUTH_TOKEN_INVALID_OR_EXPIRED" to "Phiên đăng nhập không hợp lệ hoặc đã hết hạn!",
        "AUTH_IP_CONNECTION_LIMIT_EXCEEDED" to "Vượt quá số kết nối tối đa cho phép trên cùng 1 địa chỉ IP!",
        "ROOM_ID_REQUIRED" to "Vui lòng cung cấp mã phòng!",
        "ROOM_ID_ALREADY_EXISTS" to "Mã phòng đã tồn tại. Hãy thử mã khác!",
        "ROOM_NOT_FOUND" to "Phòng chơi không tồn tại hoặc đã giải tán!",
        "ROOM_NOT_JOINED" to "Bạn chưa tham gia phòng nào!",
        "ROOM_FULL" to "Phòng đã đầy ({maxMembers}/{maxMembers} người)!",
        "ROOM_HOST_ONLY_CLOSE" to "Chỉ có Chủ phòng (Host) mới có quyền đóng phòng!",
        "ROOM_HOST_ONLY_KICK" to "Chỉ có Chủ phòng mới có quyền mời thành viên ra khỏi phòng!",
        "ROOM_CANNOT_KICK_SELF" to "Bạn không thể tự mời chính mình ra khỏi phòng!",
        "ROOM_KICKED_BY_HOST" to "Bạn đã bị Chủ phòng mời ra khỏi phòng!",
        "PLAYER_NOT_IN_ROOM" to "Người chơi không còn trong phòng!",
        "RATE_LIMIT_CHAT_EXCEEDED" to "Bạn nhắn quá nhanh! Vui lòng đợi giây lát.",
        "RATE_LIMIT_SOUND_EXCEEDED" to "Thao tác phát âm thanh quá nhanh! Vui lòng đợi giây lát.",
        "ATTEMPT_AUDIO_NOT_FOUND" to "Không tìm thấy bản thu âm hoặc bản thu đã được giải phóng.",
        "GAME_NOT_FOUND" to "Trận đấu không tồn tại!",
        "GAME_HOST_ONLY_START" to "Chỉ có Chủ phòng (Host) mới có quyền bắt đầu trận đấu!",
        "GAME_PLAYERS_NOT_READY" to "Chưa thể bắt đầu! Còn thành viên chưa sẵn sàng: {unreadyPlayers}",
        "GAME_HOST_ONLY_CONFIG" to "Chỉ có Chủ phòng mới có quyền cấu hình trận đấu!",
        "GAME_CONFIG_LOCKED_IN_PROGRESS" to "Không thể đổi cấu hình khi trận đấu đang diễn ra!",
        "GAME_NOT_IN_RECORDING_PHASE" to "Hiện không trong thời gian thu âm!",
        "GAME_ALREADY_SUBMITTED_THIS_ROUND" to "Bạn đã nộp bài trong vòng này rồi!",
        "GAME_NOT_IN_SHOWDOWN_PHASE" to "Chưa tới giai đoạn Showdown Reveal!",
        "GAME_NOT_IN_READY_PHASE" to "Chưa tới giai đoạn xác nhận sẵn sàng qua vòng!",
        "BOT_HOST_ONLY_MANAGE" to "Chỉ có Chủ phòng mới có quyền thêm hoặc xóa Bot AI!",
        "BOT_CANNOT_MANAGE_IN_PROGRESS" to "Không thể thêm hoặc xóa Bot khi trận đấu đang diễn ra!",
        "BOT_NOT_FOUND" to "Không tìm thấy Bot AI trong phòng!",

        // SystemMessageCode
        "SYS_HOST_JOINED_ROOM" to "👑 Chủ phòng {userName} đã tham gia phòng!",
        "SYS_PLAYER_JOINED_ROOM" to "🎧 {userName} đã tham gia phòng!",
        "SYS_USER_LEFT_ROOM" to "{userName} đã rời phòng.",
        "SYS_HOST_CHANGED" to "👑 {newHostName} đã trở thành Chủ phòng mới!",
        "SYS_HOST_CLOSED_ROOM" to "👑 Chủ phòng {hostName} đã đóng phòng đấu!",
        "SYS_PLAYER_READY" to "{userName} đã SẴN SÀNG ✅",
        "SYS_PLAYER_UNREADY" to "{userName} đã hủy sẵn sàng ⏳",
        "SYS_SOUND_TRIGGERED" to "đã phát âm thanh \"{soundName}\"",
        "SYS_AUDIO_CLIP_SHARED" to "đã chia sẻ một đoạn ghi âm giọng nói 🎙️",
        "SYS_GAME_CONFIG_UPDATED" to "⚙️ Chủ phòng đã cập nhật: {totalRounds} vòng, thời gian nhại {recordDuration}s!",
        "SYS_BOT_JOINED_ROOM" to "🤖 Bot {botName} đã tham gia phòng đấu!",
        "SYS_BOT_REMOVED_FROM_ROOM" to "🤖 Bot {botName} đã rời khỏi phòng.",
        "SYS_MATCHMAKING_BOTS_FILLED" to "🤖 Không tìm thấy người chơi khác — Hệ thống đã tự động thêm {botsAdded} Bot AI vào phòng để bắt đầu trận đấu!",

        // GameMessageCode
        "GAME_MSG_PREPARE_RECORDING" to "Lấy hơi! Chuẩn bị micro để nhại lại trong {countdown} giây...",
        "GAME_MSG_USER_RECORDING" to "🎙️ TỚI LƯỢT BẠN! HÃY NHẠI LẠI NGAY VÀO MICRO!",
        "GAME_MSG_AI_SCORING" to "🤖 AI Voice Detector đang phân tích & đối chiếu phổ âm thanh...",
        "GAME_MSG_ALL_SKIP_CONFIRMED" to "🚀 Tất cả đã đồng ý! Đang mở Bảng Điểm Vòng...",
        "GAME_MSG_ALL_PLAYERS_READY_COUNTDOWN" to "🎉 Tất cả người chơi đã SẴN SÀNG! Bắt đầu trong {countdown} giây...",
        "GAME_MSG_GAME_OVER_CHAMPION" to "🏆 Chúc mừng {championName} đã trở thành Vua Nhại Giọng!",
        "GAME_MSG_GAME_OVER_FINISHED" to "Trận đấu kết thúc!",

        // StateLabelCode
        "STATE_LABEL_IDLE" to "Đang chờ tại sảnh",
        "STATE_LABEL_THEME_SELECTION" to "Đang quay chọn chủ đề âm thanh",
        "STATE_LABEL_PLAYING_SAMPLE" to "Đang phát âm thanh mẫu",
        "STATE_LABEL_PREPARE_RECORDING" to "Chuẩn bị lấy hơi & sẵn sàng micro (3s)",
        "STATE_LABEL_USER_RECORDING" to "Tới lượt người chơi nhại lại",
        "STATE_LABEL_AI_SCORING" to "AI đang phân tích & chấm điểm",
        "STATE_LABEL_SHOWDOWN_REVEAL" to "Showdown & Nghe lại các bản thu",
        "STATE_LABEL_ROUND_RESULT" to "Bảng xếp hạng vòng đấu",
        "STATE_LABEL_GAME_OVER" to "Trận đấu kết thúc",

        // AiRemarkCode
        "AI_REMARK_LEGENDARY_1" to "🔥 THÁNH NHẠI ÂM! Giống đến mức bản gốc phải xin chữ ký!",
        "AI_REMARK_LEGENDARY_2" to "🌟 10 điểm không có nhưng! Quá xuất thần!",
        "AI_REMARK_LEGENDARY_3" to "👑 Đỉnh cao thanh nhạc đường phố! Giống y đúc!",
        "AI_REMARK_GOOD_1" to "👏 Rất mượt mà! Khá giống bản gốc đấy!",
        "AI_REMARK_GOOD_2" to "✨ Ấn tượng đấy, chỉ lệch một xíu cao độ thôi!",
        "AI_REMARK_GOOD_3" to "🎉 Khá lắm, nghe có nét rất riêng!",
        "AI_REMARK_FUNNY_1" to "😂 Âm thanh này nghe giống tiếng bị nghẹt mũi hơn!",
        "AI_REMARK_FUNNY_2" to "🤔 Có gì đó sai sai... nhưng rất giải trí!",
        "AI_REMARK_FUNNY_3" to "🤣 Nghe như phiên bản remix bị lỗi vậy!",
        "AI_REMARK_FUNNY_4" to "🚑 Cần gọi cấp cứu cho thanh quản của bạn không?",
        "AI_REMARK_TERRIBLE_1" to "💀 Tiếng gì đây trời?! AI xin phép từ chối nhận dạng!",
        "AI_REMARK_TERRIBLE_2" to "👻 Đang giả tiếng sinh vật ngoài hành tinh à?",
        "AI_REMARK_TERRIBLE_3" to "🤐 Quên bật tiếng hay đang nhai micro vậy?",
        "AI_REMARK_MISSED_RECORDING" to "😴 Không kịp thu âm nhại lại!",

        // RoomCloseReasonCode
        "ROOM_CLOSED" to "Phòng đấu đã đóng.",
        "HOST_CLOSED" to "Chủ phòng đã chủ động đóng phòng đấu.",
        "ALL_MEMBERS_LEFT" to "Tất cả thành viên đã rời khỏi phòng.",
        "EMPTY_ROOM_TIMEOUT" to "Phòng trống quá thời gian chờ kết nối lại (30s).",
        "GC_ORPHAN_ROOM" to "Hệ thống tự động thu hồi phòng trống không còn hoạt động."
    )

    /**
     * Chuyển đổi mã Enum từ Server và nội suy các biến trong `params`
     */
    fun localize(code: String?, params: Map<String, Any?>? = null): String {
        if (code.isNullOrBlank()) return ""
        var template = viDictionary[code] ?: code
        params?.forEach { (key, value) ->
            template = template.replace("{$key}", value?.toString() ?: "")
        }
        return template
    }
}
```

---

## 10. Bảng Mapping `SOUND_NAME_*` & `SOUND_HINT_*` (53 âm thanh trong `SOUND_PACKS`)

| Sound ID | `name` Key | `hint` Key | Emoji | Tiếng Việt (Tên — Gợi ý cách nhại) | Tiếng Anh (Name — Mimic Hint) |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `cat-meow` | `SOUND_NAME_CAT_MEOW` | `SOUND_HINT_CAT_MEOW` | 🐱 | Mèo Kêu Meo Meo — Kêu "Mee-ooo" giọng mũi cao vút! | Cat Meow — High-pitched nasal "Mee-ooow"! |
| `animals_dog-bark` | `SOUND_NAME_DOG_BARK` | `SOUND_HINT_DOG_BARK` | 🐶 | Chó Sủa Gâu Gâu — Sủa "Gâu! Gâu!" dứt khoát từ cổ họng! | Dog Bark — Sharp "Woof! Woof!" from the throat! |
| `angry-cat` | `SOUND_NAME_ANGRY_CAT` | `SOUND_HINT_ANGRY_CAT` | 😾 | Mèo Quạo Khè — Gầm gừ rồi khè "Khèeee" thật gắt! | Angry Cat — Low growl followed by a sharp hiss! |
| `animals_duck-quack` | `SOUND_NAME_DUCK_QUACK` | `SOUND_HINT_DUCK_QUACK` | 🦆 | Vịt Kêu Cạp Cạp — Bóp giọng mũi kêu "Quạc quạc quạc"! | Duck Quack — Nasal "Quack quack quack"! |
| `animals_rooster` | `SOUND_NAME_ROOSTER` | `SOUND_HINT_ROOSTER` | 🐓 | Gà Trống Gáy — Lấy hơi sâu gáy "Ò ó o oooo" ngân dài! | Rooster Crow — Deep breath and long "Cock-a-doodle-doo"! |
| `animals_wolf-howl` | `SOUND_NAME_WOLF_HOWL` | `SOUND_HINT_WOLF_HOWL` | 🐺 | Sói Hú Đêm Trăng — Chu môi hú "A-uuuuuu" ngân vang! | Wolf Howl — Long echoing "Awooooo"! |
| `animals_frog-croak` | `SOUND_NAME_FROG_CROAK` | `SOUND_HINT_FROG_CROAK` | 🐸 | Ếch Kêu Ộp Ộp — Giọng trầm từ bụng "Ộp... ộp..."! | Frog Croak — Deep belly "Ribbit... ribbit..."! |
| `animals_lion-roar` | `SOUND_NAME_LION_ROAR` | `SOUND_HINT_LION_ROAR` | 🦁 | Sư Tử Gầm — Gầm "Gừ-aaaa" trầm và vang dội! | Lion Roar — Deep, powerful "Roooaaar"! |
| `animals_horse-neigh` | `SOUND_NAME_HORSE_NEIGH` | `SOUND_HINT_HORSE_NEIGH` | 🐴 | Ngựa Hí — Hí "Hí-hí-hí" cao giọng rồi thở phì! | Horse Neigh — High-pitched neigh followed by a snort! |
| `tiger` | `SOUND_NAME_TIGER` | `SOUND_HINT_TIGER` | 🐯 | Hổ Gầm Chúa Sơn Lâm — Gầm khàn và nặng từ cuống họng! | Tiger Growl — Raspy, heavy throat roar! |
| `turkey` | `SOUND_NAME_TURKEY` | `SOUND_HINT_TURKEY` | 🦃 | Gà Tây Kêu — Rung lưỡi liên tục "Gốc-gốc-gốc-gốc"! | Turkey Gobble — Rapid tongue flutter "Gobble-gobble"! |
| `airhorn-triple` | `SOUND_NAME_AIRHORN_TRIPLE` | `SOUND_HINT_AIRHORN_TRIPLE` | 🎺 | Còi Hơi MLG (Triple Airhorn) — Hét "Peeee-pe-pe-peeee" thật vang! | Triple Airhorn — Loud nasal "Bwaa-bwa-bwa-bwaaaa"! |
| `emotional-damage` | `SOUND_NAME_EMOTIONAL_DAMAGE` | `SOUND_HINT_EMOTIONAL_DAMAGE` | 💔 | Emotional Damage! — Nhấn mạnh chữ "E-MO-TION-AL DA-MAGE!" | Emotional Damage! — Dramatic "E-MO-TION-AL DA-MAGE!" |
| `bonk-metal` | `SOUND_NAME_BONK_METAL` | `SOUND_HINT_BONK_METAL` | 🔨 | Cú Gõ Bonk! — Phát âm "Bong!" ngắn và vang như gõ ống sắt! | Metal Bonk — Short, hollow metallic "BONK!" |
| `bruh-sound` | `SOUND_NAME_BRUH_SOUND` | `SOUND_HINT_BRUH_SOUND` | 😑 | Tiếng "Bruh" Bất Lực — Hạ tông giọng trầm hết cỡ: "Bruhhh..." | Bruh Sound — Deadpan low-pitched "Bruhhh..." |
| `vine-boom` | `SOUND_NAME_VINE_BOOM` | `SOUND_HINT_VINE_BOOM` | 💥 | Vine Boom Bass — Bụm miệng tạo tiếng trống trầm "BÙMmm"! | Vine Boom — Deep bass mouth thud "BOOOOM"! |
| `yeah-boi` | `SOUND_NAME_YEAH_BOI` | `SOUND_HINT_YEAH_BOI` | 😎 | Yeah Boiiii! — Ngân dài chữ "Yeahhhh Boiiiiii"! | Yeah Boi — Long rising "Yeahhhh Boiiiiii"! |
| `screaming-goat` | `SOUND_NAME_SCREAMING_GOAT` | `SOUND_HINT_SCREAMING_GOAT` | 🐐 | Dê Hét Thất Thanh — Hét "Áaaaa" như con dê đang hoảng loạn! | Screaming Goat — High panic human-like "Aaaah!" |
| `oof-roblox` | `SOUND_NAME_OOF_ROBLOX` | `SOUND_HINT_OOF_ROBLOX` | 🧱 | Roblox OOF — Phát âm "Uff!" ngắn gọn dứt khoát! | Roblox Oof — Short, punchy "OOF!" |
| `fbi-open-up` | `SOUND_NAME_FBI_OPEN_UP` | `SOUND_HINT_FBI_OPEN_UP` | 🚓 | FBI Open Up! — Hét dồn dập "FBI OPEN UP!" | FBI Open Up! — Aggressive "FBI OPEN UP!" |
| `why-are-you-running` | `SOUND_NAME_WHY_ARE_YOU_RUNNING` | `SOUND_HINT_WHY_ARE_YOU_RUNNING` | 🏃 | Why Are You Running?! — Giọng hoảng hốt "Why are you running?!" | Why Are You Running — Urgent accent "Why are you running?!" |
| `what-the-dog-doin` | `SOUND_NAME_WHAT_THE_DOG_DOIN` | `SOUND_HINT_WHAT_THE_DOG_DOIN` | 🐕 | What The Dog Doin? — Hỏi tỉnh bơ "What the dog doin?" | What The Dog Doin — Casual "What the dog doin?" |
| `bing-chilling` | `SOUND_NAME_BING_CHILLING` | `SOUND_HINT_BING_CHILLING` | 🍦 | Bing Chilling — Nói "Zao shang hao... BING CHILLING!" | Bing Chilling — Energetic "BING CHILLING!" |
| `he-need-some-milk` | `SOUND_NAME_HE_NEED_SOME_MILK` | `SOUND_HINT_HE_NEED_SOME_MILK` | 🥛 | He Need Some Milk! — Hốt hoảng "He need some milk!" | He Need Some Milk — Concerned "He need some milk!" |
| `among-us` | `SOUND_NAME_AMONG_US` | `SOUND_HINT_AMONG_US` | 📮 | Among Us Role Reveal — Tạo âm trầm "Đùng... đùng đùng..." | Among Us Reveal — Suspenseful low "Dun... dun-dun..." |
| `tuturu` | `SOUND_NAME_TUTURU` | `SOUND_HINT_TUTURU` | 🌟 | Tuturu~ (Mayuri) — Giọng cute cao vút "Tu-tu-ruuu~♪" | Tuturu~ — Cute high-pitched "Tu-tu-ruuu~♪" |
| `anime-wow` | `SOUND_NAME_ANIME_WOW` | `SOUND_HINT_ANIME_WOW` | 🌸 | Anime Wow~ — Ngân giọng lấp lánh "Waaaooo~" | Anime Wow — Sparkling amazed "Waaaooo~" |
| `sukuna-laugh` | `SOUND_NAME_SUKUNA_LAUGH` | `SOUND_HINT_SUKUNA_LAUGH` | 👹 | Điệu Cười Sukuna — Cười ngạo nghễ trầm khàn "Ha ha ha ha!" | Sukuna Laugh — Deep maniacal villain laugh! |
| `titan-roar` | `SOUND_NAME_TITAN_ROAR` | `SOUND_HINT_TITAN_ROAR` | 🔥 | Tiếng Gầm Titan — Gầm xé gió như Eren hóa Titan! | Titan Roar — Piercing feral monster roar! |
| `teleport` | `SOUND_NAME_TELEPORT` | `SOUND_HINT_TELEPORT` | ✨ | Dịch Chuyển Tức Thời — Phát âm "Chéo!" nhanh gọn như DBZ! | Instant Teleport — Quick sharp sci-fi "Zzzwip!" |
| `sword-slash` | `SOUND_NAME_SWORD_SLASH` | `SOUND_HINT_SWORD_SLASH` | ⚔️ | Kiếm Khí Chém Gió — Phát âm "Xoẹt! Keng!" thật sắc bén! | Sword Slash — Crisp metallic "Shing! Slash!" |
| `kono-dio-da` | `SOUND_NAME_KONO_DIO_DA` | `SOUND_HINT_KONO_DIO_DA` | 🧛 | Kono Dio Da! — Hét đầy kịch tính "KONO DIO DA!" | Kono Dio Da! — Dramatic anime shout "KONO DIO DA!" |
| `voices_evil-laugh` | `SOUND_NAME_EVIL_LAUGH` | `SOUND_HINT_EVIL_LAUGH` | 😈 | Điệu Cười Ác Quỷ — Cười "Muahahaha" thật nham hiểm! | Evil Laugh — Sinister "Muahahaha!" |
| `goofy-laugh` | `SOUND_NAME_GOOFY_LAUGH` | `SOUND_HINT_GOOFY_LAUGH` | 🤪 | Cười Ngố Tàu (Goofy) — Cười "A-hyuck! Hoo-hoo-hoo-hoo!" | Goofy Laugh — Silly "A-hyuck! Yah-hoo-hoo-hoo!" |
| `wheeze` | `SOUND_NAME_WHEEZE` | `SOUND_HINT_WHEEZE` | 🤣 | Cười Khàn Hết Hơi (Wheeze) — Cười rít hơi qua kẽ răng "Khìiiii..." | Wheeze Laugh — High-pitched breathless wheezing laugh! |
| `snoring` | `SOUND_NAME_SNORING` | `SOUND_HINT_SNORING` | 😴 | Tiếng Ngáy Khò Khò — Hít vào ngáy "Khòooo... ফুঁ..." | Loud Snoring — Deep inhale snore and whistle exhale! |
| `tada` | `SOUND_NAME_TADA` | `SOUND_HINT_TADA` | 🎩 | Ta-daaa! — Hô vang "Ta-daaa!" tươi vui! | Ta-da! — Cheerful "Ta-daaa!" fanfare! |
| `r2d2` | `SOUND_NAME_R2D2` | `SOUND_HINT_R2D2` | 🤖 | Robot R2-D2 — Huýt sáo kết hợp kêu "Bíp-bồ-bíp-uuu"! | R2-D2 — Electronic beeps, whistles, and droid warbles! |
| `walle` | `SOUND_NAME_WALLE` | `SOUND_HINT_WALLE` | 🌱 | Robot WALL-E — Giọng nghẹt mũi gọi "Uoo-all-E..." | WALL-E — Robotic nasal "Waaall-E..." |
| `transformer` | `SOUND_NAME_TRANSFORMER` | `SOUND_HINT_TRANSFORMER` | 🦾 | Robot Biến Hình — Kêu "Chư-cư-cư-cạc-cạc" theo nhịp cơ khí! | Transformer — Mechanical shifting "Chik-chuk-chika-chee"! |
| `laser-blast` | `SOUND_NAME_LASER_BLAST` | `SOUND_HINT_LASER_BLAST` | 🔫 | Súng Laser Sci-Fi — Kêu "Chíu! Chíu! Piu piu!" | Laser Blast — Rapid sci-fi "Pew! Pew! Pew!" |
| `kisama` | `SOUND_NAME_KISAMA` | `SOUND_HINT_KISAMA` | 💢 | Kisamaaa! — Gằn giọng trầm khàn "KI-SA-MAAA!" | Kisama! — Fierce gravelly "KI-SA-MAAA!" |
| `temee` | `SOUND_NAME_TEMEE` | `SOUND_HINT_TEMEE` | 🔥 | Temeee! — Quát lớn rung lưỡi "TE-ME-RAAA!" | Temee! — Rolled-R delinquent shout "TE-MEEE!" |
| `motorcycle-rev` | `SOUND_NAME_MOTORCYCLE_REV` | `SOUND_HINT_MOTORCYCLE_REV` | 🏍️ | Nẹt Pô Xe Phân Khối Lớn — Rung môi "Bừm-bừm-bừmmmm"! | Motorcycle Rev — Aggressive engine rev "Vroom-vroom-braaap!" |
| `car-horn-honk` | `SOUND_NAME_CAR_HORN_HONK` | `SOUND_HINT_CAR_HORN_HONK` | 🚗 | Còi Ô Tô — Bấm còi "Bíp! Bíp!" hai nhịp rõ ràng! | Car Horn — Double nasal "Beep! Beep!" |
| `ship-foghorn` | `SOUND_NAME_SHIP_FOGHORN` | `SOUND_HINT_SHIP_FOGHORN` | 🚢 | Còi Tàu Thủy — Ngân giọng trầm nhất có thể "Ùuuuuuu..." | Ship Foghorn — Ultra-low booming "Bwooooooom..." |
| `air-raid-horn` | `SOUND_NAME_AIR_RAID_HORN` | `SOUND_HINT_AIR_RAID_HORN` | 🚨 | Còi Báo Động — Hú từ trầm lên cao "Uuuuu-íiiii-uuuuu"! | Air Raid Siren — Rising and falling wail "Woooo-weeee"! |
| `boxing-bell` | `SOUND_NAME_BOXING_BELL` | `SOUND_HINT_BOXING_BELL` | 🥊 | Chuông Võ Đài — Kêu "Keng! Keng! Keng!" ngân vang! | Boxing Bell — Sharp metallic "Ding! Ding! Ding!" |
| `train-horn` | `SOUND_NAME_TRAIN_HORN` | `SOUND_HINT_TRAIN_HORN` | 🚂 | Còi Tàu Hỏa — Kêu "Tu-tuuuu" vang như đoàn tàu! | Train Horn — Classic "Choo-chooooo!" horn! |
| `burp-slide` | `SOUND_NAME_BURP_SLIDE` | `SOUND_HINT_BURP_SLIDE` | 🍺 | Tiếng Ợ Hơi Dài — Giả tiếng "Ợoooo" trầm và kéo dài! | Giant Burp — Deep, long comical "Buuuurp"! |
| `boing-spring` | `SOUND_NAME_BOING_SPRING` | `SOUND_HINT_BOING_SPRING` | 🪀 | Lò Xo Nhún (Boing) — Búng giọng "Tưng-ưng-ưng-ưng"! | Boing Spring — Bouncy "Boing-oing-oing"! |
| `crazy-whistle` | `SOUND_NAME_CRAZY_WHISTLE` | `SOUND_HINT_CRAZY_WHISTLE` | 😗 | Tiếng Huýt Sáo Vui Nhộn — Huýt sáo luyến láy lên xuống! | Crazy Whistle — Slide whistle up and down! |
| `baby-giggle` | `SOUND_NAME_BABY_GIGGLE` | `SOUND_HINT_BABY_GIGGLE` | 👶 | Em Bé Cười Khúc Khích — Cười giọng cao "Hí hí ha ha"! | Baby Giggle — High-pitched innocent "Hehehe-hahaha"! |
| `whip-crack` | `SOUND_NAME_WHIP_CRACK` | `SOUND_HINT_WHIP_CRACK` | 🤠 | Tiếng Quất Roi — Hít gió "Vút — CHÁT!" thật đanh! | Whip Crack — Fast whoosh followed by a sharp "CRACK!" |

---

## 11. 🤖 Giao thức Tích hợp Tính năng AI Bot (Khi tìm User không thấy / Phòng ít người)

### 11.1. Tìm trận nhanh (`find_match` / `quick_match`) — Không thấy User khác ➔ Tự thêm 3 Bot & Bắt đầu ngay
Khi Client tìm trận hoặc tìm người chơi khác (`find_match` hoặc `quick_match`):
- Nếu đang có phòng chờ (`IDLE`) của người chơi khác ➔ Tự động ghép vào phòng đó (`matchedWithHumans: true`).
- Nếu **KHÔNG tìm thấy người chơi nào khác** (`matchedWithHumans: false`) ➔ Server **tự động tạo phòng mới, thêm mặc định 3 AI Bot (tổng 4 người chơi với độ khó đa dạng `NORMAL`, `EASY`, `HARD`) và bắt đầu Gameplay ngay lập tức (`autoStarted: true`)**!

```json
// Client emit "find_match" (hoặc "quick_match"):
{
  "userName": "CaoThuNhaiGiong",
  "avatar": "🎧",
  "botCount": 3,
  "autoStart": true
}

// Callback (và sự kiện "match_found" / "joined_room_success") trả về:
{
  "success": true,
  "matchedWithHumans": false,
  "botsAdded": 3,
  "autoStarted": true,
  "roomId": "K8X9P2",
  "room": {
    "id": "K8X9P2",
    "hostId": "...",
    "members": [ /* 1 User + 3 AI Bots */ ]
  },
  "gameState": { /* State THEME_SELECTION đang chạy vòng 1 */ }
}
```

### 11.2. Hết thời gian tìm người trong phòng hoặc Bắt đầu trận khi ít người (`game_start` / `matchmaking_timeout` / `fill_bots_and_start`)
Khi Chủ phòng đang đợi ở sảnh mà không tìm thấy thêm người chơi (hoặc hết thời gian tìm trận `matchmaking_timeout`), chỉ cần emit `game_start` (hoặc `matchmaking_timeout` / `fill_bots_and_start`):
- Mặc định `minPlayers = 4`: Nếu phòng chỉ có 1 người chơi, Server tự động thêm **3 AI Bot** (nếu có 2 người thì thêm **2 AI Bot**, nếu có 3 người thì thêm **1 AI Bot**) để đủ bàn 4 người và bắt đầu vòng 1 ngay!
- Đồng thời Server broadcast sự kiện `bots_auto_filled` kèm mã `SYS_MATCHMAKING_BOTS_FILLED`.

```json
// Client (Host) emit "game_start" (hoặc "matchmaking_timeout" / "fill_bots_and_start"):
{
  "roomId": "ROOM01",
  "requireAllReady": false,
  "autoFillBots": true,
  "minPlayers": 4
}

// Callback trả về:
{
  "success": true,
  "botsAdded": 3,
  "totalPlayers": 4
}
```
- Nếu muốn truyền số lượng Bot cố định: truyền `"botCount": 3`.
- Nếu muốn tắt tự động thêm Bot: truyền `"autoFillBots": false`.

### 11.3. Chủ phòng Thêm Bot thủ công tại sảnh (`add_bot`)
```json
// Client (Host) emit "add_bot":
{
  "roomId": "ROOM01",
  "difficulty": "NORMAL",
  "botName": "Bot Shib",
  "avatar": "🐶"
}

// Server broadcast "bot_added" & "user_joined" tới cả phòng:
{
  "bot": {
    "socketId": "bot_x8k2p",
    "userId": "bot_x8k2p",
    "userName": "Bot Shib",
    "avatar": "🐶",
    "role": "PLAYER",
    "isReady": true,
    "isBot": true,
    "botDifficulty": "NORMAL"
  },
  "members": [ ... ],
  "systemMessage": "SYS_BOT_JOINED_ROOM",
  "messageCode": "SYS_BOT_JOINED_ROOM",
  "messageParams": {
    "botName": "Bot Shib",
    "userName": "Bot Shib",
    "difficulty": "NORMAL"
  }
}
```

### 11.4. Chủ phòng Xóa Bot (`remove_bot` hoặc `kick_player`)
```json
// Client (Host) emit "remove_bot" (nếu bỏ trống botSocketId sẽ xóa Bot vừa thêm gần nhất):
{
  "roomId": "ROOM01",
  "botSocketId": "bot_x8k2p"
}

// Server broadcast "bot_removed" & "user_left" tới cả phòng:
{
  "removedBot": {
    "socketId": "bot_x8k2p",
    "userName": "Bot Shib",
    "isBot": true
  },
  "members": [ ... ],
  "systemMessage": "SYS_BOT_REMOVED_FROM_ROOM",
  "messageCode": "SYS_BOT_REMOVED_FROM_ROOM",
  "messageParams": {
    "botName": "Bot Shib",
    "userName": "Bot Shib"
  }
}
```

### 11.5. Đặc điểm của AI Bot trong các Giai đoạn Game
1. **Nhận diện trên UI:** Mọi object member/player của Bot đều có `"isBot": true`, `"botDifficulty": "EASY" | "NORMAL" | "HARD"`, và `socketId` bắt đầu bằng `"bot_"`.
2. **Không bao giờ chặn phòng:**
   - Tại sảnh chờ (`IDLE`): Bot luôn `isReady: true`.
   - Tại pha phát mẫu (`PLAYING_SAMPLE`): Bot tự động đánh dấu đã nghe xong mẫu.
   - Tại pha thu âm (`USER_RECORDING`): Ngay khi tất cả người chơi thật nộp bài thu âm, Bot đã có sẵn điểm chấm mô phỏng theo độ khó (`EASY`: 50–73đ, `NORMAL`: 68–88đ, `HARD`: 82–97đ) và `audioUrl` trỏ về âm thanh mẫu trên R2 CDN để phát lại trong `SHOWDOWN_REVEAL`.
   - Tại pha `SHOWDOWN_REVEAL`: Bot tự động vote skip (`showdownSkipVotes`), nên chỉ cần tất cả người chơi thật bấm Skip là chuyển thẳng sang bảng điểm.
   - Tại pha `ROUND_RESULT` & `GAME_OVER`: Bot tự động `isReady: true`, nên chỉ cần người chơi thật bấm Sẵn sàng là đếm ngược 3s qua vòng mới ngay lập tức.
   - Khi tất cả người chơi thật rời phòng: Toàn bộ Bot trong phòng sẽ tự động được dọn dẹp và giải phóng RAM.
