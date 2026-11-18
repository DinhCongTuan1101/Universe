import { h, icon, btn, avatar } from '../core/dom.js';
import { api, download } from '../core/api.js';
import { navigate } from '../core/router.js';
import { store } from '../core/store.js';
import { toast, showError, modal, confirmDialog, emptyState, errorState, loading, select, field, withLoading } from '../core/ui.js';
import { relativeTime, fmtDateTime, fileSize } from '../core/format.js';
import { renderMarkdown } from '../core/markdown.js';
import { POST_TYPES } from './share.js';

export function mount(container, { params }) {
  const id = Number(params.id);
  const me = store.get().user;
  let p = null;
  let reasons = {};
  container.append(loading());

  async function load() {
    try {
      const [post, facets] = await Promise.all([api.get(`/community/posts/${id}`), api.get('/community/facets').catch(() => ({ reasons: {} }))]);
      p = post;
      reasons = facets.reasons;
      render();
    } catch (e) {
      container.replaceChildren(errorState(e, load));
    }
  }

  function render() {
    const t = POST_TYPES[p.type];
    const stars = h('div', { class: 'rating' });
    const renderStars = () =>
      stars.replaceChildren(
        ...[1, 2, 3, 4, 5].map((v) =>
          h('button', {
            class: `star ${(p.myRating || 0) >= v ? 'on' : ''}`,
            title: p.authorId === me.id ? 'Không thể tự đánh giá' : `${v} sao`,
            disabled: p.authorId === me.id || p.status !== 'PUBLISHED',
            onclick: async () => {
              try {
                const r = await api.put(`/community/posts/${id}/rating`, { value: v });
                Object.assign(p, r);
                renderStars();
                ratingText.textContent = `${p.ratingAvg} / 5 (${p.ratingCount} lượt)`;
                toast('Cảm ơn bạn đã đánh giá');
              } catch (e) {
                showError(e);
              }
            },
          }, icon('star', { size: 20 }))
        )
      );
    const ratingText = h('span', { class: 'small muted' }, `${p.ratingAvg || 0} / 5 (${p.ratingCount} lượt)`);
    renderStars();
    const bookmarkBtn = btn(p.bookmarked ? 'Đã lưu' : 'Lưu bài', {
      icon: 'bookmark',
      size: 'sm',
      variant: p.bookmarked ? 'soft' : '',
      onClick: async () => {
        try {
          await api.put('/library/favorites', { entityType: 'POST', entityId: id, favorite: !p.bookmarked });
          p.bookmarked = !p.bookmarked;
          render();
        } catch (e) {
          showError(e);
        }
      },
    });

    const commentsBox = h('div', { class: 'col', style: { gap: '12px' } });
    container.replaceChildren(
      h('div', { class: 'breadcrumb' }, h('a', { href: '/share' }, 'UniShare'), h('span', { class: 'sep' }, '/'), h('span', { class: 'truncate' }, p.title)),
      h(
        'article',
        { class: 'card card-pad post-detail' },
        p.status !== 'PUBLISHED' ? h('div', { class: 'alert danger mb-16' }, icon('alert'), h('div', { class: 'small' }, `Bài viết đang ${p.status === 'HIDDEN' ? 'bị ẩn' : 'bị gỡ'} bởi kiểm duyệt viên.`, p.moderationNote ? ` Lý do: ${p.moderationNote}` : '')) : null,
        h('div', { class: 'row wrap mb-8' }, h('span', { class: 'badge', style: { background: `${t.color}1a`, color: t.color } }, icon(t.icon), t.label), p.subjectName ? h('span', { class: 'badge' }, p.subjectName) : null, p.topic ? h('span', { class: 'badge info' }, `#${p.topic}`) : null),
        h('h1', { class: 'mb-8' }, p.title),
        h('div', { class: 'row mb-16' }, avatar(p.author), h('div', { class: 'grow' }, h('div', { class: 'bold small' }, p.author.fullName), h('div', { class: 'tiny muted' }, [p.author.university, fmtDateTime(p.createdAt), `${p.viewCount} lượt xem`].filter(Boolean).join(' · '))), bookmarkBtn, p.canEdit ? btn('Sửa', { icon: 'edit', size: 'sm', onClick: () => navigate(`/share/${id}/edit`) }) : null, p.canEdit || p.canModerate ? btn('', { icon: 'trash', size: 'sm', title: 'Xóa', onClick: remove }) : null, !p.canEdit ? btn(p.reported ? 'Đã báo cáo' : 'Báo cáo', { icon: 'flag', size: 'sm', variant: 'ghost', disabled: p.reported, onClick: () => reportDialog('POST', id) }) : null),
        renderMarkdown(p.content),
        p.file ? h('div', { class: 'attach-card mt-16' }, icon('file-text'), h('div', { class: 'grow' }, h('div', { class: 'bold small' }, p.file.originalName), h('div', { class: 'tiny muted' }, `${p.file.extension.toUpperCase()} · ${fileSize(p.file.size)}${p.license ? ` · Giấy phép: ${p.license}` : ''}`)), btn('Tải xuống', { icon: 'download', size: 'sm', variant: 'primary', onClick: () => download(`/drive/files/${p.file.id}/download`, p.file.originalName).catch(showError) })) : null,
        p.note ? h('a', { class: 'attach-card mt-16', href: `/notes/${p.note.id}` }, h('span', { style: { fontSize: '20px' } }, p.note.icon || '📄'), h('div', { class: 'grow' }, h('div', { class: 'bold small' }, p.note.title || 'Ghi chú'), h('div', { class: 'tiny muted' }, 'Ghi chú UniNote (chỉ đọc)')), icon('external')) : null,
        p.externalUrl ? h('a', { class: 'attach-card mt-16', href: p.externalUrl, target: '_blank', rel: 'noopener noreferrer' }, icon('link'), h('div', { class: 'grow truncate small' }, p.externalUrl), icon('external')) : null,
        p.copyrightConfirmed ? h('p', { class: 'tiny muted mt-16' }, '✔ Người đăng xác nhận có quyền chia sẻ nội dung này. Nếu phát hiện vi phạm bản quyền, hãy bấm Báo cáo.') : null,
        h('div', { class: 'row mt-16', style: { borderTop: '1px solid var(--border)', paddingTop: '14px' } }, h('span', { class: 'small bold' }, 'Đánh giá:'), stars, ratingText)
      ),
      h('div', { class: 'card card-pad mt-16' }, h('h3', { class: 'mb-16' }, `Bình luận (${p.commentCount})`), commentsBox, p.status === 'PUBLISHED' ? commentForm() : null)
    );
    loadComments(commentsBox);
  }

  function commentForm() {
    const input = h('textarea', { class: 'textarea', rows: 2, placeholder: 'Viết bình luận...' });
    return h('div', { class: 'mt-16' }, input, h('div', { class: 'row mt-8' }, h('div', { class: 'spacer' }), btn('Gửi bình luận', { icon: 'send', size: 'sm', variant: 'primary', onClick: async (e) => withLoading(e.currentTarget, async () => {
      if (!input.value.trim()) return;
      try {
        await api.post(`/community/posts/${id}/comments`, { content: input.value.trim() });
        input.value = '';
        p.commentCount++;
        render();
      } catch (err) {
        showError(err);
      }
    }) })));
  }

  async function loadComments(box) {
    try {
      const list = await api.get(`/community/posts/${id}/comments`);
      box.replaceChildren(
        ...(list.length
          ? list.map((c) =>
              h(
                'div',
                { class: `comment ${c.hidden ? 'hidden-comment' : ''}` },
                avatar(c.user, 'sm'),
                h(
                  'div',
                  { class: 'grow' },
                  h('div', { class: 'row' }, h('span', { class: 'bold small' }, c.user.fullName), h('span', { class: 'tiny muted' }, relativeTime(c.createdAt)), c.hidden ? h('span', { class: 'badge danger' }, 'Đã ẩn') : null, h('div', { class: 'spacer' }), c.user.id !== me.id ? btn('', { icon: 'flag', size: 'xs', variant: 'ghost', title: 'Báo cáo', onClick: () => reportDialog('COMMENT', c.id) }) : null, c.user.id === me.id || p.canModerate ? btn('', { icon: 'trash', size: 'xs', variant: 'ghost', title: 'Xóa', onClick: async () => {
                    if (!(await confirmDialog({ title: 'Xóa bình luận?', danger: true, confirmText: 'Xóa' }))) return;
                    try {
                      await api.del(`/community/comments/${c.id}`);
                      p.commentCount--;
                      render();
                    } catch (e) {
                      showError(e);
                    }
                  } }) : null),
                  h('div', { class: 'small comment-body' }, c.content)
                )
              )
            )
          : [emptyState({ icon: 'message', title: 'Chưa có bình luận', compact: true })])
      );
    } catch (e) {
      box.replaceChildren(errorState(e));
    }
  }

  async function remove() {
    if (!(await confirmDialog({ title: 'Xóa bài viết?', message: 'Bài viết sẽ bị xóa khỏi UniShare.', danger: true, confirmText: 'Xóa' }))) return;
    try {
      await api.del(`/community/posts/${id}`);
      toast('Đã xóa bài viết');
      navigate('/share');
    } catch (e) {
      showError(e);
    }
  }

  function reportDialog(targetType, targetId) {
    const reason = select(Object.entries(reasons).map(([v, l]) => ({ value: v, label: l })), 'spam');
    const details = h('textarea', { class: 'textarea', rows: 3, placeholder: 'Mô tả thêm (không bắt buộc)' });
    modal({
      title: targetType === 'POST' ? 'Báo cáo bài viết' : 'Báo cáo bình luận',
      icon: 'flag',
      body: [field('Lý do', reason), field('Chi tiết', details), h('p', { class: 'tiny muted' }, 'Báo cáo được gửi tới kiểm duyệt viên. Danh tính của bạn không hiển thị với người đăng.')],
      footer: (close) => [btn('Hủy', { onClick: () => close() }), btn('Gửi báo cáo', { variant: 'danger', onClick: async (e) => withLoading(e.currentTarget, async () => {
        try {
          await api.post('/community/reports', { targetType, targetId, reason: reason.value, details: details.value });
          toast('Đã gửi báo cáo – cảm ơn bạn');
          close();
          if (targetType === 'POST') {
            p.reported = true;
            render();
          }
        } catch (err) {
          showError(err);
        }
      }) })],
    });
  }

  load();
}
