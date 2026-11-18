/**
 * API client dùng Fetch API.
 *  - Tự đính kèm CSRF token cho request thay đổi dữ liệu.
 *  - Chuẩn hóa lỗi thành ApiError { status, message, code, details }.
 *  - 401 => phát sự kiện "auth:expired" để app chuyển về trang đăng nhập.
 */
const BASE = '/api/v1';
let csrfToken = null;

export class ApiError extends Error {
  constructor(status, message, { code, details } = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function setCsrf(token) {
  csrfToken = token;
}

async function fetchCsrf() {
  const res = await fetch(`${BASE}/auth/csrf`, { credentials: 'same-origin' });
  const body = await res.json();
  csrfToken = body?.data?.csrfToken || null;
  return csrfToken;
}

function buildUrl(path, query) {
  const url = new URL(BASE + path, location.origin);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null || v === '') continue;
      url.searchParams.set(k, Array.isArray(v) ? v.join(',') : String(v));
    }
  }
  return url.pathname + url.search;
}

export async function request(method, path, { body, query, signal, raw = false, retry = true } = {}) {
  const headers = { Accept: 'application/json' };
  const opts = { method, headers, credentials: 'same-origin', signal };
  if (body instanceof FormData) opts.body = body;
  else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  if (!['GET', 'HEAD'].includes(method)) {
    if (!csrfToken) await fetchCsrf();
    headers['X-CSRF-Token'] = csrfToken;
  }
  let res;
  try {
    res = await fetch(buildUrl(path, query), opts);
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    throw new ApiError(0, 'Không kết nối được máy chủ. Kiểm tra mạng hoặc server đã chạy chưa.');
  }
  if (raw && res.ok) return res;
  let data = null;
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) data = await res.json().catch(() => null);
  if (!res.ok) {
    // CSRF hết hạn (vd sau khi đăng nhập lại ở tab khác) => lấy token mới và thử lại 1 lần
    if (res.status === 403 && data?.code === 'CSRF' && retry) {
      await fetchCsrf();
      return request(method, path, { body, query, signal, raw, retry: false });
    }
    if (res.status === 401 && !path.startsWith('/auth/')) window.dispatchEvent(new CustomEvent('auth:expired'));
    throw new ApiError(res.status, data?.message || `Lỗi ${res.status}`, { code: data?.code, details: data?.details });
  }
  return data ? { data: data.data, message: data.message, meta: data.meta } : { data: null };
}

export const api = {
  get: (p, query, o) => request('GET', p, { query, ...o }).then((r) => r.data),
  post: (p, body, o) => request('POST', p, { body, ...o }).then((r) => r.data),
  put: (p, body, o) => request('PUT', p, { body, ...o }).then((r) => r.data),
  patch: (p, body, o) => request('PATCH', p, { body, ...o }).then((r) => r.data),
  del: (p, o) => request('DELETE', p, o).then((r) => r.data),
  /** Trả về cả message để hiển thị toast */
  send: (method, p, body, o) => request(method, p, { body, ...o }),
  upload: (p, formData, o) => request('POST', p, { body: formData, ...o }),
};

/** Tải file từ API (có kiểm tra quyền phía server) */
export async function download(path, fallbackName = 'download') {
  const res = await request('GET', path, { raw: true });
  const blob = await res.blob();
  const cd = res.headers.get('content-disposition') || '';
  const m = /filename\*=UTF-8''([^;]+)/i.exec(cd) || /filename="([^"]+)"/i.exec(cd);
  const name = m ? decodeURIComponent(m[1]) : fallbackName;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
