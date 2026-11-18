import { h, icon, btn, debounce } from '../core/dom.js';
import { api } from '../core/api.js';
import { query, setQuery } from '../core/router.js';
import { store, pref, setPref } from '../core/store.js';
import { toast, showError, modal, confirmDialog, drawer, menu, emptyState, errorState, skeleton, select, field, withLoading } from '../core/ui.js';
import { PRIORITY, STATUS, dueLabel, toLocalInput, fromLocalInput, fmtDateTime, isoDate, startOfWeek, addDays, DAY_SHORT, fmtDate, periodLabel } from '../core/format.js';
import { renderMarkdown } from '../core/markdown.js';

export function mount(container) {
  const q = query();
  const state = { view: q.view || pref('tasks.view', 'list'), status: '', priority: '', subjectId: q.subject || '', search: '', sort: 'due', tasks: [], subjects: [], month: new Date() };

  const searchInput = h('input', { class: 'input sm', placeholder: 'Tìm công việc...', style: { width: '220px' } });
  searchInput.addEventListener('input', debounce(() => ((state.search = searchInput.value.trim()), load()), 300));
  const statusSel = select([{ value: '', label: 'Mọi trạng thái' }, ...Object.entries(STATUS).map(([v, s]) => ({ value: v, label: s.label }))], '', { size: 'sm', onchange: (e) => ((state.status = e.target.value), load()) });
  const prioSel = select([{ value: '', label: 'Mọi mức ưu tiên' }, ...Object.entries(PRIORITY).map(([v, p]) => ({ value: v, label: p.label }))], '', { size: 'sm', onchange: (e) => ((state.priority = e.target.value), load()) });
  const subjSel = select([{ value: '', label: 'Mọi môn học' }], '', { size: 'sm', onchange: (e) => ((state.subjectId = e.target.value), load()) });
  const sortSel = select(
    [
      { value: 'due', label: 'Theo hạn chót' },
      { value: 'priority', label: 'Theo ưu tiên' },
      { value: 'created', label: 'Mới tạo' },
    ],
    'due',
    { size: 'sm', onchange: (e) => ((state.sort = e.target.value), load()) }
  );
  const viewGroup = h(
    'div',
    { class: 'btn-group' },
    [
      ['list', 'List', 'list'],
      ['kanban', 'Kanban', 'kanban'],
      ['calendar', 'Lịch', 'calendar'],
    ].map(([v, l, ic]) => h('button', { class: `btn sm ${state.view === v ? 'active' : ''}`, 'data-v': v, onclick: () => setView(v) }, icon(ic), l))
  );
  const statsEl = h('div', { class: 'row wrap' });
  const body = h('div', {}, skeleton(6));

  container.append(
    h(
      'div',
      { class: 'page-header' },
      h('div', { class: 'titles' }, h('h1', {}, 'UniTask'), h('p', {}, 'Quản lý công việc & deadline, liên kết với môn học và buổi học trong UniSchedule.')),
      h('div', { class: 'actions' }, btn('UniAI', { icon: 'sparkles', variant: 'soft', onClick: (e) => aiMenu(e.currentTarget) }), btn('Công việc mới', { icon: 'plus', variant: 'primary', onClick: () => editor() }))
    ),
    statsEl,
    h('div', { class: 'toolbar mt-16' }, viewGroup, h('div', { class: 'input-icon' }, icon('search'), searchInput), statusSel, prioSel, subjSel, sortSel),
    body
  );

  function setView(v) {
    state.view = v;
    setPref('tasks.view', v);
    viewGroup.querySelectorAll('.btn').forEach((b) => b.classList.toggle('active', b.dataset.v === v));
    setQuery({ view: v });
    render();
  }

  async function loadMeta() {
    try {
      const [subjects, stats] = await Promise.all([api.get('/schedules/subjects/options'), api.get('/tasks/stats')]);
      state.subjects = subjects;
      subjSel.replaceChildren(...[{ id: '', name: 'Mọi môn học' }, ...subjects].map((s) => h('option', { value: s.id, selected: String(s.id) === String(state.subjectId) }, s.name)));
      statsEl.replaceChildren(
        h('span', { class: 'badge' }, `${stats.total} công việc`),
        h('span', { class: 'badge primary' }, `${stats.counts.IN_PROGRESS} đang làm`),
        h('span', { class: 'badge success' }, `${stats.completionRate}% hoàn thành`),
        stats.dueSoon ? h('span', { class: 'badge warning' }, `${stats.dueSoon} sắp đến hạn`) : null,
        stats.overdue ? h('span', { class: 'badge danger' }, `${stats.overdue} quá hạn`) : null
      );
    } catch {
      /* ignore */
    }
  }

  async function load() {
    try {
      state.tasks = await api.get('/tasks', { status: state.status, priority: state.priority, subjectId: state.subjectId, search: state.search, sort: state.view === 'kanban' ? 'manual' : state.sort });
      render();
    } catch (e) {
      body.replaceChildren(errorState(e, load));
    }
  }

  function render() {
    if (state.view === 'calendar') return body.replaceChildren(renderCalendar());
    if (!state.tasks.length) {
      body.replaceChildren(emptyState({ icon: 'task', title: state.search || state.status || state.priority ? 'Không có công việc phù hợp' : 'Chưa có công việc nào', text: 'Tạo công việc, đặt deadline và nhắc nhở để không bỏ lỡ bài tập.', action: btn('Tạo công việc', { icon: 'plus', variant: 'primary', onClick: () => editor() }) }));
      return;
    }
    body.replaceChildren(state.view === 'kanban' ? renderKanban() : renderList());
  }

  const isGroupTask = (t) => Boolean(t.groupId);

  async function setStatus(t, status) {
    try {
      if (isGroupTask(t)) await api.patch(`/groups/${t.groupId}/tasks/${t.id}`, { status });
      else await api.patch(`/tasks/${t.id}`, { status });
      t.status = status;
      if (status === 'DONE') toast('Đã hoàn thành 🎉');
      loadMeta();
      render();
    } catch (e) {
      showError(e);
    }
  }

  function taskMeta(t) {
    const due = dueLabel(t.dueAt);
    return h(
      'div',
      { class: 'row wrap', style: { gap: '4px' } },
      t.dueAt ? h('span', { class: `badge ${t.status === 'DONE' ? '' : due.tone}` }, icon('clock'), due.text) : null,
      h('span', { class: `badge ${PRIORITY[t.priority].tone}` }, PRIORITY[t.priority].label),
      t.subject ? h('span', { class: 'badge', style: { background: `${t.subject.color}1f`, color: t.subject.color } }, t.subject.name) : null,
      t.group ? h('span', { class: 'badge violet' }, icon('users'), t.group.name) : null,
      t.classMeeting ? h('span', { class: 'badge info' }, icon('calendar'), `Buổi ${fmtDate(t.classMeeting.date)}`) : null,
      t._count?.subtasks ? h('span', { class: 'badge' }, `${t._count.subtasks} bước`) : null,
      t.remindAt && !t.reminderSentAt && t.status !== 'DONE' ? h('span', { class: 'badge' }, icon('bell'), fmtDateTime(t.remindAt)) : null
    );
  }

  function renderList() {
    return h(
      'div',
      { class: 'card' },
      h(
        'div',
        { class: 'list', style: { padding: '6px' } },
        state.tasks.map((t) =>
          h(
            'div',
            { class: `task-row ${t.status === 'DONE' ? 'done' : ''}`, onclick: () => openTask(t) },
            h('input', { type: 'checkbox', class: 'task-check', checked: t.status === 'DONE', 'aria-label': 'Hoàn thành', onclick: (e) => e.stopPropagation(), onchange: (e) => setStatus(t, e.target.checked ? 'DONE' : 'TODO') }),
            h('div', { class: 'grow', style: { minWidth: 0 } }, h('div', { class: 'task-title' }, t.title), taskMeta(t)),
            h('span', { class: `badge ${STATUS[t.status].tone} hide-sm` }, STATUS[t.status].label),
            btn('', { icon: 'more', size: 'xs', variant: 'ghost', title: 'Thao tác', onClick: (e) => (e.stopPropagation(), rowMenu(e.currentTarget, t)) })
          )
        )
      )
    );
  }

  function rowMenu(anchor, t) {
    menu(anchor, [
      ...Object.entries(STATUS)
        .filter(([s]) => s !== t.status)
        .map(([s, def]) => ({ label: `Chuyển sang "${def.label}"`, icon: 'check', onClick: () => setStatus(t, s) })),
      !isGroupTask(t) ? 'sep' : null,
      !isGroupTask(t) ? { label: 'Chỉnh sửa', icon: 'edit', onClick: () => editor(t) } : null,
      !isGroupTask(t) ? { label: 'Xóa', icon: 'trash', danger: true, onClick: () => remove(t) } : null,
    ]);
  }

  async function remove(t, after) {
    if (!(await confirmDialog({ title: 'Xóa công việc?', message: `"${t.title}" sẽ được chuyển vào Thùng rác.`, danger: true, confirmText: 'Xóa' }))) return;
    try {
      await api.del(`/tasks/${t.id}`);
      toast('Đã xóa công việc');
      after?.();
      load();
      loadMeta();
    } catch (e) {
      showError(e);
    }
  }

  // ---------------------------------------------------------------- Kanban
  function renderKanban() {
    let dragged = null;
    const board = h(
      'div',
      { class: 'kanban' },
      Object.entries(STATUS).map(([status, def]) => {
        const items = state.tasks.filter((t) => t.status === status);
        const list = h('div', { class: 'kanban-list', 'data-status': status });
        const col = h(
          'div',
          { class: 'kanban-col' },
          h('div', { class: 'kanban-head' }, h('span', { class: `dot`, style: { background: status === 'DONE' ? 'var(--success)' : status === 'IN_PROGRESS' ? 'var(--primary)' : 'var(--text-3)' } }), h('span', { class: 'bold' }, def.label), h('span', { class: 'badge' }, items.length), h('div', { class: 'spacer' }), btn('', { icon: 'plus', size: 'xs', variant: 'ghost', title: 'Thêm', onClick: () => editor(null, { status }) })),
          list
        );
        for (const t of items) {
          const card = h('div', { class: 'kanban-card card', draggable: 'true', 'data-id': t.id, onclick: () => openTask(t) }, h('div', { class: 'task-title small' }, t.title), taskMeta(t), t.assignee && t.group ? h('div', { class: 'tiny muted mt-8' }, `Giao cho: ${t.assignee.fullName}`) : null);
          card.addEventListener('dragstart', (e) => {
            dragged = t;
            card.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
          });
          card.addEventListener('dragend', () => card.classList.remove('dragging'));
          list.append(card);
        }
        list.addEventListener('dragover', (e) => {
          e.preventDefault();
          list.classList.add('over');
          const after = [...list.querySelectorAll('.kanban-card:not(.dragging)')].find((c) => e.clientY < c.getBoundingClientRect().top + c.offsetHeight / 2);
          const draggingEl = board.querySelector('.dragging');
          if (draggingEl) after ? list.insertBefore(draggingEl, after) : list.append(draggingEl);
        });
        list.addEventListener('dragleave', () => list.classList.remove('over'));
        list.addEventListener('drop', async (e) => {
          e.preventDefault();
          list.classList.remove('over');
          if (!dragged) return;
          const t = dragged;
          dragged = null;
          if (isGroupTask(t)) {
            if (t.status !== status) await setStatus(t, status);
            else render();
            return;
          }
          const ids = [...list.querySelectorAll('.kanban-card')].map((c) => Number(c.dataset.id)).filter((id) => !state.tasks.find((x) => x.id === id)?.groupId);
          if (!ids.includes(t.id)) ids.push(t.id);
          try {
            await api.post('/tasks/reorder', { status, orderedIds: ids });
            const wasDone = t.status !== 'DONE' && status === 'DONE';
            t.status = status;
            if (wasDone) toast('Đã hoàn thành 🎉');
            loadMeta();
            load();
          } catch (err) {
            showError(err);
            render();
          }
        });
        return col;
      })
    );
    return board;
  }

  // ---------------------------------------------------------------- Calendar
  function renderCalendar() {
    const first = new Date(state.month.getFullYear(), state.month.getMonth(), 1);
    const start = startOfWeek(first);
    const byDate = new Map();
    for (const t of state.tasks) {
      if (!t.dueAt) continue;
      const k = isoDate(new Date(t.dueAt));
      if (!byDate.has(k)) byDate.set(k, []);
      byDate.get(k).push(t);
    }
    const noDue = state.tasks.filter((t) => !t.dueAt && t.status !== 'DONE');
    const today = isoDate();
    return h(
      'div',
      { class: 'col gap-12' },
      h(
        'div',
        { class: 'row' },
        btn('', { icon: 'chevron-left', size: 'sm', onClick: () => ((state.month = new Date(first.getFullYear(), first.getMonth() - 1, 1)), render()) }),
        btn('Tháng này', { size: 'sm', onClick: () => ((state.month = new Date()), render()) }),
        btn('', { icon: 'chevron-right', size: 'sm', onClick: () => ((state.month = new Date(first.getFullYear(), first.getMonth() + 1, 1)), render()) }),
        h('div', { class: 'bold' }, `Tháng ${first.getMonth() + 1}/${first.getFullYear()}`)
      ),
      h(
        'div',
        { class: 'card month-grid' },
        DAY_SHORT.slice(1).map((d) => h('div', { class: 'mg-head' }, d)),
        Array.from({ length: 42 }, (_, i) => {
          const d = addDays(start, i);
          const iso = isoDate(d);
          const list = byDate.get(iso) || [];
          return h(
            'div',
            { class: `mg-cell ${d.getMonth() !== first.getMonth() ? 'other' : ''} ${iso === today ? 'today' : ''}`, ondblclick: () => editor(null, { dueAt: new Date(`${iso}T23:00`).toISOString() }) },
            h('div', { class: 'mg-date' }, d.getDate()),
            list.slice(0, 4).map((t) => h('button', { class: `mg-ev ${t.status === 'DONE' ? 'cancelled' : ''}`, style: { '--c': t.subject?.color || (t.priority === 'URGENT' ? '#ef4444' : '#2563eb') }, onclick: () => openTask(t), title: t.title }, h('span', { class: 'truncate' }, t.title))),
            list.length > 4 ? h('div', { class: 'tiny muted' }, `+${list.length - 4} việc`) : null
          );
        })
      ),
      h('p', { class: 'tiny muted' }, 'Nhấp đúp vào một ngày để tạo công việc có hạn chót ngày đó.'),
      noDue.length ? h('div', { class: 'card card-pad' }, h('div', { class: 'section-title' }, `Chưa có hạn chót (${noDue.length})`), h('div', { class: 'row wrap' }, noDue.map((t) => h('button', { class: 'chip', onclick: () => openTask(t) }, t.title)))) : null
    );
  }

  // ---------------------------------------------------------------- Detail
  async function openTask(t0) {
    setQuery({ open: t0.id });
    let t;
    try {
      t = await api.get(`/tasks/${t0.id}`);
    } catch (e) {
      setQuery({ open: null });
      return showError(e);
    }
    const group = isGroupTask(t);
    const subBox = h('div', { class: 'list' });
    const renderSubs = () =>
      subBox.replaceChildren(
        ...(t.subtasks?.length
          ? t.subtasks.map((s) =>
              h(
                'label',
                { class: `task-row ${s.status === 'DONE' ? 'done' : ''}`, style: { padding: '6px 8px' } },
                h('input', {
                  type: 'checkbox',
                  class: 'task-check',
                  checked: s.status === 'DONE',
                  onchange: async (e) => {
                    try {
                      await api.patch(`/tasks/${s.id}`, { status: e.target.checked ? 'DONE' : 'TODO' });
                      s.status = e.target.checked ? 'DONE' : 'TODO';
                      renderSubs();
                    } catch (err) {
                      showError(err);
                    }
                  },
                }),
                h('span', { class: 'task-title small grow' }, s.title)
              )
            )
          : [h('p', { class: 'small muted' }, 'Chưa có bước nhỏ.')])
      );
    renderSubs();
    const aiOut = h('div');
    const d = drawer({
      title: t.title,
      onClose: () => setQuery({ open: null }),
      body: [
        h('div', { class: 'row wrap mb-16' }, h('span', { class: `badge ${STATUS[t.status].tone}` }, STATUS[t.status].label), taskMeta(t)),
        t.description ? h('div', { class: 'card card-pad mb-16' }, renderMarkdown(t.description)) : h('p', { class: 'muted small mb-16' }, 'Không có mô tả.'),
        t.classMeeting ? h('a', { class: 'list-item card mb-16', href: `/schedule?date=${t.classMeeting.date}&meeting=${t.classMeeting.id}` }, icon('calendar'), h('div', { class: 'grow' }, h('div', { class: 'small bold' }, t.classMeeting.subject.name), h('div', { class: 'tiny muted' }, `${fmtDate(t.classMeeting.date)} · ${periodLabel(t.classMeeting.startPeriod, t.classMeeting.endPeriod)}${t.classMeeting.room ? ` · ${t.classMeeting.room}` : ''}`))) : null,
        group ? h('div', { class: 'alert info mb-16' }, icon('users'), h('div', { class: 'small' }, `Nhiệm vụ của nhóm "${t.group.name}". `, h('a', { href: `/groups/${t.group.id}?tab=tasks` }, 'Mở nhóm'))) : null,
        !group ? h('div', { class: 'section-title' }, 'Các bước nhỏ') : null,
        !group ? subBox : null,
        !group && store.get().aiConfigured ? btn('AI chia nhỏ công việc', { icon: 'sparkles', size: 'sm', variant: 'soft', onClick: (e) => withLoading(e.currentTarget, () => breakdown(t, aiOut, renderSubs)) }) : null,
        aiOut,
        h('div', { class: 'tiny muted mt-16' }, `Tạo lúc ${fmtDateTime(t.createdAt)}${t.completedAt ? ` · Hoàn thành ${fmtDateTime(t.completedAt)}` : ''}`),
      ],
      footer: () => [
        ...Object.entries(STATUS)
          .filter(([s]) => s !== t.status)
          .map(([s, def]) => btn(def.label, { size: 'sm', icon: s === 'DONE' ? 'check' : undefined, variant: s === 'DONE' ? 'primary' : '', onClick: () => (setStatus(t, s), d.close()) })),
        h('div', { class: 'spacer' }),
        !group ? btn('', { icon: 'trash', size: 'sm', title: 'Xóa', onClick: () => remove(t, () => d.close()) }) : null,
        !group ? btn('Sửa', { icon: 'edit', size: 'sm', onClick: () => (d.close(), editor(t)) }) : null,
      ],
    });
  }

  async function breakdown(t, out, rerender) {
    try {
      const r = await api.post(`/tasks/${t.id}/ai/breakdown`);
      const checks = r.subtasks.map((s) => ({ s, cb: h('input', { type: 'checkbox', checked: true }) }));
      out.replaceChildren(
        h(
          'div',
          { class: 'ai-box mt-16' },
          h('div', { class: 'ai-tag mb-8' }, icon('sparkles'), 'Đề xuất các bước'),
          ...checks.map(({ s, cb }) => h('label', { class: 'checkbox small', style: { alignItems: 'flex-start', marginBottom: '6px' } }, cb, h('div', {}, h('div', { class: 'bold' }, s.title, s.estimateHours ? h('span', { class: 'tiny muted' }, ` (~${s.estimateHours}h)`) : null), s.description ? h('div', { class: 'tiny muted' }, s.description) : null))),
          r.advice ? h('p', { class: 'small muted mt-8' }, `💡 ${r.advice}`) : null,
          h('p', { class: 'tiny muted' }, r.note),
          btn('Thêm các bước đã chọn', {
            size: 'sm',
            variant: 'primary',
            icon: 'plus',
            onClick: async (e) =>
              withLoading(e.currentTarget, async () => {
                const items = checks.filter((c) => c.cb.checked).map((c) => ({ title: c.s.title, description: c.s.description }));
                if (!items.length) return;
                try {
                  const updated = await api.post(`/tasks/${t.id}/subtasks`, { items });
                  t.subtasks = updated.subtasks;
                  rerender();
                  out.replaceChildren();
                  toast('Đã thêm các bước nhỏ');
                } catch (err) {
                  showError(err);
                }
              }),
          })
        )
      );
    } catch (e) {
      showError(e);
    }
  }

  // ---------------------------------------------------------------- Editor
  async function editor(t, defaults = {}) {
    const meetings = await api.get('/schedules/meetings', { from: isoDate(addDays(new Date(), -7)), to: isoDate(addDays(new Date(), 60)) }).catch(() => []);
    const v = t || { title: '', description: '', priority: 'MEDIUM', status: defaults.status || 'TODO', dueAt: defaults.dueAt || null, remindAt: null, subjectId: state.subjectId || null, classMeetingId: null };
    const f = {
      title: h('input', { class: 'input', value: v.title, placeholder: 'vd: Nộp báo cáo thí nghiệm', autofocus: true, maxlength: 255 }),
      description: h('textarea', { class: 'textarea', rows: 4, value: v.description || '', placeholder: 'Mô tả chi tiết (hỗ trợ Markdown)' }),
      priority: select(Object.entries(PRIORITY).map(([k, p]) => ({ value: k, label: p.label })), v.priority),
      status: select(Object.entries(STATUS).map(([k, s]) => ({ value: k, label: s.label })), v.status),
      dueAt: h('input', { class: 'input', type: 'datetime-local', value: toLocalInput(v.dueAt) }),
      remindAt: h('input', { class: 'input', type: 'datetime-local', value: toLocalInput(v.remindAt) }),
      subjectId: select([{ value: '', label: '— Không gắn môn —' }, ...state.subjects.map((s) => ({ value: s.id, label: s.name }))], v.subjectId || v.subject?.id || ''),
      classMeetingId: select([{ value: '', label: '— Không gắn buổi học —' }, ...meetings.map((m) => ({ value: m.id, label: `${fmtDate(m.date)} · ${m.subject.name} · ${periodLabel(m.startPeriod, m.endPeriod)}` }))], v.classMeetingId || v.classMeeting?.id || ''),
    };
    f.classMeetingId.addEventListener('change', () => {
      const m = meetings.find((x) => String(x.id) === f.classMeetingId.value);
      if (m) {
        f.subjectId.value = m.subject.id;
        if (!f.dueAt.value) f.dueAt.value = `${m.date}T07:00`;
      }
    });
    const remindQuick = h(
      'div',
      { class: 'row wrap', style: { gap: '4px' } },
      [
        ['1 giờ trước hạn', 60],
        ['1 ngày trước hạn', 1440],
      ].map(([l, min]) =>
        h('button', {
          class: 'chip',
          type: 'button',
          onclick: () => {
            if (!f.dueAt.value) return toast.info('Hãy đặt hạn chót trước');
            f.remindAt.value = toLocalInput(new Date(new Date(f.dueAt.value).getTime() - min * 60000));
          },
        }, l)
      )
    );
    modal({
      title: t ? 'Sửa công việc' : 'Công việc mới',
      size: 'wide',
      body: h('div', { class: 'form-grid' }, field('Tiêu đề *', f.title, { className: 'span-2' }), field('Mô tả', f.description, { className: 'span-2' }), field('Hạn chót', f.dueAt), field('Nhắc nhở', f.remindAt, { hint: remindQuick }), field('Ưu tiên', f.priority), field('Trạng thái', f.status), field('Môn học', f.subjectId), field('Liên kết buổi học (UniSchedule)', f.classMeetingId)),
      footer: (close) => [
        btn('Hủy', { onClick: () => close() }),
        btn(t ? 'Lưu' : 'Tạo công việc', {
          variant: 'primary',
          onClick: async (e) => {
            const body = {
              title: f.title.value.trim(),
              description: f.description.value,
              priority: f.priority.value,
              status: f.status.value,
              dueAt: fromLocalInput(f.dueAt.value),
              remindAt: fromLocalInput(f.remindAt.value),
              subjectId: f.subjectId.value || null,
              classMeetingId: f.classMeetingId.value || null,
            };
            if (!body.title) return toast.error('Nhập tiêu đề công việc');
            if (body.remindAt && new Date(body.remindAt) < new Date()) return toast.error('Thời điểm nhắc phải ở tương lai');
            await withLoading(e.currentTarget, async () => {
              try {
                if (t) await api.patch(`/tasks/${t.id}`, body);
                else await api.post('/tasks', body);
                toast(t ? 'Đã lưu công việc' : 'Đã tạo công việc');
                close();
                load();
                loadMeta();
              } catch (err) {
                showError(err);
              }
            });
          },
        }),
      ],
    });
  }

  // ---------------------------------------------------------------- AI tổng hợp
  function aiMenu(anchor) {
    if (!store.get().aiConfigured) return toast.warning('AI chưa được cấu hình trên máy chủ');
    menu(anchor, [
      { label: 'Đề xuất mức độ ưu tiên', icon: 'flag', onClick: aiPriorities },
      { label: 'Lập kế hoạch học tập 7 ngày', icon: 'calendar', onClick: () => aiText('/tasks/ai/study-plan', 'Kế hoạch học tập 7 ngày') },
      { label: 'Tóm tắt tiến độ', icon: 'trending-up', onClick: () => aiText('/tasks/ai/progress', 'Tóm tắt tiến độ') },
    ], { align: 'right' });
  }
  async function aiText(path, title) {
    const m = modal({ title, icon: 'sparkles', size: 'wide', body: h('div', { class: 'loading-center' }, h('div', { class: 'spinner' })) });
    try {
      const r = await api.post(path);
      m.body.replaceChildren(renderMarkdown(r.content), h('p', { class: 'tiny muted mt-16' }, 'Nội dung do AI đề xuất – hãy cân nhắc trước khi áp dụng.'));
    } catch (e) {
      m.close();
      showError(e);
    }
  }
  async function aiPriorities() {
    const m = modal({ title: 'Đề xuất mức độ ưu tiên', icon: 'sparkles', size: 'wide', body: h('div', { class: 'loading-center' }, h('div', { class: 'spinner' })) });
    try {
      const r = await api.post('/tasks/ai/priorities');
      if (!r.suggestions.length) return m.body.replaceChildren(h('p', { class: 'muted' }, r.note || 'Không có đề xuất.'));
      m.body.replaceChildren(
        h('p', { class: 'small muted mb-8' }, r.note),
        ...r.suggestions.map((s) => {
          const applyBtn = btn(s.current === s.priority ? 'Giữ nguyên' : 'Áp dụng', {
            size: 'xs',
            variant: s.current === s.priority ? '' : 'primary',
            disabled: s.current === s.priority,
            onClick: async () => {
              try {
                const task = state.tasks.find((x) => x.id === s.id);
                if (task?.groupId) await api.patch(`/groups/${task.groupId}/tasks/${s.id}`, { priority: s.priority });
                else await api.patch(`/tasks/${s.id}`, { priority: s.priority });
                applyBtn.textContent = 'Đã áp dụng';
                applyBtn.disabled = true;
                load();
              } catch (e) {
                showError(e);
              }
            },
          });
          return h('div', { class: 'card card-pad mb-8' }, h('div', { class: 'row' }, h('div', { class: 'grow bold small' }, s.title), h('span', { class: `badge ${PRIORITY[s.current].tone}` }, PRIORITY[s.current].label), '→', h('span', { class: `badge ${PRIORITY[s.priority].tone}` }, PRIORITY[s.priority].label), applyBtn), h('div', { class: 'tiny muted mt-8' }, s.reason));
        })
      );
    } catch (e) {
      m.close();
      showError(e);
    }
  }

  loadMeta();
  load().then(() => {
    if (q.new) editor();
    if (q.open) openTask({ id: Number(q.open) });
  });
}
