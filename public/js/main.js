/** Điểm khởi động frontend UniVerse. */
import { api, setCsrf } from './core/api.js';
import { store, applyTheme, initialTheme } from './core/store.js';
import { defineRoute, startRouter, onBeforeEach, setOutlet, navigate } from './core/router.js';
import { ensureShell, removeShell } from './layout/shell.js';
import { toast } from './core/ui.js';

applyTheme(initialTheme());

const page = (name) => () => import(`./pages/${name}.js`);

// Trang công khai (không cần đăng nhập)
defineRoute('/login', page('auth'), { title: 'Đăng nhập', public: true, layout: 'none', mode: 'login' });
defineRoute('/register', page('auth'), { title: 'Đăng ký', public: true, layout: 'none', mode: 'register' });

// Ứng dụng
defineRoute('/', page('dashboard'), { title: 'Dashboard', nav: 'dashboard' });
defineRoute('/schedule', page('schedule'), { title: 'UniSchedule', nav: 'schedule' });
defineRoute('/schedule/import', page('schedule-import'), { title: 'Nhập thời khóa biểu', nav: 'schedule' });
defineRoute('/drive', page('drive'), { title: 'UniDrive', nav: 'drive' });
defineRoute('/notes', page('notes'), { title: 'UniNote', nav: 'notes', full: true });
defineRoute('/notes/:id', page('notes'), { title: 'UniNote', nav: 'notes', full: true });
defineRoute('/sheets', page('sheets'), { title: 'UniSheet', nav: 'sheets' });
defineRoute('/sheets/:id', page('sheet-editor'), { title: 'UniSheet', nav: 'sheets', full: true });
defineRoute('/tasks', page('tasks'), { title: 'UniTask', nav: 'tasks' });
defineRoute('/ai', page('ai'), { title: 'UniAI', nav: 'ai', full: true });
defineRoute('/ai/:id', page('ai'), { title: 'UniAI', nav: 'ai', full: true });
defineRoute('/quiz', page('quiz'), { title: 'UniQuiz', nav: 'quiz' });
defineRoute('/quiz/:id', page('quiz-set'), { title: 'UniQuiz', nav: 'quiz' });
defineRoute('/quiz/attempt/:id', page('quiz-play'), { title: 'Làm bài', nav: 'quiz' });
defineRoute('/quiz/:id/flashcards', page('quiz-flashcards'), { title: 'Flashcards', nav: 'quiz' });
defineRoute('/groups', page('groups'), { title: 'UniGroup', nav: 'groups' });
defineRoute('/groups/:id', page('group-detail'), { title: 'UniGroup', nav: 'groups' });
defineRoute('/share', page('share'), { title: 'UniShare', nav: 'share' });
defineRoute('/share/new', page('share-editor'), { title: 'Đăng bài', nav: 'share' });
defineRoute('/share/moderation', page('share-moderation'), { title: 'Kiểm duyệt', nav: 'share', roles: ['MODERATOR', 'ADMIN'] });
defineRoute('/share/:id/edit', page('share-editor'), { title: 'Sửa bài viết', nav: 'share' });
defineRoute('/share/:id', page('share-post'), { title: 'UniShare', nav: 'share' });
defineRoute('/search', page('search'), { title: 'Tìm kiếm' });
defineRoute('/library', page('library'), { title: 'Thư viện', nav: 'library' });
defineRoute('/settings', page('settings'), { title: 'Cài đặt', nav: 'settings' });
defineRoute('/admin', page('admin'), { title: 'Quản trị', nav: 'admin', roles: ['ADMIN'] });
defineRoute('/404', page('not-found'), { title: 'Không tìm thấy' });

onBeforeEach(async (route, loc) => {
  const { user } = store.get();
  if (!route.meta.public && !user) return `/login?next=${encodeURIComponent(loc.pathname + loc.search)}`;
  if (route.meta.public && user) return '/';
  if (route.meta.roles && !route.meta.roles.includes(user.role)) {
    toast.error('Bạn không có quyền truy cập trang này');
    return '/';
  }
  if (route.meta.layout === 'none') removeShell();
  else setOutlet(ensureShell());
  return null;
});

window.addEventListener('auth:expired', () => {
  if (!store.get().user) return;
  store.set({ user: null });
  toast.warning('Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại.');
  navigate(`/login?next=${encodeURIComponent(location.pathname)}`, { replace: true });
});

async function boot() {
  try {
    const status = await api.get('/auth/status');
    setCsrf(status.csrfToken);
    store.set({ user: status.user, aiConfigured: status.aiConfigured });
    if (status.user?.theme) applyTheme(status.user.theme);
  } catch (err) {
    document.getElementById('app').replaceChildren(
      Object.assign(document.createElement('div'), {
        className: 'empty-state',
        style: 'min-height:100vh;justify-content:center',
        textContent: `Không kết nối được máy chủ UniVerse: ${err.message}`,
      })
    );
    return;
  }
  await startRouter();
}

boot();
