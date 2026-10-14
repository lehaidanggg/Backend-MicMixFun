const { io } = require('socket.io-client');

const SERVER_URL = 'http://localhost:3000';
const ROOM_ID = 'TESTWAVE_' + Date.now();

async function runTest() {
  console.log(`\n==================================================================`);
  console.log(`🧪 TEST: AUDIO DONE TRIGGER, DUAL WAVEFORM DURATION & SCORING SUSPENSE`);
  console.log(`==================================================================\n`);

  const client1 = io(SERVER_URL);
  const client2 = io(SERVER_URL);

  await new Promise(r => setTimeout(r, 400));

  // 1. Join room
  await new Promise(res => {
    client1.emit('join_room', { roomId: ROOM_ID, userName: 'HostHero', avatar: '🦁' }, () => {
      client2.emit('join_room', { roomId: ROOM_ID, userName: 'MimicSinger', avatar: '🎤' }, res);
    });
  });
  console.log('✅ Bước 1: 2 người chơi đã join phòng thành công.');

  let targetSoundData = null;
  let playingSampleTime = null;
  let receivedPrepareState = false;
  let receivedAiScoringState = false;
  let aiScoringDuration = null;
  let aiScoringTicks = [];

  // Lắng nghe nhịp tick
  client1.on('game_state_tick', (tick) => {
    if (tick.state === 'AI_SCORING') {
      aiScoringTicks.push(tick.timeRemaining);
      console.log(`   [Tick] 🤖 AI_SCORING hồi hộp còn ${tick.timeRemaining}s...`);
    } else if (tick.state === 'PREPARE_RECORDING') {
      console.log(`   [Tick] 🧘 PREPARE_RECORDING còn ${tick.timeRemaining}s...`);
    }
  });

  const testPromise = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Test timeout sau 40s!'));
    }, 40000);

    client1.on('game_state_changed', async (data) => {
      console.log(`\n🔄 [State Changed] => ${data.state} (Duration: ${data.duration}s, Round: ${data.round})`);

      if (data.state === 'PLAYING_SAMPLE') {
        targetSoundData = data.payload.targetSound;
        playingSampleTime = Date.now();
        console.log(`🔊 PLAYING_SAMPLE: "${targetSoundData.name}"`);
        console.log(`   Audio URL: ${targetSoundData.audioUrl}`);
        console.log(`   Độ dài chính xác (exactDuration): ${targetSoundData.exactDuration}s | Fallback timer: ${data.duration}s`);

        if (!targetSoundData.exactDuration || targetSoundData.exactDuration <= 0) {
          clearTimeout(timeout);
          reject(new Error('❌ FAIL: exactDuration không tồn tại hoặc <= 0!'));
          return;
        }

        // Mô phỏng client phát audio sau 1.2s -> audio kết thúc (onended) -> emit sample_playback_done
        console.log(`   ⏳ Client đang phát audio mẫu và hiển thị biểu đồ Cyan...`);
        setTimeout(() => {
          console.log(`   👉 Client phát xong toàn bộ audio (onended) -> emit "sample_playback_done"!`);
          client1.emit('sample_playback_done', { roomId: ROOM_ID });
        }, 1200);

      } else if (data.state === 'PREPARE_RECORDING') {
        receivedPrepareState = true;
        const timeFromSample = (Date.now() - playingSampleTime) / 1000;
        console.log(`🧘 PREPARE_RECORDING: Đã chuyển sang đệm chuẩn bị sau ${timeFromSample.toFixed(2)}s (ngay khi audio phát xong)!`);
        console.log(`   Độ dài đệm chuẩn bị: ${data.duration}s (Đếm 3..2..1)`);

        if (data.duration !== 3) {
          clearTimeout(timeout);
          reject(new Error(`❌ FAIL: PREPARE_RECORDING phải có thời lượng 3s, nhận được: ${data.duration}s`));
          return;
        }
        console.log(`✅ PASS: Phát xong sound mẫu -> kích hoạt đếm 3, 2, 1 ngay lập tức!`);

      } else if (data.state === 'USER_RECORDING') {
        console.log(`🎙️ USER_RECORDING: Tới lượt user nhại lại!`);
        console.log(`   Thời gian thu âm: ${data.duration}s (Bằng đúng độ dài sound gốc: ${targetSoundData.exactDuration}s)`);
        console.log(`   Giao diện hiển thị Biểu đồ kép: Sóng mẫu (Cyan 40%) + Giọng nhại User (Neon Pink 95%)`);

        if (Math.abs(data.duration - Math.ceil(targetSoundData.exactDuration)) > 1) {
          clearTimeout(timeout);
          reject(new Error(`❌ FAIL: Thời gian USER_RECORDING (${data.duration}s) không khớp với độ dài sound gốc (${targetSoundData.exactDuration}s)!`));
          return;
        }
        console.log(`✅ PASS: Thời gian nhại lại chuẩn xác bằng duration sound gốc!`);

        // Cả 2 nộp bản thu
        setTimeout(() => {
          client1.emit('game_submit_audio', {
            roomId: ROOM_ID,
            audioData: 'data:audio/webm;base64,GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQRChYECGFOAZwH/////////FUmpZpkq17GDD0JATYCGQ2hyb21lV0GGQ2hyb21lFlSua8+17GDD0JATYCGQ2hyb21lV0GGQ2hyb21lFlSua8+17GDD0JATYCGQ2hyb21lV0GGQ2hyb21lFlSua8+17GDD0JATYCGQ2hyb21lV0GGQ2hyb21lFlSua8+17GDD0JATYCGQ2hyb21lV0GGQ2hyb21lFlSua8+17GDD0JA='
          });
          client2.emit('game_submit_audio', {
            roomId: ROOM_ID,
            audioData: 'data:audio/webm;base64,GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQRChYECGFOAZwH/////////FUmpZpkq17GDD0JATYCGQ2hyb21lV0GGQ2hyb21lFlSua8+17GDD0JATYCGQ2hyb21lV0GGQ2hyb21lFlSua8+17GDD0JATYCGQ2hyb21lV0GGQ2hyb21lFlSua8+17GDD0JATYCGQ2hyb21lV0GGQ2hyb21lFlSua8+17GDD0JATYCGQ2hyb21lV0GGQ2hyb21lFlSua8+17GDD0JA='
          });
          console.log(`   Đã nộp bài thu nhại lại cho cả 2 người chơi!`);
        }, 1000);

      } else if (data.state === 'AI_SCORING') {
        receivedAiScoringState = true;
        aiScoringDuration = data.duration;
        console.log(`🤖 AI_SCORING: Đang phân tích âm sắc & chấm điểm hồi hộp! Duration = ${aiScoringDuration}s`);

        if (aiScoringDuration < 4) {
          clearTimeout(timeout);
          reject(new Error(`❌ FAIL: AI_SCORING thời gian quá ngắn (${aiScoringDuration}s), không đủ tạo sự hồi hộp!`));
          return;
        }
        console.log(`✅ PASS: AI_SCORING có thời gian hồi hộp đủ dài (${aiScoringDuration}s) trước khi công bố kết quả!`);

      } else if (data.state === 'SHOWDOWN_REVEAL') {
        console.log(`🏆 SHOWDOWN_REVEAL: Đã công bố kết quả sau thời gian hồi hộp!`);
        console.log(`   Quán quân vòng: ${data.payload.roundWinner ? data.payload.roundWinner.userName : 'N/A'}`);
        console.log(`   Số bản thu được chấm: ${(data.payload.attempts || []).length}`);

        clearTimeout(timeout);
        resolve();
      }
    });

    // Bắt đầu game
    console.log('--- Bước 2: Bắt đầu game ---');
    client1.emit('game_start', { roomId: ROOM_ID });
  });

  try {
    await testPromise;
    console.log(`\n==================================================================`);
    console.log(`🎉 TẤT CẢ KIỂM TRA ĐỀU THÀNH CÔNG RỰC RỠ!`);
    console.log(`==================================================================\n`);
  } finally {
    client1.disconnect();
    client2.disconnect();
  }
}

runTest().catch(err => {
  console.error('\n❌ TEST THẤT BẠI:', err.message);
  process.exit(1);
});
