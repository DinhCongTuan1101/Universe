/* Áp dụng theme trước khi vẽ trang để tránh nháy màu (chạy đồng bộ, không phụ thuộc module). */
(function () {
  try {
    var t = localStorage.getItem('universe.theme');
    if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
  } catch (e) {
    /* bỏ qua */
  }
})();
