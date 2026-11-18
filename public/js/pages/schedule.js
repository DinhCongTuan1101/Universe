import { h, icon, btn } from '../core/dom.js';
import { api } from '../core/api.js';
import { navigate, query, setQuery } from '../core/router.js';
import { toast, showError, modal, confirmDialog, drawer, emptyState, errorState, skeleton, select, field, withLoading } from '../core/ui.js';
import { isoDate, parseIsoDate, addDays, startOfWeek, isoWeekday, fmtDate, DAY_NAMES, DAY_SHORT, periodLabel, periodTime, PRIORITY, STATUS, fromLocalInput } from '../core/format.js';

const PALETTE = ['#2563EB', '#0891B2', '#10B981', '#F59E0B', '#EF4444', '#EC4899', '#14B8A6', '#F97316', '#84CC16', '#0EA5E9', '#64748B', '#CA8A04'];

export function mount(container) {
  const q = query();
  const state = {
    view: q.view || 'week',
    date: q.date ? parseIsoDate(q.date) : new Date(),
    semesterId: q.semester || '',
    subjectId: q.subject || '',
    semesters: [],
    subjects: [],
    periods: [],
    meetings: [],
    conflicts: [],
  };

  const semSelect = select([{ value: '', label: 'Tất cả học kỳ' }], '', { size: 'sm', 'aria-label': 'Lọc học kỳ', onchange: (e) => ((state.semesterId = e.target.value), sync(), loadAll()) });
  const subjSelect = select([{ value: '', label: 'Tất cả môn' }], '', { size: 'sm', 'aria-label': 'Lọc môn học', onchange: (e) => ((state.subjectId = e.target.value), sync(), loadMeetings()) });
  const viewGroup = h(
    'div',
    { class: 'btn-group' },
    [
      ['week', 'Tuần', 'columns'],
      ['month', 'Tháng', 'calendar'],
      ['subjects', 'Môn học', 'list'],
    ].map(([v, l, ic]) => h('button', { class: `btn sm ${state.view === v ? 'active' : ''}`, 'data-v': v, onclick: () => setView(v) }, icon(ic), l))
  );
  const rangeLabel = h('div', { class: 'bold', style: { minWidth: '200px' } });
  const navGroup = h(
    'div',
    { class: 'row' },
    btn('', { icon: 'chevron-left', size: 'sm', title: 'Trước', onClick: () => shift(-1) }),
    btn('Hôm nay', { size: 'sm', onClick: () => ((state.date = new Date()), sync(), loadMeetings()) }),
    btn('', { icon: 'chevron-right', size: 'sm', title: 'Sau', onClick: () => shift(1) }),
    rangeLabel
  );
  const conflictBadge = h('button', { class: 'badge danger', style: { cursor: 'pointer', border: 'none' }, hidden: true, onclick: showConflicts });
  const body = h('div', {}, skeleton(6));

  container.append(
    h(
      'div',
      { class: 'page-header' },
      h('div', { class: 'titles' }, h('h1', {}, 'UniSchedule'), h('p', {}, 'Thời khóa biểu theo tiết học, nhiều khoảng lịch cho mỗi môn, phát hiện trùng lịch.')),
      h(
        'div',
        { class: 'actions' },
        btn('Học kỳ', { icon: 'graduation', onClick: semesterManager }),
        btn('Nhập TKB', { icon: 'upload', onClick: () => navigate('/schedule/import') }),
        btn('Thêm môn học', { icon: 'plus', variant: 'primary', onClick: () => subjectEditor() })
      )
    ),
    h('div', { class: 'toolbar' }, viewGroup, navGroup, h('div', { class: 'spacer' }), conflictBadge, semSelect, subjSelect),
    body
  );

  function sync() {
    setQuery({ view: state.view, date: isoDate(state.date), semester: state.semesterId, subject: state.subjectId });
  }
  function setView(v) {
    state.view = v;
    viewGroup.querySelectorAll('.btn').forEach((b) => b.classList.toggle('active', b.dataset.v === v));
    navGroup.hidden = v === 'subjects';
    sync();
    loadMeetings();
  }
  function shift(dir) {
    if (state.view === 'month') state.date = new Date(state.date.getFullYear(), state.date.getMonth() + dir, 1);
    else state.date = addDays(state.date, 7 * dir);
    sync();
    loadMeetings();
  }
  function range() {
    if (state.view === 'month') {
      const first = new Date(state.date.getFullYear(), state.date.getMonth(), 1);
      const start = startOfWeek(first);
      return { from: start, to: addDays(start, 41), month: first };
    }
    const start = startOfWeek(state.date);
    return { from: start, to: addDays(start, 6) };
  }

  async function loadAll() {
    try {
      const [semesters, subjects, periods] = await Promise.all([
        api.get('/schedules/semesters'),
        api.get('/schedules/subjects', { semesterId: state.semesterId }),
        api.get('/system/class-periods'),
      ]);
      Object.assign(state, { semesters, subjects, periods });
      semSelect.replaceChildren(...[{ id: '', name: 'Tất cả học kỳ' }, ...semesters].map((s) => h('option', { value: s.id, selected: String(s.id) === String(state.semesterId) }, s.name + (s.isCurrent ? ' (hiện tại)' : ''))));
      subjSelect.replaceChildren(...[{ id: '', name: 'Tất cả môn' }, ...subjects].map((s) => h('option', { value: s.id, selected: String(s.id) === String(state.subjectId) }, s.name)));
      await loadMeetings();
      if (q.new) subjectEditor();
      if (q.meeting) openMeeting(Number(q.meeting));
      if (q.subject && state.view === 'subjects') openSubject(Number(q.subject));
    } catch (e) {
      body.replaceChildren(errorState(e, loadAll));
    }
  }

  async function loadMeetings() {
    navGroup.hidden = state.view === 'subjects';
    if (state.view === 'subjects') return renderSubjects();
    const { from, to, month } = range();
    rangeLabel.textContent = month ? `Tháng ${month.getMonth() + 1}/${month.getFullYear()}` : `${fmtDate(isoDate(from))} – ${fmtDate(isoDate(to))}`;
    try {
      const params = { from: isoDate(from), to: isoDate(to), semesterId: state.semesterId, subjectId: state.subjectId };
      const [meetings, conflicts] = await Promise.all([api.get('/schedules/meetings', params), api.get('/schedules/conflicts', { from: params.from, to: params.to, semesterId: state.semesterId })]);
      state.meetings = meetings;
      state.conflicts = conflicts;
      conflictBadge.hidden = !conflicts.length;
      conflictBadge.replaceChildren(icon('alert'), `${conflicts.length} xung đột`);
      if (!state.subjects.length) {
        body.replaceChildren(
          emptyState({
            icon: 'calendar',
            title: 'Chưa có môn học nào',
            text: 'Nhập thời khóa biểu từ file Excel hoặc thêm môn học thủ công.',
            action: h('div', { class: 'row' }, btn('Nhập thời khóa biểu', { icon: 'upload', variant: 'primary', onClick: () => navigate('/schedule/import') }), btn('Thêm thủ công', { icon: 'plus', onClick: () => subjectEditor() })),
          })
        );
        return;
      }
      body.replaceChildren(state.view === 'month' ? renderMonth(from, month) : renderWeek(from));
    } catch (e) {
      body.replaceChildren(errorState(e, loadMeetings));
    }
  }

  const conflictIds = () => new Set(state.conflicts.flatMap((c) => [c.a.id, c.b.id]));

  // ---------------------------------------------------------------- Week view
  function renderWeek(start) {
    const maxPeriod = Math.max(10, ...state.periods.map((p) => p.periodNumber), ...state.meetings.map((m) => m.endPeriod));
    const today = isoDate();
    const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
    const cIds = conflictIds();
    const grid = h('div', { class: 'week-grid', style: { gridTemplateRows: `44px repeat(${maxPeriod}, minmax(46px, auto))` } });
    grid.append(h('div', { class: 'wg-corner' }, 'Tiết'));
    days.forEach((d, i) => grid.append(h('div', { class: `wg-day ${isoDate(d) === today ? 'today' : ''}`, style: { gridColumn: i + 2, gridRow: 1 } }, h('div', { class: 'tiny muted' }, DAY_NAMES[i + 1]), h('div', { class: 'bold' }, `${d.getDate()}/${d.getMonth() + 1}`))));
    for (let p = 1; p <= maxPeriod; p++) {
      const cfg = state.periods.find((x) => x.periodNumber === p);
      const isShiftStart = cfg && (p === 1 || state.periods.find((x) => x.periodNumber === p - 1)?.shift !== cfg.shift);
      grid.append(h('div', { class: `wg-period ${isShiftStart ? 'shift-start' : ''}`, style: { gridRow: p + 1 } }, h('div', { class: 'bold' }, p), cfg?.startTime ? h('div', { class: 'tiny muted' }, cfg.startTime) : null));
      for (let c = 0; c < 7; c++) grid.append(h('div', { class: `wg-cell ${isShiftStart ? 'shift-start' : ''} ${isoDate(days[c]) === today ? 'today' : ''}`, style: { gridRow: p + 1, gridColumn: c + 2 } }));
    }
    // Đặt buổi học; nếu chồng tiết trong cùng ngày => chia cột
    const byDay = new Map();
    for (const m of state.meetings) {
      if (!byDay.has(m.date)) byDay.set(m.date, []);
      byDay.get(m.date).push(m);
    }
    for (const [date, list] of byDay) {
      const col = days.findIndex((d) => isoDate(d) === date);
      if (col < 0) continue;
      list.sort((a, b) => a.startPeriod - b.startPeriod);
      const lanes = [];
      for (const m of list) {
        let lane = lanes.findIndex((end) => end < m.startPeriod);
        if (lane < 0) {
          lane = lanes.length;
          lanes.push(m.endPeriod);
        } else lanes[lane] = m.endPeriod;
        m._lane = lane;
      }
      for (const m of list) {
        const overlapLanes = list.filter((o) => o.startPeriod <= m.endPeriod && o.endPeriod >= m.startPeriod).reduce((mx, o) => Math.max(mx, o._lane + 1), 1);
        const ev = h(
          'button',
          {
            class: `wg-event ${m.status === 'CANCELLED' ? 'cancelled' : ''} ${cIds.has(m.id) ? 'conflict' : ''}`,
            style: {
              gridColumn: col + 2,
              gridRow: `${m.startPeriod + 1} / ${m.endPeriod + 2}`,
              '--c': m.subject.color,
              width: `calc(${100 / overlapLanes}% - 4px)`,
              marginLeft: `calc(${(100 / overlapLanes) * m._lane}% + 2px)`,
            },
            title: `${m.subject.name} – ${periodLabel(m.startPeriod, m.endPeriod)}${m.room ? ` – ${m.room}` : ''}`,
            onclick: () => openMeeting(m.id),
          },
          h('div', { class: 'ev-title' }, m.subject.name),
          h('div', { class: 'ev-meta' }, periodLabel(m.startPeriod, m.endPeriod), periodTime(state.periods, m.startPeriod, m.endPeriod) ? ` · ${periodTime(state.periods, m.startPeriod, m.endPeriod)}` : ''),
          m.room ? h('div', { class: 'ev-meta' }, icon('map', { size: 11 }), ' ', m.room) : null,
          cIds.has(m.id) ? h('div', { class: 'ev-flag' }, icon('alert', { size: 11 }), ' Trùng lịch') : null,
          m.status === 'CANCELLED' ? h('div', { class: 'ev-flag' }, 'Nghỉ') : null
        );
        grid.append(ev);
      }
    }
    const hasTimes = state.periods.some((p) => p.startTime);
    return h(
      'div',
      { class: 'col gap-12' },
      h('div', { class: 'card', style: { overflow: 'auto' } }, grid),
      !hasTimes ? h('div', { class: 'alert info' }, icon('info'), h('div', {}, 'Chưa có bảng giờ học chính thức – lịch đang hiển thị theo ', h('b', {}, 'số tiết'), '. Quản trị viên có thể cấu hình giờ bắt đầu/kết thúc từng tiết trong trang Quản trị.')) : null
    );
  }

  // ---------------------------------------------------------------- Month view
  function renderMonth(start, month) {
    const today = isoDate();
    const cIds = conflictIds();
    const byDate = new Map();
    for (const m of state.meetings) {
      if (!byDate.has(m.date)) byDate.set(m.date, []);
      byDate.get(m.date).push(m);
    }
    return h(
      'div',
      { class: 'card month-grid' },
      DAY_SHORT.slice(1).map((d) => h('div', { class: 'mg-head' }, d)),
      Array.from({ length: 42 }, (_, i) => {
        const d = addDays(start, i);
        const iso = isoDate(d);
        const list = byDate.get(iso) || [];
        return h(
          'div',
          { class: `mg-cell ${d.getMonth() !== month.getMonth() ? 'other' : ''} ${iso === today ? 'today' : ''}` },
          h('button', { class: 'mg-date', onclick: () => ((state.date = d), setView('week')), title: 'Xem tuần này' }, d.getDate()),
          list.slice(0, 4).map((m) => h('button', { class: `mg-ev ${cIds.has(m.id) ? 'conflict' : ''} ${m.status === 'CANCELLED' ? 'cancelled' : ''}`, style: { '--c': m.subject.color }, onclick: () => openMeeting(m.id), title: `${m.subject.name} – ${periodLabel(m.startPeriod, m.endPeriod)}` }, h('span', { class: 'truncate' }, `T${m.startPeriod}-${m.endPeriod} ${m.subject.name}`))),
          list.length > 4 ? h('button', { class: 'tiny muted mg-more', onclick: () => ((state.date = d), setView('week')) }, `+${list.length - 4} buổi`) : null
        );
      })
    );
  }

  // ---------------------------------------------------------------- Subjects
  function renderSubjects() {
    if (!state.subjects.length) {
      body.replaceChildren(emptyState({ icon: 'book', title: 'Chưa có môn học', action: btn('Thêm môn học', { icon: 'plus', variant: 'primary', onClick: () => subjectEditor() }) }));
      return;
    }
    const total = state.subjects.reduce((a, s) => a + (s.credits || 0), 0);
    body.replaceChildren(
      h('p', { class: 'muted mb-16' }, `${state.subjects.length} môn · ${total} tín chỉ`),
      h(
        'div',
        { class: 'grid auto' },
        state.subjects.map((s) =>
          h(
            'div',
            { class: 'card hoverable subject-card', style: { '--c': s.color }, onclick: () => openSubject(s.id) },
            h('div', { class: 'row' }, h('span', { class: 'dot', style: { background: s.color, width: '12px', height: '12px' } }), h('h3', { class: 'grow truncate' }, s.name), s.credits != null ? h('span', { class: 'badge primary' }, `${s.credits} TC`) : null),
            h('div', { class: 'small muted mt-8' }, [s.code, s.classCode].filter(Boolean).join(' · ') || '—'),
            s.lecturer ? h('div', { class: 'small muted' }, `GV: ${s.lecturer}`) : null,
            h('div', { class: 'row wrap mt-8' }, h('span', { class: 'badge' }, `${s.periods.length} khoảng lịch`), h('span', { class: 'badge' }, `${s._count.meetings} buổi`), s._count.tasks ? h('span', { class: 'badge warning' }, `${s._count.tasks} việc`) : null, s.semester ? h('span', { class: 'badge violet' }, s.semester.name) : null)
          )
        )
      )
    );
  }

  async function openSubject(id) {
    let s;
    try {
      s = await api.get(`/schedules/subjects/${id}`);
    } catch (e) {
      return showError(e);
    }
    const d = drawer({
      title: s.name,
      wide: true,
      body: [
        h('div', { class: 'row wrap mb-16' }, s.code ? h('span', { class: 'badge' }, s.code) : null, s.credits != null ? h('span', { class: 'badge primary' }, `${s.credits} tín chỉ`) : null, s.classCode ? h('span', { class: 'badge' }, s.classCode) : null, s.semester ? h('span', { class: 'badge violet' }, s.semester.name) : null),
        s.lecturer ? h('p', { class: 'mb-8' }, h('b', {}, 'Giảng viên: '), s.lecturer) : null,
        s.note ? h('p', { class: 'muted mb-16' }, s.note) : null,
        h('div', { class: 'section-title' }, icon('calendar', { size: 14 }), 'Lịch học'),
        s.periods.length
          ? s.periods.map((p) =>
              h(
                'div',
                { class: 'card card-pad mb-8' },
                h('div', { class: 'bold mb-8' }, `Từ ${fmtDate(p.startDate)} đến ${fmtDate(p.endDate)}`),
                h('div', { class: 'list' }, p.sessions.map((x) => h('div', { class: 'row small', style: { padding: '4px 0' } }, h('span', { class: 'badge primary' }, DAY_NAMES[x.dayOfWeek]), h('span', {}, `${periodLabel(x.startPeriod, x.endPeriod)} (${x.periods})`), x.room ? h('span', { class: 'muted' }, `· Phòng ${x.room}`) : null))),
                p.rawText ? h('details', { class: 'tiny muted mt-8' }, h('summary', {}, 'Dữ liệu gốc từ file'), h('pre', { style: { whiteSpace: 'pre-wrap' } }, p.rawText)) : null
              )
            )
          : h('p', { class: 'muted' }, 'Chưa có lịch học.'),
        h('div', { class: 'section-title mt-16' }, icon('link', { size: 14 }), 'Liên kết'),
        h('div', { class: 'row wrap' }, h('a', { class: 'btn sm', href: `/drive?subject=${s.id}` }, icon('folder'), `Tài liệu (${s._count.files})`), h('a', { class: 'btn sm', href: `/notes?subject=${s.id}` }, icon('note'), `Ghi chú (${s._count.notes})`), h('a', { class: 'btn sm', href: `/tasks?subject=${s.id}` }, icon('task'), `Công việc (${s._count.tasks})`)),
      ],
      footer: (close) => [
        btn('Xóa môn', {
          icon: 'trash',
          variant: 'ghost',
          onClick: async () => {
            if (!(await confirmDialog({ title: 'Xóa môn học?', message: `"${s.name}" sẽ được chuyển vào Thùng rác cùng lịch học. Bạn có thể khôi phục sau.`, danger: true, confirmText: 'Xóa' }))) return;
            try {
              await api.del(`/schedules/subjects/${s.id}`);
              toast('Đã xóa môn học');
              close();
              loadAll();
            } catch (e) {
              showError(e);
            }
          },
        }),
        h('div', { class: 'spacer' }),
        btn('Chỉnh sửa', { icon: 'edit', variant: 'primary', onClick: () => (close(), subjectEditor(s)) }),
      ],
    });
    return d;
  }

  // ---------------------------------------------------------------- Meeting detail
  async function openMeeting(id) {
    let m;
    try {
      m = await api.get(`/schedules/meetings/${id}`);
    } catch (e) {
      return showError(e);
    }
    const conflicts = state.conflicts.filter((c) => c.a.id === id || c.b.id === id);
    const note = h('textarea', { class: 'textarea', rows: 3, placeholder: 'Ghi chú cho buổi học (vd: mang laptop, kiểm tra 15 phút...)', value: m.note || '' });
    const room = h('input', { class: 'input', value: m.room || '', placeholder: 'Phòng học' });
    const tasksBox = h('div', { class: 'list' });
    const renderTasks = () =>
      tasksBox.replaceChildren(
        ...(m.tasks.length
          ? m.tasks.map((t) => h('a', { class: 'list-item', href: `/tasks?open=${t.id}` }, icon('task'), h('span', { class: 'grow' }, t.title), h('span', { class: `badge ${STATUS[t.status].tone}` }, STATUS[t.status].label)))
          : [h('p', { class: 'small muted' }, 'Chưa có công việc gắn với buổi học này.')])
      );
    renderTasks();
    drawer({
      title: m.subject.name,
      body: [
        h('div', { class: 'row wrap mb-16' }, h('span', { class: 'badge primary' }, `${DAY_NAMES[isoWeekday(parseIsoDate(m.date))]}, ${fmtDate(m.date)}`), h('span', { class: 'badge' }, periodLabel(m.startPeriod, m.endPeriod)), periodTime(state.periods, m.startPeriod, m.endPeriod) ? h('span', { class: 'badge' }, periodTime(state.periods, m.startPeriod, m.endPeriod)) : null, m.status === 'CANCELLED' ? h('span', { class: 'badge danger' }, 'Nghỉ học') : null),
        conflicts.length ? h('div', { class: 'alert danger mb-16' }, icon('alert'), h('div', {}, conflicts.map((c) => h('div', {}, c.message)))) : null,
        h('div', { class: 'card card-pad mb-16' }, h('div', { class: 'small' }, h('b', {}, 'Mã HP: '), m.subject.code || '—'), h('div', { class: 'small' }, h('b', {}, 'Lớp HP: '), m.subject.classCode || '—'), h('div', { class: 'small' }, h('b', {}, 'Giảng viên: '), m.session.lecturer || m.subject.lecturer || '—'), h('div', { class: 'small' }, h('b', {}, 'Tiết gốc: '), m.session.periods), h('div', { class: 'small' }, h('b', {}, 'Khoảng lịch: '), `${fmtDate(m.session.period.startDate)} – ${fmtDate(m.session.period.endDate)}`)),
        field('Phòng học', room),
        field('Ghi chú', note),
        h('div', { class: 'section-title mt-16' }, icon('task', { size: 14 }), 'Công việc của buổi học'),
        tasksBox,
        btn('Tạo công việc cho buổi này', {
          icon: 'plus',
          size: 'sm',
          variant: 'soft',
          onClick: async () => {
            const { promptDialog } = await import('../core/ui.js');
            const title = await promptDialog({ title: 'Công việc mới', label: 'Tiêu đề', placeholder: 'vd: Chuẩn bị bài tập chương 2' });
            if (!title) return;
            try {
              const due = new Date(`${m.date}T07:00:00`);
              const t = await api.post('/tasks', { title, subjectId: m.subject.id, classMeetingId: m.id, dueAt: fromLocalInput(isoDate(due) + 'T07:00') });
              m.tasks.push(t);
              renderTasks();
              toast('Đã tạo công việc');
            } catch (e) {
              showError(e);
            }
          },
        }),
      ],
      footer: (close) => [
        btn(m.status === 'CANCELLED' ? 'Đánh dấu có học' : 'Đánh dấu nghỉ', {
          icon: m.status === 'CANCELLED' ? 'check' : 'x',
          onClick: async () => {
            try {
              await api.patch(`/schedules/meetings/${m.id}`, { status: m.status === 'CANCELLED' ? 'SCHEDULED' : 'CANCELLED' });
              toast('Đã cập nhật');
              close();
              loadMeetings();
            } catch (e) {
              showError(e);
            }
          },
        }),
        h('div', { class: 'spacer' }),
        btn('Lưu', {
          variant: 'primary',
          icon: 'check',
          onClick: async (e) =>
            withLoading(e.currentTarget, async () => {
              try {
                await api.patch(`/schedules/meetings/${m.id}`, { note: note.value, room: room.value });
                toast('Đã lưu buổi học');
                close();
                loadMeetings();
              } catch (err) {
                showError(err);
              }
            }),
        }),
      ],
    });
  }

  function showConflicts() {
    modal({
      title: `Xung đột lịch học (${state.conflicts.length})`,
      icon: 'alert',
      size: 'wide',
      body: h(
        'div',
        { class: 'col' },
        h('p', { class: 'muted small' }, 'Các buổi học dưới đây chồng tiết trong cùng ngày. UniVerse chỉ cảnh báo, không tự xóa môn học.'),
        state.conflicts.map((c) => h('div', { class: `alert ${c.type === 'duplicate' ? 'warning' : 'danger'}` }, icon('alert'), h('div', {}, h('div', { class: 'bold small' }, c.type === 'duplicate' ? 'Trùng lặp' : 'Trùng tiết'), c.message)))
      ),
    });
  }

  // ---------------------------------------------------------------- Subject editor
  function subjectEditor(existing) {
    const s = existing || { name: '', code: '', credits: '', classCode: '', lecturer: '', color: PALETTE[state.subjects.length % PALETTE.length], semesterId: state.semesterId || state.semesters.find((x) => x.isCurrent)?.id || '', note: '', periods: [] };
    const periods = (s.periods || []).map((p) => ({ startDate: p.startDate, endDate: p.endDate, rawText: p.rawText, sessions: p.sessions.map((x) => ({ dayOfWeek: x.dayOfWeek, startPeriod: x.startPeriod, endPeriod: x.endPeriod, room: x.room || '' })) }));
    const inputs = {
      name: h('input', { class: 'input', name: 'name', value: s.name, required: true, placeholder: 'Tên học phần' }),
      code: h('input', { class: 'input', name: 'code', value: s.code || '', placeholder: 'Mã học phần' }),
      credits: h('input', { class: 'input', name: 'credits', type: 'number', min: 0, max: 30, value: s.credits ?? '' }),
      classCode: h('input', { class: 'input', name: 'classCode', value: s.classCode || '', placeholder: 'Lớp học phần' }),
      lecturer: h('input', { class: 'input', name: 'lecturer', value: s.lecturer || '' }),
      color: h('input', { class: 'input', name: 'color', type: 'color', value: s.color, style: { padding: '4px', width: '60px' } }),
      semesterId: select([{ value: '', label: '— Không thuộc học kỳ —' }, ...state.semesters.map((x) => ({ value: x.id, label: x.name }))], s.semester?.id ?? s.semesterId, { name: 'semesterId' }),
      note: h('textarea', { class: 'textarea', name: 'note', rows: 2, value: s.note || '' }),
    };
    const periodsBox = h('div', { class: 'col gap-12' });
    const renderPeriods = () => {
      periodsBox.replaceChildren(
        ...periods.map((p, pi) =>
          h(
            'div',
            { class: 'card card-pad' },
            h(
              'div',
              { class: 'row wrap mb-8' },
              h('span', { class: 'small bold' }, `Khoảng ${pi + 1}:`),
              h('input', { class: 'input sm', type: 'date', value: p.startDate || '', style: { width: '150px' }, onchange: (e) => (p.startDate = e.target.value), 'aria-label': 'Từ ngày' }),
              h('span', { class: 'small muted' }, 'đến'),
              h('input', { class: 'input sm', type: 'date', value: p.endDate || '', style: { width: '150px' }, onchange: (e) => (p.endDate = e.target.value), 'aria-label': 'Đến ngày' }),
              h('div', { class: 'spacer' }),
              btn('', { icon: 'trash', size: 'xs', variant: 'ghost', title: 'Xóa khoảng lịch', onClick: () => (periods.splice(pi, 1), renderPeriods()) })
            ),
            ...p.sessions.map((x, si) =>
              h(
                'div',
                { class: 'row wrap mb-8' },
                select(DAY_NAMES.slice(1).map((d, i) => ({ value: i + 1, label: d })), x.dayOfWeek, { size: 'sm', style: { width: '120px' }, onchange: (e) => (x.dayOfWeek = Number(e.target.value)), 'aria-label': 'Thứ' }),
                h('span', { class: 'small muted' }, 'Tiết'),
                h('input', { class: 'input sm', type: 'number', min: 1, max: 20, value: x.startPeriod, style: { width: '64px' }, onchange: (e) => (x.startPeriod = Number(e.target.value)), 'aria-label': 'Tiết bắt đầu' }),
                h('span', { class: 'small muted' }, '→'),
                h('input', { class: 'input sm', type: 'number', min: 1, max: 20, value: x.endPeriod, style: { width: '64px' }, onchange: (e) => (x.endPeriod = Number(e.target.value)), 'aria-label': 'Tiết kết thúc' }),
                h('input', { class: 'input sm grow', value: x.room, placeholder: 'Phòng', style: { minWidth: '100px' }, oninput: (e) => (x.room = e.target.value), 'aria-label': 'Phòng' }),
                btn('', { icon: 'x', size: 'xs', variant: 'ghost', title: 'Xóa buổi', onClick: () => (p.sessions.splice(si, 1), renderPeriods()) })
              )
            ),
            btn('Thêm buổi trong tuần', { icon: 'plus', size: 'xs', variant: 'soft', onClick: () => (p.sessions.push({ dayOfWeek: 1, startPeriod: 1, endPeriod: 3, room: p.sessions.at(-1)?.room || '' }), renderPeriods()) })
          )
        ),
        btn('Thêm khoảng lịch', { icon: 'plus', size: 'sm', onClick: () => (periods.push({ startDate: periods.at(-1)?.endDate || isoDate(), endDate: '', sessions: [{ dayOfWeek: 1, startPeriod: 1, endPeriod: 3, room: '' }] }), renderPeriods()) })
      );
    };
    renderPeriods();
    const m = modal({
      title: existing ? 'Chỉnh sửa môn học' : 'Thêm môn học',
      size: 'wide',
      body: h(
        'form',
        { class: 'form-grid', onsubmit: (e) => e.preventDefault() },
        field('Tên học phần *', inputs.name, { className: 'span-2' }),
        field('Mã học phần', inputs.code),
        field('Số tín chỉ', inputs.credits),
        field('Lớp học phần', inputs.classCode),
        field('Giảng viên', inputs.lecturer),
        field('Học kỳ', inputs.semesterId),
        field('Màu hiển thị', inputs.color),
        field('Ghi chú', inputs.note, { className: 'span-2' }),
        h('div', { class: 'span-2' }, h('div', { class: 'section-title' }, 'Lịch học (một môn có thể có nhiều khoảng ngày)'), periodsBox)
      ),
      footer: (close) => [
        btn('Hủy', { onClick: () => close() }),
        btn(existing ? 'Lưu thay đổi' : 'Thêm môn', {
          variant: 'primary',
          onClick: async (e) => {
            const body = {
              name: inputs.name.value.trim(),
              code: inputs.code.value,
              credits: inputs.credits.value,
              classCode: inputs.classCode.value,
              lecturer: inputs.lecturer.value,
              color: inputs.color.value.toUpperCase(),
              semesterId: inputs.semesterId.value || null,
              note: inputs.note.value,
              periods: periods.map((p) => ({ startDate: p.startDate, endDate: p.endDate, rawText: p.rawText, sessions: p.sessions.map((x) => ({ ...x, endPeriod: Math.max(x.endPeriod, x.startPeriod) })) })),
            };
            if (!body.name) return toast.error('Vui lòng nhập tên môn học');
            if (periods.some((p) => !p.startDate || !p.endDate)) return toast.error('Hãy nhập đủ ngày bắt đầu/kết thúc cho mỗi khoảng lịch');
            await withLoading(e.currentTarget, async () => {
              try {
                if (existing) await api.patch(`/schedules/subjects/${existing.id}`, body);
                else await api.post('/schedules/subjects', body);
                toast(existing ? 'Đã cập nhật môn học' : 'Đã thêm môn học');
                close();
                loadAll();
              } catch (err) {
                showError(err);
              }
            });
          },
        }),
      ],
    });
    return m;
  }

  // ---------------------------------------------------------------- Semesters
  function semesterManager() {
    const list = h('div', { class: 'list' });
    const render = () =>
      list.replaceChildren(
        ...(state.semesters.length
          ? state.semesters.map((s) =>
              h(
                'div',
                { class: 'list-item', style: { cursor: 'default' } },
                h('div', { class: 'icon-box sm' }, icon('graduation')),
                h('div', { class: 'grow' }, h('div', { class: 'bold' }, s.name, s.isCurrent ? h('span', { class: 'badge success', style: { marginLeft: '6px' } }, 'Hiện tại') : null), h('div', { class: 'tiny muted' }, [s.academicYear, s.startDate && s.endDate ? `${fmtDate(s.startDate)} – ${fmtDate(s.endDate)}` : null, `${s._count?.subjects ?? 0} môn`].filter(Boolean).join(' · '))),
                !s.isCurrent ? btn('Đặt hiện tại', { size: 'xs', onClick: () => save(s.id, { isCurrent: true }) }) : null,
                btn('', { icon: 'edit', size: 'xs', variant: 'ghost', title: 'Sửa', onClick: () => edit(s) }),
                btn('', {
                  icon: 'trash',
                  size: 'xs',
                  variant: 'ghost',
                  title: 'Xóa',
                  onClick: async () => {
                    if (!(await confirmDialog({ title: 'Xóa học kỳ?', message: `Học kỳ "${s.name}" và các môn học thuộc học kỳ sẽ được chuyển vào Thùng rác.`, danger: true, confirmText: 'Xóa' }))) return;
                    try {
                      await api.del(`/schedules/semesters/${s.id}`);
                      toast('Đã xóa học kỳ');
                      await reload();
                    } catch (e) {
                      showError(e);
                    }
                  },
                })
              )
            )
          : [emptyState({ icon: 'graduation', title: 'Chưa có học kỳ', compact: true })])
      );
    const reload = async () => {
      state.semesters = await api.get('/schedules/semesters');
      render();
      loadAll();
    };
    const save = async (id, data) => {
      try {
        if (id) await api.patch(`/schedules/semesters/${id}`, data);
        else await api.post('/schedules/semesters', data);
        toast('Đã lưu học kỳ');
        await reload();
      } catch (e) {
        showError(e);
      }
    };
    const edit = (s = {}) => {
      const f = {
        name: h('input', { class: 'input', value: s.name || '', placeholder: 'vd: Học kỳ 1 – 2026-2027' }),
        academicYear: h('input', { class: 'input', value: s.academicYear || '', placeholder: '2026-2027' }),
        startDate: h('input', { class: 'input', type: 'date', value: s.startDate || '' }),
        endDate: h('input', { class: 'input', type: 'date', value: s.endDate || '' }),
        isCurrent: h('input', { type: 'checkbox', checked: s.isCurrent }),
      };
      modal({
        title: s.id ? 'Sửa học kỳ' : 'Thêm học kỳ',
        body: h('div', { class: 'form-grid' }, field('Tên học kỳ *', f.name, { className: 'span-2' }), field('Năm học', f.academicYear, { className: 'span-2' }), field('Bắt đầu', f.startDate), field('Kết thúc', f.endDate), h('label', { class: 'checkbox span-2' }, f.isCurrent, 'Đặt làm học kỳ hiện tại')),
        footer: (close) => [
          btn('Hủy', { onClick: () => close() }),
          btn('Lưu', {
            variant: 'primary',
            onClick: async () => {
              if (!f.name.value.trim()) return toast.error('Nhập tên học kỳ');
              await save(s.id, { name: f.name.value.trim(), academicYear: f.academicYear.value, startDate: f.startDate.value, endDate: f.endDate.value, isCurrent: f.isCurrent.checked });
              close();
            },
          }),
        ],
      });
    };
    render();
    modal({ title: 'Quản lý học kỳ', icon: 'graduation', size: 'wide', body: list, footer: (close) => [btn('Đóng', { onClick: () => close() }), btn('Thêm học kỳ', { icon: 'plus', variant: 'primary', onClick: () => edit() })] });
  }

  navGroup.hidden = state.view === 'subjects';
  loadAll();
}

export { PRIORITY };
