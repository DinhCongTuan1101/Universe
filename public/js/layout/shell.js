/** App shell: Sidebar + Topbar + UniSearch palette + Notification Center + menu tài khoản. */
import { h, icon, btn, avatar, debounce } from '../core/dom.js';
import { api } from '../core/api.js';
import { store, applyTheme, pref, setPref } from '../core/store.js';
import { navigate } from '../core/router.js';
import { menu, modal, toast, showError, emptyState } from '../core/ui.js';
import { relativeTime } from '../core/format.js';

const NAV = [
  { section: 'Tổng quan' },
  { id: 'dashboard', label: 'Dashboard', icon: 'dashboard', href: '/' },
  { section: 'Học tập' },
  { id: 'schedule', label: 'UniSchedule', icon: 'calendar', href: '/schedule' },
  { id: 'drive', label: 'UniDrive', icon: 'folder', href: '/drive' },
  { id: 'notes', label: 'UniNote', icon: 'note', href: '/notes' },
  { id: 'sheets', label: 'UniSheet', icon: 'sheet', href: '/sheets' },
  { id: 'tasks', label: 'UniTask', icon: 'task', href: '/tasks' },
  { section: 'Thông minh' },
  { id: 'ai', label: 'UniAI', icon: 'sparkles', href: '/ai' },
  { id: 'quiz', label: 'UniQuiz', icon: 'quiz', href: '/quiz' },
  { section: 'Cộng tác' },
  { id: 'groups', label: 'UniGroup', icon: 'users', href: '/groups' },
  { id: 'share', label: 'UniShare', icon: 'share', href: '/share' },
  { section: 'Cá nhân' },
  { id: 'library', label: 'Thư viện', icon: 'bookmark', href: '/library' },
  { id: 'settings', label: 'Settings', icon: 'settings', href: '/settings' },
];

let shell = null;
let outlet = null;
let pollTimer = null;
let unsub = null;

export function removeShell() {
  if (shell) {
    clearInterval(pollTimer);
    unsub?.();
    shell = null;
    outlet = null;
  }
}

export function ensureShell() {
  if (shell && document.body.contains(shell)) return outlet;
  const app = document.getElementById('app');
  const collapsed = pref('sidebarCollapsed', false);
  outlet = h('main', { class: 'content', id: 'outlet' });
  const sidebar = buildSidebar();
  const topbar = buildTopbar();
  const user = store.get().user;
  shell = h(
    'div',
    { class: `app ${collapsed ? 'collapsed' : ''}` },
    sidebar,
    h('div', { class: 'main' }, user?.isDemo ? h('div', { class: 'dev-banner' }, 'Tài khoản DEMO – dữ liệu mẫu chỉ dùng cho môi trường phát triển') : null, topbar, outlet)
  );
  app.replaceChildren(shell);
  window.addEventListener('route:change', onRoute);
  document.addEventListener('keydown', hotkeys);
  refreshUnread();
  pollTimer = setInterval(refreshUnread, 60000);
  unsub = store.subscribe(updateCounters);
  return outlet;
}

function onRoute(e) {
  if (!shell) return;
  const nav = e.detail.meta?.nav;
  shell.querySelectorAll('.nav-link').forEach((a) => a.classList.toggle('active', a.dataset.id === nav));
  shell.classList.remove('mobile-open');
  shell.querySelector('.sidebar-scrim')?.remove();
}

function hotkeys(e) {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    openSearch();
  }
}

// ------------------------------------------------------------------ Sidebar
function buildSidebar() {
  const user = store.get().user;
  const items = [...NAV];
  if (user?.role === 'ADMIN') items.push({ id: 'admin', label: 'Quản trị', icon: 'shield', href: '/admin' });
  return h(
    'aside',
    { class: 'sidebar', 'aria-label': 'Điều hướng chính' },
    h('a', { class: 'brand', href: '/' }, h('span', { class: 'brand-logo' }, icon('logo')), h('span', { class: 'brand-name' }, 'Uni', h('span', {}, 'Verse'))),
    h(
      'nav',
      { class: 'nav' },
      items.map((it) =>
        it.section
          ? h('div', { class: 'nav-section' }, it.section)
          : h('a', { class: 'nav-link', href: it.href, 'data-id': it.id, title: it.label }, icon(it.icon), h('span', {}, it.label), it.id === 'groups' ? h('span', { class: 'badge danger nav-badge', id: 'nav-invites', hidden: true }) : null)
      )
    ),
    h(
      'div',
      { class: 'sidebar-footer' },
      h(
        'button',
        {
          class: 'btn ghost collapse-btn',
          onclick: () => {
            shell.classList.toggle('collapsed');
            setPref('sidebarCollapsed', shell.classList.contains('collapsed'));
          },
          title: 'Thu gọn / mở rộng sidebar',
        },
        icon('chevrons-left'),
        h('span', {}, 'Thu gọn')
      )
    )
  );
}

// ------------------------------------------------------------------ Topbar
function buildTopbar() {
  const user = store.get().user;
  const bellBtn = h('button', { class: 'icon-btn', title: 'Thông báo', 'aria-label': 'Thông báo', onclick: (e) => toggleNotifications(e.currentTarget) }, icon('bell'), h('span', { class: 'count', id: 'notif-count', hidden: true }));
  return h(
    'header',
    { class: 'topbar' },
    h(
      'button',
      {
        class: 'icon-btn menu-toggle',
        'aria-label': 'Mở menu',
        onclick: () => {
          shell.classList.add('mobile-open');
          const scrim = h('div', { class: 'sidebar-scrim', onclick: () => (shell.classList.remove('mobile-open'), scrim.remove()) });
          shell.appendChild(scrim);
        },
      },
      icon('menu')
    ),
    h('button', { class: 'search-trigger', onclick: openSearch, 'aria-label': 'Tìm kiếm' }, icon('search'), h('span', { class: 'grow' }, 'Tìm tài liệu, ghi chú, công việc...'), h('kbd', {}, 'Ctrl K')),
    h(
      'div',
      { class: 'topbar-actions' },
      btn('Tạo mới', { icon: 'plus', variant: 'primary', size: 'sm', onClick: (e) => quickCreate(e.currentTarget) }),
      bellBtn,
      h(
        'button',
        { class: 'account-btn', 'aria-label': 'Tài khoản', onclick: (e) => accountMenu(e.currentTarget) },
        h('span', { id: 'topbar-avatar' }, avatar(user, 'sm')),
        h('span', { class: 'name truncate' }, user?.fullName || ''),
        icon('chevron-down', { size: 14 })
      )
    )
  );
}

function quickCreate(anchor) {
  menu(
    anchor,
    [
      { header: 'Tạo nhanh' },
      { label: 'Ghi chú mới', icon: 'note', onClick: () => navigate('/notes?new=1') },
      { label: 'Công việc mới', icon: 'task', onClick: () => navigate('/tasks?new=1') },
      { label: 'Tải tài liệu lên', icon: 'upload', onClick: () => navigate('/drive?upload=1') },
      { label: 'Bảng tính mới', icon: 'sheet', onClick: () => navigate('/sheets?new=1') },
      { label: 'Môn học / lịch học', icon: 'calendar', onClick: () => navigate('/schedule?new=1') },
      { label: 'Nhập thời khóa biểu', icon: 'upload', onClick: () => navigate('/schedule/import') },
      'sep',
      { label: 'Hỏi UniAI', icon: 'sparkles', onClick: () => navigate('/ai?new=1') },
      { label: 'Bộ câu hỏi mới', icon: 'quiz', onClick: () => navigate('/quiz?new=1') },
      { label: 'Nhóm học tập', icon: 'users', onClick: () => navigate('/groups?new=1') },
      { label: 'Đăng bài chia sẻ', icon: 'share', onClick: () => navigate('/share/new') },
    ],
    { align: 'right' }
  );
}

function accountMenu(anchor) {
  const user = store.get().user;
  const setTheme = async (theme) => {
    applyTheme(theme);
    try {
      const u = await api.patch('/users/me/settings', { theme });
      store.set({ user: { ...store.get().user, ...u } });
    } catch (e) {
      showError(e);
    }
  };
  menu(
    anchor,
    [
      { header: user.email },
      { label: 'Hồ sơ & Cài đặt', icon: 'user', onClick: () => navigate('/settings') },
      { label: 'Thư viện (Yêu thích, Gần đây, Thùng rác)', icon: 'bookmark', onClick: () => navigate('/library') },
      user.role === 'ADMIN' ? { label: 'Quản trị hệ thống', icon: 'shield', onClick: () => navigate('/admin') } : null,
      user.role !== 'STUDENT' ? { label: 'Kiểm duyệt UniShare', icon: 'flag', onClick: () => navigate('/share/moderation') } : null,
      'sep',
      { header: 'Giao diện' },
      { label: 'Sáng', icon: 'sun', onClick: () => setTheme('light') },
      { label: 'Tối', icon: 'moon', onClick: () => setTheme('dark') },
      { label: 'Theo hệ thống', icon: 'monitor', onClick: () => setTheme('system') },
      'sep',
      {
        label: 'Đăng xuất',
        icon: 'logout',
        danger: true,
        onClick: async () => {
          try {
            await api.post('/auth/logout');
          } catch {
            /* vẫn đăng xuất phía client */
          }
          store.set({ user: null });
          location.href = '/login';
        },
      },
    ],
    { align: 'right' }
  );
}

function updateCounters(state) {
  const c = document.getElementById('notif-count');
  if (c) {
    c.hidden = !state.unread;
    c.textContent = state.unread > 99 ? '99+' : String(state.unread);
  }
  const av = document.getElementById('topbar-avatar');
  if (av && state.user) av.replaceChildren(avatar(state.user, 'sm'));
}

export async function refreshUnread() {
  try {
    const { unreadCount } = await api.get('/notifications/unread-count');
    store.set({ unread: unreadCount });
  } catch {
    /* bỏ qua lỗi tạm thời */
  }
}

// ------------------------------------------------------------------ Notification Center
let notifPanel = null;
function closeNotifications() {
  notifPanel?.remove();
  notifPanel = null;
  document.removeEventListener('mousedown', outsideNotif, true);
}
function outsideNotif(e) {
  if (notifPanel && !notifPanel.contains(e.target) && !e.target.closest('.icon-btn[title="Thông báo"]')) closeNotifications();
}

async function toggleNotifications() {
  if (notifPanel) return closeNotifications();
  const list = h('div', { class: 'notif-list' }, h('div', { class: 'loading-center' }, h('div', { class: 'spinner' })));
  notifPanel = h(
    'div',
    { class: 'notif-panel', role: 'dialog', 'aria-label': 'Thông báo' },
    h(
      'div',
      { class: 'notif-head' },
      h('h3', {}, 'Thông báo'),
      btn('Đọc tất cả', {
        size: 'xs',
        variant: 'ghost',
        icon: 'check',
        onClick: async () => {
          await api.post('/notifications/read-all').catch(showError);
          load();
          refreshUnread();
        },
      }),
      btn('', {
        size: 'xs',
        variant: 'ghost',
        icon: 'trash',
        title: 'Xóa các thông báo đã đọc',
        onClick: async () => {
          await api.del('/notifications').catch(showError);
          load();
        },
      })
    ),
    list
  );
  document.body.appendChild(notifPanel);
  setTimeout(() => document.addEventListener('mousedown', outsideNotif, true));

  async function load() {
    try {
      const { items } = await api.get('/notifications', { limit: 40 });
      if (!items.length) return list.replaceChildren(emptyState({ icon: 'bell', title: 'Không có thông báo', text: 'Thông báo về nhắc việc, nhóm và cộng đồng sẽ hiển thị ở đây.', compact: true }));
      list.replaceChildren(
        ...items.map((n) =>
          h(
            'div',
            {
              class: `notif-item ${n.readAt ? '' : 'unread'}`,
              onclick: async () => {
                if (!n.readAt) await api.patch(`/notifications/${n.id}`, { read: true }).catch(() => {});
                refreshUnread();
                closeNotifications();
                if (n.link) navigate(n.link);
              },
            },
            h('div', { class: 'icon-box sm' }, icon(n.type.startsWith('task') ? 'clock' : n.type.startsWith('group') ? 'users' : n.type.startsWith('share') ? 'share' : 'file')),
            h('div', { class: 'grow' }, h('div', { class: 'bold small' }, n.title), n.body ? h('div', { class: 'small muted' }, n.body) : null, h('div', { class: 'tiny faint' }, relativeTime(n.createdAt))),
            h(
              'div',
              { class: 'notif-actions' },
              btn('', {
                size: 'xs',
                variant: 'ghost',
                icon: n.readAt ? 'eye' : 'check',
                title: n.readAt ? 'Đánh dấu chưa đọc' : 'Đánh dấu đã đọc',
                onClick: async (e) => {
                  e.stopPropagation();
                  await api.patch(`/notifications/${n.id}`, { read: !n.readAt }).catch(showError);
                  load();
                  refreshUnread();
                },
              }),
              btn('', {
                size: 'xs',
                variant: 'ghost',
                icon: 'x',
                title: 'Xóa',
                onClick: async (e) => {
                  e.stopPropagation();
                  await api.del(`/notifications/${n.id}`).catch(showError);
                  load();
                  refreshUnread();
                },
              })
            )
          )
        )
      );
    } catch (e) {
      list.replaceChildren(h('div', { class: 'empty-state compact' }, e.message));
    }
  }
  load();
}

// ------------------------------------------------------------------ UniSearch palette
const GROUP_LABELS = { files: ['Tài liệu', 'file'], notes: ['Ghi chú', 'note'], tasks: ['Công việc', 'task'], groups: ['Nhóm', 'users'], posts: ['UniShare', 'share'], subjects: ['Môn học', 'calendar'], workbooks: ['Bảng tính', 'sheet'], quizzes: ['Bộ câu hỏi', 'quiz'] };

export function openSearch() {
  const input = h('input', { placeholder: 'Tìm trên toàn UniVerse...', 'aria-label': 'Tìm kiếm', autocomplete: 'off' });
  const results = h('div', { class: 'palette-results' });
  let items = [];
  let sel = 0;
  let ctrl;
  const m = modal({
    footer: undefined,
    body: () => [],
  });
  // thay nội dung modal mặc định bằng palette
  const backdrop = m.el.parentElement;
  m.el.remove();
  const palette = h(
    'div',
    { class: 'palette', role: 'dialog', 'aria-label': 'Tìm kiếm' },
    h('div', { class: 'palette-input' }, icon('search'), input, h('kbd', {}, 'Esc')),
    results,
    h('div', { class: 'palette-footer' }, h('span', {}, h('kbd', {}, '↑↓'), ' chọn'), h('span', {}, h('kbd', {}, 'Enter'), ' mở'), h('span', { class: 'spacer' }), h('a', { href: '#', onclick: (e) => (e.preventDefault(), go(`/search?q=${encodeURIComponent(input.value)}`)) }, 'Xem tất cả kết quả'))
  );
  backdrop.appendChild(palette);
  backdrop.style.placeItems = 'start center';
  setTimeout(() => input.focus(), 20);

  const go = (link) => {
    m.close();
    navigate(link);
  };

  const hint = () => results.replaceChildren(h('div', { class: 'empty-state compact' }, h('p', {}, 'Nhập từ khóa để tìm tài liệu (kể cả nội dung bên trong), ghi chú, công việc, nhóm, bài viết...')));
  hint();

  const search = debounce(async (q) => {
    if (!q.trim()) return hint();
    ctrl?.abort();
    ctrl = new AbortController();
    results.replaceChildren(h('div', { class: 'loading-center' }, h('div', { class: 'spinner' })));
    try {
      const data = await api.get('/search', { q, limit: 5 }, { signal: ctrl.signal });
      items = [];
      const nodes = [];
      for (const [key, list] of Object.entries(data.results)) {
        if (!list.length) continue;
        const [label, ic] = GROUP_LABELS[key];
        nodes.push(h('div', { class: 'palette-group' }, label));
        for (const r of list) {
          const idx = items.length;
          const el = h('a', { class: 'palette-item', href: r.link, onclick: (e) => (e.preventDefault(), go(r.link)), onmouseenter: () => select(idx) }, h('div', { class: 'icon-box sm' }, icon(ic)), h('div', { class: 'grow', style: { minWidth: 0 } }, h('div', { class: 'truncate bold small' }, r.title), r.subtitle ? h('div', { class: 'sub truncate' }, r.subtitle) : null), r.shared ? h('span', { class: 'badge' }, 'Được chia sẻ') : null);
          items.push({ el, link: r.link });
          nodes.push(el);
        }
      }
      if (!items.length) nodes.push(emptyState({ icon: 'search', title: 'Không tìm thấy kết quả', text: `Không có dữ liệu nào khớp "${q}" mà bạn có quyền xem.`, compact: true }));
      results.replaceChildren(...nodes);
      select(0);
    } catch (e) {
      if (e.name !== 'AbortError') results.replaceChildren(h('div', { class: 'empty-state compact' }, e.message));
    }
  }, 250);

  function select(i) {
    sel = i;
    items.forEach((it, j) => it.el.classList.toggle('selected', j === i));
    items[i]?.el.scrollIntoView({ block: 'nearest' });
  }

  input.addEventListener('input', () => search(input.value));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      select(Math.min(items.length - 1, sel + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      select(Math.max(0, sel - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (items[sel]) go(items[sel].link);
      else if (input.value.trim()) go(`/search?q=${encodeURIComponent(input.value)}`);
    }
  });
}

export { toast };
