'use strict';

/** Chuẩn hóa response thành công: { success, message, data, meta? } */
function ok(res, data = null, message = 'Thành công', meta) {
  const body = { success: true, message, data: serialize(data) };
  if (meta) body.meta = meta;
  return res.status(200).json(body);
}

function created(res, data = null, message = 'Tạo mới thành công') {
  return res.status(201).json({ success: true, message, data: serialize(data) });
}

/** BigInt (vd: dung lượng file) không JSON hóa được – chuyển sang Number. */
function serialize(value) {
  return JSON.parse(JSON.stringify(value, (_k, v) => (typeof v === 'bigint' ? Number(v) : v)));
}

module.exports = { ok, created, serialize };
