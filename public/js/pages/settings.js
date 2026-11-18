import { h, icon, btn, avatar } from '../core/dom.js';
import { api } from '../core/api.js';
import { store, applyTheme } from '../core/store.js';
import { toast, showError, confirmDialog, field, withLoading, applyFieldErrors, errorState, skeleton } from '../core/ui.js';
import { relativeTime, fileSize } from '../core/format.js';

export function mount(container) {
  const user = () => store.get().user;
  const setUser = (u) => store.set({ user: { ...user(), ...u } });

  // ---------------- Hồ sơ
  const avatarBox = h('div');
  const renderAvatar = () => avatarBox.replaceChildren(avatar(user(), 'lg'));
  renderAvatar();
  const avatarInput = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp,image/gif', hidden: true });
  avatarInput.addEventListener('change', async () => {
    const f = avatarInput.files[0];
    avatarInput.value = '';
    if (!f) return;
    if (f.size > 2 * 1024 * 1024) return toast.error('Ảnh tối đa 2 MB');
    const fd = new FormData();
    fd.append('avatar', f);
    try {
      const r = await api.upload('/users/me/avatar', fd);
      setUser(r.data);
      renderAvatar();
      toast('Đã cập nhật ảnh đại diện');
    } catch (e) {
      showError(e);
    }
  });
  const u = user();
  const pf = {
    fullName: h('input', { class: 'input', name: 'fullName', value: u.fullName }),
    university: h('input', { class: 'input', name: 'university', value: u.university || '', placeholder: 'vd: Học viện Kỹ thuật Mật mã' }),
    major: h('input', { class: 'input', name: 'major', value: u.major || '' }),
    className: h('input', { class: 'input', name: 'className', value: u.className || '' }),
    studentCode: h('input', { class: 'input', name: 'studentCode', value: u.studentCode || '', placeholder: 'Không bắt buộc' }),
    bio: h('textarea', { class: 'textarea', name: 'bio', rows: 2, value: u.bio || '' }),
  };
  const profileForm = h('form', { class: 'form-grid', onsubmit: (e) => e.preventDefault() }, field('Họ và tên', pf.fullName), field('Email', h('input', { class: 'input', value: u.email, disabled: true }), { hint: 'Email dùng để đăng nhập, không thể thay đổi.' }), field('Trường đại học', pf.university), field('Ngành học', pf.major), field('Lớp', pf.className), field('Mã sinh viên', pf.studentCode), field('Giới thiệu', pf.bio, { className: 'span-2' }));
  const saveProfile = btn('Lưu hồ sơ', { variant: 'primary', icon: 'check' });
  saveProfile.addEventListener('click', () =>
    withLoading(saveProfile, async () => {
      try {
        const body = Object.fromEntries(Object.entries(pf).map(([k, el]) => [k, el.value]));
        setUser(await api.patch('/users/me', body));
        toast('Đã cập nhật hồ sơ');
      } catch (e) {
        if (!applyFieldErrors(profileForm, e)) showError(e);
      }
    })
  );

  // ---------------- Giao diện
  const themeBtns = h('div', { class: 'btn-group' });
  const renderTheme = () =>
    themeBtns.replaceChildren(
      ...[
        ['light', 'Sáng', 'sun'],
        ['dark', 'Tối', 'moon'],
        ['system', 'Hệ thống', 'monitor'],
      ].map(([v, l, ic]) =>
        h('button', { class: `btn sm ${user().theme === v ? 'active' : ''}`, onclick: async () => {
          applyTheme(v);
          try {
            setUser(await api.patch('/users/me/settings', { theme: v }));
            renderTheme();
          } catch (e) {
            showError(e);
          }
        } }, icon(ic), l)
      )
    );
  renderTheme();

  // ---------------- Thông báo
  const ns = { taskReminders: true, groupActivity: true, communityActivity: true, documentProcessing: true, ...(u.notificationSettings || {}) };
  const notifLabels = { taskReminders: 'Nhắc nhở công việc', groupActivity: 'Hoạt động nhóm (giao việc, lời mời, bình luận)', communityActivity: 'UniShare (bình luận, kiểm duyệt)', documentProcessing: 'Kết quả xử lý tài liệu' };
  const notifBox = h(
    'div',
    { class: 'col' },
    Object.entries(notifLabels).map(([k, l]) =>
      h('label', { class: 'switch' }, h('input', { type: 'checkbox', checked: ns[k], onchange: async (e) => {
        try {
          setUser(await api.patch('/users/me/settings', { notificationSettings: { [k]: e.target.checked } }));
          toast('Đã lưu cài đặt thông báo', 'info');
        } catch (err) {
          showError(err);
          e.target.checked = !e.target.checked;
        }
      } }), h('span', { class: 'small' }, l))
    )
  );

  // ---------------- Mật khẩu
  const pw = { currentPassword: h('input', { class: 'input', type: 'password', name: 'currentPassword', autocomplete: 'current-password' }), newPassword: h('input', { class: 'input', type: 'password', name: 'newPassword', autocomplete: 'new-password' }), confirm: h('input', { class: 'input', type: 'password', autocomplete: 'new-password' }) };
  const pwForm = h('form', { onsubmit: (e) => e.preventDefault() }, field('Mật khẩu hiện tại', pw.currentPassword), field('Mật khẩu mới', pw.newPassword, { hint: 'Tối thiểu 8 ký tự, gồm chữ và số' }), field('Nhập lại mật khẩu mới', pw.confirm));
  const pwBtn = btn('Đổi mật khẩu', { icon: 'lock', variant: 'primary' });
  pwBtn.addEventListener('click', () =>
    withLoading(pwBtn, async () => {
      if (pw.newPassword.value !== pw.confirm.value) return toast.error('Mật khẩu nhập lại không khớp');
      try {
        const r = await api.post('/auth/change-password', { currentPassword: pw.currentPassword.value, newPassword: pw.newPassword.value });
        Object.values(pw).forEach((i) => (i.value = ''));
        toast(`Đổi mật khẩu thành công${r.revokedSessions ? ` – đã đăng xuất ${r.revokedSessions} thiết bị khác` : ''}`);
        loadSessions();
      } catch (e) {
        if (!applyFieldErrors(pwForm, e)) showError(e);
      }
    })
  );

  // ---------------- Phiên đăng nhập
  const sessionsBox = h('div', {}, skeleton(2));
  async function loadSessions() {
    try {
      const list = await api.get('/auth/sessions');
      sessionsBox.replaceChildren(
        h(
          'div',
          { class: 'list' },
          list.map((s) =>
            h(
              'div',
              { class: 'list-item', style: { cursor: 'default' } },
              h('div', { class: 'icon-box sm' }, icon('monitor')),
              h('div', { class: 'grow', style: { minWidth: 0 } }, h('div', { class: 'small bold truncate' }, describeUA(s.userAgent), s.current ? h('span', { class: 'badge success', style: { marginLeft: '6px' } }, 'Thiết bị này') : null), h('div', { class: 'tiny muted' }, `IP ${s.ip || '—'} · hoạt động ${relativeTime(s.lastSeenAt)}`)),
              !s.current ? btn('Đăng xuất', { size: 'xs', onClick: async () => {
                if (!(await confirmDialog({ title: 'Đăng xuất thiết bị này?', confirmText: 'Đăng xuất', danger: true }))) return;
                try {
                  await api.del(`/auth/sessions/${s.id}`);
                  loadSessions();
                } catch (e) {
                  showError(e);
                }
              } }) : null
            )
          )
        )
      );
    } catch (e) {
      sessionsBox.replaceChildren(errorState(e, loadSessions));
    }
  }

  // ---------------- Dung lượng & AI
  const usageBox = h('div', {}, skeleton(2));
  Promise.all([api.get('/users/me/storage'), api.get('/ai/status'), api.get('/ai/usage').catch(() => null)])
    .then(([s, ai, au]) => {
      const pct = Math.min(100, Math.round((s.used / s.quota) * 100));
      usageBox.replaceChildren(
        h('div', { class: 'small mb-8' }, `UniDrive: ${fileSize(s.used)} / ${fileSize(s.quota)} (${s.fileCount} file, gồm cả thùng rác)`),
        h('div', { class: 'progress mb-16' }, h('span', { style: { width: `${pct}%` } })),
        h('div', { class: 'small' }, ai.configured ? `UniAI: ${ai.provider} · ${ai.chatModel}${ai.embeddings ? ' · embedding bật' : ''}` : 'UniAI: chưa được cấu hình trên máy chủ'),
        au ? h('div', { class: 'small muted' }, `Đã dùng hôm nay ${au.today}/${au.dailyLimit} lượt · 30 ngày: ${au.last30Days.requests} lượt, ${au.last30Days.totalTokens.toLocaleString('vi-VN')} token`) : null
      );
    })
    .catch((e) => usageBox.replaceChildren(errorState(e)));

  const section = (title, ic, ...content) => h('section', { class: 'card mb-16' }, h('div', { class: 'card-header' }, h('div', { class: 'icon-box sm' }, icon(ic)), h('h3', {}, title)), h('div', { class: 'card-body' }, ...content));

  container.append(
    h('div', { class: 'page-header' }, h('div', { class: 'titles' }, h('h1', {}, 'Settings'), h('p', {}, 'Hồ sơ cá nhân, giao diện, thông báo và bảo mật tài khoản.'))),
    h(
      'div',
      { class: 'settings-layout' },
      h(
        'div',
        {},
        section('Hồ sơ cá nhân', 'user', h('div', { class: 'row gap-16 mb-16' }, avatarBox, h('div', { class: 'col' }, h('div', { class: 'row' }, btn('Đổi ảnh', { size: 'sm', icon: 'upload', onClick: () => avatarInput.click() }), user().avatarPath ? btn('Xóa ảnh', { size: 'sm', variant: 'ghost', onClick: async () => {
          try {
            setUser(await api.del('/users/me/avatar'));
            renderAvatar();
          } catch (e) {
            showError(e);
          }
        } }) : null), h('span', { class: 'tiny muted' }, 'PNG, JPG, WEBP, GIF – tối đa 2 MB')), avatarInput), profileForm, saveProfile),
        section('Đổi mật khẩu', 'lock', pwForm, pwBtn)
      ),
      h('div', {}, section('Giao diện', 'sun', h('div', { class: 'small muted mb-8' }, 'Chế độ hiển thị'), themeBtns), section('Thông báo', 'bell', notifBox), section('Phiên đăng nhập', 'shield', sessionsBox), section('Dung lượng & AI', 'layers', usageBox))
    )
  );
  loadSessions();
}

function describeUA(ua = '') {
  const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Trình duyệt';
  const os = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Mac OS/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : '';
  return `${browser}${os ? ` trên ${os}` : ''}`;
}
