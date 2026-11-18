import { h, icon, btn } from '../core/dom.js';
import { api } from '../core/api.js';
import { navigate, query } from '../core/router.js';
import { toast, showError, errorState, loading, select, field, withLoading, applyFieldErrors } from '../core/ui.js';
import { renderMarkdown } from '../core/markdown.js';
import { POST_TYPES } from './share.js';

const LICENSES = ['', 'CC BY 4.0', 'CC BY-SA 4.0', 'CC BY-NC 4.0', 'Tác giả giữ bản quyền – chỉ dùng cho học tập', 'Phạm vi công cộng'];

export async function mount(container, { params }) {
  const editId = params.id ? Number(params.id) : null;
  const q = query();
  container.append(loading());
  let post = null;
  let files = [];
  let notes = [];
  let subjects = [];
  try {
    [files, notes, subjects] = await Promise.all([
      api.get('/drive', { view: 'my', sort: 'date' }).then((d) => d.files).catch(() => []),
      api.get('/notes').catch(() => []),
      api.get('/schedules/subjects/options').catch(() => []),
    ]);
    if (editId) post = await api.get(`/community/posts/${editId}`);
  } catch (e) {
    container.replaceChildren(errorState(e));
    return;
  }
  const v = post || { type: q.noteId ? 'NOTE' : q.fileId ? 'DOCUMENT' : 'ARTICLE', title: '', content: '', subjectName: '', topic: '', fileId: q.fileId ? Number(q.fileId) : null, noteId: q.noteId ? Number(q.noteId) : null, externalUrl: '', license: '', copyrightConfirmed: false };

  const f = {
    type: select(Object.entries(POST_TYPES).map(([k, t]) => ({ value: k, label: t.label })), v.type, { name: 'type' }),
    title: h('input', { class: 'input', name: 'title', value: v.title, maxlength: 191, placeholder: 'Tiêu đề rõ ràng, vd: Tổng hợp công thức Xác suất thống kê chương 2' }),
    content: h('textarea', { class: 'textarea', name: 'content', rows: 14, value: v.content, placeholder: 'Nội dung (hỗ trợ Markdown: # tiêu đề, **đậm**, - danh sách, ```code```)...' }),
    subjectName: h('input', { class: 'input', name: 'subjectName', value: v.subjectName || '', list: 'subject-list', placeholder: 'vd: Cấu trúc dữ liệu và giải thuật' }),
    topic: h('input', { class: 'input', name: 'topic', value: v.topic || '', placeholder: 'vd: Đồ thị' }),
    fileId: select([{ value: '', label: '— Không đính kèm —' }, ...files.map((x) => ({ value: x.id, label: x.originalName }))], v.fileId || v.file?.id || '', { name: 'fileId' }),
    noteId: select([{ value: '', label: '— Không đính kèm —' }, ...notes.map((n) => ({ value: n.id, label: `${n.icon || '📄'} ${n.title || 'Không tiêu đề'}` }))], v.noteId || v.note?.id || '', { name: 'noteId' }),
    externalUrl: h('input', { class: 'input', name: 'externalUrl', value: v.externalUrl || '', placeholder: 'https://...' }),
    license: select(LICENSES.map((l) => ({ value: l, label: l || '— Chọn giấy phép —' })), v.license || '', { name: 'license' }),
    copyright: h('input', { type: 'checkbox', checked: v.copyrightConfirmed }),
  };
  const preview = h('div', { class: 'card card-pad', style: { minHeight: '200px' } });
  const updatePreview = () => preview.replaceChildren(f.content.value.trim() ? renderMarkdown(f.content.value) : h('p', { class: 'muted small' }, 'Xem trước nội dung sẽ hiển thị ở đây.'));
  f.content.addEventListener('input', updatePreview);
  updatePreview();
  const datalist = h('datalist', { id: 'subject-list' }, subjects.map((s) => h('option', { value: s.name })));

  const form = h(
    'form',
    { onsubmit: (e) => e.preventDefault() },
    h('div', { class: 'form-grid' }, field('Loại nội dung', f.type), field('Môn học', f.subjectName), field('Tiêu đề *', f.title, { className: 'span-2' }), field('Chủ đề', f.topic), field('Giấy phép', f.license)),
    field('Nội dung *', f.content),
    h('div', { class: 'form-grid' }, field('Đính kèm tài liệu (UniDrive)', f.fileId), field('Đính kèm ghi chú (UniNote)', f.noteId), field('Liên kết ngoài', f.externalUrl, { className: 'span-2' })),
    h('div', { class: 'alert warning' }, icon('shield'), h('label', { class: 'checkbox small', style: { alignItems: 'flex-start' } }, f.copyright, h('span', {}, 'Tôi xác nhận có quyền chia sẻ nội dung/tài liệu này (là tác giả hoặc được phép), không vi phạm bản quyền và quy định của trường. ', h('b', {}, 'Bắt buộc'), ' khi đính kèm tài liệu hoặc đăng đề cương.'))),
    datalist
  );
  const submit = btn(editId ? 'Lưu thay đổi' : 'Đăng bài', { icon: 'send', variant: 'primary', size: 'lg' });
  submit.addEventListener('click', () =>
    withLoading(submit, async () => {
      const body = {
        type: f.type.value,
        title: f.title.value.trim(),
        content: f.content.value.trim(),
        subjectName: f.subjectName.value,
        topic: f.topic.value,
        fileId: f.fileId.value ? Number(f.fileId.value) : null,
        noteId: f.noteId.value ? Number(f.noteId.value) : null,
        externalUrl: f.externalUrl.value.trim(),
        license: f.license.value,
        copyrightConfirmed: f.copyright.checked,
      };
      try {
        const r = editId ? await api.patch(`/community/posts/${editId}`, body) : await api.post('/community/posts', body);
        toast(editId ? 'Đã cập nhật bài viết' : 'Đã đăng bài');
        navigate(`/share/${r.id}`, { replace: true });
      } catch (e) {
        if (!applyFieldErrors(form, e)) showError(e);
        else showError(e);
      }
    })
  );

  container.replaceChildren(
    h('div', { class: 'breadcrumb' }, h('a', { href: '/share' }, 'UniShare'), h('span', { class: 'sep' }, '/'), h('span', {}, editId ? 'Sửa bài viết' : 'Đăng bài')),
    h('h1', { class: 'mb-16' }, editId ? 'Sửa bài viết' : 'Chia sẻ kiến thức'),
    h('div', { class: 'grid', style: { gridTemplateColumns: 'minmax(0,1.2fr) minmax(0,1fr)' }, id: 'share-editor-grid' }, h('div', { class: 'card card-pad' }, form), h('div', {}, h('div', { class: 'section-title' }, 'Xem trước'), preview)),
    h('div', { class: 'import-actions' }, btn('Hủy', { onClick: () => history.back() }), h('div', { class: 'spacer' }), submit)
  );
}
