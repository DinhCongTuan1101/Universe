/**
 * UI components dùng chung: toast, modal, confirm, prompt, dropdown, drawer,
 * skeleton, empty/error state. Thay thế hoàn toàn alert/confirm mặc định của trình duyệt.
 */
import { h, clear, icon, btn } from './dom.js';

// ------------------------------------------------------------------ Toast
let stack;
export function toast(message, type = 'success', { timeout = 3800 } = {}) {
  if (!stack) {
    stack = h('div', { class: 'toast-stack', role: 'status', 'aria-live': 'polite' });
    document.body.appendChild(stack);
  }
  const ic = { success: 'check-circle', error: 'alert', warning: 'alert', info: 'info' }[type] || 'info';
  const el = h('div', { class: `toast ${type}` }, icon(ic), h('div', { class: 'grow' }, message), h('button', { class: 'toast-close', 'aria-label': 'Đóng', onclick: () => close() }, icon('x', { size: 14 })));
  stack.appendChild(el);
  const close = () => {
    el.classList.add('leaving');
    setTimeout(() => el.remove(), 200);
  };
  if (timeout) setTimeout(close, type === 'error' ? timeout + 2500 : timeout);
  return close;
}
toast.error = (m) => toast(m, 'error');
toast.info = (m) => toast(m, 'info');
toast.warning = (m) => toast(m, 'warning');

/** Hiển thị lỗi API thân thiện (kèm lỗi validation đầu tiên nếu có). */
export function showError(err, fallback = 'Đã xảy ra lỗi') {
  if (err?.name === 'AbortError') return;
  let msg = err?.message || fallback;
  if (err?.details?.length && err.details[0]?.message && err.code === 'VALIDATION') {
    msg = `${msg}: ${err.details[0].message}`;
  }
  toast(msg, 'error');
}

// ------------------------------------------------------------------ Modal
const openModals = [];
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && openModals.length) {
    const top = openModals[openModals.length - 1];
    if (top.dismissible) top.close(undefined);
  }
});

/**
 * modal({ title, body, footer, size, onClose, dismissible }) => { el, close, body, footer, promise }
 * body/footer: Node hoặc hàm (close) => Node
 */
export function modal({ title, body, footer, size = '', dismissible = true, icon: ic, onClose } = {}) {
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  const prevFocus = document.activeElement;
  const ctl = { dismissible, close: null, promise };
  const close = (value) => {
    backdrop.remove();
    openModals.splice(openModals.indexOf(ctl), 1);
    if (!openModals.length) document.body.style.overflow = '';
    onClose?.(value);
    resolve(value);
    prevFocus?.focus?.();
  };
  ctl.close = close;
  const bodyEl = h('div', { class: 'modal-body' });
  const footerEl = h('div', { class: 'modal-footer' });
  const dialog = h(
    'div',
    { class: `modal ${size}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': title || 'Hộp thoại' },
    title || ic
      ? h('div', { class: 'modal-header' }, ic ? h('div', { class: 'icon-box sm' }, icon(ic)) : null, h('h2', {}, title || ''), dismissible ? btn('', { icon: 'x', variant: 'ghost', size: 'sm', title: 'Đóng', onClick: () => close(undefined) }) : null)
      : null,
    bodyEl,
    footer !== null ? footerEl : null
  );
  const backdrop = h('div', { class: 'modal-backdrop', onmousedown: (e) => dismissible && e.target === backdrop && close(undefined) }, dialog);
  const resolveNode = (n) => (typeof n === 'function' ? n(close) : n);
  if (body) bodyEl.append(...[].concat(resolveNode(body)).filter(Boolean));
  if (footer) footerEl.append(...[].concat(resolveNode(footer)).filter(Boolean));
  else if (footer === undefined) footerEl.remove();
  document.body.appendChild(backdrop);
  document.body.style.overflow = 'hidden';
  openModals.push(ctl);
  setTimeout(() => (dialog.querySelector('[autofocus], input, textarea, select, .btn.primary') || dialog).focus?.(), 30);
  return { el: dialog, body: bodyEl, footer: footerEl, close, promise };
}

/** Hộp thoại xác nhận – trả về Promise<boolean>. */
export function confirmDialog({ title = 'Xác nhận', message, confirmText = 'Xác nhận', cancelText = 'Hủy', danger = false, icon: ic } = {}) {
  const m = modal({
    body: (close) => [
      h('div', { class: `dialog-icon ${danger ? 'danger' : ''}` }, icon(ic || (danger ? 'alert' : 'info'))),
      h('h2', { style: { fontSize: '17px', marginBottom: '6px' } }, title),
      typeof message === 'string' ? h('p', { class: 'muted' }, message) : message,
    ],
    footer: (close) => [btn(cancelText, { onClick: () => close(false) }), btn(confirmText, { variant: danger ? 'danger' : 'primary', onClick: () => close(true) })],
  });
  return m.promise.then((v) => v === true);
}

/** Hộp thoại nhập liệu – trả về chuỗi hoặc null. */
export function promptDialog({ title, label, value = '', placeholder = '', confirmText = 'Lưu', maxLength = 191, multiline = false, required = true } = {}) {
  const input = multiline
    ? h('textarea', { class: 'textarea', value, placeholder, maxlength: maxLength, rows: 4 })
    : h('input', { class: 'input', value, placeholder, maxlength: maxLength, autofocus: true });
  const err = h('div', { class: 'error-msg', hidden: true });
  const m = modal({
    title,
    body: h('div', { class: 'field' }, label ? h('label', {}, label) : null, input, err),
    footer: (close) => [
      btn('Hủy', { onClick: () => close(null) }),
      btn(confirmText, {
        variant: 'primary',
        onClick: () => submit(close),
      }),
    ],
  });
  function submit(close) {
    const v = input.value.trim();
    if (required && !v) {
      err.textContent = 'Không được để trống';
      err.hidden = false;
      input.classList.add('invalid');
      return;
    }
    close(v);
  }
  if (!multiline) input.addEventListener('keydown', (e) => e.key === 'Enter' && submit(m.close));
  setTimeout(() => {
    input.focus();
    input.select?.();
  }, 40);
  return m.promise.then((v) => (v === undefined ? null : v));
}

// ------------------------------------------------------------------ Dropdown menu
let openMenu = null;
function closeMenu() {
  if (openMenu) {
    openMenu.remove();
    openMenu = null;
    document.removeEventListener('mousedown', outside, true);
  }
}
function outside(e) {
  if (openMenu && !openMenu.contains(e.target)) closeMenu();
}
/**
 * menu(anchorEl | {x,y}, items) – items: { label, icon, onClick, danger, disabled } | 'sep' | { header }
 */
export function menu(anchor, items, { align = 'left' } = {}) {
  closeMenu();
  const el = h(
    'div',
    { class: 'dropdown', role: 'menu' },
    items.filter(Boolean).map((it) => {
      if (it === 'sep') return h('div', { class: 'dropdown-sep' });
      if (it.header) return h('div', { class: 'dropdown-label' }, it.header);
      return h(
        'button',
        {
          class: `dropdown-item ${it.danger ? 'danger' : ''}`,
          role: 'menuitem',
          disabled: it.disabled,
          onclick: (e) => {
            e.stopPropagation();
            closeMenu();
            it.onClick?.();
          },
        },
        it.icon ? icon(it.icon) : null,
        h('span', { class: 'grow' }, it.label),
        it.hint ? h('span', { class: 'tiny faint' }, it.hint) : null
      );
    })
  );
  document.body.appendChild(el);
  const r = anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : { left: anchor.x, right: anchor.x, top: anchor.y, bottom: anchor.y };
  const w = el.offsetWidth;
  const hgt = el.offsetHeight;
  let left = align === 'right' ? r.right - w : r.left;
  let top = r.bottom + 6;
  if (left + w > innerWidth - 8) left = innerWidth - w - 8;
  if (left < 8) left = 8;
  if (top + hgt > innerHeight - 8) top = Math.max(8, r.top - hgt - 6);
  el.style.left = `${left}px`;
  el.style.top = `${top}px`;
  openMenu = el;
  setTimeout(() => document.addEventListener('mousedown', outside, true));
  el.querySelector('.dropdown-item')?.focus();
  el.addEventListener('keydown', (e) => {
    const list = [...el.querySelectorAll('.dropdown-item:not([disabled])')];
    const i = list.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') list[(i + 1) % list.length]?.focus();
    if (e.key === 'ArrowUp') list[(i - 1 + list.length) % list.length]?.focus();
    if (e.key === 'Escape') closeMenu();
    if (['ArrowDown', 'ArrowUp'].includes(e.key)) e.preventDefault();
  });
  return closeMenu;
}
window.addEventListener('resize', closeMenu);
window.addEventListener('scroll', closeMenu, true);

// ------------------------------------------------------------------ Drawer
export function drawer({ title, body, footer, wide = false, onClose } = {}) {
  const close = () => {
    back.remove();
    el.remove();
    document.removeEventListener('keydown', esc);
    onClose?.();
  };
  const esc = (e) => e.key === 'Escape' && !openModals.length && close();
  const bodyEl = h('div', { class: 'drawer-body' });
  const footerEl = h('div', { class: 'drawer-footer' });
  const titleEl = h('h2', {}, title || '');
  const el = h('aside', { class: `drawer ${wide ? 'wide' : ''}`, role: 'dialog', 'aria-label': title }, h('div', { class: 'drawer-header' }, titleEl, btn('', { icon: 'x', variant: 'ghost', size: 'sm', title: 'Đóng', onClick: close })), bodyEl, footer ? footerEl : null);
  const back = h('div', { class: 'drawer-backdrop', onclick: close });
  if (body) bodyEl.append(...[].concat(typeof body === 'function' ? body(close) : body).filter(Boolean));
  if (footer) footerEl.append(...[].concat(typeof footer === 'function' ? footer(close) : footer).filter(Boolean));
  document.body.append(back, el);
  document.addEventListener('keydown', esc);
  return { el, body: bodyEl, footer: footerEl, title: titleEl, close };
}

// ------------------------------------------------------------------ States
export function skeleton(lines = 4, { height = 14, avatar = false } = {}) {
  return h(
    'div',
    { class: 'skeleton-list', 'aria-busy': 'true', 'aria-label': 'Đang tải' },
    Array.from({ length: lines }, (_, i) =>
      h('div', { class: 'row gap-12' }, avatar ? h('div', { class: 'skeleton', style: { width: '36px', height: '36px', borderRadius: '10px', flex: 'none' } }) : null, h('div', { class: 'col grow', style: { gap: '6px' } }, h('div', { class: 'skeleton', style: { height: `${height}px`, width: `${60 + ((i * 17) % 35)}%` } }), avatar ? h('div', { class: 'skeleton', style: { height: '10px', width: '35%' } }) : null))
    )
  );
}

export function skeletonCards(n = 6) {
  return h('div', { class: 'grid auto' }, Array.from({ length: n }, () => h('div', { class: 'card card-pad' }, h('div', { class: 'skeleton', style: { height: '18px', width: '60%', marginBottom: '12px' } }), h('div', { class: 'skeleton', style: { height: '12px', width: '90%', marginBottom: '8px' } }), h('div', { class: 'skeleton', style: { height: '12px', width: '40%' } }))));
}

export function emptyState({ icon: ic = 'inbox', title, text, action, compact = false } = {}) {
  return h('div', { class: `empty-state ${compact ? 'compact' : ''}` }, h('div', { class: 'icon-box' }, icon(ic)), title ? h('h3', {}, title) : null, text ? h('p', {}, text) : null, action || null);
}

export function errorState(err, onRetry) {
  return h(
    'div',
    { class: 'empty-state error-state' },
    h('div', { class: 'icon-box' }, icon('alert')),
    h('h3', {}, err?.status === 403 ? 'Bạn không có quyền truy cập' : err?.status === 404 ? 'Không tìm thấy dữ liệu' : 'Không tải được dữ liệu'),
    h('p', {}, err?.message || 'Đã xảy ra lỗi'),
    onRetry ? btn('Thử lại', { icon: 'refresh', onClick: onRetry }) : null
  );
}

export function loading() {
  return h('div', { class: 'loading-center' }, h('div', { class: 'spinner' }));
}

/** Đặt trạng thái đang xử lý cho nút trong khi chạy hàm async. */
export async function withLoading(button, fn) {
  if (!button) return fn();
  button.classList.add('loading');
  button.disabled = true;
  try {
    return await fn();
  } finally {
    button.classList.remove('loading');
    button.disabled = false;
  }
}

/** Ô nhập có nhãn */
export function field(label, input, { hint, error, className = '' } = {}) {
  return h('div', { class: `field ${className}` }, label ? h('label', {}, label) : null, input, hint ? h('div', { class: 'hint' }, hint) : null, error ? h('div', { class: 'error-msg' }, error) : null);
}

export function select(options, value, attrs = {}) {
  return h(
    'select',
    { class: `select ${attrs.size || ''}`, ...attrs },
    options.map((o) => h('option', { value: o.value ?? '', selected: String(o.value ?? '') === String(value ?? '') }, o.label))
  );
}

/** Hiển thị lỗi validation từ API lên form (theo name). */
export function applyFieldErrors(form, err) {
  form.querySelectorAll('.error-msg.api').forEach((e) => e.remove());
  form.querySelectorAll('.invalid').forEach((e) => e.classList.remove('invalid'));
  if (!err?.details) return false;
  let applied = false;
  for (const d of err.details) {
    const input = form.querySelector(`[name="${d.field}"]`);
    if (input) {
      input.classList.add('invalid');
      input.closest('.field')?.append(h('div', { class: 'error-msg api' }, d.message));
      applied = true;
    }
  }
  return applied;
}

export { clear };
