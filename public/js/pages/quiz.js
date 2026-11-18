import { h, icon, btn, debounce } from '../core/dom.js';
import { api } from '../core/api.js';
import { navigate, query } from '../core/router.js';
import { store } from '../core/store.js';
import { toast, showError, modal, emptyState, errorState, skeletonCards, select, field, withLoading } from '../core/ui.js';
import { relativeTime, fmtDate } from '../core/format.js';
import { questionPreview } from './quiz-set.js';

export const TYPE_LABELS = { SINGLE: 'Một đáp án', MULTIPLE: 'Nhiều đáp án', TRUE_FALSE: 'Đúng/Sai', SHORT: 'Trả lời ngắn' };
export const DIFF_LABELS = { EASY: 'Dễ', MEDIUM: 'Trung bình', HARD: 'Khó' };

export function mount(container) {
  const q = query();
  let search = '';
  const body = h('div', {}, skeletonCards(6));
  const statsEl = h('div');
  const searchInput = h('input', { class: 'input sm', placeholder: 'Tìm bộ câu hỏi...', style: { width: '240px' } });
  searchInput.addEventListener('input', debounce(() => ((search = searchInput.value.trim()), load()), 300));

  container.append(
    h(
      'div',
      { class: 'page-header' },
      h('div', { class: 'titles' }, h('h1', {}, 'UniQuiz'), h('p', {}, 'Tạo câu hỏi, luyện tập (Quick Quiz, Practice, Mock Test, Flashcards) và theo dõi chủ đề còn yếu.')),
      h('div', { class: 'actions' }, btn('Sinh câu hỏi bằng AI', { icon: 'sparkles', variant: 'soft', onClick: () => generateDialog() }), btn('Bộ câu hỏi mới', { icon: 'plus', variant: 'primary', onClick: () => createDialog() }))
    ),
    statsEl,
    h('div', { class: 'toolbar mt-16' }, h('div', { class: 'input-icon' }, icon('search'), searchInput)),
    body
  );

  async function loadStats() {
    try {
      const s = await api.get('/quiz/stats');
      if (!s.totalAttempts) return statsEl.replaceChildren();
      statsEl.replaceChildren(
        h(
          'div',
          { class: 'grid cols-4' },
          statCard('award', s.averageScore ?? '—', 'Điểm trung bình (thang 10)', '#10b981'),
          statCard('trending-up', s.bestScore ?? '—', 'Điểm cao nhất', '#2563eb'),
          statCard('check-circle', s.totalAttempts, 'Lượt làm bài', '#0ea5e9'),
          statCard('target', s.weakTopics.length, 'Chủ đề cần ôn', '#ef4444')
        ),
        s.weakTopics.length
          ? h('div', { class: 'card card-pad mt-16' }, h('div', { class: 'section-title' }, icon('target', { size: 14 }), 'Chủ đề còn yếu (tỉ lệ đúng < 60%)'), h('div', { class: 'row wrap' }, s.weakTopics.map((t) => h('span', { class: 'badge danger' }, `${t.key}: ${t.accuracy}% (${t.correct}/${t.total})`))))
          : null,
        s.trend.length > 1 ? h('div', { class: 'card card-pad mt-16' }, h('div', { class: 'section-title' }, 'Xu hướng điểm gần đây'), trendChart(s.trend)) : null
      );
    } catch {
      /* ignore */
    }
  }

  async function load() {
    try {
      const sets = await api.get('/quiz/sets', { search: search || undefined });
      if (!sets.length) {
        body.replaceChildren(
          emptyState({
            icon: 'quiz',
            title: search ? 'Không tìm thấy' : 'Chưa có bộ câu hỏi',
            text: 'Tự soạn câu hỏi hoặc để UniAI sinh câu hỏi từ tài liệu UniDrive / ghi chú UniNote.',
            action: h('div', { class: 'row' }, btn('Sinh bằng AI', { icon: 'sparkles', variant: 'soft', onClick: () => generateDialog() }), btn('Tự soạn', { icon: 'plus', variant: 'primary', onClick: () => createDialog() })),
          })
        );
        return;
      }
      body.replaceChildren(
        h(
          'div',
          { class: 'grid auto' },
          sets.map((s) =>
            h(
              'div',
              { class: 'card hoverable card-pad', onclick: () => navigate(`/quiz/${s.id}`) },
              h('div', { class: 'row' }, h('div', { class: 'icon-box', style: { background: '#14b8a61a', color: '#14b8a6' } }, icon('quiz')), h('div', { class: 'grow', style: { minWidth: 0 } }, h('div', { class: 'bold truncate' }, s.title), h('div', { class: 'tiny muted' }, `${s._count.questions} câu · ${s._count.attempts} lượt làm · ${relativeTime(s.updatedAt)}`))),
              h('div', { class: 'row wrap mt-8' }, s.subject ? h('span', { class: 'badge', style: { background: `${s.subject.color}1f`, color: s.subject.color } }, s.subject.name) : null, s.chapter ? h('span', { class: 'badge' }, s.chapter) : null, s.lastAttempt ? h('span', { class: `badge ${s.lastAttempt.score >= 8 ? 'success' : s.lastAttempt.score >= 5 ? 'warning' : 'danger'}` }, `Lần gần nhất: ${s.lastAttempt.score}/10`) : null)
            )
          )
        )
      );
    } catch (e) {
      body.replaceChildren(errorState(e, load));
    }
  }

  async function createDialog() {
    const subjects = await api.get('/schedules/subjects/options').catch(() => []);
    const f = { title: h('input', { class: 'input', placeholder: 'vd: Ôn tập chương 1 – Mạng máy tính', autofocus: true }), chapter: h('input', { class: 'input', placeholder: 'Chương / chủ đề' }), subject: select([{ value: '', label: '— Không gắn môn —' }, ...subjects.map((s) => ({ value: s.id, label: s.name }))], '') };
    modal({
      title: 'Bộ câu hỏi mới',
      body: [field('Tên bộ câu hỏi *', f.title), field('Môn học', f.subject), field('Chương', f.chapter)],
      footer: (close) => [
        btn('Hủy', { onClick: () => close() }),
        btn('Tạo', {
          variant: 'primary',
          onClick: async (e) => {
            if (!f.title.value.trim()) return toast.error('Nhập tên bộ câu hỏi');
            await withLoading(e.currentTarget, async () => {
              try {
                const s = await api.post('/quiz/sets', { title: f.title.value.trim(), chapter: f.chapter.value, subjectId: f.subject.value || null, questions: [] });
                close();
                navigate(`/quiz/${s.id}?edit=1`);
              } catch (err) {
                showError(err);
              }
            });
          },
        }),
      ],
    });
  }

  async function generateDialog(presetFileId) {
    if (!store.get().aiConfigured) return toast.warning('AI chưa được cấu hình trên máy chủ – bạn vẫn có thể tự soạn câu hỏi.');
    const [drive, subjects] = await Promise.all([api.get('/drive', { view: 'my', type: 'document', sort: 'date' }).catch(() => ({ files: [] })), api.get('/schedules/subjects/options').catch(() => [])]);
    const files = drive.files.filter((x) => x.document?.status === 'READY');
    const f = {
      source: select([{ value: '', label: '— Chọn tài liệu UniDrive —' }, ...files.map((x) => ({ value: x.id, label: x.originalName }))], presetFileId || ''),
      subject: select([{ value: '', label: '— Không gắn môn —' }, ...subjects.map((s) => ({ value: s.id, label: s.name }))], ''),
      chapter: h('input', { class: 'input', placeholder: 'vd: Chương 3 – Định tuyến (bỏ trống = toàn bộ tài liệu)' }),
      count: h('input', { class: 'input', type: 'number', min: 1, max: 30, value: 10 }),
      difficulty: select(Object.entries(DIFF_LABELS).map(([v, l]) => ({ value: v, label: l })), 'MEDIUM'),
      types: Object.entries(TYPE_LABELS).map(([v, l]) => ({ v, cb: h('input', { type: 'checkbox', checked: v === 'SINGLE' || v === 'TRUE_FALSE' }), l })),
      title: h('input', { class: 'input', placeholder: 'Tên bộ câu hỏi' }),
    };
    f.source.addEventListener('change', () => {
      const file = files.find((x) => String(x.id) === f.source.value);
      if (file && !f.title.value) f.title.value = `Ôn tập: ${file.originalName.replace(/\.[^.]+$/, '')}`.slice(0, 191);
      if (file?.subject) f.subject.value = file.subject.id;
    });
    if (presetFileId) f.source.dispatchEvent(new Event('change'));
    const out = h('div');
    const m = modal({
      title: 'Sinh câu hỏi từ tài liệu',
      icon: 'sparkles',
      size: 'wide',
      body: [
        files.length ? null : h('div', { class: 'alert warning mb-16' }, icon('alert'), 'Chưa có tài liệu nào đã trích xuất văn bản. Hãy tải PDF/DOCX/TXT lên UniDrive trước.'),
        h('div', { class: 'form-grid' }, field('Tài liệu nguồn *', f.source, { className: 'span-2' }), field('Chương / chủ đề', f.chapter, { className: 'span-2', hint: 'Nếu nhập, AI chỉ nhận các đoạn liên quan thay vì toàn bộ tài liệu.' }), field('Số câu', f.count), field('Độ khó', f.difficulty), field('Môn học', f.subject), field('Tên bộ câu hỏi', f.title)),
        h('div', { class: 'field' }, h('label', {}, 'Dạng câu hỏi'), h('div', { class: 'row wrap' }, f.types.map((t) => h('label', { class: 'checkbox small' }, t.cb, t.l)))),
        out,
      ],
      footer: (close) => [
        btn('Đóng', { onClick: () => close() }),
        btn('Sinh câu hỏi', {
          icon: 'sparkles',
          variant: 'primary',
          onClick: async (e) => {
            const types = f.types.filter((t) => t.cb.checked).map((t) => t.v);
            if (!f.source.value) return toast.error('Chọn tài liệu nguồn');
            if (!types.length) return toast.error('Chọn ít nhất một dạng câu hỏi');
            await withLoading(e.currentTarget, async () => {
              try {
                const r = await api.post('/quiz/generate', { fileId: Number(f.source.value), chapter: f.chapter.value.trim() || undefined, count: Number(f.count.value) || 10, difficulty: f.difficulty.value, types });
                showGenerated(r);
              } catch (err) {
                showError(err);
              }
            });
          },
        }),
      ],
    });
    function showGenerated(r) {
      if (!r.questions.length) return out.replaceChildren(h('div', { class: 'alert warning mt-16' }, icon('alert'), 'AI không tạo được câu hỏi hợp lệ. Hãy thử lại hoặc đổi chủ đề.'));
      const items = r.questions.map((qq) => ({ qq, cb: h('input', { type: 'checkbox', checked: true }) }));
      out.replaceChildren(
        h('div', { class: 'section-title mt-16' }, `Xem trước ${r.questions.length} câu${r.discarded ? ` (loại ${r.discarded} câu không hợp lệ)` : ''}`),
        h('p', { class: 'small muted mb-8' }, r.note),
        ...items.map(({ qq, cb }, i) => h('div', { class: 'card card-pad mb-8 row', style: { alignItems: 'flex-start' } }, cb, h('div', { class: 'grow' }, questionPreview(qq, i)))),
        btn('Lưu các câu đã chọn', {
          icon: 'check',
          variant: 'primary',
          onClick: async (e) =>
            withLoading(e.currentTarget, async () => {
              const qs = items.filter((x) => x.cb.checked).map((x) => x.qq);
              if (!qs.length) return toast.error('Chọn ít nhất 1 câu');
              try {
                const set = await api.post('/quiz/sets', { title: f.title.value.trim() || 'Bộ câu hỏi AI', chapter: f.chapter.value.trim() || null, subjectId: f.subject.value || null, sourceFileId: Number(f.source.value), questions: qs });
                m.close();
                toast(`Đã lưu ${qs.length} câu hỏi – bạn có thể chỉnh sửa thêm`);
                navigate(`/quiz/${set.id}?edit=1`);
              } catch (err) {
                showError(err);
              }
            }),
        })
      );
    }
  }

  loadStats();
  load();
  if (q.new) createDialog();
  if (q.generate) generateDialog(q.generate);
}

function statCard(ic, value, label, color) {
  return h('div', { class: 'card stat' }, h('div', { class: 'icon-box', style: { background: `${color}1a`, color } }, icon(ic)), h('div', {}, h('div', { class: 'value' }, value), h('div', { class: 'label' }, label)));
}

/** Biểu đồ cột đơn giản (SVG) cho xu hướng điểm */
export function trendChart(trend) {
  const NS = 'http://www.w3.org/2000/svg';
  const w = 600;
  const hgt = 140;
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${w} ${hgt + 24}`);
  svg.setAttribute('class', 'trend-chart');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Biểu đồ điểm các lần làm bài gần đây');
  const bw = w / trend.length;
  trend.forEach((t, i) => {
    const v = t.score ?? 0;
    const bh = (v / 10) * hgt;
    const rect = document.createElementNS(NS, 'rect');
    rect.setAttribute('x', i * bw + bw * 0.2);
    rect.setAttribute('y', hgt - bh);
    rect.setAttribute('width', bw * 0.6);
    rect.setAttribute('height', Math.max(2, bh));
    rect.setAttribute('rx', 3);
    rect.setAttribute('class', v >= 8 ? 'bar good' : v >= 5 ? 'bar mid' : 'bar low');
    const title = document.createElementNS(NS, 'title');
    title.textContent = `${t.title}: ${v}/10 – ${fmtDate(t.date)}`;
    rect.appendChild(title);
    svg.appendChild(rect);
    const label = document.createElementNS(NS, 'text');
    label.setAttribute('x', i * bw + bw / 2);
    label.setAttribute('y', hgt + 16);
    label.setAttribute('text-anchor', 'middle');
    label.setAttribute('class', 'bar-label');
    label.textContent = String(v);
    svg.appendChild(label);
  });
  return svg;
}
