/** Trang quản trị (Admin): người dùng & vai trò, cấu hình tiết học (Class Periods). */
import { h, icon, btn, debounce } from '../core/dom.js';
import { api } from '../core/api.js';
import { store } from '../core/store.js';
import { toast, showError, confirmDialog, errorState, skeleton, select, withLoading } from '../core/ui.js';
import { fmtDateTime } from '../core/format.js';

export function mount(container) {
  const me = store.get().user;
  const usersBox = h('div', {}, skeleton(5));
  const periodsBox = h('div', {}, skeleton(5));
  const aiBox = h('div', {}, skeleton(2));
  const search = h('input', { class: 'input sm', placeholder: 'Tìm email hoặc tên...', style: { width: '240px' } });
  search.addEventListener('input', debounce(loadUsers, 300));

  container.append(
    h('div', { class: 'page-header' }, h('div', { class: 'titles' }, h('h1', {}, 'Quản trị hệ thống'), h('p', {}, 'Quản lý người dùng, phân quyền Admin/Moderator/Student và bảng giờ học theo tiết.'))),
    h('section', { class: 'card mb-16' }, h('div', { class: 'card-header' }, h('div', { class: 'icon-box sm' }, icon('users')), h('h3', {}, 'Người dùng'), h('div', { class: 'input-icon' }, icon('search'), search)), h('div', { class: 'card-body' }, usersBox)),
    h('section', { class: 'card mb-16' }, h('div', { class: 'card-header' }, h('div', { class: 'icon-box sm' }, icon('sparkles')), h('h3', {}, 'Kết nối AI (UniAI)')), h('div', { class: 'card-body' }, aiBox)),
    h('section', { class: 'card' }, h('div', { class: 'card-header' }, h('div', { class: 'icon-box sm' }, icon('clock')), h('h3', {}, 'Cấu hình tiết học (Class Periods)')), h('div', { class: 'card-body' }, periodsBox))
  );

  async function loadUsers() {
    try {
      const r = await api.get('/users', { q: search.value.trim() || undefined, pageSize: 50 });
      usersBox.replaceChildren(
        h(
          'div',
          { class: 'table-wrap' },
          h(
            'table',
            { class: 'table' },
            h('thead', {}, h('tr', {}, h('th', {}, 'Người dùng'), h('th', {}, 'Vai trò'), h('th', { class: 'hide-sm' }, 'Đăng nhập gần nhất'), h('th', {}, 'Trạng thái'))),
            h(
              'tbody',
              {},
              r.items.map((u) =>
                h(
                  'tr',
                  {},
                  h('td', {}, h('div', { class: 'bold small' }, u.fullName, u.isDemo ? h('span', { class: 'badge warning', style: { marginLeft: '6px' } }, 'Demo') : null), h('div', { class: 'tiny muted' }, u.email)),
                  h('td', {}, select([{ value: 'STUDENT', label: 'Student' }, { value: 'MODERATOR', label: 'Moderator' }, { value: 'ADMIN', label: 'Admin' }], u.role, { size: 'sm', disabled: u.id === me.id, style: { width: '130px' }, onchange: (e) => update(u, { role: e.target.value }) })),
                  h('td', { class: 'small muted hide-sm' }, u.lastLoginAt ? fmtDateTime(u.lastLoginAt) : '—'),
                  h('td', {}, u.id === me.id ? h('span', { class: 'badge success' }, 'Bạn') : h('label', { class: 'switch' }, h('input', { type: 'checkbox', checked: u.isActive, onchange: async (e) => {
                    if (!e.target.checked && !(await confirmDialog({ title: `Khóa tài khoản ${u.email}?`, message: 'Người dùng sẽ bị đăng xuất khỏi mọi thiết bị.', danger: true, confirmText: 'Khóa' }))) return (e.target.checked = true);
                    update(u, { isActive: e.target.checked });
                  } }), h('span', { class: 'small' }, u.isActive ? 'Hoạt động' : 'Đã khóa')))
                )
              )
            )
          )
        ),
        h('p', { class: 'tiny muted mt-8' }, `${r.total} người dùng`)
      );
    } catch (e) {
      usersBox.replaceChildren(errorState(e, loadUsers));
    }
  }
  async function update(u, data) {
    try {
      await api.patch(`/users/${u.id}`, data);
      toast('Đã cập nhật người dùng');
      loadUsers();
    } catch (e) {
      showError(e);
      loadUsers();
    }
  }

  async function loadPeriods() {
    try {
      const periods = await api.get('/system/class-periods');
      const rows = periods.map((p) => ({ ...p }));
      const tbody = h('tbody');
      const render = () =>
        tbody.replaceChildren(
          ...rows.map((p, i) =>
            h(
              'tr',
              {},
              h('td', { class: 'bold' }, `Tiết ${p.periodNumber}`),
              h('td', {}, select([{ value: 'MORNING', label: 'Sáng' }, { value: 'AFTERNOON', label: 'Chiều' }, { value: 'EVENING', label: 'Tối' }], p.shift, { size: 'sm', onchange: (e) => (p.shift = e.target.value) })),
              h('td', {}, h('input', { class: 'input sm', type: 'time', value: p.startTime || '', onchange: (e) => (p.startTime = e.target.value || null) })),
              h('td', {}, h('input', { class: 'input sm', type: 'time', value: p.endTime || '', onchange: (e) => (p.endTime = e.target.value || null) })),
              h('td', {}, i === rows.length - 1 && rows.length > 1 ? btn('', { icon: 'x', size: 'xs', variant: 'ghost', title: 'Bỏ tiết cuối', onClick: () => (rows.pop(), render()) }) : null)
            )
          )
        );
      render();
      periodsBox.replaceChildren(
        h('div', { class: 'alert info mb-16' }, icon('info'), h('div', { class: 'small' }, 'Chỉ nhập giờ khi đã có bảng giờ chính thức của trường. Để trống => lịch học chỉ hiển thị theo số tiết (UniVerse không tự suy đoán giờ học).')),
        h('div', { class: 'table-wrap' }, h('table', { class: 'table' }, h('thead', {}, h('tr', {}, h('th', {}, 'Tiết'), h('th', {}, 'Buổi'), h('th', {}, 'Bắt đầu'), h('th', {}, 'Kết thúc'), h('th', {}, ''))), tbody)),
        h(
          'div',
          { class: 'row mt-16' },
          btn('Thêm tiết', { icon: 'plus', size: 'sm', disabled: rows.length >= 20, onClick: () => (rows.push({ periodNumber: (rows.at(-1)?.periodNumber || 0) + 1, shift: rows.at(-1)?.shift || 'EVENING', startTime: null, endTime: null }), render()) }),
          h('div', { class: 'spacer' }),
          btn('Lưu cấu hình', { icon: 'check', variant: 'primary', onClick: async (e) => withLoading(e.currentTarget, async () => {
            try {
              await api.put('/system/class-periods', { periods: rows.map(({ periodNumber, shift, startTime, endTime }) => ({ periodNumber, shift, startTime: startTime || null, endTime: endTime || null })) });
              toast('Đã lưu cấu hình tiết học');
              loadPeriods();
            } catch (err) {
              showError(err);
            }
          }) })
        )
      );
    } catch (e) {
      periodsBox.replaceChildren(errorState(e, loadPeriods));
    }
  }

  async function loadAi() {
    try {
      const s = await api.get('/system/ai-status');
      const out = h('div', { class: 'mt-16' });
      const testBtn = btn('Kiểm tra kết nối AI', {
        icon: 'zap',
        variant: 'primary',
        size: 'sm',
        disabled: !s.configured,
        onClick: async (e) =>
          withLoading(e.currentTarget, async () => {
            try {
              const r = await api.post('/system/ai-test');
              out.replaceChildren(
                h('div', { class: `alert ${r.ok ? 'success' : 'danger'} mb-8` }, icon(r.ok ? 'check-circle' : 'alert'), h('div', { class: 'small bold' }, r.ok ? 'AI hoạt động bình thường' : 'Kết nối AI còn lỗi – xem chi tiết bên dưới')),
                ...r.steps.map((st) =>
                  h(
                    'div',
                    { class: 'card card-pad mb-8' },
                    h('div', { class: 'row' }, h('span', { class: `badge ${st.ok ? 'success' : 'danger'}` }, st.ok ? 'OK' : 'Lỗi'), h('span', { class: 'small bold grow' }, st.name), h('span', { class: 'tiny muted' }, `${st.ms} ms`)),
                    st.ok
                      ? h('div', { class: 'tiny muted mt-8', style: { wordBreak: 'break-word' } }, st.detail?.sample ? `${st.detail.count} model khả dụng${st.detail.chatModelListed ? '' : ' – model chat hiện tại KHÔNG có trong danh sách'}: ${st.detail.sample.slice(0, 40).join(', ')}` : JSON.stringify(st.detail))
                      : h('div', { class: 'small mt-8' }, st.message, st.providerMessage ? h('div', { class: 'tiny muted mt-8' }, `Provider (HTTP ${st.providerStatus ?? '-'}): ${st.providerMessage}`) : null)
                  )
                )
              );
            } catch (err) {
              showError(err);
            }
          }),
      });
      aiBox.replaceChildren(
        s.configured
          ? h('div', { class: 'small' }, h('div', {}, h('b', {}, 'Provider: '), s.provider), h('div', {}, h('b', {}, 'Model chat: '), s.chatModel), h('div', {}, h('b', {}, 'Embedding: '), s.embeddings ? 'bật' : 'tắt'), h('div', {}, h('b', {}, 'Hạn mức: '), `${s.dailyLimit} lượt/người/ngày`))
          : h('div', { class: 'alert warning' }, icon('alert'), h('div', { class: 'small' }, h('b', {}, 'AI chưa được cấu hình: '), s.problem || 'thiếu cấu hình', '. Điền AI_PROVIDER và API key trong file .env rồi khởi động lại server.')),
        h('div', { class: 'row mt-16' }, testBtn, h('span', { class: 'tiny muted' }, 'Gửi 1 câu hỏi ngắn + 1 embedding thử tới provider (tính vào chi phí rất nhỏ).')),
        out
      );
    } catch (e) {
      aiBox.replaceChildren(errorState(e, loadAi));
    }
  }

  loadUsers();
  loadAi();
  loadPeriods();
}
