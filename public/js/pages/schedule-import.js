/**
 * Nhập thời khóa biểu: Upload -> Xem trước (thông tin SV, học kỳ, môn, khoảng lịch, buổi học, cảnh báo, xung đột)
 * -> Chỉnh sửa -> Xác nhận. Dữ liệu chỉ được lưu chính thức sau bước xác nhận.
 */
import { h, icon, btn } from '../core/dom.js';
import { api, download } from '../core/api.js';
import { navigate } from '../core/router.js';
import { toast, showError, select, field, withLoading, confirmDialog } from '../core/ui.js';
import { DAY_NAMES, fmtDate, periodLabel } from '../core/format.js';

export function mount(container) {
  let preview = null;
  let semesters = [];
  const body = h('div');

  container.append(
    h('div', { class: 'breadcrumb' }, h('a', { href: '/schedule' }, 'UniSchedule'), h('span', { class: 'sep' }, '/'), h('span', {}, 'Nhập thời khóa biểu')),
    h(
      'div',
      { class: 'page-header' },
      h('div', { class: 'titles' }, h('h1', {}, 'Nhập thời khóa biểu'), h('p', {}, 'Hỗ trợ file thời khóa biểu sinh viên KMA (.xls/.xlsx) và mẫu CSV/Excel chung. Dữ liệu được đọc bằng quy tắc có cấu trúc – không dùng AI để đoán.')),
      h('div', { class: 'actions' }, btn('Tải file mẫu CSV', { icon: 'download', onClick: () => download('/schedules/import/template', 'mau-thoi-khoa-bieu.csv').catch(showError) }))
    ),
    body
  );

  api.get('/schedules/semesters').then((s) => (semesters = s)).catch(() => {});

  // ---------------------------------------------------------------- Bước 1: Upload
  function renderUpload() {
    const input = h('input', { type: 'file', accept: '.xls,.xlsx,.csv', hidden: true, onchange: () => input.files[0] && upload(input.files[0]) });
    const adapter = select(
      [
        { value: '', label: 'Tự nhận diện định dạng' },
        { value: 'kma', label: 'Thời khóa biểu sinh viên KMA' },
        { value: 'generic', label: 'Mẫu CSV/Excel chung của UniVerse' },
      ],
      '',
      { size: 'sm', style: { width: 'auto' } }
    );
    const zone = h(
      'div',
      {
        class: 'dropzone',
        tabindex: 0,
        role: 'button',
        onclick: () => input.click(),
        onkeydown: (e) => (e.key === 'Enter' || e.key === ' ') && input.click(),
        ondragover: (e) => (e.preventDefault(), zone.classList.add('over')),
        ondragleave: () => zone.classList.remove('over'),
        ondrop: (e) => {
          e.preventDefault();
          zone.classList.remove('over');
          if (e.dataTransfer.files[0]) upload(e.dataTransfer.files[0]);
        },
      },
      icon('upload'),
      h('div', { class: 'bold' }, 'Kéo thả file vào đây hoặc bấm để chọn'),
      h('div', { class: 'small' }, '.xls, .xlsx, .csv – tối đa 5 MB')
    );
    async function upload(file) {
      const fd = new FormData();
      fd.append('file', file);
      if (adapter.value) fd.append('adapter', adapter.value);
      zone.replaceChildren(h('div', { class: 'spinner', style: { margin: '0 auto 8px' } }), h('div', {}, `Đang đọc "${file.name}"...`));
      try {
        const res = await api.upload('/schedules/import/preview', fd);
        preview = res.data;
        preview.subjects.forEach((s) => (s.include = true));
        renderPreview();
      } catch (e) {
        showError(e);
        renderUpload();
      }
    }
    body.replaceChildren(
      h(
        'div',
        { class: 'grid', style: { gridTemplateColumns: 'minmax(0,1.5fr) minmax(0,1fr)' }, id: 'import-grid' },
        h('div', { class: 'card card-pad' }, h('div', { class: 'row mb-16' }, h('h3', { class: 'grow' }, '1. Chọn file'), adapter), zone, input),
        h(
          'div',
          { class: 'card card-pad' },
          h('h3', { class: 'mb-8' }, 'Quy trình'),
          h(
            'ol',
            { class: 'small muted', style: { paddingLeft: '18px', margin: 0, lineHeight: 1.9 } },
            ['Đọc thông tin học kỳ, sinh viên', 'Nhận diện bảng học phần theo tiêu đề cột', 'Tách cột "Thời gian địa điểm" thành khoảng ngày → thứ → tiết → phòng', 'Sinh các buổi học cụ thể trong từng khoảng ngày', 'Phát hiện dữ liệu chưa nhận diện & trùng lịch', 'Bạn kiểm tra, chỉnh sửa rồi xác nhận lưu'].map((t) => h('li', {}, t))
          ),
          h('div', { class: 'alert info mt-16' }, icon('lock'), h('div', { class: 'small' }, 'File chỉ được đọc để tạo bản xem trước; nội dung gốc không được lưu vào UniDrive.'))
        )
      )
    );
  }

  // ---------------------------------------------------------------- Bước 2: Preview
  function renderPreview() {
    const p = preview;
    const st = p.meta?.student || {};
    const sem = p.meta?.semester || {};
    const existingSem = semesters.find((s) => sem.academicYear && s.academicYear === sem.academicYear && (!sem.term || (s.term || '') === sem.term));
    const semChoice = select([{ value: 'new', label: '+ Tạo học kỳ mới' }, ...semesters.map((s) => ({ value: s.id, label: s.name }))], existingSem ? existingSem.id : 'new');
    const semName = h('input', { class: 'input', value: sem.label || 'Học kỳ mới' });
    const dupMode = select(
      [
        { value: 'skip', label: 'Bỏ qua môn đã tồn tại trong học kỳ' },
        { value: 'replace', label: 'Thay thế môn đã tồn tại' },
      ],
      'skip'
    );
    const applyProfile = h('input', { type: 'checkbox' });
    const semNameField = field('Tên học kỳ mới', semName);
    semChoice.addEventListener('change', () => (semNameField.hidden = semChoice.value !== 'new'));
    semNameField.hidden = semChoice.value !== 'new';

    const subjectsBox = h('div', { class: 'col gap-12' });
    const conflictsBox = h('div');
    const statsBox = h('div', { class: 'row wrap' });

    const renderStats = () => {
      const inc = p.subjects.filter((s) => s.include);
      statsBox.replaceChildren(
        h('span', { class: 'badge primary' }, `${inc.length}/${p.subjects.length} môn được chọn`),
        h('span', { class: 'badge' }, `${inc.reduce((a, s) => a + (Number(s.credits) || 0), 0)} tín chỉ`),
        h('span', { class: 'badge' }, `${p.stats.meetingCount} buổi học`),
        p.stats.firstDate ? h('span', { class: 'badge' }, `${fmtDate(p.stats.firstDate)} → ${fmtDate(p.stats.lastDate)}`) : null,
        p.conflicts.length ? h('span', { class: 'badge danger' }, `${p.conflicts.length} xung đột`) : h('span', { class: 'badge success' }, 'Không trùng lịch')
      );
    };
    const renderConflicts = () =>
      conflictsBox.replaceChildren(
        ...(p.conflicts.length
          ? [h('div', { class: 'alert danger' }, icon('alert'), h('div', {}, h('div', { class: 'bold mb-8' }, `Phát hiện ${p.conflicts.length} xung đột (chỉ cảnh báo – không tự xóa môn):`), h('ul', { style: { margin: 0, paddingLeft: '18px' } }, p.conflicts.slice(0, 30).map((c) => h('li', { class: 'small' }, c.message, c.a.source === 'existing' || c.b.source === 'existing' ? h('span', { class: 'badge', style: { marginLeft: '6px' } }, 'với lịch đã có') : null))), p.conflicts.length > 30 ? h('div', { class: 'small' }, `… và ${p.conflicts.length - 30} xung đột khác`) : null))]
          : [])
      );

    const renderSubjects = () => subjectsBox.replaceChildren(...p.subjects.map((s, i) => subjectCard(s, i)));

    function subjectCard(s, i) {
      const warn = s.warnings || [];
      const inc = h('input', { type: 'checkbox', checked: s.include, onchange: (e) => ((s.include = e.target.checked), card.classList.toggle('excluded', !s.include), renderStats()) });
      const inp = (key, attrs = {}) => h('input', { class: `input sm ${attrs.required && !s[key] ? 'invalid' : ''}`, value: s[key] ?? '', oninput: (e) => (s[key] = attrs.type === 'number' ? (e.target.value === '' ? null : Number(e.target.value)) : e.target.value), ...attrs });
      const periodsEl = h('div', { class: 'col', style: { gap: '8px' } });
      const renderPeriods = () =>
        periodsEl.replaceChildren(
          ...s.periods.map((pr, pi) =>
            h(
              'div',
              { class: `import-period ${pr.invalid ? 'invalid' : ''}` },
              h(
                'div',
                { class: 'row wrap' },
                h('span', { class: 'small bold' }, `Khoảng ${pi + 1}`),
                h('input', { class: `input sm ${!pr.startDate ? 'invalid' : ''}`, type: 'date', value: pr.startDate || '', style: { width: '150px' }, onchange: (e) => ((pr.startDate = e.target.value), (pr.invalid = false)) }),
                h('span', { class: 'small muted' }, '→'),
                h('input', { class: `input sm ${!pr.endDate ? 'invalid' : ''}`, type: 'date', value: pr.endDate || '', style: { width: '150px' }, onchange: (e) => ((pr.endDate = e.target.value), (pr.invalid = false)) }),
                h('div', { class: 'spacer' }),
                btn('', { icon: 'trash', size: 'xs', variant: 'ghost', title: 'Bỏ khoảng này', onClick: () => (s.periods.splice(pi, 1), renderPeriods()) })
              ),
              h(
                'div',
                { class: 'col', style: { gap: '6px', marginTop: '6px' } },
                pr.sessions.map((x, si) =>
                  h(
                    'div',
                    { class: 'row wrap' },
                    select(DAY_NAMES.slice(1).map((d, k) => ({ value: k + 1, label: d })), x.dayOfWeek, { size: 'sm', style: { width: '115px' }, onchange: (e) => (x.dayOfWeek = Number(e.target.value)) }),
                    h('input', { class: 'input sm', type: 'number', min: 1, max: 20, value: x.startPeriod, style: { width: '62px' }, title: 'Tiết bắt đầu', onchange: (e) => (x.startPeriod = Number(e.target.value)) }),
                    h('span', { class: 'small muted' }, '→'),
                    h('input', { class: 'input sm', type: 'number', min: 1, max: 20, value: x.endPeriod, style: { width: '62px' }, title: 'Tiết kết thúc', onchange: (e) => (x.endPeriod = Number(e.target.value)) }),
                    h('input', { class: `input sm grow ${!x.room ? 'invalid' : ''}`, value: x.room || '', placeholder: 'Phòng (chưa xác định)', style: { minWidth: '110px' }, oninput: (e) => (x.room = e.target.value) }),
                    x.note ? h('span', { class: 'badge' }, x.note) : null,
                    btn('', { icon: 'x', size: 'xs', variant: 'ghost', title: 'Bỏ buổi', onClick: () => (pr.sessions.splice(si, 1), renderPeriods()) })
                  )
                ),
                btn('Thêm buổi', { icon: 'plus', size: 'xs', variant: 'ghost', onClick: () => (pr.sessions.push({ dayOfWeek: 1, startPeriod: 1, endPeriod: 3, room: pr.sessions.at(-1)?.room || '' }), renderPeriods()) })
              )
            )
          ),
          btn('Thêm khoảng lịch', { icon: 'plus', size: 'xs', onClick: () => (s.periods.push({ startDate: '', endDate: '', sessions: [{ dayOfWeek: 1, startPeriod: 1, endPeriod: 3, room: '' }] }), renderPeriods()) })
        );
      renderPeriods();
      const card = h(
        'div',
        { class: `card import-subject ${s.include ? '' : 'excluded'}` },
        h(
          'div',
          { class: 'card-header' },
          h('label', { class: 'checkbox' }, inc),
          h('div', { class: 'grow' }, h('div', { class: 'bold' }, `${s.stt ?? i + 1}. ${s.name}`), h('div', { class: 'tiny muted' }, `${s.meetingCount ?? '?'} buổi học${s.firstDate ? ` · ${fmtDate(s.firstDate)} → ${fmtDate(s.lastDate)}` : ''}${s.rowNumber ? ` · dòng ${s.rowNumber} trong file` : ''}`)),
          warn.length ? h('span', { class: 'badge warning' }, icon('alert'), `${warn.length} cảnh báo`) : h('span', { class: 'badge success' }, icon('check'), 'Hợp lệ')
        ),
        h(
          'div',
          { class: 'card-body' },
          h('div', { class: 'grid', style: { gridTemplateColumns: 'minmax(0,2fr) repeat(3, minmax(0,1fr))', gap: '8px' }, id: `sg-${i}` }, field('Tên học phần', inp('name', { required: true })), field('Mã HP', inp('code', { required: true })), field('Số TC', inp('credits', { type: 'number', min: 0, max: 30 })), field('Lớp HP', inp('classCode'))),
          warn.length ? h('div', { class: 'alert warning mb-8' }, icon('alert'), h('ul', { style: { margin: 0, paddingLeft: '18px' } }, warn.map((w) => h('li', { class: 'small' }, w)))) : null,
          periodsEl,
          s.rawTimeText ? h('details', { class: 'mt-8' }, h('summary', { class: 'small muted', style: { cursor: 'pointer' } }, 'Xem dữ liệu gốc "Thời gian địa điểm"'), h('pre', { class: 'raw-text' }, s.rawTimeText)) : null
        )
      );
      return card;
    }

    renderStats();
    renderConflicts();
    renderSubjects();

    const confirmBtn = btn('Xác nhận nhập', { icon: 'check', variant: 'primary', size: 'lg' });
    confirmBtn.addEventListener('click', () =>
      withLoading(confirmBtn, async () => {
        const chosen = p.subjects.filter((s) => s.include);
        if (!chosen.length) return toast.error('Hãy chọn ít nhất một môn học');
        const invalid = chosen.find((s) => !s.name || s.periods.some((x) => !x.startDate || !x.endDate || x.startDate > x.endDate || !x.sessions.length));
        if (invalid) return toast.error(`Môn "${invalid.name || '(chưa đặt tên)'}" còn khoảng lịch thiếu ngày hoặc không có buổi học`);
        if (p.conflicts.length && !(await confirmDialog({ title: 'Vẫn nhập dù có xung đột?', message: `Có ${p.conflicts.length} xung đột lịch học. Dữ liệu vẫn được nhập và các xung đột sẽ được đánh dấu trên lịch.`, confirmText: 'Vẫn nhập' }))) return;
        const payload = {
          duplicateMode: dupMode.value,
          applyProfile: applyProfile.checked,
          subjects: chosen.map((s) => ({
            key: s.key,
            include: true,
            name: s.name,
            code: s.code || null,
            credits: s.credits === '' || s.credits === undefined ? null : s.credits,
            classCode: s.classCode || null,
            lecturer: s.lecturer || null,
            periods: s.periods.map((x) => ({ startDate: x.startDate, endDate: x.endDate, rawText: x.rawText, sessions: x.sessions.map((y) => ({ dayOfWeek: y.dayOfWeek, startPeriod: y.startPeriod, endPeriod: Math.max(y.endPeriod, y.startPeriod), periods: y.periods, room: y.room || null })) })),
          })),
        };
        if (semChoice.value === 'new') payload.newSemester = { name: semName.value.trim() || 'Học kỳ mới', academicYear: sem.academicYear || null, term: sem.term || null, phase: sem.phase || null, isCurrent: true };
        else payload.semesterId = Number(semChoice.value);
        try {
          const r = await api.post(`/schedules/import/${p.importId}/confirm`, payload);
          toast(`Đã nhập ${r.created} môn, ${r.meetings} buổi học${r.skipped ? ` (bỏ qua ${r.skipped} môn đã có)` : ''}`);
          navigate(`/schedule?semester=${r.semesterId}&date=${p.stats.firstDate || ''}`);
        } catch (e) {
          showError(e);
        }
      })
    );
    const recheck = btn('Kiểm tra lại', {
      icon: 'refresh',
      onClick: (e) =>
        withLoading(e.currentTarget, async () => {
          try {
            const subjects = p.subjects.filter((s) => s.include).map((s) => ({ key: s.key, include: true, name: s.name, code: s.code || null, credits: s.credits ?? null, classCode: s.classCode || null, periods: s.periods.filter((x) => x.startDate && x.endDate && x.sessions.length).map((x) => ({ startDate: x.startDate, endDate: x.endDate, sessions: x.sessions.map((y) => ({ dayOfWeek: y.dayOfWeek, startPeriod: y.startPeriod, endPeriod: Math.max(y.startPeriod, y.endPeriod), room: y.room || null })) })) }));
            const r = await api.post(`/schedules/import/${p.importId}/revalidate`, { subjects });
            p.conflicts = r.conflicts;
            p.stats = r.stats;
            for (const rs of r.subjects) {
              const s = p.subjects.find((x) => x.key === rs.key);
              if (s) Object.assign(s, { meetingCount: rs.meetingCount, firstDate: rs.firstDate, lastDate: rs.lastDate, warnings: rs.warnings.filter((w) => !/^Thiếu/.test(w)) });
            }
            renderStats();
            renderConflicts();
            renderSubjects();
            toast('Đã kiểm tra lại dữ liệu', 'info');
          } catch (err) {
            showError(err);
          }
        }),
    });

    body.replaceChildren(
      h('div', { class: 'alert info mb-16' }, icon('info'), h('div', {}, 'Đây là ', h('b', {}, 'bản xem trước'), ' – chưa có dữ liệu nào được lưu. Kiểm tra, sửa các trường bị đánh dấu đỏ rồi bấm ', h('b', {}, 'Xác nhận nhập'), '.')),
      h(
        'div',
        { class: 'grid cols-2 mb-16' },
        h(
          'div',
          { class: 'card card-pad' },
          h('h3', { class: 'mb-8' }, 'Thông tin trong file'),
          h('div', { class: 'small kv' }, kv('Định dạng', p.adapter === 'kma' ? 'Thời khóa biểu KMA' : 'Mẫu chung'), kv('Sheet', p.sheetName), kv('Học kỳ', sem.label || '—'), kv('Sinh viên', st.fullName), kv('Mã SV', st.studentCode), kv('Lớp', st.className), kv('Khóa', st.cohort), kv('Ngành', st.major)),
          p.meta?.shiftNotes?.length ? h('div', { class: 'tiny muted mt-8' }, p.meta.shiftNotes.join(' · ')) : null,
          p.warnings?.length ? h('div', { class: 'alert warning mt-8' }, icon('alert'), h('div', { class: 'small' }, p.warnings.join(' '))) : null
        ),
        h(
          'div',
          { class: 'card card-pad' },
          h('h3', { class: 'mb-8' }, 'Lưu vào'),
          field('Học kỳ', semChoice),
          semNameField,
          field('Môn trùng (cùng mã + lớp HP)', dupMode),
          h('label', { class: 'checkbox small' }, applyProfile, 'Cập nhật Lớp / Ngành / Mã SV vào hồ sơ của tôi'),
          h('div', { class: 'mt-16' }, statsBox)
        )
      ),
      conflictsBox,
      h('div', { class: 'section-title mt-16' }, `Danh sách học phần (${p.subjects.length})`),
      p.subjects.length ? subjectsBox : h('div', { class: 'alert warning' }, icon('alert'), 'File không có học phần nào (có thể là file mẫu chưa đăng ký môn).'),
      h(
        'div',
        { class: 'import-actions' },
        btn('Hủy', {
          onClick: async () => {
            await api.del(`/schedules/import/${p.importId}`).catch(() => {});
            preview = null;
            renderUpload();
          },
        }),
        h('div', { class: 'spacer' }),
        recheck,
        p.subjects.length ? confirmBtn : null
      )
    );
  }

  renderUpload();
}

function kv(k, v) {
  return h('div', { class: 'row', style: { padding: '3px 0' } }, h('span', { class: 'muted', style: { width: '90px', flex: 'none' } }, k), h('span', { class: v ? 'bold' : 'faint' }, v || 'Không có'));
}

export { periodLabel };
