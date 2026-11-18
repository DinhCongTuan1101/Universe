import { h, icon, btn } from '../core/dom.js';
import { api } from '../core/api.js';
import { navigate, query } from '../core/router.js';
import { toast, showError, modal, emptyState, errorState, skeletonCards, field, withLoading } from '../core/ui.js';
import { relativeTime } from '../core/format.js';

const COLORS = ['#2563EB', '#0891B2', '#10B981', '#F59E0B', '#EC4899', '#0EA5E9', '#EF4444', '#14B8A6'];

export function mount(container) {
  const q = query();
  const body = h('div', {}, skeletonCards(4));
  container.append(
    h(
      'div',
      { class: 'page-header' },
      h('div', { class: 'titles' }, h('h1', {}, 'UniGroup'), h('p', {}, 'Không gian làm việc nhóm: giao nhiệm vụ, chia sẻ tài liệu & ghi chú, thảo luận.')),
      h('div', { class: 'actions' }, btn('Tham gia bằng mã', { icon: 'key', onClick: joinDialog }), btn('Tạo nhóm', { icon: 'plus', variant: 'primary', onClick: createDialog }))
    ),
    body
  );

  async function load() {
    try {
      const { groups, invites } = await api.get('/groups');
      body.replaceChildren(
        invites.length
          ? h(
              'div',
              { class: 'card card-pad mb-16', id: 'invites' },
              h('div', { class: 'section-title' }, icon('inbox', { size: 14 }), `Lời mời (${invites.length})`),
              h(
                'div',
                { class: 'list' },
                invites.map((inv) =>
                  h(
                    'div',
                    { class: 'list-item', style: { cursor: 'default' } },
                    h('div', { class: 'icon-box sm', style: { background: `${inv.group.color}22`, color: inv.group.color } }, icon('users')),
                    h('div', { class: 'grow' }, h('div', { class: 'bold small' }, inv.group.name), h('div', { class: 'tiny muted' }, `${inv.inviter.fullName} mời bạn · ${relativeTime(inv.createdAt)}`)),
                    btn('Từ chối', { size: 'sm', onClick: () => respond(inv, false) }),
                    btn('Tham gia', { size: 'sm', variant: 'primary', onClick: () => respond(inv, true) })
                  )
                )
              )
            )
          : null,
        groups.length
          ? h(
              'div',
              { class: 'grid auto' },
              groups.map((g) =>
                h(
                  'div',
                  { class: 'card hoverable card-pad', onclick: () => navigate(`/groups/${g.id}`) },
                  h('div', { class: 'row' }, h('div', { class: 'icon-box', style: { background: `${g.color}22`, color: g.color } }, icon('users')), h('div', { class: 'grow', style: { minWidth: 0 } }, h('div', { class: 'bold truncate' }, g.name), h('div', { class: 'tiny muted' }, `${g._count.members} thành viên · ${g._count.tasks} nhiệm vụ`)), g.myRole === 'LEADER' ? h('span', { class: 'badge violet' }, 'Trưởng nhóm') : null),
                  g.description ? h('p', { class: 'small muted mt-8', style: { display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' } }, g.description) : null,
                  h('div', { class: 'tiny faint mt-8' }, `Cập nhật ${relativeTime(g.updatedAt)}`)
                )
              )
            )
          : emptyState({ icon: 'users', title: 'Bạn chưa tham gia nhóm nào', text: 'Tạo nhóm học tập cho đồ án, môn học hoặc tham gia bằng mã mời từ bạn bè.', action: h('div', { class: 'row' }, btn('Tham gia bằng mã', { icon: 'key', onClick: joinDialog }), btn('Tạo nhóm', { icon: 'plus', variant: 'primary', onClick: createDialog })) })
      );
      if (q.tab === 'invites') document.getElementById('invites')?.scrollIntoView({ behavior: 'smooth' });
    } catch (e) {
      body.replaceChildren(errorState(e, load));
    }
  }

  async function respond(inv, accept) {
    try {
      const r = await api.post(`/groups/invites/${inv.id}/respond`, { accept });
      toast(accept ? 'Đã tham gia nhóm' : 'Đã từ chối lời mời');
      accept ? navigate(`/groups/${r.groupId}`) : load();
    } catch (e) {
      showError(e);
    }
  }

  function createDialog() {
    let color = COLORS[0];
    const name = h('input', { class: 'input', placeholder: 'vd: Nhóm đồ án Cơ sở dữ liệu', autofocus: true });
    const desc = h('textarea', { class: 'textarea', rows: 3, placeholder: 'Mục tiêu, môn học, thời hạn...' });
    const swatches = h('div', { class: 'row' }, COLORS.map((c) => h('button', { type: 'button', class: `swatch ${c === color ? 'active' : ''}`, style: { background: c }, 'aria-label': c, onclick: (e) => ((color = c), swatches.querySelectorAll('.swatch').forEach((s) => s.classList.toggle('active', s === e.currentTarget))) })));
    modal({
      title: 'Tạo nhóm học tập',
      body: [field('Tên nhóm *', name), field('Mô tả', desc), field('Màu nhóm', swatches)],
      footer: (close) => [
        btn('Hủy', { onClick: () => close() }),
        btn('Tạo nhóm', {
          variant: 'primary',
          onClick: async (e) => {
            if (name.value.trim().length < 2) return toast.error('Tên nhóm tối thiểu 2 ký tự');
            await withLoading(e.currentTarget, async () => {
              try {
                const g = await api.post('/groups', { name: name.value.trim(), description: desc.value, color });
                close();
                toast('Đã tạo nhóm – chia sẻ mã tham gia để mời thành viên');
                navigate(`/groups/${g.id}`);
              } catch (err) {
                showError(err);
              }
            });
          },
        }),
      ],
    });
  }

  function joinDialog() {
    const code = h('input', { class: 'input mono', placeholder: 'VD: AB3K9XQ2', maxlength: 12, style: { textTransform: 'uppercase', letterSpacing: '0.15em' }, autofocus: true });
    modal({
      title: 'Tham gia nhóm',
      body: field('Mã tham gia (do trưởng nhóm cung cấp)', code),
      footer: (close) => [
        btn('Hủy', { onClick: () => close() }),
        btn('Tham gia', {
          variant: 'primary',
          onClick: async (e) =>
            withLoading(e.currentTarget, async () => {
              try {
                const g = await api.post('/groups/join', { code: code.value.trim().toUpperCase() });
                close();
                toast(`Đã tham gia "${g.name}"`);
                navigate(`/groups/${g.id}`);
              } catch (err) {
                showError(err);
              }
            }),
        }),
      ],
    });
  }

  load();
  if (q.new) createDialog();
}
