/**
 * Trình hiển thị Markdown AN TOÀN: sinh DOM bằng createElement/textContent,
 * không bao giờ chèn HTML thô => không thể bị XSS từ nội dung AI/người dùng.
 * Hỗ trợ: tiêu đề, đoạn, **đậm**, *nghiêng*, `code`, ```khối code```, danh sách (- 1.),
 * checklist, trích dẫn, bảng, liên kết [x](url), đường kẻ ngang, trích dẫn nguồn [n].
 */
import { h, safeUrl } from './dom.js';

function inline(text, ctx = {}) {
  const out = [];
  const re = /(`[^`]+`)|(\*\*[^*]+\*\*)|(__[^_]+__)|(\*[^*\s][^*]*\*)|(_[^_\s][^_]*_)|(\[[^\]]+\]\([^)\s]+\))|(https?:\/\/[^\s<>()]+)|(\[\d{1,2}\])/g;
  let last = 0;
  let m;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const t = m[0];
    if (m[1]) out.push(h('code', {}, t.slice(1, -1)));
    else if (m[2] || m[3]) out.push(h('strong', {}, ...inline(t.slice(2, -2), ctx)));
    else if (m[4] || m[5]) out.push(h('em', {}, ...inline(t.slice(1, -1), ctx)));
    else if (m[6]) {
      const lm = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(t);
      const url = safeUrl(lm[2]);
      out.push(h('a', { href: url, target: url.startsWith('/') ? undefined : '_blank', rel: 'noopener noreferrer' }, lm[1]));
    } else if (m[7]) out.push(h('a', { href: safeUrl(t), target: '_blank', rel: 'noopener noreferrer' }, t));
    else if (m[8]) {
      const n = Number(t.slice(1, -1));
      if (ctx.onCite) out.push(h('button', { class: 'badge primary', style: { cursor: 'pointer', border: 'none', height: '18px', padding: '0 6px' }, onclick: () => ctx.onCite(n), title: `Nguồn ${n}` }, String(n)));
      else out.push(t);
    }
    last = m.index + t.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function codeBlock(lang, code) {
  const pre = h('pre', { class: lang ? 'has-lang' : '' }, lang ? h('span', { class: 'code-lang' }, lang) : null, h('code', {}, code));
  const copy = h('button', { class: 'code-copy', type: 'button' }, 'Sao chép');
  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(code);
      copy.textContent = 'Đã chép';
      setTimeout(() => (copy.textContent = 'Sao chép'), 1500);
    } catch {
      copy.textContent = 'Lỗi';
    }
  });
  pre.appendChild(copy);
  return pre;
}

export function renderMarkdown(src, ctx = {}) {
  const root = h('div', { class: 'md' });
  const lines = String(src ?? '').replace(/\r\n?/g, '\n').split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    // Khối code
    const fence = /^\s*```\s*([\w+#.-]*)\s*$/.exec(line);
    if (fence) {
      const buf = [];
      i++;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) buf.push(lines[i++]);
      i++;
      root.appendChild(codeBlock(fence[1], buf.join('\n')));
      continue;
    }
    if (!line.trim()) {
      i++;
      continue;
    }
    const hd = /^(#{1,4})\s+(.*)$/.exec(line);
    if (hd) {
      root.appendChild(h(`h${Math.min(hd[1].length + 1, 4)}`, {}, ...inline(hd[2], ctx)));
      i++;
      continue;
    }
    if (/^\s*([-*_])\s*\1\s*\1[\s\1]*$/.test(line)) {
      root.appendChild(h('hr'));
      i++;
      continue;
    }
    if (/^\s*>/.test(line)) {
      const buf = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) buf.push(lines[i++].replace(/^\s*>\s?/, ''));
      const bq = h('blockquote');
      bq.appendChild(renderMarkdown(buf.join('\n'), ctx));
      root.appendChild(bq);
      continue;
    }
    // Bảng
    if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
      const split = (l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      const head = split(line);
      i += 2;
      const rows = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) rows.push(split(lines[i++]));
      root.appendChild(h('table', {}, h('thead', {}, h('tr', {}, head.map((c) => h('th', {}, ...inline(c, ctx))))), h('tbody', {}, rows.map((r) => h('tr', {}, r.map((c) => h('td', {}, ...inline(c, ctx))))))));
      continue;
    }
    // Danh sách
    const li = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(line);
    if (li) {
      const ordered = /\d/.test(li[2]);
      const list = h(ordered ? 'ol' : 'ul');
      while (i < lines.length) {
        const m = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(lines[i]);
        if (!m) {
          if (lines[i].trim() && /^\s{2,}/.test(lines[i]) && list.lastChild) {
            list.lastChild.append(' ', ...inline(lines[i].trim(), ctx));
            i++;
            continue;
          }
          break;
        }
        const task = /^\[( |x|X)\]\s+(.*)$/.exec(m[3]);
        const item = h('li', { style: m[1].length >= 2 ? { marginLeft: `${Math.min(m[1].length, 8) * 8}px` } : undefined });
        if (task) item.append(h('input', { type: 'checkbox', checked: task[1] !== ' ', disabled: true, style: { marginRight: '6px' } }), ...inline(task[2], ctx));
        else item.append(...inline(m[3], ctx));
        list.appendChild(item);
        i++;
      }
      root.appendChild(list);
      continue;
    }
    // Đoạn văn
    const buf = [line];
    i++;
    while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|\s*```|\s*>|\s*([-*+]|\d+[.)])\s|\s*\|)/.test(lines[i])) buf.push(lines[i++]);
    const p = h('p');
    buf.forEach((b, j) => {
      if (j) p.appendChild(h('br'));
      p.append(...inline(b, ctx));
    });
    root.appendChild(p);
  }
  return root;
}
