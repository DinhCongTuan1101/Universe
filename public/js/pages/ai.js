import { h, icon, btn, avatar, debounce } from '../core/dom.js';
import { api } from '../core/api.js';
import { navigate, query } from '../core/router.js';
import { store } from '../core/store.js';
import { toast, showError, modal, confirmDialog, promptDialog, menu, emptyState, errorState, skeleton } from '../core/ui.js';
import { relativeTime, fileSize } from '../core/format.js';
import { renderMarkdown } from '../core/markdown.js';

const SUGGESTIONS = [
  'Giải thích thuật toán Dijkstra bằng ví dụ đơn giản',
  'Lập kế hoạch ôn thi cuối kỳ trong 2 tuần',
  'Cách viết phần tổng quan tài liệu cho báo cáo đồ án',
  'So sánh TCP và UDP, khi nào nên dùng loại nào?',
];

export function mount(container, { params }) {
  const q = query();
  const convId = params.id ? Number(params.id) : null;
  const user = store.get().user;
  let conversations = [];
  let conv = null;
  let sending = false;
  let aiStatus = { configured: store.get().aiConfigured };

  const search = h('input', { class: 'input sm', placeholder: 'Tìm hội thoại...' });
  search.addEventListener('input', debounce(loadList, 300));
  const listEl = h('div', { class: 'conv-list' }, skeleton(5));
  const main = h('div', { class: 'chat-main' });
  container.append(
    h(
      'div',
      { class: 'chat-layout' },
      h('aside', { class: 'chat-sidebar' }, h('div', { class: 'row mb-8' }, h('h2', { class: 'grow' }, 'UniAI'), btn('', { icon: 'plus', size: 'sm', variant: 'primary', title: 'Hội thoại mới', onClick: () => newConversation() })), h('div', { class: 'input-icon mb-8' }, icon('search'), search), listEl, h('div', { class: 'usage-box', id: 'ai-usage' })),
      main
    )
  );

  async function loadList() {
    try {
      conversations = await api.get('/ai/conversations', { search: search.value.trim() || undefined });
      listEl.replaceChildren(
        ...(conversations.length
          ? conversations.map((c) =>
              h(
                'a',
                { class: `conv-item ${c.id === convId ? 'active' : ''}`, href: `/ai/${c.id}` },
                icon('message', { size: 15 }),
                h('div', { class: 'grow', style: { minWidth: 0 } }, h('div', { class: 'truncate small bold' }, c.title), h('div', { class: 'tiny muted' }, `${c._count.messages} tin nhắn · ${relativeTime(c.updatedAt)}`))
              )
            )
          : [h('p', { class: 'small muted', style: { padding: '8px' } }, 'Chưa có hội thoại.')])
      );
    } catch (e) {
      listEl.replaceChildren(errorState(e, loadList));
    }
  }

  async function loadUsage() {
    try {
      const [s, u] = await Promise.all([api.get('/ai/status'), api.get('/ai/usage')]);
      aiStatus = s;
      const box = document.getElementById('ai-usage');
      if (box)
        box.replaceChildren(
          s.configured ? h('div', { class: 'tiny muted' }, h('div', {}, `Provider: ${s.provider} · ${s.chatModel}`), h('div', {}, `Hôm nay: ${u.today}/${u.dailyLimit} lượt`), h('div', { class: 'progress sm mt-8' }, h('span', { style: { width: `${Math.min(100, (u.today / u.dailyLimit) * 100)}%` } })), h('div', { class: 'mt-8' }, `30 ngày: ${u.last30Days.requests} lượt · ${u.last30Days.totalTokens.toLocaleString('vi-VN')} token`)) : h('div', { class: 'tiny muted' }, 'AI chưa được cấu hình')
        );
    } catch {
      /* ignore */
    }
  }

  async function newConversation(documentIds) {
    try {
      const c = await api.post('/ai/conversations', { documentIds });
      navigate(`/ai/${c.id}`);
    } catch (e) {
      showError(e);
    }
  }

  function notConfiguredBanner() {
    return h('div', { class: 'alert warning' }, icon('alert'), h('div', {}, h('div', { class: 'bold' }, 'AI chưa được cấu hình'), h('div', { class: 'small' }, 'Quản trị viên cần đặt AI_PROVIDER (openai hoặc gemini) và API key tương ứng trong file .env rồi khởi động lại server. UniVerse không tạo câu trả lời giả – các module khác vẫn hoạt động bình thường.')));
  }

  async function loadConversation() {
    if (!convId) {
      main.replaceChildren(
        h(
          'div',
          { class: 'chat-welcome' },
          h('div', { class: 'icon-box lg', style: { background: 'var(--gradient)', color: '#fff', margin: '0 auto 12px' } }, icon('sparkles')),
          h('h1', {}, 'Xin chào, mình là UniAI'),
          h('p', { class: 'muted' }, 'Trợ lý học tập: giải thích kiến thức, lập kế hoạch, hỏi đáp dựa trên tài liệu UniDrive của bạn.'),
          !aiStatus.configured ? h('div', { class: 'mt-16' }, notConfiguredBanner()) : null,
          h('div', { class: 'grid cols-2 mt-16' }, SUGGESTIONS.map((s) => h('button', { class: 'card hoverable card-pad suggestion', disabled: !aiStatus.configured, onclick: () => startWith(s) }, icon('sparkles', { size: 14 }), ' ', s))),
          h('div', { class: 'row mt-16', style: { justifyContent: 'center' } }, btn('Hội thoại mới', { icon: 'plus', variant: 'primary', onClick: () => newConversation() }), btn('Hỏi về tài liệu', { icon: 'file-text', onClick: () => pickDocuments([]).then((ids) => ids && newConversation(ids)) }))
        )
      );
      if (q.new && aiStatus.configured) newConversation();
      return;
    }
    main.replaceChildren(h('div', { class: 'chat-messages' }, skeleton(4, { avatar: true })));
    try {
      conv = await api.get(`/ai/conversations/${convId}`);
      aiStatus = conv.ai;
      renderChat();
    } catch (e) {
      main.replaceChildren(errorState(e, loadConversation));
    }
  }

  async function startWith(text) {
    try {
      const c = await api.post('/ai/conversations', {});
      sessionStorage.setItem('universe.ai.pending', text);
      navigate(`/ai/${c.id}`);
    } catch (e) {
      showError(e);
    }
  }

  function renderMessage(m) {
    const mine = m.role === 'USER';
    const body = mine ? h('div', { class: 'msg-text' }, m.content) : renderMarkdown(m.content, { onCite: (n) => el.querySelector(`[data-ref="${n}"]`)?.classList.add('flash') });
    const sources = !mine && m.sources?.items?.length
      ? h(
          'details',
          { class: 'msg-sources' },
          h('summary', {}, icon('book', { size: 13 }), ` ${m.sources.items.length} nguồn · ${m.sources.method === 'semantic' ? 'truy xuất ngữ nghĩa' : 'truy xuất từ khóa'}`),
          m.sources.items.map((s) => h('div', { class: 'source-item', 'data-ref': s.ref }, h('div', { class: 'row small' }, h('span', { class: 'badge primary' }, s.ref), h('a', { href: `/drive?file=${s.fileId}`, class: 'bold truncate' }, s.fileName), h('span', { class: 'tiny muted' }, [s.pageNumber ? `trang ${s.pageNumber}` : null, `đoạn ${s.chunkIndex + 1}`].filter(Boolean).join(' · '))), h('div', { class: 'tiny muted' }, `“${s.excerpt}…”`)))
        )
      : !mine && m.sources && !m.sources.items?.length
        ? h('div', { class: 'tiny muted mt-8' }, 'Không tìm thấy đoạn tài liệu liên quan – câu trả lời dựa trên kiến thức chung.')
        : null;
    const el = h(
      'div',
      { class: `msg ${mine ? 'mine' : 'ai'}` },
      mine ? avatar(user, 'sm') : h('span', { class: 'avatar sm ai-avatar' }, icon('sparkles', { size: 13 })),
      h('div', { class: 'msg-bubble' }, body, sources, !mine ? h('div', { class: 'msg-actions' }, btn('', { icon: 'copy', size: 'xs', variant: 'ghost', title: 'Sao chép', onClick: () => navigator.clipboard.writeText(m.content).then(() => toast('Đã sao chép', 'info')) }), m.model ? h('span', { class: 'tiny faint' }, m.model) : null) : null)
    );
    return el;
  }

  function renderChat() {
    const messagesEl = h('div', { class: 'chat-messages' });
    const scroll = () => (messagesEl.scrollTop = messagesEl.scrollHeight);
    if (!conv.messages.length) messagesEl.append(h('div', { class: 'empty-state compact' }, h('p', {}, conv.documents.length ? 'Đặt câu hỏi về các tài liệu đã đính kèm.' : 'Hãy bắt đầu bằng một câu hỏi.')));
    conv.messages.forEach((m) => messagesEl.append(renderMessage(m)));

    const input = h('textarea', { class: 'chat-input', rows: 1, placeholder: aiStatus.configured ? 'Nhập câu hỏi... (Enter để gửi, Shift+Enter xuống dòng)' : 'AI chưa được cấu hình', disabled: !aiStatus.configured, maxlength: 8000 });
    const sendBtn = btn('', { icon: 'send', variant: 'primary', title: 'Gửi', disabled: !aiStatus.configured });
    const grow = () => {
      input.style.height = 'auto';
      input.style.height = `${Math.min(200, input.scrollHeight)}px`;
    };
    input.addEventListener('input', grow);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        send();
      }
    });
    sendBtn.addEventListener('click', send);

    async function send() {
      const content = input.value.trim();
      if (!content || sending) return;
      sending = true;
      sendBtn.classList.add('loading');
      messagesEl.querySelector('.empty-state')?.remove();
      const tempUser = renderMessage({ role: 'USER', content });
      const typing = h('div', { class: 'msg ai' }, h('span', { class: 'avatar sm ai-avatar' }, icon('sparkles', { size: 13 })), h('div', { class: 'msg-bubble' }, h('div', { class: 'typing' }, h('span'), h('span'), h('span'))));
      messagesEl.append(tempUser, typing);
      input.value = '';
      grow();
      scroll();
      try {
        const r = await api.post(`/ai/conversations/${conv.id}/messages`, { content });
        typing.replaceWith(renderMessage(r.assistantMessage));
        conv.messages.push(r.userMessage, r.assistantMessage);
        if (r.title !== conv.title) {
          conv.title = r.title;
          titleEl.textContent = r.title;
          loadList();
        }
        loadUsage();
      } catch (e) {
        typing.remove();
        tempUser.remove();
        input.value = content;
        grow();
        showError(e);
      } finally {
        sending = false;
        sendBtn.classList.remove('loading');
        scroll();
        input.focus();
      }
    }

    const titleEl = h('h2', { class: 'truncate grow' }, conv.title);
    const docsEl = h(
      'div',
      { class: 'row wrap', style: { gap: '4px' } },
      conv.documents.map((d) => h('span', { class: 'badge info' }, icon('file-text'), d.originalName, d.document?.status !== 'READY' ? ' (chưa sẵn sàng)' : d.document?.embeddedCount ? ' · ngữ nghĩa' : ''))
    );
    main.replaceChildren(
      h(
        'div',
        { class: 'chat-header' },
        h('div', { class: 'grow', style: { minWidth: 0 } }, titleEl, conv.documents.length ? docsEl : h('div', { class: 'tiny muted' }, 'Không đính kèm tài liệu')),
        btn('Tài liệu', { icon: 'file-text', size: 'sm', onClick: attach }),
        btn('', {
          icon: 'more',
          size: 'sm',
          variant: 'ghost',
          title: 'Thêm',
          onClick: (e) =>
            menu(e.currentTarget, [
              {
                label: 'Đổi tên',
                icon: 'edit',
                onClick: async () => {
                  const t = await promptDialog({ title: 'Đổi tên hội thoại', value: conv.title });
                  if (!t) return;
                  try {
                    await api.patch(`/ai/conversations/${conv.id}`, { title: t });
                    conv.title = t;
                    titleEl.textContent = t;
                    loadList();
                  } catch (err) {
                    showError(err);
                  }
                },
              },
              {
                label: 'Xóa hội thoại',
                icon: 'trash',
                danger: true,
                onClick: async () => {
                  if (!(await confirmDialog({ title: 'Xóa hội thoại?', message: 'Hội thoại sẽ được chuyển vào Thùng rác.', danger: true, confirmText: 'Xóa' }))) return;
                  try {
                    await api.del(`/ai/conversations/${conv.id}`);
                    toast('Đã xóa hội thoại');
                    navigate('/ai');
                  } catch (err) {
                    showError(err);
                  }
                },
              },
            ], { align: 'right' }),
        })
      ),
      !aiStatus.configured ? h('div', { style: { padding: '12px 20px 0' } }, notConfiguredBanner()) : null,
      messagesEl,
      h('div', { class: 'chat-composer' }, h('div', { class: 'composer-box' }, input, sendBtn), h('div', { class: 'tiny faint center mt-8' }, 'UniAI có thể sai – hãy kiểm tra thông tin quan trọng. Tài liệu chỉ được gửi khi bạn đính kèm.'))
    );
    setTimeout(() => {
      scroll();
      input.focus();
      const pending = sessionStorage.getItem('universe.ai.pending');
      if (pending) {
        sessionStorage.removeItem('universe.ai.pending');
        input.value = pending;
        send();
      }
    }, 30);

    async function attach() {
      const ids = await pickDocuments(conv.documents.map((d) => d.id));
      if (!ids) return;
      try {
        const c = await api.patch(`/ai/conversations/${conv.id}`, { documentIds: ids });
        conv.documents = c.documents;
        docsEl.replaceChildren(...c.documents.map((d) => h('span', { class: 'badge info' }, icon('file-text'), d.originalName)));
        toast(ids.length ? `Đã đính kèm ${ids.length} tài liệu` : 'Đã bỏ đính kèm tài liệu');
        renderChat();
      } catch (e) {
        showError(e);
      }
    }
  }

  /** Chọn tài liệu (đã trích xuất văn bản) để làm ngữ cảnh RAG */
  async function pickDocuments(selected) {
    const [mine, shared] = await Promise.all([api.get('/drive', { view: 'my', type: 'document', sort: 'date' }).catch(() => ({ files: [] })), api.get('/drive', { view: 'shared' }).catch(() => ({ files: [] }))]);
    const seen = new Set();
    const files = [...mine.files, ...shared.files].filter((f) => f.document && !seen.has(f.id) && seen.add(f.id));
    const checks = files.map((f) => ({ f, cb: h('input', { type: 'checkbox', checked: selected.includes(f.id), disabled: f.document.status !== 'READY' }) }));
    const m = modal({
      title: 'Đính kèm tài liệu từ UniDrive',
      icon: 'file-text',
      size: 'wide',
      body: files.length
        ? [
            h('p', { class: 'small muted mb-8' }, 'Khi bạn hỏi, UniAI chỉ gửi các đoạn liên quan nhất (không gửi toàn bộ tài liệu) kèm số trang/đoạn để trích dẫn. Tối đa 10 tài liệu.'),
            h('div', { class: 'doc-pick' }, checks.map(({ f, cb }) => h('label', { class: 'checkbox small' }, cb, h('span', { class: 'grow' }, f.originalName), h('span', { class: 'tiny muted' }, f.document.status !== 'READY' ? 'chưa sẵn sàng' : `${fileSize(f.size)}${f.document.embeddedCount ? ' · ngữ nghĩa' : ' · từ khóa'}`)))),
          ]
        : emptyState({ icon: 'folder', title: 'Chưa có tài liệu văn bản', text: 'Tải PDF/DOCX/TXT lên UniDrive để hỏi đáp.', compact: true }),
      footer: (close) => [btn('Hủy', { onClick: () => close(null) }), btn('Xác nhận', { variant: 'primary', onClick: () => close(checks.filter((c) => c.cb.checked).map((c) => c.f.id).slice(0, 10)) })],
    });
    const v = await m.promise;
    return v === undefined ? null : v;
  }

  loadList();
  loadUsage().then(loadConversation);
}
