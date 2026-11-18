/**
 * Router phía client dùng History API (URL sạch: /notes/12, /drive?folder=3).
 * Mỗi trang là một module có hàm mount(container, ctx) => cleanup().
 */
const routes = [];
let current = null;
let outlet = null;
let beforeEach = null;
const guards = new Set();

export function defineRoute(pattern, loader, meta = {}) {
  const keys = [];
  const re = new RegExp(
    `^${pattern
      .replace(/\/$/, '')
      .replace(/\//g, '\\/')
      .replace(/:(\w+)/g, (_m, k) => {
        keys.push(k);
        return '([^/]+)';
      })}\\/?$`
  );
  routes.push({ pattern, re, keys, loader, meta });
}

export function setOutlet(el) {
  outlet = el;
}
export function onBeforeEach(fn) {
  beforeEach = fn;
}

/** Đăng ký hàm chặn rời trang (vd còn thay đổi chưa lưu). Trả về hàm hủy đăng ký. */
export function addLeaveGuard(fn) {
  guards.add(fn);
  return () => guards.delete(fn);
}

function match(pathname) {
  for (const r of routes) {
    const m = r.re.exec(pathname === '' ? '/' : pathname);
    if (m) {
      const params = {};
      r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
      return { route: r, params };
    }
  }
  return null;
}

export async function navigate(to, { replace = false } = {}) {
  for (const g of guards) {
    if ((await g()) === false) return;
  }
  if (replace) history.replaceState({}, '', to);
  else history.pushState({}, '', to);
  await render();
}

export function currentPath() {
  return location.pathname;
}

export function query() {
  return Object.fromEntries(new URLSearchParams(location.search));
}

/** Cập nhật query string mà không render lại trang */
export function setQuery(params, { replace = true } = {}) {
  const sp = new URLSearchParams(location.search);
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '' || v === false) sp.delete(k);
    else sp.set(k, String(v));
  }
  const url = `${location.pathname}${sp.toString() ? `?${sp}` : ''}`;
  if (replace) history.replaceState({}, '', url);
  else history.pushState({}, '', url);
}

let renderToken = 0;
export async function render() {
  const token = ++renderToken;
  const found = match(location.pathname) || match('/404');
  if (beforeEach) {
    const redirect = await beforeEach(found?.route, location);
    if (redirect) {
      history.replaceState({}, '', redirect);
      return render();
    }
  }
  if (current?.cleanup) {
    try {
      current.cleanup();
    } catch {
      /* ignore */
    }
  }
  guards.clear();
  const mod = await found.route.loader();
  if (token !== renderToken) return;
  const ctx = { params: found.params, query: query(), meta: found.route.meta };
  window.dispatchEvent(new CustomEvent('route:change', { detail: { path: location.pathname, meta: found.route.meta } }));
  const container = found.route.meta.layout === 'none' ? document.getElementById('app') : outlet;
  container.replaceChildren();
  container.className = found.route.meta.layout === 'none' ? '' : `content ${found.route.meta.full ? 'full' : ''}`;
  document.title = `${found.route.meta.title ? `${found.route.meta.title} · ` : ''}UniVerse`;
  const cleanup = await mod.mount(container, ctx);
  current = { cleanup, route: found.route };
  if (!found.route.meta.keepScroll) window.scrollTo(0, 0);
}

export function startRouter() {
  window.addEventListener('popstate', () => render());
  document.addEventListener('click', (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = e.target.closest('a[href]');
    if (!a || a.target === '_blank' || a.hasAttribute('download')) return;
    const href = a.getAttribute('href');
    if (!href.startsWith('/') || href.startsWith('/api/')) return;
    e.preventDefault();
    navigate(href);
  });
  return render();
}
