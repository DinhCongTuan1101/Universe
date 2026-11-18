import { h, icon, btn } from '../core/dom.js';
import { api } from '../core/api.js';
import { store } from '../core/store.js';
import { skeleton, emptyState, errorState } from '../core/ui.js';
import { isoDate, fmtDayLabel, relativeTime, dueLabel, fileSize, periodLabel, periodTime, PRIORITY, FILE_ICONS } from '../core/format.js';

export function mount(container) {
  const user = store.get().user;
  const hour = new Date().getHours();
  const greet = hour < 11 ? 'Chào buổi sáng' : hour < 14 ? 'Chào buổi trưa' : hour < 18 ? 'Chào buổi chiều' : 'Chào buổi tối';
  const body = h('div', {}, skeleton(8));
  container.append(
    h(
      'div',
      { class: 'page-header' },
      h('div', { class: 'titles' }, h('h1', {}, `${greet}, ${user.fullName.split(' ').slice(-1)[0]} 👋`), h('p', {}, fmtDayLabel(isoDate()))),
      h('div', { class: 'actions' }, btn('Nhập thời khóa biểu', { icon: 'upload', href: '/schedule/import', onClick: () => go('/schedule/import') }), btn('Hỏi UniAI', { icon: 'sparkles', variant: 'gradient', onClick: () => go('/ai?new=1') }))
    ),
    body
  );

  async function load() {
    try {
      const d = await api.get('/dashboard', { today: isoDate() });
      body.replaceChildren(render(d));
    } catch (e) {
      body.replaceChildren(errorState(e, load));
    }
  }
  load();
}

function go(path) {
  import('../core/router.js').then((r) => r.navigate(path));
}

function stat(ic, value, label, color, href) {
  return h(
    'a',
    { class: 'card hoverable stat', href, style: { textDecoration: 'none', color: 'inherit' } },
    h('div', { class: 'icon-box', style: { background: `${color}1a`, color } }, icon(ic)),
    h('div', {}, h('div', { class: 'value' }, value), h('div', { class: 'label' }, label))
  );
}

function card(title, ic, href, content, extra) {
  return h(
    'section',
    { class: 'card' },
    h('div', { class: 'card-header' }, h('div', { class: 'icon-box sm' }, icon(ic)), h('h3', {}, title), extra || null, href ? h('a', { href, class: 'small' }, 'Xem tất cả') : null),
    h('div', { class: 'card-body' }, content)
  );
}

function render(d) {
  const s = d.stats;
  const t = d.tasks.stats;
  const pct = s.storageQuota ? Math.min(100, Math.round((s.storageUsed / s.storageQuota) * 100)) : 0;

  const todayClasses = d.todayClasses.length
    ? h(
        'div',
        { class: 'list' },
        d.todayClasses.map((m) =>
          h(
            'a',
            { class: 'list-item', href: `/schedule?date=${d.today}&meeting=${m.id}` },
            h('div', { style: { width: '4px', alignSelf: 'stretch', borderRadius: '4px', background: m.subject.color } }),
            h(
              'div',
              { class: 'grow' },
              h('div', { class: 'bold' }, m.subject.name, m.status === 'CANCELLED' ? h('span', { class: 'badge danger', style: { marginLeft: '6px' } }, 'Nghỉ') : null),
              h('div', { class: 'small muted' }, [periodLabel(m.startPeriod, m.endPeriod), periodTime(d.classPeriods, m.startPeriod, m.endPeriod), m.room ? `Phòng ${m.room}` : null].filter(Boolean).join(' · '))
            ),
            m._count.tasks ? h('span', { class: 'badge primary' }, `${m._count.tasks} việc`) : null
          )
        )
      )
    : emptyState({ icon: 'calendar', title: 'Hôm nay không có lịch học', text: s.subjects ? 'Tận hưởng thời gian tự học nhé!' : 'Nhập thời khóa biểu để xem lịch học mỗi ngày.', compact: true, action: s.subjects ? null : btn('Nhập thời khóa biểu', { size: 'sm', variant: 'soft', icon: 'upload', onClick: () => go('/schedule/import') }) });

  const upcoming = d.tasks.upcoming.length
    ? h(
        'div',
        { class: 'list' },
        d.tasks.upcoming.map((task) => {
          const due = dueLabel(task.dueAt);
          return h(
            'a',
            { class: 'list-item', href: task.group ? `/groups/${task.group.id}?tab=tasks` : `/tasks?open=${task.id}` },
            h('span', { class: 'dot', style: { background: task.subject?.color || 'var(--border-strong)' } }),
            h('div', { class: 'grow', style: { minWidth: 0 } }, h('div', { class: 'truncate bold small' }, task.title), h('div', { class: 'tiny muted' }, [task.subject?.name, task.group ? `Nhóm ${task.group.name}` : null].filter(Boolean).join(' · ') || 'Cá nhân')),
            h('span', { class: `badge ${due.tone}` }, due.text),
            h('span', { class: `badge ${PRIORITY[task.priority].tone}` }, PRIORITY[task.priority].label)
          );
        })
      )
    : emptyState({ icon: 'check-circle', title: 'Không có deadline trong 7 ngày tới', compact: true, action: btn('Tạo công việc', { size: 'sm', variant: 'soft', icon: 'plus', onClick: () => go('/tasks?new=1') }) });

  const progress = h(
    'div',
    { class: 'col gap-12' },
    h('div', { class: 'row' }, h('div', { style: { fontSize: '32px', fontWeight: 750, letterSpacing: '-0.03em' } }, `${t.completionRate}%`), h('div', { class: 'muted small' }, 'công việc đã hoàn thành')),
    h('div', { class: 'progress' }, h('span', { style: { width: `${t.completionRate}%` } })),
    h(
      'div',
      { class: 'grid cols-3', style: { gap: '8px' } },
      [
        ['Cần làm', t.counts.TODO, 'var(--text-2)'],
        ['Đang làm', t.counts.IN_PROGRESS, 'var(--primary)'],
        ['Xong', t.counts.DONE, 'var(--success)'],
      ].map(([l, v, c]) => h('div', { class: 'card', style: { padding: '10px', textAlign: 'center' } }, h('div', { class: 'bold', style: { color: c, fontSize: '18px' } }, v), h('div', { class: 'tiny muted' }, l)))
    ),
    t.overdue ? h('div', { class: 'alert danger' }, icon('alert'), `${t.overdue} công việc đã quá hạn`) : null
  );

  const recentFiles = d.recentFiles.length
    ? h(
        'div',
        { class: 'list' },
        d.recentFiles.map((f) => {
          const fi = FILE_ICONS[f.extension] || FILE_ICONS.txt;
          return h('a', { class: 'list-item', href: `/drive?file=${f.id}` }, h('div', { class: 'icon-box sm', style: { background: `${fi.color}1a`, color: fi.color } }, icon(fi.icon)), h('div', { class: 'grow', style: { minWidth: 0 } }, h('div', { class: 'truncate small bold' }, f.originalName), h('div', { class: 'tiny muted' }, `${fileSize(f.size)} · ${relativeTime(f.updatedAt)}`)));
        })
      )
    : emptyState({ icon: 'folder', title: 'Chưa có tài liệu', compact: true, action: btn('Tải lên', { size: 'sm', variant: 'soft', icon: 'upload', onClick: () => go('/drive?upload=1') }) });

  const recentNotes = d.recentNotes.length
    ? h(
        'div',
        { class: 'list' },
        d.recentNotes.map((n) => h('a', { class: 'list-item', href: `/notes/${n.id}` }, h('div', { class: 'icon-box sm', style: { background: 'var(--secondary-soft)', color: 'var(--secondary)' } }, n.icon ? h('span', {}, n.icon) : icon('note')), h('div', { class: 'grow', style: { minWidth: 0 } }, h('div', { class: 'truncate small bold' }, n.title || 'Không tiêu đề'), h('div', { class: 'tiny muted' }, relativeTime(n.updatedAt)))))
      )
    : emptyState({ icon: 'note', title: 'Chưa có ghi chú', compact: true, action: btn('Viết ghi chú', { size: 'sm', variant: 'soft', icon: 'plus', onClick: () => go('/notes?new=1') }) });

  const groupActivity = d.groupActivity.length
    ? h(
        'div',
        { class: 'list' },
        d.groupActivity.map((a) => h('a', { class: 'list-item', href: `/groups/${a.group.id}` }, h('div', { class: 'icon-box sm' }, icon('users')), h('div', { class: 'grow', style: { minWidth: 0 } }, h('div', { class: 'small' }, h('b', {}, a.user.fullName), ` – ${a.summary}`), h('div', { class: 'tiny muted' }, `${a.group.name} · ${relativeTime(a.createdAt)}`))))
      )
    : emptyState({ icon: 'users', title: 'Chưa có hoạt động nhóm', text: 'Tạo hoặc tham gia nhóm học tập để cộng tác.', compact: true });

  const shortcuts = h(
    'div',
    { class: 'grid', style: { gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: '10px' } },
    [
      ['calendar', 'Lịch học', '/schedule', '#2563eb'],
      ['folder', 'Tài liệu', '/drive', '#0ea5e9'],
      ['note', 'Ghi chú', '/notes', '#0891b2'],
      ['sheet', 'Bảng tính', '/sheets', '#16a34a'],
      ['task', 'Công việc', '/tasks', '#f59e0b'],
      ['sparkles', 'UniAI', '/ai', '#ec4899'],
      ['quiz', 'Ôn tập', '/quiz', '#14b8a6'],
      ['users', 'Nhóm', '/groups', '#1d4ed8'],
      ['share', 'Cộng đồng', '/share', '#ef4444'],
    ].map(([ic, l, href, c]) => h('a', { class: 'card hoverable', href, style: { padding: '14px', textAlign: 'center', color: 'inherit', textDecoration: 'none' } }, h('div', { class: 'icon-box', style: { margin: '0 auto 8px', background: `${c}1a`, color: c } }, icon(ic)), h('div', { class: 'small bold' }, l)))
  );

  return h(
    'div',
    { class: 'col gap-16' },
    h(
      'div',
      { class: 'grid cols-4' },
      stat('calendar', s.classesThisWeek, 'Buổi học 7 ngày tới', '#2563eb', '/schedule'),
      stat('task', t.dueSoon, 'Deadline trong tuần', '#f59e0b', '/tasks'),
      stat('award', s.avgQuizScore30d ?? '—', 'Điểm quiz TB (30 ngày)', '#10b981', '/quiz'),
      stat('folder', `${pct}%`, `Dung lượng (${fileSize(s.storageUsed)})`, '#0ea5e9', '/drive')
    ),
    h('div', { class: 'grid', style: { gridTemplateColumns: 'minmax(0,1.4fr) minmax(0,1fr)' }, id: 'dash-row-1' }, card('Lịch học hôm nay', 'calendar', '/schedule', todayClasses), card('Tiến độ công việc', 'trending-up', '/tasks', progress)),
    h('div', { class: 'grid cols-2' }, card('Sắp đến hạn', 'clock', '/tasks', upcoming), card('Hoạt động nhóm', 'users', '/groups', groupActivity)),
    h('div', { class: 'grid cols-2' }, card('Tài liệu gần đây', 'folder', '/drive', recentFiles), card('Ghi chú gần đây', 'note', '/notes', recentNotes)),
    card('Lối tắt', 'zap', null, shortcuts),
    h('p', { class: 'tiny faint center' }, `Thống kê: ${s.subjects} môn học · ${s.notes} ghi chú · ${s.files} tài liệu · ${s.quizAttempts} lượt làm quiz · ${s.groups} nhóm`)
  );
}
