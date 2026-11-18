/**
 * UniSheet Formula Engine – bộ xử lý công thức có kiểm soát.
 * KHÔNG dùng eval()/Function(): công thức được tách token -> phân tích cú pháp (AST) -> tính toán.
 *
 * Hỗ trợ: số, chuỗi "..", TRUE/FALSE, tham chiếu ô (A1, $A$1), vùng (A1:B5),
 *         toán tử + - * / ^ & % và so sánh = <> < > <= >=,
 *         hàm SUM, AVERAGE, MAX, MIN, COUNT, IF, SUMIF, COUNTIF.
 * Hàm khác => lỗi #NAME? với thông báo rõ "chưa được hỗ trợ" (không trả kết quả sai).
 *
 * Dùng chung cho frontend (import) và backend/test (require).
 */

export const SUPPORTED_FUNCTIONS = ['SUM', 'AVERAGE', 'MAX', 'MIN', 'COUNT', 'IF', 'SUMIF', 'COUNTIF'];
const MAX_RANGE_CELLS = 100000;

// ------------------------------------------------------------------ Lỗi bảng tính
export class SheetError {
  constructor(code, message) {
    this.code = code; // "#DIV/0!", "#VALUE!", "#REF!", "#NAME?", "#CYCLE!", "#ERROR!", "#N/A"
    this.message = message;
  }
  toString() {
    return this.code;
  }
}
const err = (code, message) => new SheetError(code, message);
export const isError = (v) => v instanceof SheetError;

// ------------------------------------------------------------------ Địa chỉ ô
export function colToIndex(col) {
  let n = 0;
  for (const ch of col.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}
export function indexToCol(i) {
  let s = '';
  let n = i + 1;
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}
export function parseRef(ref) {
  const m = /^\$?([A-Za-z]{1,3})\$?(\d{1,6})$/.exec(ref);
  if (!m) return null;
  const row = Number(m[2]) - 1;
  if (row < 0) return null;
  return { col: colToIndex(m[1]), row };
}
export function refName(col, row) {
  return `${indexToCol(col)}${row + 1}`;
}

// ------------------------------------------------------------------ Tokenizer
function tokenize(src) {
  const tokens = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (ch === '"') {
      let j = i + 1;
      let s = '';
      while (j < src.length) {
        if (src[j] === '"') {
          if (src[j + 1] === '"') {
            s += '"';
            j += 2;
            continue;
          }
          break;
        }
        s += src[j++];
      }
      if (j >= src.length) throw err('#ERROR!', 'Thiếu dấu " đóng chuỗi');
      tokens.push({ t: 'str', v: s });
      i = j + 1;
      continue;
    }
    const num = /^(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?/.exec(src.slice(i));
    if (num) {
      tokens.push({ t: 'num', v: Number(num[0]) });
      i += num[0].length;
      continue;
    }
    const range = /^\$?[A-Za-z]{1,3}\$?\d{1,6}:\$?[A-Za-z]{1,3}\$?\d{1,6}/.exec(src.slice(i));
    if (range) {
      tokens.push({ t: 'range', v: range[0].toUpperCase().replace(/\$/g, '') });
      i += range[0].length;
      continue;
    }
    const word = /^[A-Za-z_][A-Za-z0-9_.]*/.exec(src.slice(i));
    if (word) {
      const w = word[0];
      const after = src.slice(i + w.length).trimStart();
      if (after.startsWith('(')) tokens.push({ t: 'func', v: w.toUpperCase() });
      else if (/^(TRUE|FALSE)$/i.test(w)) tokens.push({ t: 'bool', v: w.toUpperCase() === 'TRUE' });
      else if (/^\$?[A-Za-z]{1,3}\$?\d{1,6}$/.test(w)) tokens.push({ t: 'ref', v: w.toUpperCase().replace(/\$/g, '') });
      else throw err('#NAME?', `Không nhận ra "${w}"`);
      i += w.length;
      continue;
    }
    const ref = /^\$[A-Za-z]{1,3}\$?\d{1,6}/.exec(src.slice(i));
    if (ref) {
      tokens.push({ t: 'ref', v: ref[0].toUpperCase().replace(/\$/g, '') });
      i += ref[0].length;
      continue;
    }
    const two = src.slice(i, i + 2);
    if (['<=', '>=', '<>'].includes(two)) {
      tokens.push({ t: 'op', v: two });
      i += 2;
      continue;
    }
    if ('+-*/^&=<>%'.includes(ch)) {
      tokens.push({ t: 'op', v: ch });
      i++;
      continue;
    }
    if (ch === '(' || ch === ')') {
      tokens.push({ t: ch });
      i++;
      continue;
    }
    if (ch === ',' || ch === ';') {
      tokens.push({ t: ',' });
      i++;
      continue;
    }
    throw err('#ERROR!', `Ký tự không hợp lệ "${ch}"`);
  }
  return tokens;
}

// ------------------------------------------------------------------ Parser (Pratt)
const BINARY = {
  '=': 1,
  '<>': 1,
  '<': 1,
  '>': 1,
  '<=': 1,
  '>=': 1,
  '&': 2,
  '+': 3,
  '-': 3,
  '*': 4,
  '/': 4,
  '^': 5,
};

export function parseFormula(src) {
  const tokens = tokenize(src);
  let pos = 0;
  const peek = () => tokens[pos];
  const next = () => tokens[pos++];

  function expr(minPrec = 0) {
    let left = unary();
    for (;;) {
      const tk = peek();
      if (!tk || tk.t !== 'op' || !(tk.v in BINARY)) break;
      const prec = BINARY[tk.v];
      if (prec < minPrec) break;
      next();
      // ^ kết hợp phải, còn lại kết hợp trái
      const right = expr(tk.v === '^' ? prec : prec + 1);
      left = { type: 'bin', op: tk.v, left, right };
    }
    return left;
  }

  function unary() {
    const tk = peek();
    if (tk && tk.t === 'op' && (tk.v === '-' || tk.v === '+')) {
      next();
      return { type: 'unary', op: tk.v, arg: unary() };
    }
    return postfix(primary());
  }

  function postfix(node) {
    let n = node;
    while (peek() && peek().t === 'op' && peek().v === '%') {
      next();
      n = { type: 'percent', arg: n };
    }
    return n;
  }

  function primary() {
    const tk = next();
    if (!tk) throw err('#ERROR!', 'Công thức chưa hoàn chỉnh');
    switch (tk.t) {
      case 'num':
        return { type: 'num', v: tk.v };
      case 'str':
        return { type: 'str', v: tk.v };
      case 'bool':
        return { type: 'bool', v: tk.v };
      case 'ref':
        return { type: 'ref', v: tk.v };
      case 'range':
        return { type: 'range', v: tk.v };
      case '(': {
        const e = expr();
        if (!peek() || peek().t !== ')') throw err('#ERROR!', 'Thiếu dấu ")"');
        next();
        return e;
      }
      case 'func': {
        next(); // '('
        const args = [];
        if (peek() && peek().t === ')') {
          next();
        } else {
          for (;;) {
            args.push(expr());
            const sep = next();
            if (!sep) throw err('#ERROR!', `Thiếu dấu ")" cho hàm ${tk.v}`);
            if (sep.t === ')') break;
            if (sep.t !== ',') throw err('#ERROR!', `Sai cú pháp trong hàm ${tk.v}`);
          }
        }
        return { type: 'func', name: tk.v, args };
      }
      default:
        throw err('#ERROR!', 'Sai cú pháp công thức');
    }
  }

  const ast = expr();
  if (pos < tokens.length) throw err('#ERROR!', 'Sai cú pháp công thức');
  return ast;
}

/** Liệt kê các ô/vùng mà công thức tham chiếu (phục vụ tính lại khi dữ liệu liên quan đổi). */
export function collectRefs(ast, out = new Set()) {
  if (!ast) return out;
  if (ast.type === 'ref') out.add(ast.v);
  else if (ast.type === 'range') for (const r of expandRange(ast.v)) out.add(r);
  else if (ast.type === 'bin') {
    collectRefs(ast.left, out);
    collectRefs(ast.right, out);
  } else if (ast.type === 'unary' || ast.type === 'percent') collectRefs(ast.arg, out);
  else if (ast.type === 'func') ast.args.forEach((a) => collectRefs(a, out));
  return out;
}

export function expandRange(range) {
  const [a, b] = range.split(':');
  const p = parseRef(a);
  const q = parseRef(b);
  if (!p || !q) throw err('#REF!', `Vùng không hợp lệ ${range}`);
  const c1 = Math.min(p.col, q.col);
  const c2 = Math.max(p.col, q.col);
  const r1 = Math.min(p.row, q.row);
  const r2 = Math.max(p.row, q.row);
  if ((c2 - c1 + 1) * (r2 - r1 + 1) > MAX_RANGE_CELLS) throw err('#REF!', 'Vùng quá lớn');
  const out = [];
  for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) out.push(refName(c, r));
  return out;
}

// ------------------------------------------------------------------ Kiểu dữ liệu
const EMPTY = null;

function toNumber(v) {
  if (isError(v)) return v;
  if (v === EMPTY || v === '') return 0;
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  const s = String(v).trim().replace(/,/g, '');
  if (s !== '' && !Number.isNaN(Number(s))) return Number(s);
  return err('#VALUE!', `"${v}" không phải là số`);
}

function toText(v) {
  if (v === EMPTY) return '';
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (typeof v === 'number') return formatNumberPlain(v);
  return String(v);
}

function formatNumberPlain(n) {
  if (Number.isInteger(n)) return String(n);
  return String(Math.round(n * 1e10) / 1e10);
}

function toBool(v) {
  if (isError(v)) return v;
  if (typeof v === 'boolean') return v;
  if (v === EMPTY) return false;
  if (typeof v === 'number') return v !== 0;
  const s = String(v).toUpperCase();
  if (s === 'TRUE') return true;
  if (s === 'FALSE') return false;
  return err('#VALUE!', `"${v}" không phải giá trị đúng/sai`);
}

function compare(a, b, op) {
  // Excel: số < chuỗi < boolean; chuỗi so sánh không phân biệt hoa thường
  const rank = (v) => (typeof v === 'number' || v === EMPTY ? 0 : typeof v === 'string' ? 1 : 2);
  let x = a === EMPTY ? (typeof b === 'string' ? '' : 0) : a;
  let y = b === EMPTY ? (typeof a === 'string' ? '' : 0) : b;
  let c;
  if (rank(x) !== rank(y)) c = rank(x) - rank(y);
  else if (typeof x === 'string') {
    x = x.toLowerCase();
    y = y.toLowerCase();
    c = x < y ? -1 : x > y ? 1 : 0;
  } else c = Number(x) - Number(y);
  switch (op) {
    case '=':
      return c === 0;
    case '<>':
      return c !== 0;
    case '<':
      return c < 0;
    case '>':
      return c > 0;
    case '<=':
      return c <= 0;
    case '>=':
      return c >= 0;
  }
  return false;
}

// ------------------------------------------------------------------ Điều kiện SUMIF/COUNTIF
function criteriaMatcher(criteria) {
  if (isError(criteria)) return () => false;
  if (typeof criteria === 'number' || typeof criteria === 'boolean') return (v) => v !== EMPTY && compare(v, criteria, '=');
  const s = toText(criteria);
  const m = /^(<=|>=|<>|<|>|=)?(.*)$/s.exec(s);
  const op = m[1] || '=';
  const rhsRaw = m[2];
  const rhsNum = rhsRaw.trim() !== '' && !Number.isNaN(Number(rhsRaw)) ? Number(rhsRaw) : null;
  if (rhsNum !== null) {
    return (v) => {
      if (typeof v === 'number') return compare(v, rhsNum, op);
      if (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v))) return compare(Number(v), rhsNum, op);
      return op === '<>';
    };
  }
  if ((op === '=' || op === '<>') && /[*?]/.test(rhsRaw)) {
    const re = new RegExp(
      `^${rhsRaw
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/~\*/g, '\u0001')
        .replace(/~\?/g, '\u0002')
        .replace(/\*/g, '.*')
        .replace(/\?/g, '.')
        .replace(/\u0001/g, '\\*')
        .replace(/\u0002/g, '\\?')}$`,
      'i'
    );
    return (v) => (op === '=' ? re.test(toText(v)) : !re.test(toText(v)));
  }
  if (rhsRaw === '') return (v) => (op === '=' ? v === EMPTY || v === '' : !(v === EMPTY || v === ''));
  return (v) => (typeof v === 'string' ? compare(v, rhsRaw, op) : op === '<>');
}

// ------------------------------------------------------------------ Hàm
function flatValues(args, ctx, { fromRangeOnly = false } = {}) {
  // Trả về [{ v, direct }] – direct = giá trị nhập trực tiếp (không từ vùng/ô)
  const out = [];
  for (const a of args) {
    if (a.type === 'range') for (const r of expandRange(a.v)) out.push({ v: ctx.get(r), direct: false });
    else if (a.type === 'ref') out.push({ v: ctx.get(a.v), direct: false });
    else if (!fromRangeOnly) out.push({ v: evaluate(a, ctx), direct: true });
  }
  return out;
}

function numericList(args, ctx) {
  const nums = [];
  for (const { v, direct } of flatValues(args, ctx)) {
    if (isError(v)) return v;
    if (direct) {
      const n = toNumber(v);
      if (isError(n)) return n;
      nums.push(n);
    } else if (typeof v === 'number') nums.push(v);
    // ô chứa chữ/rỗng/boolean trong vùng => bỏ qua (giống Excel)
  }
  return nums;
}

function rangeCells(node, ctx, fn) {
  if (node.type === 'range') return expandRange(node.v);
  if (node.type === 'ref') return [node.v];
  throw err('#VALUE!', `Đối số của ${fn} phải là ô hoặc vùng`);
}

const FUNCTIONS = {
  SUM(args, ctx) {
    const nums = numericList(args, ctx);
    return isError(nums) ? nums : nums.reduce((a, b) => a + b, 0);
  },
  AVERAGE(args, ctx) {
    const nums = numericList(args, ctx);
    if (isError(nums)) return nums;
    if (!nums.length) return err('#DIV/0!', 'AVERAGE không có giá trị số');
    return nums.reduce((a, b) => a + b, 0) / nums.length;
  },
  MAX(args, ctx) {
    const nums = numericList(args, ctx);
    return isError(nums) ? nums : nums.length ? Math.max(...nums) : 0;
  },
  MIN(args, ctx) {
    const nums = numericList(args, ctx);
    return isError(nums) ? nums : nums.length ? Math.min(...nums) : 0;
  },
  COUNT(args, ctx) {
    let n = 0;
    for (const { v, direct } of flatValues(args, ctx)) {
      if (typeof v === 'number') n++;
      else if (direct && typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v))) n++;
    }
    return n;
  },
  IF(args, ctx) {
    if (args.length < 2 || args.length > 3) return err('#ERROR!', 'IF cần 2 hoặc 3 đối số');
    const cond = toBool(evaluate(args[0], ctx));
    if (isError(cond)) return cond;
    if (cond) return evaluate(args[1], ctx);
    return args.length === 3 ? evaluate(args[2], ctx) : false;
  },
  SUMIF(args, ctx) {
    if (args.length < 2 || args.length > 3) return err('#ERROR!', 'SUMIF cần 2 hoặc 3 đối số');
    const range = rangeCells(args[0], ctx, 'SUMIF');
    const match = criteriaMatcher(evaluate(args[1], ctx));
    const sumRange = args[2] ? rangeCells(args[2], ctx, 'SUMIF') : range;
    // Vùng tính tổng có cùng kích thước & góc trên-trái như Excel
    const sumCells = args[2] ? resizeLike(sumRange[0], range, args[0]) : range;
    let total = 0;
    for (let i = 0; i < range.length; i++) {
      const v = ctx.get(range[i]);
      if (isError(v)) return v;
      if (match(v)) {
        const s = ctx.get(sumCells[i]);
        if (isError(s)) return s;
        if (typeof s === 'number') total += s;
      }
    }
    return total;
  },
  COUNTIF(args, ctx) {
    if (args.length !== 2) return err('#ERROR!', 'COUNTIF cần 2 đối số');
    const range = rangeCells(args[0], ctx, 'COUNTIF');
    const match = criteriaMatcher(evaluate(args[1], ctx));
    let n = 0;
    for (const r of range) {
      const v = ctx.get(r);
      if (!isError(v) && match(v)) n++;
    }
    return n;
  },
};

function resizeLike(topLeft, criteriaCells, criteriaNode) {
  const start = parseRef(topLeft);
  if (criteriaNode.type === 'ref') return [topLeft];
  const [a, b] = criteriaNode.v.split(':');
  const p = parseRef(a);
  const q = parseRef(b);
  const cols = Math.abs(q.col - p.col) + 1;
  const out = [];
  for (let i = 0; i < criteriaCells.length; i++) {
    out.push(refName(start.col + (i % cols), start.row + Math.floor(i / cols)));
  }
  return out;
}

// ------------------------------------------------------------------ Evaluator
export function evaluate(node, ctx) {
  switch (node.type) {
    case 'num':
    case 'str':
    case 'bool':
      return node.v;
    case 'ref':
      return ctx.get(node.v);
    case 'range':
      return err('#VALUE!', 'Không thể dùng vùng ô trực tiếp – hãy dùng trong hàm, vd SUM(A1:A5)');
    case 'percent': {
      const n = toNumber(evaluate(node.arg, ctx));
      return isError(n) ? n : n / 100;
    }
    case 'unary': {
      const n = toNumber(evaluate(node.arg, ctx));
      return isError(n) ? n : node.op === '-' ? -n : n;
    }
    case 'bin': {
      const l = evaluate(node.left, ctx);
      if (isError(l)) return l;
      const r = evaluate(node.right, ctx);
      if (isError(r)) return r;
      if (node.op === '&') return toText(l) + toText(r);
      if (['=', '<>', '<', '>', '<=', '>='].includes(node.op)) return compare(l, r, node.op);
      const a = toNumber(l);
      if (isError(a)) return a;
      const b = toNumber(r);
      if (isError(b)) return b;
      switch (node.op) {
        case '+':
          return a + b;
        case '-':
          return a - b;
        case '*':
          return a * b;
        case '/':
          return b === 0 ? err('#DIV/0!', 'Chia cho 0') : a / b;
        case '^': {
          const p = a ** b;
          return Number.isFinite(p) ? p : err('#VALUE!', 'Kết quả lũy thừa không hợp lệ');
        }
      }
      return err('#ERROR!', 'Toán tử không hợp lệ');
    }
    case 'func': {
      const fn = FUNCTIONS[node.name];
      if (!fn) return err('#NAME?', `Hàm ${node.name} chưa được UniSheet hỗ trợ. Hỗ trợ: ${SUPPORTED_FUNCTIONS.join(', ')}`);
      try {
        return fn(node.args, ctx);
      } catch (e) {
        if (isError(e)) return e;
        throw e;
      }
    }
  }
  return err('#ERROR!', 'Công thức không hợp lệ');
}

/** Chuyển nội dung nhập vào ô thành giá trị (số nếu là số). */
export function literalValue(raw) {
  if (raw === undefined || raw === null || raw === '') return EMPTY;
  if (typeof raw === 'number' || typeof raw === 'boolean') return raw;
  const s = String(raw);
  const t = s.trim();
  if (t !== '' && /^[-+]?(\d+([.,]\d+)?|\d{1,3}(,\d{3})+(\.\d+)?|\.\d+)([eE][-+]?\d+)?%?$/.test(t)) {
    const pct = t.endsWith('%');
    let core = pct ? t.slice(0, -1) : t;
    if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(core.replace(/^[-+]/, ''))) core = core.replace(/,/g, '');
    else core = core.replace(',', '.');
    const n = Number(core);
    if (!Number.isNaN(n)) return pct ? n / 100 : n;
  }
  if (/^(TRUE|FALSE)$/i.test(t)) return t.toUpperCase() === 'TRUE';
  return s;
}

// ------------------------------------------------------------------ Workbook model
/**
 * Mô hình 1 sheet: cells = { "A1": { v: "nội dung nhập", ... } }
 * computeAll() tính toàn bộ, có phát hiện tham chiếu vòng; dependents() cho biết ô nào cần tính lại.
 */
export class SheetModel {
  constructor(cells = {}) {
    this.cells = cells;
    this.cache = new Map();
    this.parsed = new Map();
    this.stack = new Set();
  }

  raw(ref) {
    return this.cells[ref]?.v ?? '';
  }

  setRaw(ref, value) {
    if (value === '' || value === undefined || value === null) {
      if (this.cells[ref]) {
        delete this.cells[ref].v;
        if (!this.cells[ref].s) delete this.cells[ref];
      }
    } else {
      this.cells[ref] = { ...(this.cells[ref] || {}), v: String(value) };
    }
    this.parsed.delete(ref);
    this.cache.clear();
  }

  ast(ref) {
    if (this.parsed.has(ref)) return this.parsed.get(ref);
    const raw = this.raw(ref);
    let out = null;
    if (typeof raw === 'string' && raw.startsWith('=') && raw.length > 1) {
      try {
        out = parseFormula(raw.slice(1));
      } catch (e) {
        out = { type: 'error', error: isError(e) ? e : err('#ERROR!', 'Công thức không hợp lệ') };
      }
    }
    this.parsed.set(ref, out);
    return out;
  }

  get(ref) {
    if (this.cache.has(ref)) return this.cache.get(ref);
    const raw = this.raw(ref);
    if (!(typeof raw === 'string' && raw.startsWith('=') && raw.length > 1)) {
      const v = literalValue(raw);
      this.cache.set(ref, v);
      return v;
    }
    if (this.stack.has(ref)) return err('#CYCLE!', `Tham chiếu vòng tại ${ref}`);
    this.stack.add(ref);
    let v;
    try {
      const ast = this.ast(ref);
      v = ast.type === 'error' ? ast.error : evaluate(ast, this);
    } finally {
      this.stack.delete(ref);
    }
    if (typeof v === 'number' && !Number.isFinite(v)) v = err('#VALUE!', 'Kết quả không hợp lệ');
    this.cache.set(ref, v);
    return v;
  }

  /** Các ô công thức phụ thuộc (trực tiếp hoặc gián tiếp) vào `ref`. */
  dependents(ref) {
    const direct = new Map();
    for (const r of Object.keys(this.cells)) {
      const a = this.ast(r);
      if (a && a.type !== 'error') {
        for (const dep of collectRefs(a)) {
          if (!direct.has(dep)) direct.set(dep, new Set());
          direct.get(dep).add(r);
        }
      }
    }
    const out = new Set();
    const queue = [ref];
    while (queue.length) {
      const cur = queue.shift();
      for (const d of direct.get(cur) || []) {
        if (!out.has(d)) {
          out.add(d);
          queue.push(d);
        }
      }
    }
    return out;
  }

  computeAll() {
    this.cache.clear();
    const values = {};
    for (const ref of Object.keys(this.cells)) values[ref] = this.get(ref);
    return values;
  }
}

/** Định dạng giá trị để hiển thị theo định dạng số của ô. */
export function formatValue(v, fmt) {
  if (isError(v)) return v.code;
  if (v === null || v === undefined) return '';
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (typeof v === 'number') {
    const decimals = fmt?.decimals;
    switch (fmt?.type) {
      case 'percent':
        return `${(v * 100).toLocaleString('vi-VN', { minimumFractionDigits: decimals ?? 0, maximumFractionDigits: decimals ?? 2 })}%`;
      case 'currency':
        return `${v.toLocaleString('vi-VN', { minimumFractionDigits: decimals ?? 0, maximumFractionDigits: decimals ?? 0 })} ₫`;
      case 'number':
        return v.toLocaleString('vi-VN', { minimumFractionDigits: decimals ?? 0, maximumFractionDigits: decimals ?? 2 });
      default:
        return decimals !== undefined ? v.toFixed(decimals) : formatNumberPlain(v);
    }
  }
  return String(v);
}
