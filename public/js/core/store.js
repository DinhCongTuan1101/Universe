/** Trạng thái toàn cục nhỏ gọn (người dùng hiện tại, AI, số thông báo chưa đọc). */
const state = { user: null, aiConfigured: false, unread: 0, subjects: null };
const listeners = new Set();

export const store = {
  get: () => state,
  set(patch) {
    Object.assign(state, patch);
    listeners.forEach((fn) => fn(state));
  },
  subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};

/** Áp dụng giao diện sáng/tối/hệ thống */
export function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === 'light' || theme === 'dark') root.setAttribute('data-theme', theme);
  else root.removeAttribute('data-theme');
  try {
    localStorage.setItem('universe.theme', theme || 'system');
  } catch {
    /* bộ nhớ trình duyệt có thể bị chặn */
  }
}

export function initialTheme() {
  try {
    return localStorage.getItem('universe.theme') || 'system';
  } catch {
    return 'system';
  }
}

export function pref(key, fallback) {
  try {
    const v = localStorage.getItem(`universe.${key}`);
    return v === null ? fallback : JSON.parse(v);
  } catch {
    return fallback;
  }
}
export function setPref(key, value) {
  try {
    localStorage.setItem(`universe.${key}`, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}
