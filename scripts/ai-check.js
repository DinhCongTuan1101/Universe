'use strict';
/**
 * Kiểm tra cấu hình & kết nối AI từ dòng lệnh (không cần chạy server, không cần đăng nhập):
 *   npm run ai:check
 * In ra: provider, model đang dùng, danh sách model mà API key được phép dùng, kết quả gọi thử chat & embedding.
 * KHÔNG in API key.
 */
const ai = require('../src/services/ai/ai.service');
const config = require('../src/config');

(async () => {
  const masked = config.ai.apiKey ? `${config.ai.apiKey.slice(0, 4)}…${config.ai.apiKey.slice(-4)} (${config.ai.apiKey.length} ký tự)` : '(trống)';
  console.log('\n=== UniVerse – kiểm tra AI ===');
  console.log(`AI_PROVIDER        : ${config.ai.provider || '(trống)'}`);
  console.log(`API key            : ${masked}`);
  console.log(`Chat model         : ${config.ai.chatModel || '(trống)'}`);
  console.log(`Embedding model    : ${config.ai.embeddingModel || '(trống)'} ${config.ai.embeddingsEnabled ? '' : '(đang tắt)'}`);
  if (!config.ai.configured) {
    console.log(`\n✖ ${config.ai.problem}. Sửa file .env rồi chạy lại lệnh này.\n`);
    process.exit(1);
  }
  const r = await ai.testConnection(null);
  for (const s of r.steps) {
    if (s.ok) {
      console.log(`\n✔ ${s.name} (${s.ms} ms)`);
      if (s.detail?.sample) {
        console.log(`  ${s.detail.count} model khả dụng. Model chat hiện tại ${s.detail.chatModelListed ? 'CÓ' : 'KHÔNG thấy'} trong danh sách.`);
        console.log(`  Một số model: ${s.detail.sample.slice(0, 40).join(', ')}`);
      } else console.log(`  ${JSON.stringify(s.detail)}`);
    } else {
      console.log(`\n✖ ${s.name} (${s.ms} ms): ${s.message}`);
      if (s.providerStatus || s.providerMessage) console.log(`  Phản hồi từ provider: HTTP ${s.providerStatus ?? '-'} – ${s.providerMessage || ''}`);
    }
  }
  console.log(r.ok ? '\n=> AI sẵn sàng. Khởi động lại server để áp dụng cấu hình.\n' : '\n=> Còn lỗi – xem chi tiết ở trên (thường do API key, tên model hoặc billing).\n');
  process.exit(r.ok ? 0 : 1);
})().catch((e) => {
  console.error('Lỗi không mong đợi:', e.message);
  process.exit(1);
});
