import { h, icon, btn } from '../core/dom.js';
import { api, setCsrf } from '../core/api.js';
import { store, applyTheme } from '../core/store.js';
import { navigate, query } from '../core/router.js';
import { field, applyFieldErrors, withLoading, toast } from '../core/ui.js';

export function mount(container, { meta }) {
  const isLogin = meta.mode === 'login';
  const err = h('div', { class: 'alert danger', hidden: true });

  const email = h('input', { class: 'input', name: 'email', type: 'email', autocomplete: 'email', required: true, placeholder: 'ban@truong.edu.vn', autofocus: true });
  const password = h('input', { class: 'input', name: 'password', type: 'password', autocomplete: isLogin ? 'current-password' : 'new-password', required: true, placeholder: isLogin ? 'Mật khẩu' : 'Tối thiểu 8 ký tự, có chữ và số' });
  const fullName = h('input', { class: 'input', name: 'fullName', autocomplete: 'name', required: true, placeholder: 'Nguyễn Văn A' });
  const toggle = h('button', { type: 'button', class: 'btn ghost sm', style: { position: 'absolute', right: '4px', top: '4px' }, onclick: () => (password.type = password.type === 'password' ? 'text' : 'password') }, icon('eye'));
  const submit = btn(isLogin ? 'Đăng nhập' : 'Tạo tài khoản', { variant: 'primary', size: 'lg', type: 'submit' });
  submit.classList.add('w-full');

  const form = h(
    'form',
    {
      novalidate: true,
      onsubmit: async (e) => {
        e.preventDefault();
        err.hidden = true;
        const body = { email: email.value.trim(), password: password.value };
        if (!isLogin) body.fullName = fullName.value.trim();
        await withLoading(submit, async () => {
          try {
            const data = await api.post(isLogin ? '/auth/login' : '/auth/register', body);
            setCsrf(data.csrfToken);
            store.set({ user: data.user });
            applyTheme(data.user.theme);
            toast(isLogin ? `Chào mừng trở lại, ${data.user.fullName}!` : 'Tạo tài khoản thành công!');
            const next = query().next;
            navigate(next && next.startsWith('/') && !next.startsWith('//') ? next : '/', { replace: true });
          } catch (ex) {
            if (!applyFieldErrors(form, ex)) {
              err.textContent = ex.message;
              err.hidden = false;
            }
          }
        });
      },
    },
    err,
    !isLogin ? field('Họ và tên', fullName) : null,
    field('Email', email),
    field('Mật khẩu', h('div', { style: { position: 'relative' } }, password, toggle)),
    submit
  );

  const features = [
    ['calendar', 'Nhập TKB KMA'],
    ['folder', 'Lưu trữ tài liệu'],
    ['note', 'Ghi chú khối'],
    ['task', 'Kanban & deadline'],
    ['sparkles', 'Trợ lý AI'],
    ['users', 'Học nhóm'],
  ];

  container.append(
    h(
      'div',
      { class: 'auth-page' },
      h(
        'section',
        { class: 'auth-hero' },
        h('div', { class: 'row gap-12' }, h('span', { class: 'brand-logo' }, icon('logo')), h('span', { class: 'brand-name', style: { color: '#fff' } }, 'UniVerse')),
        h('div', {}, h('h1', {}, 'Mọi công cụ học tập của sinh viên, trong một không gian.'), h('p', {}, 'Thời khóa biểu, tài liệu, ghi chú, bảng tính, công việc, AI, quiz, nhóm học tập và cộng đồng chia sẻ – liên kết với nhau.')),
        h('div', { class: 'auth-features' }, features.map(([ic, t]) => h('div', { class: 'auth-feature' }, icon(ic), t)))
      ),
      h(
        'section',
        { class: 'auth-form-wrap' },
        h(
          'div',
          { class: 'auth-card' },
          h('h2', {}, isLogin ? 'Đăng nhập' : 'Tạo tài khoản'),
          h('p', { class: 'muted mb-16' }, isLogin ? 'Tiếp tục hành trình học tập của bạn.' : 'Miễn phí, chỉ mất 30 giây.'),
          form,
          h('p', { class: 'center muted mt-16' }, isLogin ? 'Chưa có tài khoản? ' : 'Đã có tài khoản? ', h('a', { href: isLogin ? '/register' : '/login' }, isLogin ? 'Đăng ký ngay' : 'Đăng nhập'))
        )
      )
    )
  );
}
