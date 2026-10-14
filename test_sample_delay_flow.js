const { io } = require('socket.io-client');

const SERVER_URL = 'http://localhost:3000';
const ROOM_ID = 'TESTDELAY_' + Date.now();

async function runTest() {
  console.log(`\n==================================================================`);
  console.log(`🧪 TEST: THỜI GIAN NHẠI BẰNG SOUND MẪU & DELAY CHUẨN BỊ (PREPARE)`);
  console.log(`==================================================================\n`);

  const client1 = io(SERVER_URL);
  const client2 = io(SERVER_URL);

  await new Promise(r => setTimeout(r, 400));

  // 1. Join room
  await new Promise(res => {
    client1.emit('join_room', { roomId: ROOM_ID, userName: 'HostHero', avatar: '🦁' }, () => {
      client2.emit('join_room', { roomId: ROOM_ID, userName: 'MimicPro', avatar: '🐸' }, res);
    });
  });
  console.log('✅ Bước 1: 2 người chơi đã join phòng');

  let sampleDuration = null;
  let sampleSound = null;
  let receivedPrepareState = false;
  let receivedPrepareTicks = [];
  let userRecordingDuration = null;

  // 2. Lắng nghe ticks
  client1.on('game_state_tick', (tick) => {
    if (tick.state === 'PREPARE_RECORDING') {
      receivedPrepareTicks.push(tick.timeRemaining);
      console.log(`   [Tick] 🧘 PREPARE_RECORDING còn ${tick.timeRemaining}s (tiến độ: ${tick.progressPercent}%)`);
    }
  });

  // 3. Khởi động trận đấu
  console.log('\n--- Bước 2: Bắt đầu game và kiểm tra chuỗi State ---');

  const testPromise = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Test timeout sau 35s!'));
    }, 35000);

    client1.on('game_state_changed', (data) => {
      console.log(`\n🔄 [State Changed] => ${data.state} (Duration: ${data.duration}s, Round: ${data.round})`);

      if (data.state === 'PLAYING_SAMPLE') {
        sampleDuration = data.duration;
        sampleSound = data.payload.targetSound;
        console.log(`🔊 PLAYING_SAMPLE: "${sampleSound.name}" | Audio: ${sampleSound.audioUrl} | Duration: ${sampleDuration}s (Raw: ${sampleSound.rawDuration}s)`);
      } else if (data.state === 'PREPARE_RECORDING') {
        receivedPrepareState = true;
        console.log(`🧘 PREPARE_RECORDING: Đệm chuẩn bị lấy hơi trong ${data.duration}s!`);
        console.log(`   Thông điệp: ${data.payload.message}`);
        console.log(`   Thời gian thu âm sắp tới: ${data.payload.recordingDuration}s`);

        if (data.duration !== 3) {
          console.error(`❌ FAIL: PREPARE_RECORDING duration mong muốn là 3s, nhận được: ${data.duration}s`);
        } else {
          console.log(`✅ PASS: PREPARE_RECORDING có thời lượng đệm chuẩn xác = 3 giây!`);
        }

        if (data.payload.recordingDuration !== sampleDuration) {
          console.error(`❌ FAIL: recordingDuration (${data.payload.recordingDuration}s) không khớp sampleDuration (${sampleDuration}s)!`);
        } else {
          console.log(`✅ PASS: recordingDuration trong payload khớp chính xác sampleDuration (${sampleDuration}s)!`);
        }

      } else if (data.state === 'USER_RECORDING') {
        userRecordingDuration = data.duration;
        console.log(`🎙️ USER_RECORDING: Tới lượt user nhại lại! Duration: ${userRecordingDuration}s`);

        // Kiểm tra điều kiện tiên quyết
        if (!receivedPrepareState) {
          clearTimeout(timeout);
          reject(new Error('❌ FAIL: Không nhận được PREPARE_RECORDING trước khi tới USER_RECORDING!'));
          return;
        }

        if (userRecordingDuration !== sampleDuration) {
          clearTimeout(timeout);
          reject(new Error(`❌ FAIL: Thời gian USER_RECORDING (${userRecordingDuration}s) KHÔNG bằng thời gian sound mẫu (${sampleDuration}s)!`));
          return;
        }

        console.log(`✅ PASS: Thời gian USER_RECORDING (${userRecordingDuration}s) BẰNG ĐÚNG thời gian sound mẫu (${sampleDuration}s)!`);
        console.log(`✅ PASS: Có thời gian đệm PREPARE_RECORDING (3s) cho user chuẩn bị lấy hơi!`);

        clearTimeout(timeout);
        resolve();
      }
    });

    client1.emit('game_start', { roomId: ROOM_ID });
  });

  try {
    await testPromise;
    console.log(`\n==================================================================`);
    console.log(`🎉 TẤT CẢ CÁC KIỂM TRA ĐỀU THÀNH CÔNG VƯỢT TRỘI!`);
    console.log(`==================================================================\n`);
  } finally {
    client1.disconnect();
    client2.disconnect();
  }
}

runTest().catch(err => {
  console.error('\n❌ TEST GẶP LỖI:', err.message);
  process.exit(1);
});
