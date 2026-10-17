# 🚀 Hướng Dẫn Tối Ưu Hóa Phía Client Để Giảm Tải Cho Server (Web & Android)

Tài liệu này quy định các nguyên tắc kỹ thuật và Best Practices bắt buộc đối với **Client (Android Kotlin & Web)** khi giao tiếp với **MicMixFun & Mimic Party Server**, nhằm giảm tải CPU, RAM và băng thông mạng cho Server khi vận hành nhiều phòng đồng thời.

---

## 1. 🎙️ Nén & Tối Ưu Hóa Audio Trước Khi Gửi (`game_submit_audio` & `share_audio_clip`)

Băng thông lớn nhất của hệ thống nằm ở bước người chơi nộp bản thu âm nhại giọng. Client **tuyệt đối không gửi dữ liệu PCM/WAV thô** chưa nén.

### 1.1. Cấu hình chuẩn khi thu âm (Audio Recording Specs)
* **Số kênh (Channels)**: Bắt buộc dùng **Mono (`1 kênh`)**. Giọng nói micro không cần Stereo (giảm ngay **50%** dung lượng).
* **Tần số lấy mẫu (Sample Rate)**: Dùng **`16,000 Hz`** hoặc **`24,000 Hz`** (tối đa `44,100 Hz`).
* **Định dạng nén & Bitrate**:
  * **Web**: `audio/webm;codecs=opus` với `audioBitsPerSecond: 24000` (24 kbps).
  * **Android**: `MediaRecorder.OutputFormat.MPEG_4` + `AudioEncoder.AAC` (hoặc `OGG/Opus`), Bitrate `24,000 - 32,000 bps`.
  * 👉 Với cấu hình này, 1 bản thu 5 giây chỉ nặng **~15 KB – 22 KB** (nhẹ hơn **30 lần** so với WAV thô).

**Ví dụ trên Web (`MediaRecorder`):**
```javascript
const options = {
  mimeType: MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
    ? 'audio/webm;codecs=opus'
    : 'audio/webm',
  audioBitsPerSecond: 24000 // 24 kbps - Rất nhẹ nhưng giữ nguyên độ nét giọng nói
};
const mediaRecorder = new MediaRecorder(stream, options);
```

**Ví dụ trên Android (Kotlin):**
```kotlin
MediaRecorder(context).apply {
    setAudioSource(MediaRecorder.AudioSource.MIC)
    setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
    setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
    setAudioChannels(1)           // Mono
    setAudioSamplingRate(24000)   // 24 kHz
    setAudioEncodingBitRate(24000)// 24 kbps
    setOutputFile(outputFile.absolutePath)
}
```

### 1.2. Loại bỏ bản thu im lặng (Silence Filtering tại Client)
* Trong quá trình thu âm, nếu phát hiện người dùng **không phát ra âm thanh** (`activeRatio < 0.05` hoặc biên độ đỉnh `< ngưỡng ồn nền`):
  * **KHÔNG gửi chuỗi Base64 của file âm thanh trắng** lên Server.
  * Chỉ gửi payload nhẹ báo rỗng để Server chấm 0đ / Hạng F ngay lập tức:
    ```json
    {
      "roomId": "MIMIC99",
      "audioData": null,
      "metrics": { "matchPct": 0, "activeRatio": 0 }
    }
    ```

### 1.3. Chốt chặn chỉ gửi 1 lần mỗi vòng & Giới hạn dung lượng tối đa (`decodeBoundedBase64Audio`)
* Đặt cờ `hasSubmittedCurrentRound = true` ngay khi gọi `socket.emit('game_submit_audio', ...)`.
* Không cho phép gọi lại `game_submit_audio` cho đến khi nhận được `game_state_changed` của vòng mới.
* **Ngưỡng bảo vệ bộ nhớ trên Server (`decodeBoundedBase64Audio`)**:
  * `game_submit_audio` & `share_audio_clip`: Tối đa **`512 KB`** (`MAX_USER_AUDIO_UPLOAD_BYTES`).
  * `game_submit_bot_audio`: Tối đa **`350 KB`** (`MAX_BOT_AUDIO_UPLOAD_BYTES`).
  * Các payload vượt ngưỡng sẽ bị Server từ chối ngay trước khi cấp phát `Buffer` (`AUDIO_PAYLOAD_TOO_LARGE`).

---

## 2. 🧠 Tính Toán DSP & Chấm Điểm Sơ Bộ Tại Client (`clientMetrics`)

Thay vì bắt Server phải giải mã (decode) và chạy biến đổi Fourier (FFT) cho hàng trăm bản thu cùng lúc khi chuyển sang `AI_SCORING`, Client đã có sẵn luồng PCM/Analyser thời gian thực trong lúc vẽ biểu đồ sóng kép (`USER_RECORDING`).

* **Việc Client cần làm**:
  1. Lấy mẫu 70 điểm biên độ chuẩn hóa (`0.0 -> 1.0`) của âm thanh mẫu (`sampleWaveformPoints`) và giọng thu từ micro (`userWavePoints`).
  2. Tính toán sẵn 4 chỉ số đặc trưng trong lúc thu âm và đính kèm vào trường `metrics` khi gọi `game_submit_audio`:
     ```json
     {
       "roomId": "MIMIC99",
       "audioData": "data:audio/webm;base64,...",
       "mimeType": "audio/webm",
       "metrics": {
         "matchPct": 86,
         "activeRatio": 0.72,
         "energyScore": 88,
         "rhythmScore": 84
       }
     }
     ```
* **Lợi ích cho Server**: Server chỉ mất `< 0.1ms` để kiểm tra chéo (single-pass decode) và tổng hợp bảng xếp hạng thay vì tốn CPU giải mã lại từng file âm thanh.

---

## 3. 🔊 Tối Ưu Tải & Phát Âm Thanh (Audio Caching, Lazy Streaming & 1:1 Bot DSP)

### 3.1. Cache kho âm thanh mẫu (`/downloaded_sounds/*`)
* Các tệp âm thanh mẫu trong game là **bất biến (immutable)**.
* **Android**: Sử dụng `OkHttp Cache` hoặc lưu file vào `context.cacheDir` theo `targetSound.id`. Trước khi tải `targetSound.audioUrl`, kiểm tra xem file đã có trong máy chưa.
* **Web**: Tận dụng HTTP Cache của trình duyệt hoặc `CacheStorage` (Service Worker).
* **Danh mục `/api/mimic-packs` & `/api/sounds`**: Chỉ fetch **1 lần duy nhất** khi khởi động ứng dụng và lưu vào biến toàn cục / Local Storage.

### 3.2. Sử dụng HTTP Stream URL ở pha `SHOWDOWN_REVEAL` (Ngưỡng `4KB`)
* Ở pha `SHOWDOWN_REVEAL`, mỗi phần tử trong `payload.attempts` có cung cấp:
  * `audioStreamUrl`: `/api/attempts/:roomId/:socketId?r=...` (Endpoint stream nhị phân trực tiếp qua HTTP).
  * `audioUrl`: Chỉ giữ inline Base64 nếu bản thu siêu nhỏ (`< 4KB` / `4096` ký tự), còn lại **mặc định trỏ sang đường dẫn HTTP stream (`/api/attempts/:roomId/:socketId?r=...`)** để giữ gói JSON của `game_state_changed` luôn nhẹ (`~2KB`), không làm nghẽn Socket.IO.
* **Lưu ý cho Client**:
  * Không tự động tải và phát đồng loạt tất cả bản thu của mọi người chơi cùng lúc.
  * Sử dụng `preload="metadata"` hoặc `preload="none"` trên thẻ `<audio>` (hoặc chỉ khởi tạo `MediaPlayer` trên Android khi người dùng bấm nút **Nghe lại** của người chơi đó).

### 3.3. Quota 1:1 khi Gen Sound cho AI Bot (`CLIENT_UPLOAD` vs `LIVE_PLAYBACK_DSP`)
* Ngay từ đầu vòng (`5.0 THEME_SELECTION`), Server gửi danh sách `botAssignments`:
  * **Mỗi máy Client chỉ chịu trách nhiệm render & upload tối đa `1 Bot` mỗi vòng** (`botGenerationMode: "CLIENT_UPLOAD"` khi `assignedGeneratorSocketId === socket.id`).
  * Các Bot dư ra (khi số Bot nhiều hơn số người thật trong phòng) có `botGenerationMode: "LIVE_PLAYBACK_DSP"`. Với các Bot này, Client **không cần render file hay upload lên Server**; khi người chơi bấm nghe ở màn `SHOWDOWN_REVEAL`, Client chỉ cần phát trực tiếp `targetSound.url` qua bộ lọc `botAudioEffects` thời gian thực.

---

## 4. ⚡ Giảm Tải Sự Kiện Socket.IO Thời Gian Thực (Throttling & Debouncing)

| Sự kiện Socket | Vấn đề nếu không kiểm soát | Quy tắc bắt buộc tại Client |
| :--- | :--- | :--- |
| **`game_emoji_reaction`** | Người chơi bấm liên thanh 50 lần/giây gây bão broadcast cho cả phòng | **Throttle 300ms/lần** (tối đa ~3 emoji/giây mỗi người). Hiệu ứng của chính mình thì vẽ local ngay, nhưng chỉ emit lên server mỗi 300ms. |
| **`sample_playback_done`** | Gửi lặp lại nhiều lần hoặc gửi khi không ở state `PLAYING_SAMPLE` | Chỉ emit **đúng 1 lần** trong sự kiện `audio.onended` khi `currentState === 'PLAYING_SAMPLE'`. |
| **`mic_stream_chunk`** | Bắn gói tin âm thanh quá nhỏ (mỗi 10ms) làm nghẽn Event Loop | Gom buffer theo chu kỳ **80ms – 120ms/chunk**, tích hợp VAD (Voice Activity Detection) để ngắt gửi khi người dùng im lặng. |
| **`get_game_state`** | Gọi polling liên tục để cập nhật đồng hồ | **CẤM dùng polling**. Chỉ gọi `get_game_state` đúng 1 lần khi vừa kết nối lại sau khi rớt mạng hoặc khi app từ Background quay lại Foreground. |

---

## 5. 🔄 Quản Lý Kết Nối, Bỏ Cơ Chế Reconnect ("Đã Out Là Out Hẳn") & Giải Tán Phòng Tự Động

1. **Bỏ hoàn toàn cơ chế tự động Reconnect (Đã Out là Out hẳn)**:
   * Khi người chơi thoát giữa trận (`leave_room`, `cancel_match`, ngắt kết nối hoặc bấm mở `create_room`), người chơi bị xóa vĩnh viễn khỏi phòng cũ (`restoredSession: false, totalScore: 0`).
   * **Client BẮT BUỘC xóa ngay `currentRoomId = null` khi rời phòng** để khi mở sang màn hình `create_room` không gửi nhầm `roomId` của phòng `quick_match` / `race_1v1` trước đó.
   * Phòng `QUICK_MATCH` và `RACE_1V1` **tuyệt đối không cho phép `join_room`** dưới mọi hình thức (`ROOM_NOT_FOUND`). Chỉ phòng `CUSTOM_ROOM` mới cho phép vào phòng khi người dùng chủ động nhập lại mã Code phòng qua `join_room`.

2. **Xử lý Popup Find Match + Số người đã Accept (`match_found` / `match_accept_updated` / `accept_match`)**:
   * Khi tìm đủ `4/4` người ở `QUICK_MATCH` hoặc `2/2` người ở `RACE_1V1` (gồm cả người thật hoặc người thật + AI Bot khi hết giờ tìm trận), Server phát `match_found` và `match_accept_updated` với `state: "MATCH_FOUND"`, `showMatchFoundPopup: true`, `acceptedCount`, `totalPlayers`, `members`.
   * Tất cả AI Bot đã được tính là Accept sẵn (`isAccepted: true`). Client hiển thị **Popup Find Match** kèm tiến độ `acceptedCount / totalPlayers` (ví dụ `3/4`) và gọi `socket.emit('accept_match', { roomId })` khi người chơi bấm nút Accept. Khi đủ `100%` người chơi Accept (hoặc hết `5s` đếm ngược), Server phát `match_all_accepted` và chuyển sang Step `5.0 THEME_SELECTION`.

3. **Xử lý khi phòng `QUICK_MATCH` / `RACE_1V1` giải tán ngay ở `5.10 GAME_OVER` (`roomDisbanded: true`)**:
   * Đối với 2 chế độ tìm trận tự động (`QUICK_MATCH` 4 người và `RACE_1V1` 2 người), ngay khi Server phát sự kiện `5.10 GAME_OVER`, phòng chơi đã được **xóa sổ ngay lập tức trên Server (`roomDisbanded: true`, `autoRestart: false`, `duration: 0`)** và người chơi trở về trạng thái **Online** (ngoài phòng).
   * Client vẫn hiển thị bảng tổng kết Podium từ dữ liệu trong gói `GAME_OVER` vừa nhận, nhưng **không gọi các API của phòng cũ nữa**. Khi người dùng bấm *"Chơi Tiếp / Tìm Trận Mới"*, Client gọi lại `quick_match` hoặc `race_1v1`.

4. **Chỉ duy trì 1 kết nối Socket (Singleton Socket Instance)**:
   * Trên Android, khởi tạo Socket.IO bên trong `Singleton Repository` hoặc `Service`, **không khởi tạo lại `IO.socket()` trong `Activity.onCreate()` hay `Fragment`** mỗi khi xoay màn hình.
   * Khi người dùng thoát hẳn khỏi màn hình chơi game, gọi `socket.emit('leave_room')` để Server giải phóng RAM của phòng ngay lập tức (`0ms`).

5. **Ràng buộc dữ liệu đầu vào ngay tại UI (Client-side Validation)**:
   * Giới hạn ô nhập `userName` tối đa **20 ký tự**, `roomId` tối đa **16 ký tự**, tin nhắn chat tối đa **500 ký tự** trước khi emit lên Server.

---

## 6. 🛡️ Chống Server Trung Gian (Anti-MITM / Anti-Relay Proxy / Anti-Fake Auth)

Để ngăn chặn kịch bản Hacker dựng một **Server trung gian** đứng giữa (vừa giả làm Client lấy Token từ Firebase/App thật, vừa móc nối hoặc relay lưu lượng vào Server của mình):

### 6.1. Bật Firebase App Check + Play Integrity (Bắt buộc trên Android)
* Trên Firebase Console, kích hoạt **Firebase App Check** với nhà cung cấp **Play Integrity** (Android) và **DeviceCheck / App Attest** (iOS).
* Khi bật tính năng này, chỉ bản build APK/AAB chính chủ (khớp chữ ký `SHA-256 signing certificate` trên Google Play và chạy trên thiết bị Android thật không bị root/hook) mới gọi được `FirebaseAuth.getInstance().signInAnonymously()`.
* Bất kỳ Server trung gian hay script Node.js/Python nào dùng API Key của project để tự gọi API tạo user ẩn danh đều sẽ bị Google chặn ngay từ cửa.

### 6.2. Ghim Chứng Chỉ SSL (SSL/TLS Certificate Pinning trên Android)
* Cấu hình `CertificatePinner` trong `OkHttpClient` (dùng chung cho cả REST API và `IO.socket` của Socket.IO) hoặc khai báo trong `res/xml/network_security_config.xml`:
  ```kotlin
  val certificatePinner = CertificatePinner.Builder()
      .add("your-domain.com", "sha256/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=")
      .build()
  val okHttpClient = OkHttpClient.Builder()
      .certificatePinner(certificatePinner)
      .build()
  ```
* Điều này đảm bảo App trên máy người dùng **chỉ nói chuyện trực tiếp với Server thật**, không thể bị DNS Spoofing hay Proxy trung gian (Charles, mitmproxy, Fake Server) đứng giữa đọc trộm hoặc đánh cắp `firebaseIdToken` / `authToken`.

### 6.3. Cơ chế Ràng Buộc Thiết Bị & IP (`Client Fingerprint` + `One-Time Challenge Nonce`)
Server đã tích hợp sẵn 3 lớp khóa trong `server.js`:
1. **Token Binding (`fp` - Client Fingerprint)**:
   * Khi cấp `authToken`, Server tính mã băm `fp = SHA256(clientIP + deviceId/UserAgent + AUTH_SECRET)` và nhúng vào chữ ký HMAC của Token.
   * Nếu Hacker lấy `authToken` từ máy người dùng rồi mang sang **Server trung gian** (có địa chỉ IP hoặc môi trường khác) để kết nối Socket vào Server mình, hàm `verifyAuthToken()` sẽ phát hiện lệch `fp` và từ chối ngay lập tức.
2. **One-Time Challenge–Response (`GET /api/auth/challenge`)**:
   * Trước khi gọi `/api/auth/firebase` hoặc `/api/auth/guest`, App gọi `GET /api/auth/challenge` để lấy `nonce` (chỉ có hiệu lực **30 giây**, dùng **1 lần duy nhất**, và **khóa cứng theo IP gọi lấy nonce**).
   * App tính chữ ký:
     $$\text{challengeSig} = \text{HMAC\_SHA256}(\text{"nonce:timestamp:firebaseUid"}, \text{APP\_SIGNING\_SECRET})$$
     (lưu `APP_SIGNING_SECRET` trong tầng C++ Native NDK / JNI của Android để chống dịch ngược).
3. **Giới hạn kết nối trên mỗi IP (`MAX_CONNECTIONS_PER_IP = 15`)**:
   * Chặn đứng kịch bản 1 Server trung gian (1 IP) mở hàng trăm kết nối Socket đại diện cho nhiều user giả mạo vào Server.

