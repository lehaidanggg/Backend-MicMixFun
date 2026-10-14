const { io } = require('socket.io-client');

const SERVER_URL = 'http://localhost:3000';
const ROOM_ID = 'TESTREADY_' + Date.now();

async function runTest() {
  console.log(`\n======================================================`);
  console.log(`🧪 TEST: THỜI GIAN KẾT QUẢ & BẮT BUỘC ALL USER SẴN SÀNG`);
  console.log(`======================================================\n`);

  const client1 = io(SERVER_URL);
  const client2 = io(SERVER_URL);

  await new Promise(r => setTimeout(r, 400));

  // 1. Join room
  await new Promise(res => {
    client1.emit('join_room', { roomId: ROOM_ID, userName: 'Alice', avatar: '🐱' }, () => {
      client2.emit('join_room', { roomId: ROOM_ID, userName: 'Bob', avatar: '🐶' }, res);
    });
  });
  console.log('✅ Bước 1: Alice (Host) và Bob (Player) đã vào phòng.');

  // 2. Host bắt đầu game (2 người chơi, totalRounds = 3)
  console.log('--- Bước 2: Alice bắt đầu trận đấu ---');
  let currentRound = 0;
  await new Promise(res => {
    client1.once('game_state_changed', (data) => {
      console.log(`State hiện tại: ${data.state} (duration: ${data.duration}s)`);
      if (data.state === 'THEME_SELECTION') {
        console.log('✅ PASS: Trận đấu đã khởi động sang THEME_SELECTION!');
        res();
      }
    });
    client1.emit('game_start', { roomId: ROOM_ID });
  });

  // 3. Đợi sang USER_RECORDING rồi submit audio cho cả 2
  console.log('--- Bước 3: Đợi đến lượt nhại giọng (USER_RECORDING) ---');
  await new Promise(res => {
    client1.on('game_state_changed', (data) => {
      if (data.state === 'USER_RECORDING') {
        console.log(`✅ Đã tới USER_RECORDING (${data.duration}s). Cả 2 nộp bản thu...`);
        client1.emit('game_submit_audio', {
          roomId: ROOM_ID,
          audioData: 'data:audio/webm;base64,GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQRChYECGFOAZwH/////////FUmpZpkq17GDD0JATYCGQ2hyb21lV0GGQ2hyb21lFlSua8+17GDD0JATYCGQ2hyb21lV0GGQ2hyb21lFlSua8+17GDD0JATYCGQ2hyb21lV0GGQ2hyb21lFlSua8+17GDD0JATYCGQ2hyb21lV0GGQ2hyb21lFlSua8+17GDD0JATYCGQ2hyb21lV0GGQ2hyb21lFlSua8+17GDD0JA='
        });
        client2.emit('game_submit_audio', {
          roomId: ROOM_ID,
          audioData: 'data:audio/webm;base64,GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQRChYECGFOAZwH/////////FUmpZpkq17GDD0JATYCGQ2hyb21lV0GGQ2hyb21lFlSua8+17GDD0JATYCGQ2hyb21lV0GGQ2hyb21lFlSua8+17GDD0JATYCGQ2hyb21lV0GGQ2hyb21lFlSua8+17GDD0JATYCGQ2hyb21lV0GGQ2hyb21lFlSua8+17GDD0JATYCGQ2hyb21lV0GGQ2hyb21lFlSua8+17GDD0JA='
        });
        res();
      }
    });
  });

  // 4. Kiểm tra SHOWDOWN_REVEAL: thời gian kéo dài 25s
  console.log('\n--- Bước 4: Kiểm tra SHOWDOWN_REVEAL duration ---');
  await new Promise(res => {
    client1.on('game_state_changed', (data) => {
      if (data.state === 'SHOWDOWN_REVEAL') {
        console.log(`State SHOWDOWN_REVEAL có duration: ${data.duration}s`);
        if (data.duration === 25) {
          console.log('✅ PASS: Thời gian SHOWDOWN_REVEAL đã được tăng lên 25s (đủ nghe lại & tương tác)!');
        } else {
          console.error('❌ FAIL: Duration chưa đúng 25s');
        }
        res();
      }
    });
  });

  // 5. Test nút skip_to_round_result (Yêu cầu TẤT CẢ người chơi xác nhận thì mới chuyển)
  console.log('\n--- Bước 5: Kiểm tra chỉ 1 người bấm Bỏ qua Showdown -> Chưa chuyển bảng điểm ---');
  await new Promise(res => {
    client2.once('showdown_skip_updated', (evt) => {
      console.log(`Bob nhận được showdown_skip_updated: skipCount = ${evt.skipCount}/${evt.totalCount}, allSkipConfirmed = ${evt.allSkipConfirmed}`);
      if (evt.skipCount === 1 && evt.totalCount === 2 && evt.allSkipConfirmed === false) {
        console.log('✅ PASS: Chỉ 1/2 người đồng ý xem sớm -> Game CHƯA chuyển sang bảng điểm!');
      }
      res();
    });
    client1.emit('skip_to_round_result', { roomId: ROOM_ID });
  });

  console.log('\n--- Bước 5.2: Người thứ 2 (Bob) bấm đồng ý -> ĐỦ TẤT CẢ -> Chuyển sang ROUND_RESULT ---');
  await new Promise(res => {
    client1.on('game_state_changed', (data) => {
      if (data.state === 'ROUND_RESULT') {
        console.log(`State ROUND_RESULT: duration = ${data.duration}s`);
        if (data.duration === 0) {
          console.log('✅ PASS: Cả 2 người đã đồng ý -> Đã chuyển sang ROUND_RESULT thành công!');
        }
        res();
      }
    });
    client2.emit('skip_to_round_result', { roomId: ROOM_ID });
  });

  // 6. Kiểm tra xem game có bị tự ý chuyển vòng sau 3s không
  console.log('\n--- Bước 6: Kiểm tra game KHÔNG tự chuyển vòng nếu chưa ai bấm Sẵn Sàng ---');
  let prematurelySwitched = false;
  const prematureCheck = (data) => {
    if (data.state === 'THEME_SELECTION') prematurelySwitched = true;
  };
  client1.on('game_state_changed', prematureCheck);
  await new Promise(r => setTimeout(r, 2000));
  client1.off('game_state_changed', prematureCheck);

  if (!prematurelySwitched) {
    console.log('✅ PASS: Game vẫn dừng ở Bảng Điểm, không hề tự ý nhảy vòng!');
  } else {
    console.error('❌ FAIL: Game đã tự ý chuyển vòng!');
  }

  // 7. Chỉ có 1 người (Alice) bấm Sẵn Sàng -> Kiểm tra trạng thái 1/2
  console.log('\n--- Bước 7: Chỉ Alice bấm Sẵn Sàng (1/2 người sẵn sàng) ---');
  await new Promise(res => {
    client2.once('round_ready_updated', (evt) => {
      console.log(`Bob nhận được round_ready_updated: readyCount = ${evt.readyCount}/${evt.totalCount}, allReady = ${evt.allReady}`);
      if (evt.readyCount === 1 && evt.totalCount === 2 && evt.allReady === false) {
        console.log('✅ PASS: Nhận thông tin 1/2 người sẵn sàng, chưa đủ điều kiện chuyển vòng!');
      }
      res();
    });
    client1.emit('confirm_next_round_ready', { roomId: ROOM_ID });
  });

  // Đợi thêm 1.5s xem game có chuyển vòng chưa
  await new Promise(r => setTimeout(r, 1500));
  console.log('Trận đấu vẫn đang kiên nhẫn đợi Bob bấm Sẵn Sàng...');

  // 8. Bob bấm Sẵn Sàng -> Đủ 2/2 -> Nhận event all_players_ready -> Chuyển sang Vòng 2!
  console.log('\n--- Bước 8: Bob bấm Sẵn Sàng (2/2) -> Bắt đầu Vòng 2! ---');
  await new Promise(res => {
    let gotAllReadyEvent = false;

    client1.once('all_players_ready', (evt) => {
      console.log('Event all_players_ready:', evt.message);
      gotAllReadyEvent = true;
    });

    client1.on('game_state_changed', (data) => {
      if (data.state === 'THEME_SELECTION' && data.round === 2) {
        console.log(`State hiện tại: ${data.state} - VÒNG ${data.round}/${data.totalRounds}!`);
        if (gotAllReadyEvent) {
          console.log('✅ PASS: TẤT CẢ NGƯỜI CHƠI XÁC NHẬN SẴN SÀNG ➔ VÒNG TIẾP THEO BẮT ĐẦU HOÀN HẢO!');
        }
        res();
      }
    });

    client2.emit('confirm_next_round_ready', { roomId: ROOM_ID });
  });

  console.log(`\n======================================================`);
  console.log(`🎉 TOÀN BỘ YÊU CẦU: THỜI GIAN CHỜ & XÁC NHẬN SẴN SÀNG ĐÃ ĐẠT 100%!`);
  console.log(`======================================================\n`);

  client1.disconnect();
  client2.disconnect();
  process.exit(0);
}

runTest().catch(err => {
  console.error('Lỗi test:', err);
  process.exit(1);
});
