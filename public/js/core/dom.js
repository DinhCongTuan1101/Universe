/**
 * Helper tạo DOM an toàn: chuỗi luôn được gán bằng textContent (chống XSS),
 * KHÔNG dùng innerHTML với dữ liệu người dùng.
 *
 *   h('div', { class: 'card', onclick: fn }, 'Xin chào', h('b', {}, name))
 */
import { icon } from './icons.js';

export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class' || k === 'className') el.className = Array.isArray(v) ? v.filter(Boolean).join(' ') : v;
      else if (k === 'style' && typeof v === 'object') {
        for (const [sk, sv] of Object.entries(v)) {
          if (sv === undefined || sv === null) continue;
          if (sk.startsWith('--')) el.style.setProperty(sk, String(sv));
          else el.style[sk] = sv;
        }
      }
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'ref' && typeof v === 'function') v(el);
      else if (k === 'value' && 'value' in el) el.value = v;
      else if (k === 'checked' || k === 'disabled' || k === 'selected' || k === 'multiple' || k === 'readOnly' || k === 'hidden') el[k] = Boolean(v);
      else if (k === 'href') el.setAttribute('href', safeUrl(v));
      else if (k === 'src') el.setAttribute('src', safeUrl(v, true));
      else el.setAttribute(k, v === true ? '' : String(v));
    }
  }
  append(el, children);
  return el;
}

export function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false || c === true) continue;
    el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

/** Chỉ cho phép http(s), mailto, đường dẫn tương đối, blob/data ảnh – chặn javascript: */
export function safeUrl(url, allowData = false) {
  const s = String(url ?? '').trim();
  if (/^(https?:|mailto:|\/|#|\.\/|\?)/i.test(s)) return s;
  if (/^blob:/i.test(s)) return s;
  if (allowData && /^data:image\/(png|jpe?g|gif|webp);/i.test(s)) return s;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) return s; // tương đối
  return '#';
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

export function mount(el, ...children) {
  clear(el);
  return append(el, children);
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** Nút có icon */
export function btn(label, { icon: ic, variant = '', size = '', onClick, title, type = 'button', disabled, attrs = {} } = {}) {
  const cls = ['btn', variant, size, !label && ic ? 'icon' : ''].filter(Boolean).join(' ');
  return h('button', { class: cls, type, onclick: onClick, title: title || (label ? undefined : undefined), 'aria-label': title || label || undefined, disabled, ...attrs }, ic ? icon(ic) : null, label || null);
}

export function debounce(fn, ms = 300) {
  let t;
  const d = (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
  d.cancel = () => clearTimeout(t);
  d.flush = (...args) => {
    clearTimeout(t);
    fn(...args);
  };
  return d;
}

export function initials(name = '') {
  const parts = String(name).trim().split(/\s+/);
  const a = parts.length > 1 ? parts[parts.length - 2][0] + parts[parts.length - 1][0] : (parts[0] || '?').slice(0, 2);
  return a.toUpperCase();
}

export function avatar(user, size = '') {
  if (user?.avatarPath && user?.id) {
    return h('img', { class: `avatar ${size}`, src: `/api/v1/users/${user.id}/avatar?v=${encodeURIComponent(user.avatarPath.slice(0, 8))}`, alt: user.fullName || '' });
  }
  return h('span', { class: `avatar ${size}`, title: user?.fullName || '' }, initials(user?.fullName || '?'));
}

export { icon };
