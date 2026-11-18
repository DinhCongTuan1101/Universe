'use strict';
/** Kiểm thử bộ xử lý công thức UniSheet theo từng nhóm hàm. */
const test = require('node:test');
const assert = require('node:assert/strict');
const F = require('../../public/js/shared/formula.js');

function sheet(cells) {
  const m = new F.SheetModel(Object.fromEntries(Object.entries(cells).map(([k, v]) => [k, { v: String(v) }])));
  return m;
}
const val = (cells, ref) => sheet(cells).get(ref);
const code = (v) => (F.isError(v) ? v.code : v);

test('phép toán cơ bản & độ ưu tiên', () => {
  assert.equal(val({ A1: '=1+2*3' }, 'A1'), 7);
  assert.equal(val({ A1: '=(1+2)*3' }, 'A1'), 9);
  assert.equal(val({ A1: '=2^3^2' }, 'A1'), 512);
  assert.equal(val({ A1: '=-2^2' }, 'A1'), 4);
  assert.equal(val({ A1: '=10/4' }, 'A1'), 2.5);
  assert.equal(val({ A1: '=50%' }, 'A1'), 0.5);
  assert.equal(val({ A1: '="a"&"b"&1' }, 'A1'), 'ab1');
  assert.equal(val({ A1: '=1<2' }, 'A1'), true);
  assert.equal(val({ A1: '="abc"="ABC"' }, 'A1'), true);
});

test('tham chiếu ô và tính lại khi dữ liệu thay đổi', () => {
  const m = sheet({ A1: 5, A2: 7, A3: '=A1+A2', B1: '=A3*2' });
  assert.equal(m.get('B1'), 24);
  assert.deepEqual([...m.dependents('A1')].sort(), ['A3', 'B1']);
  m.setRaw('A1', '10');
  assert.equal(m.get('B1'), 34);
  assert.equal(val({ A1: '=$B$1+1', B1: 1 }, 'A1'), 2);
  assert.equal(val({ A1: '=B9' }, 'A1'), null);
});

test('SUM / AVERAGE / MAX / MIN / COUNT', () => {
  const c = { A1: 1, A2: 2, A3: 'x', A4: '', A5: 4, B1: '=SUM(A1:A5)', B2: '=AVERAGE(A1:A5)', B3: '=MAX(A1:A5)', B4: '=MIN(A1:A5)', B5: '=COUNT(A1:A5)' };
  const m = sheet(c);
  assert.equal(m.get('B1'), 7);
  assert.equal(m.get('B2'), 7 / 3);
  assert.equal(m.get('B3'), 4);
  assert.equal(m.get('B4'), 1);
  assert.equal(m.get('B5'), 3);
  assert.equal(val({ A1: '=SUM(1,2,"3")' }, 'A1'), 6);
  assert.equal(code(val({ A1: '=SUM(1,"x")' }, 'A1')), '#VALUE!');
  assert.equal(code(val({ A1: '=AVERAGE(B1:B3)' }, 'A1')), '#DIV/0!');
  assert.equal(val({ A1: '=MAX(B1:B3)' }, 'A1'), 0);
  assert.equal(val({ A1: '=SUM(A2:B3)', A2: 1, B3: 2 }, 'A1'), 3);
});

test('IF', () => {
  assert.equal(val({ A1: 8, B1: '=IF(A1>=5,"Đạt","Trượt")' }, 'B1'), 'Đạt');
  assert.equal(val({ A1: 3, B1: '=IF(A1>=5,"Đạt","Trượt")' }, 'B1'), 'Trượt');
  assert.equal(val({ B1: '=IF(FALSE,1)' }, 'B1'), false);
  assert.equal(val({ B1: '=IF(1,IF(0,1,2),3)' }, 'B1'), 2);
  // nhánh không được chọn không làm lỗi
  assert.equal(val({ B1: '=IF(TRUE,1,1/0)' }, 'B1'), 1);
  assert.equal(code(val({ B1: '=IF("abc",1,2)' }, 'B1')), '#VALUE!');
});

test('SUMIF / COUNTIF với điều kiện', () => {
  const c = { A1: 'Toán', A2: 'Lý', A3: 'Toán', A4: 'toán', B1: 8, B2: 6, B3: 9, B4: 5, C1: 3, C2: 7, C3: '', C4: 12 };
  const m = sheet({ ...c, D1: '=SUMIF(A1:A4,"Toán",B1:B4)', D2: '=COUNTIF(A1:A4,"toán")', D3: '=COUNTIF(B1:B4,">=6")', D4: '=SUMIF(C1:C4,">5")', D5: '=COUNTIF(A1:A4,"T*")', D6: '=COUNTIF(A1:A4,"<>Lý")', D7: '=COUNTIF(C1:C4,"")', D8: '=SUMIF(B1:B4,"<>6")' });
  assert.equal(m.get('D1'), 22);
  assert.equal(m.get('D2'), 3);
  assert.equal(m.get('D3'), 3);
  assert.equal(m.get('D4'), 19);
  assert.equal(m.get('D5'), 3);
  assert.equal(m.get('D6'), 3);
  assert.equal(m.get('D7'), 1);
  assert.equal(m.get('D8'), 22);
});

test('lỗi: chia 0, tham chiếu vòng, hàm chưa hỗ trợ, cú pháp', () => {
  assert.equal(code(val({ A1: '=1/0' }, 'A1')), '#DIV/0!');
  const cyc = sheet({ A1: '=B1', B1: '=A1+1' });
  assert.equal(code(cyc.get('A1')), '#CYCLE!');
  const unsup = val({ A1: '=VLOOKUP(1,A2:B3,2)' }, 'A1');
  assert.equal(code(unsup), '#NAME?');
  assert.match(unsup.message, /chưa được UniSheet hỗ trợ/);
  assert.equal(code(val({ A1: '=1+' }, 'A1')), '#ERROR!');
  assert.equal(code(val({ A1: '=SUM(A2' }, 'A1')), '#ERROR!');
  assert.equal(code(val({ A1: '=A2:A3' }, 'A1')), '#VALUE!');
  assert.equal(code(val({ A1: '="abc' }, 'A1')), '#ERROR!');
  // lỗi lan truyền
  assert.equal(code(val({ A1: '=1/0', A2: '=A1+1' }, 'A2')), '#DIV/0!');
});

test('không thực thi mã JavaScript từ công thức', () => {
  for (const evil of ['=constructor.constructor("return 1")()', '=alert(1)', '=__proto__', '=process.exit()']) {
    const v = val({ A1: evil }, 'A1');
    assert.ok(F.isError(v), evil);
  }
});

test('literalValue & formatValue', () => {
  assert.equal(F.literalValue('12'), 12);
  assert.equal(F.literalValue('1,5'), 1.5);
  assert.equal(F.literalValue('1,234,567'), 1234567);
  assert.equal(F.literalValue('25%'), 0.25);
  assert.equal(F.literalValue('abc'), 'abc');
  assert.equal(F.literalValue('TRUE'), true);
  assert.equal(F.formatValue(0.256, { type: 'percent', decimals: 1 }), '25,6%');
  assert.equal(F.formatValue(1500000, { type: 'currency' }), '1.500.000 ₫');
  assert.equal(F.indexToCol(27), 'AB');
  assert.equal(F.colToIndex('AB'), 27);
});
