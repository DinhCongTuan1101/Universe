import { h, btn } from '../core/dom.js';
import { navigate } from '../core/router.js';
import { emptyState } from '../core/ui.js';

export function mount(container) {
  container.append(emptyState({ icon: 'search', title: '404 – Không tìm thấy trang', text: 'Đường dẫn không tồn tại hoặc đã bị thay đổi.', action: btn('Về Dashboard', { icon: 'dashboard', variant: 'primary', onClick: () => navigate('/') }) }), h('div'));
}
