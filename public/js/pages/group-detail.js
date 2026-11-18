import { h, icon, btn, avatar } from '../core/dom.js';
import { api, download } from '../core/api.js';
import { navigate, query, setQuery } from '../core/router.js';
import { store } from '../core/store.js';
import { toast, showError, modal, confirmDialog, menu, drawer, emptyState, errorState, loading, skeleton, select, field, withLoading } from '../core/ui.js';
import { relativeTime, fmtDateTime, dueLabel, toLocalInput, fromLocalInput, PRIORITY, STATUS, fileSize, FILE_ICONS } from '../core/format.js';
import { renderMarkdown } from '../core/markdown.js';

export function mount(container, { params }) {
  const gid = Number(params.id);
  const me = store.get().user;
  let g = null;
  let tab = query().tab || 'tasks';
  container.append(loading());

  async function load() {
    try {
      g = await api.get(`/groups/${gid}`);
      render();
    } catch (e) {
      container.replaceChildren(errorState(e, load));
    }
  }

  const isLeader = () => g.myRole === 'LEADER';

  function render() {
    const tabsDef = [
      ['tasks', 'Nhiệm vụ', 'task'],
      ['resources', 'Tài liệu & ghi chú', 'folder'],
      ['discussion', 'Thảo luận', 'message'],
      ['members', `Thành viên (${g.members.length})`, 'users'],
      ['activity', 'Hoạt động', 'history'],
    ];
    const tabs = h('div', { class: 'tabs mb-16' }, tabsDef.map(([v, l, ic]) => h('button', { class: `tab ${tab === v ? 'active' : ''}`, onclick: () => ((tab = v), setQuery({ tab: v }), render()) }, icon(ic), l)));
    const content = h('div', {}, skeleton(5));
    container.replaceChildren(
      h('div', { class: 'breadcrumb' }, h('a', { href: '/groups' }, 'UniGroup'), h('span', { class: 'sep' }, '/'), h('span', {}, g.name)),
      h(
        'div',
        { class: 'page-header' },
        h('div', { class: 'icon-box lg', style: { background: `${g.color}22`, color: g.color } }, icon('users')),
        h('div', { class: 'titles' }, h('h1', {}, g.name), h('p', {}, g.description || 'Chưa có mô tả')),
        h(
          'div',
          { class: 'actions' },
          store.get().aiConfigured ? btn('UniAI', { icon: 'sparkles', variant: 'soft', onClick: (e) => aiMenu(e.currentTarget) }) : null,
          isLeader() ? btn('Mời thành viên', { icon: 'plus', variant: 'primary', onClick: inviteDialog }) : null,
          btn('', { icon: 'more', title: 'Thêm', onClick: (e) => groupMenu(e.currentTarget) })
        )
      ),
      h(
        'div',
        { class: 'grid cols-4 mb-16' },
        miniStat('Tiến độ', `${g.progress.percent}%`, h('div', { class: 'progress sm mt-8' }, h('span', { style: { width: `${g.progress.percent}%` } }))),
        miniStat('Cần làm', g.progress.TODO),
        miniStat('Đang làm', g.progress.IN_PROGRESS),
        miniStat('Hoàn thành', g.progress.DONE)
      ),
      isLeader() ? h('div', { class: 'alert info mb-16' }, icon('key'), h('div', { class: 'small grow' }, 'Mã tham gia: ', h('b', { class: 'mono', style: { letterSpacing: '0.12em' } }, g.joinCode), ' – gửi mã này cho bạn bè để họ tham gia nhóm.'), btn('Sao chép', { size: 'xs', onClick: () => navigator.clipboard.writeText(g.joinCode).then(() => toast('Đã sao chép mã', 'info')) }), btn('Tạo mã mới', { size: 'xs', onClick: regenCode })) : null,
      tabs,
      content
    );
    ({ tasks: renderTasks, resources: renderResources, discussion: renderDiscussion, members: renderMembers, activity: renderActivity })[tab]?.(content);
  }

  function miniStat(label, value, extra) {
    return h('div', { class: 'card card-pad' }, h('div', { class: 'tiny muted' }, label), h('div', { class: 'bold', style: { fontSize: '20px' } }, value), extra || null);
  }

  async function regenCode() {
    if (!(await confirmDialog({ title: 'Tạo mã tham gia mới?', message: 'Mã cũ sẽ không dùng được nữa.', confirmText: 'Tạo mã mới' }))) return;
    try {
      const r = await api.post(`/groups/${gid}/join-code`);
      g.joinCode = r.joinCode;
      render();
    } catch (e) {
      showError(e);
    }
  }

  function groupMenu(anchor) {
    menu(anchor, [
      isLeader() ? { label: 'Sửa thông tin nhóm', icon: 'edit', onClick: editGroup } : null,
      g.isOwner ? { label: 'Chuyển quyền sở hữu', icon: 'key', onClick: transferDialog } : null,
      !g.isOwner ? { label: 'Rời nhóm', icon: 'logout', danger: true, onClick: leave } : null,
      g.isOwner ? 'sep' : null,
      g.isOwner ? { label: 'Giải tán nhóm', icon: 'trash', danger: true, onClick: dissolve } : null,
    ], { align: 'right' });
  }

  function editGroup() {
    const name = h('input', { class: 'input', value: g.name });
    const desc = h('textarea', { class: 'textarea', rows: 3, value: g.description || '' });
    modal({
      title: 'Sửa thông tin nhóm',
      body: [field('Tên nhóm', name), field('Mô tả', desc)],
      footer: (close) => [btn('Hủy', { onClick: () => close() }), btn('Lưu', { variant: 'primary', onClick: async () => {
        try {
          g = await api.patch(`/groups/${gid}`, { name: name.value.trim(), description: desc.value });
          close();
          toast('Đã cập nhật');
          render();
        } catch (e) {
          showError(e);
        }
      } })],
    });
  }

  async function leave() {
    if (!(await confirmDialog({ title: 'Rời nhóm?', message: `Bạn sẽ không còn truy cập "${g.name}". Nhiệm vụ đang được giao cho bạn sẽ được bỏ giao.`, danger: true, confirmText: 'Rời nhóm' }))) return;
    try {
      await api.post(`/groups/${gid}/leave`);
      toast('Đã rời nhóm');
      navigate('/groups');
    } catch (e) {
      showError(e);
    }
  }
  async function dissolve() {
    if (!(await confirmDialog({ title: 'Giải tán nhóm?', message: 'Mọi thành viên sẽ mất quyền truy cập nhóm. Thao tác này không thể hoàn tác.', danger: true, confirmText: 'Giải tán' }))) return;
    try {
      await api.del(`/groups/${gid}`);
      toast('Đã giải tán nhóm');
      navigate('/groups');
    } catch (e) {
      showError(e);
    }
  }
  function transferDialog() {
    const sel = select(g.members.filter((m) => m.user.id !== me.id).map((m) => ({ value: m.user.id, label: m.user.fullName })), '');
    if (!sel.options.length) return toast.info('Nhóm chưa có thành viên khác');
    modal({
      title: 'Chuyển quyền sở hữu',
      body: [h('p', { class: 'small muted mb-8' }, 'Người nhận sẽ trở thành chủ nhóm (trưởng nhóm). Bạn vẫn là trưởng nhóm.'), field('Thành viên', sel)],
      footer: (close) => [btn('Hủy', { onClick: () => close() }), btn('Chuyển', { variant: 'danger', onClick: async () => {
        try {
          g = await api.post(`/groups/${gid}/transfer`, { userId: Number(sel.value) });
          close();
          toast('Đã chuyển quyền sở hữu');
          render();
        } catch (e) {
          showError(e);
        }
      } })],
    });
  }

  function inviteDialog() {
    const email = h('input', { class: 'input', type: 'email', placeholder: 'email@truong.edu.vn', autofocus: true });
    modal({
      title: 'Mời thành viên',
      body: [field('Email tài khoản UniVerse', email, { hint: 'Người được mời sẽ nhận thông báo và có thể chấp nhận/từ chối.' }), h('div', { class: 'small muted' }, 'Hoặc gửi mã tham gia: ', h('b', { class: 'mono' }, g.joinCode))],
      footer: (close) => [btn('Đóng', { onClick: () => close() }), btn('Gửi lời mời', { variant: 'primary', icon: 'send', onClick: async (e) => withLoading(e.currentTarget, async () => {
        try {
          await api.post(`/groups/${gid}/invites`, { email: email.value.trim() });
          toast('Đã gửi lời mời');
          email.value = '';
          load();
        } catch (err) {
          showError(err);
        }
      }) })],
    });
  }

  // ---------------------------------------------------------------- Tasks
  async function renderTasks(box) {
    let tasks;
    try {
      tasks = await api.get(`/groups/${gid}/tasks`);
    } catch (e) {
      return box.replaceChildren(errorState(e));
    }
    const add = btn('Nhiệm vụ mới', { icon: 'plus', variant: 'primary', size: 'sm', onClick: () => taskEditor() });
    if (!tasks.length) return box.replaceChildren(emptyState({ icon: 'task', title: 'Chưa có nhiệm vụ', text: 'Tạo nhiệm vụ và giao cho thành viên để theo dõi tiến độ chung.', action: add }));
    box.replaceChildren(
      h('div', { class: 'row mb-8' }, h('div', { class: 'spacer' }), add),
      h(
        'div',
        { class: 'kanban' },
        Object.entries(STATUS).map(([status, def]) =>
          h(
            'div',
            { class: 'kanban-col' },
            h('div', { class: 'kanban-head' }, h('span', { class: 'bold' }, def.label), h('span', { class: 'badge' }, tasks.filter((t) => t.status === status).length)),
            h(
              'div',
              { class: 'kanban-list' },
              tasks
                .filter((t) => t.status === status)
                .map((t) => {
                  const due = dueLabel(t.dueAt);
                  return h(
                    'div',
                    { class: 'kanban-card card', onclick: () => openTask(t) },
                    h('div', { class: 'task-title small' }, t.title),
                    h('div', { class: 'row wrap', style: { gap: '4px' } }, t.dueAt ? h('span', { class: `badge ${t.status === 'DONE' ? '' : due.tone}` }, due.text) : null, h('span', { class: `badge ${PRIORITY[t.priority].tone}` }, PRIORITY[t.priority].label), t.commentCount ? h('span', { class: 'badge' }, icon('message'), t.commentCount) : null),
                    h('div', { class: 'row mt-8 tiny muted' }, t.assignee ? [avatar(t.assignee, 'sm'), t.assignee.fullName] : 'Chưa giao')
                  );
                })
            )
          )
        )
      )
    );
  }

  function canEditTask(t) {
    return isLeader() || t.userId === me.id;
  }

  async function openTask(t) {
    const comments = h('div', { class: 'col', style: { gap: '10px' } }, skeleton(2));
    const input = h('textarea', { class: 'textarea', rows: 2, placeholder: 'Viết bình luận...' });
    const loadComments = async () => {
      try {
        const list = await api.get(`/groups/${gid}/comments`, { targetType: 'TASK', targetId: t.id });
        comments.replaceChildren(...(list.length ? list.map((c) => commentEl(c, loadComments)) : [h('p', { class: 'small muted' }, 'Chưa có bình luận.')]));
      } catch (e) {
        comments.replaceChildren(h('p', { class: 'small danger-text' }, e.message));
      }
    };
    const statusBtns = Object.entries(STATUS)
      .filter(([s]) => s !== t.status && (canEditTask(t) || t.assigneeId === me.id))
      .map(([s, def]) => btn(def.label, { size: 'sm', variant: s === 'DONE' ? 'primary' : '', onClick: async () => {
        try {
          await api.patch(`/groups/${gid}/tasks/${t.id}`, { status: s });
          toast('Đã cập nhật trạng thái');
          d.close();
          load();
        } catch (e) {
          showError(e);
        }
      } }));
    const d = drawer({
      title: t.title,
      body: [
        h('div', { class: 'row wrap mb-16' }, h('span', { class: `badge ${STATUS[t.status].tone}` }, STATUS[t.status].label), h('span', { class: `badge ${PRIORITY[t.priority].tone}` }, PRIORITY[t.priority].label), t.dueAt ? h('span', { class: 'badge' }, `Hạn ${fmtDateTime(t.dueAt)}`) : null),
        h('div', { class: 'small mb-8' }, h('b', {}, 'Người được giao: '), t.assignee?.fullName || 'Chưa giao'),
        h('div', { class: 'small mb-16' }, h('b', {}, 'Người tạo: '), t.user.fullName),
        t.description ? h('div', { class: 'card card-pad mb-16' }, renderMarkdown(t.description)) : null,
        h('div', { class: 'section-title' }, 'Bình luận'),
        comments,
        h('div', { class: 'mt-8' }, input),
        btn('Gửi', { size: 'sm', icon: 'send', variant: 'primary', onClick: async (e) => withLoading(e.currentTarget, async () => {
          if (!input.value.trim()) return;
          try {
            await api.post(`/groups/${gid}/comments`, { targetType: 'TASK', targetId: t.id, content: input.value.trim() });
            input.value = '';
            loadComments();
          } catch (err) {
            showError(err);
          }
        }) }),
      ],
      footer: () => [
        ...statusBtns,
        h('div', { class: 'spacer' }),
        canEditTask(t) ? btn('', { icon: 'trash', size: 'sm', title: 'Xóa', onClick: async () => {
          if (!(await confirmDialog({ title: 'Xóa nhiệm vụ?', danger: true, confirmText: 'Xóa', message: t.title }))) return;
          try {
            await api.del(`/groups/${gid}/tasks/${t.id}`);
            d.close();
            load();
          } catch (e) {
            showError(e);
          }
        } }) : null,
        canEditTask(t) ? btn('Sửa', { icon: 'edit', size: 'sm', onClick: () => (d.close(), taskEditor(t)) }) : null,
      ],
    });
    loadComments();
  }

  function taskEditor(t, preset = {}) {
    const v = t || { title: preset.title || '', description: preset.description || '', priority: 'MEDIUM', status: 'TODO', assigneeId: preset.assigneeId ?? (isLeader() ? null : me.id), dueAt: preset.dueAt || null };
    const members = isLeader() ? g.members : g.members.filter((m) => m.user.id === me.id);
    const f = {
      title: h('input', { class: 'input', value: v.title, autofocus: true }),
      description: h('textarea', { class: 'textarea', rows: 3, value: v.description || '' }),
      assignee: select([{ value: '', label: '— Chưa giao —' }, ...members.map((m) => ({ value: m.user.id, label: m.user.fullName }))], v.assigneeId || ''),
      priority: select(Object.entries(PRIORITY).map(([k, p]) => ({ value: k, label: p.label })), v.priority),
      dueAt: h('input', { class: 'input', type: 'datetime-local', value: toLocalInput(v.dueAt) }),
    };
    modal({
      title: t ? 'Sửa nhiệm vụ' : 'Nhiệm vụ mới',
      size: 'wide',
      body: h('div', { class: 'form-grid' }, field('Tiêu đề *', f.title, { className: 'span-2' }), field('Mô tả', f.description, { className: 'span-2' }), field('Giao cho', f.assignee, { hint: isLeader() ? null : 'Chỉ trưởng nhóm được giao việc cho người khác' }), field('Ưu tiên', f.priority), field('Hạn chót', f.dueAt)),
      footer: (close) => [btn('Hủy', { onClick: () => close() }), btn(t ? 'Lưu' : 'Tạo', { variant: 'primary', onClick: async (e) => {
        const body = { title: f.title.value.trim(), description: f.description.value, assigneeId: f.assignee.value ? Number(f.assignee.value) : null, priority: f.priority.value, dueAt: fromLocalInput(f.dueAt.value) };
        if (!body.title) return toast.error('Nhập tiêu đề');
        await withLoading(e.currentTarget, async () => {
          try {
            if (t) await api.patch(`/groups/${gid}/tasks/${t.id}`, body);
            else await api.post(`/groups/${gid}/tasks`, body);
            close();
            toast(t ? 'Đã lưu' : 'Đã tạo nhiệm vụ');
            load();
          } catch (err) {
            showError(err);
          }
        });
      } })],
    });
  }

  // ---------------------------------------------------------------- Resources
  async function renderResources(box) {
    let list;
    try {
      list = await api.get(`/groups/${gid}/resources`);
    } catch (e) {
      return box.replaceChildren(errorState(e));
    }
    const shareBtn = btn('Chia sẻ với nhóm', { icon: 'share', variant: 'primary', size: 'sm', onClick: shareDialog });
    if (!list.length) return box.replaceChildren(emptyState({ icon: 'folder', title: 'Chưa có tài liệu chia sẻ', text: 'Chia sẻ file từ UniDrive hoặc ghi chú từ UniNote cho cả nhóm (chỉ đọc).', action: shareBtn }));
    box.replaceChildren(
      h('div', { class: 'row mb-8' }, h('div', { class: 'spacer' }), shareBtn),
      h(
        'div',
        { class: 'card' },
        h(
          'div',
          { class: 'list', style: { padding: '6px' } },
          list.map((r) => {
            const isFile = r.type === 'FILE';
            const fi = isFile ? FILE_ICONS[r.file?.extension] || FILE_ICONS.txt : { icon: 'note', color: '#0891b2' };
            return h(
              'div',
              { class: 'list-item' },
              h('div', { class: 'icon-box sm', style: { background: `${fi.color}1a`, color: fi.color } }, isFile ? icon(fi.icon) : h('span', {}, r.note?.icon || '📄')),
              h('a', { class: 'grow', href: isFile ? `/drive?file=${r.file.id}` : `/notes/${r.note.id}`, style: { minWidth: 0, color: 'inherit' } }, h('div', { class: 'bold small truncate' }, isFile ? r.file.originalName : r.note.title || 'Ghi chú'), h('div', { class: 'tiny muted' }, `${r.sharedBy.fullName} chia sẻ ${relativeTime(r.createdAt)}${isFile ? ` · ${fileSize(r.file.size)}` : ''}`)),
              isFile ? btn('', { icon: 'download', size: 'xs', variant: 'ghost', title: 'Tải xuống', onClick: () => download(`/drive/files/${r.file.id}/download`, r.file.originalName).catch(showError) }) : null,
              isLeader() || r.sharedBy.id === me.id ? btn('', { icon: 'x', size: 'xs', variant: 'ghost', title: 'Gỡ chia sẻ', onClick: async () => {
                if (!(await confirmDialog({ title: 'Gỡ chia sẻ?', message: 'Thành viên sẽ không còn xem được mục này (file gốc không bị xóa).', confirmText: 'Gỡ' }))) return;
                try {
                  await api.del(`/groups/${gid}/resources/${r.id}`);
                  renderResources(box);
                } catch (e) {
                  showError(e);
                }
              } }) : null
            );
          })
        )
      )
    );

    async function shareDialog() {
      const [drive, notes] = await Promise.all([api.get('/drive', { view: 'my', sort: 'date', search: '' }).catch(() => ({ files: [] })), api.get('/notes').catch(() => [])]);
      const type = select([{ value: 'FILE', label: 'Tài liệu UniDrive' }, { value: 'NOTE', label: 'Ghi chú UniNote' }], 'FILE');
      const fileSel = select(drive.files.map((f) => ({ value: f.id, label: f.originalName })), '');
      const noteSel = select(notes.map((n) => ({ value: n.id, label: `${n.icon || '📄'} ${n.title || 'Không tiêu đề'}` })), '');
      const fileF = field('Chọn file (chỉ file của bạn)', fileSel);
      const noteF = field('Chọn ghi chú', noteSel);
      const sync = () => ((fileF.hidden = type.value !== 'FILE'), (noteF.hidden = type.value !== 'NOTE'));
      type.addEventListener('change', sync);
      sync();
      modal({
        title: 'Chia sẻ với nhóm',
        body: [field('Loại', type), fileF, noteF, h('p', { class: 'tiny muted' }, 'Thành viên nhóm có thể xem/tải về nhưng không chỉnh sửa được bản gốc.')],
        footer: (close) => [btn('Hủy', { onClick: () => close() }), btn('Chia sẻ', { variant: 'primary', onClick: async (e) => withLoading(e.currentTarget, async () => {
          const body = type.value === 'FILE' ? { type: 'FILE', fileId: Number(fileSel.value) } : { type: 'NOTE', noteId: Number(noteSel.value) };
          if (!(body.fileId || body.noteId)) return toast.error('Hãy chọn mục cần chia sẻ');
          try {
            await api.post(`/groups/${gid}/resources`, body);
            close();
            toast('Đã chia sẻ');
            renderResources(box);
          } catch (err) {
            showError(err);
          }
        }) })],
      });
    }
  }

  // ---------------------------------------------------------------- Discussion
  function commentEl(c, reload) {
    return h(
      'div',
      { class: 'comment' },
      avatar(c.user, 'sm'),
      h('div', { class: 'grow' }, h('div', { class: 'row' }, h('span', { class: 'bold small' }, c.user.fullName), h('span', { class: 'tiny muted' }, relativeTime(c.createdAt)), h('div', { class: 'spacer' }), c.user.id === me.id || isLeader() ? btn('', { icon: 'trash', size: 'xs', variant: 'ghost', title: 'Xóa', onClick: async () => {
        if (!(await confirmDialog({ title: 'Xóa bình luận?', danger: true, confirmText: 'Xóa' }))) return;
        try {
          await api.del(`/groups/${gid}/comments/${c.id}`);
          reload();
        } catch (e) {
          showError(e);
        }
      } }) : null), h('div', { class: 'small comment-body' }, c.content))
    );
  }

  async function renderDiscussion(box) {
    const list = h('div', { class: 'col', style: { gap: '12px' } }, skeleton(3, { avatar: true }));
    const input = h('textarea', { class: 'textarea', rows: 3, placeholder: 'Chia sẻ ý tưởng, câu hỏi với nhóm...' });
    const reload = async () => {
      try {
        const cs = await api.get(`/groups/${gid}/comments`, { targetType: 'GROUP', targetId: gid });
        list.replaceChildren(...(cs.length ? cs.map((c) => commentEl(c, reload)) : [emptyState({ icon: 'message', title: 'Chưa có thảo luận', compact: true })]));
      } catch (e) {
        list.replaceChildren(errorState(e));
      }
    };
    box.replaceChildren(
      h('div', { class: 'card card-pad' }, list, h('div', { class: 'mt-16' }, input), h('div', { class: 'row mt-8' }, h('div', { class: 'spacer' }), btn('Gửi', { icon: 'send', variant: 'primary', size: 'sm', onClick: async (e) => withLoading(e.currentTarget, async () => {
        if (!input.value.trim()) return;
        try {
          await api.post(`/groups/${gid}/comments`, { targetType: 'GROUP', targetId: gid, content: input.value.trim() });
          input.value = '';
          reload();
        } catch (err) {
          showError(err);
        }
      }) })))
    );
    reload();
  }

  // ---------------------------------------------------------------- Members
  function renderMembers(box) {
    box.replaceChildren(
      h(
        'div',
        { class: 'card' },
        h(
          'div',
          { class: 'list', style: { padding: '6px' } },
          g.members.map((m) =>
            h(
              'div',
              { class: 'list-item', style: { cursor: 'default' } },
              avatar(m.user),
              h('div', { class: 'grow' }, h('div', { class: 'bold small' }, m.user.fullName, m.user.id === me.id ? ' (bạn)' : ''), h('div', { class: 'tiny muted' }, `${m.user.email} · tham gia ${relativeTime(m.joinedAt)}`)),
              m.user.id === g.ownerId ? h('span', { class: 'badge warning' }, 'Chủ nhóm') : null,
              h('span', { class: `badge ${m.role === 'LEADER' ? 'violet' : ''}` }, m.role === 'LEADER' ? 'Trưởng nhóm' : 'Thành viên'),
              isLeader() && m.user.id !== g.ownerId && m.user.id !== me.id
                ? btn('', { icon: 'more', size: 'xs', variant: 'ghost', title: 'Quản lý', onClick: (e) => menu(e.currentTarget, [
                    { label: m.role === 'LEADER' ? 'Hạ xuống thành viên' : 'Đặt làm trưởng nhóm', icon: 'shield', onClick: async () => {
                      try {
                        g = await api.patch(`/groups/${gid}/members/${m.user.id}`, { role: m.role === 'LEADER' ? 'MEMBER' : 'LEADER' });
                        toast('Đã cập nhật vai trò');
                        render();
                      } catch (err) {
                        showError(err);
                      }
                    } },
                    { label: 'Xóa khỏi nhóm', icon: 'trash', danger: true, onClick: async () => {
                      if (!(await confirmDialog({ title: `Xóa ${m.user.fullName}?`, danger: true, confirmText: 'Xóa', message: 'Thành viên sẽ mất quyền truy cập nhóm.' }))) return;
                      try {
                        await api.del(`/groups/${gid}/members/${m.user.id}`);
                        load();
                      } catch (err) {
                        showError(err);
                      }
                    } },
                  ], { align: 'right' }) })
                : null
            )
          )
        )
      ),
      isLeader() && g.pendingInvites?.length
        ? h('div', { class: 'card card-pad mt-16' }, h('div', { class: 'section-title' }, 'Lời mời đang chờ'), ...g.pendingInvites.map((inv) => h('div', { class: 'row small', style: { padding: '4px 0' } }, h('span', { class: 'grow' }, `${inv.invitee.fullName} (${inv.invitee.email})`), btn('Hủy lời mời', { size: 'xs', onClick: async () => {
            try {
              await api.del(`/groups/${gid}/invites/${inv.id}`);
              load();
            } catch (e) {
              showError(e);
            }
          } }))))
        : null
    );
  }

  // ---------------------------------------------------------------- Activity
  async function renderActivity(box) {
    try {
      const r = await api.get(`/groups/${gid}/activity`, { page: 1, pageSize: 50 });
      box.replaceChildren(r.items.length ? h('div', { class: 'card card-pad timeline' }, r.items.map((a) => h('div', { class: 'timeline-item' }, h('span', { class: 'timeline-dot' }), h('div', {}, h('div', { class: 'small' }, h('b', {}, a.user.fullName), ` – ${a.summary}`), h('div', { class: 'tiny muted' }, fmtDateTime(a.createdAt)))))) : emptyState({ icon: 'history', title: 'Chưa có hoạt động', compact: true }));
    } catch (e) {
      box.replaceChildren(errorState(e));
    }
  }

  // ---------------------------------------------------------------- AI
  function aiMenu(anchor) {
    menu(anchor, [
      isLeader() ? { label: 'Lập kế hoạch & chia việc', icon: 'target', onClick: aiPlan } : null,
      { label: 'Tóm tắt tiến độ nhóm', icon: 'trending-up', onClick: aiProgress },
    ], { align: 'right' });
  }
  async function aiProgress() {
    const m = modal({ title: 'Tiến độ nhóm', icon: 'sparkles', size: 'wide', body: loading() });
    try {
      const r = await api.post(`/groups/${gid}/ai/progress`);
      m.body.replaceChildren(renderMarkdown(r.content));
    } catch (e) {
      m.close();
      showError(e);
    }
  }
  function aiPlan() {
    const goal = h('textarea', { class: 'textarea', rows: 3, placeholder: 'vd: Hoàn thành đồ án web bán hàng trong 4 tuần: phân tích, thiết kế CSDL, code, báo cáo' });
    const out = h('div');
    const m = modal({
      title: 'UniAI – Kế hoạch & phân chia công việc',
      icon: 'sparkles',
      size: 'wide',
      body: [field('Mục tiêu / yêu cầu của nhóm', goal), out],
      footer: (close) => [btn('Đóng', { onClick: () => close() }), btn('Đề xuất', { icon: 'sparkles', variant: 'primary', onClick: async (e) => withLoading(e.currentTarget, async () => {
        if (goal.value.trim().length < 5) return toast.error('Mô tả mục tiêu chi tiết hơn');
        try {
          const r = await api.post(`/groups/${gid}/ai/plan`, { goal: goal.value.trim() });
          const items = r.tasks.map((t) => ({ t, cb: h('input', { type: 'checkbox', checked: true }), who: select([{ value: '', label: 'Chưa giao' }, ...g.members.map((mm) => ({ value: mm.user.id, label: mm.user.fullName }))], t.assigneeId || '', { size: 'sm', style: { width: '170px' } }) }));
          out.replaceChildren(
            r.plan ? h('div', { class: 'card card-pad mt-16' }, renderMarkdown(r.plan)) : null,
            h('div', { class: 'section-title mt-16' }, 'Nhiệm vụ đề xuất'),
            ...items.map(({ t, cb, who }) => h('div', { class: 'row mb-8', style: { alignItems: 'flex-start' } }, cb, h('div', { class: 'grow' }, h('div', { class: 'bold small' }, t.title, t.dueInDays != null ? h('span', { class: 'tiny muted' }, ` · hạn ${t.dueInDays} ngày`) : null), t.description ? h('div', { class: 'tiny muted' }, t.description) : null), who)),
            h('p', { class: 'tiny muted' }, r.note),
            btn('Tạo các nhiệm vụ đã chọn', { icon: 'check', variant: 'primary', onClick: async (ev) => withLoading(ev.currentTarget, async () => {
              const chosen = items.filter((x) => x.cb.checked).map(({ t, who }) => ({ title: t.title, description: t.description, assigneeId: who.value ? Number(who.value) : null, dueAt: t.dueInDays != null ? new Date(Date.now() + t.dueInDays * 86400000).toISOString() : null }));
              if (!chosen.length) return;
              try {
                await api.post(`/groups/${gid}/tasks/bulk`, { items: chosen });
                toast(`Đã tạo ${chosen.length} nhiệm vụ`);
                m.close();
                tab = 'tasks';
                load();
              } catch (err) {
                showError(err);
              }
            }) })
          );
        } catch (err) {
          showError(err);
        }
      }) })],
    });
  }

  load();
}
