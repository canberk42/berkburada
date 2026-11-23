// Ortak: menü, scroll animasyonu, sepet, API yardımcıları
const api = (u, m = 'GET', b) => fetch('/api/' + u, {
  method: m,
  headers: { 'Content-Type': 'application/json' },
  body: b ? JSON.stringify(b) : undefined
}).then(r => r.json());

const cart = {
  get: () => JSON.parse(localStorage.cart || '{}'),
  add(id) {
    const c = this.get();
    c[id] = (c[id] || 0) + 1;
    localStorage.cart = JSON.stringify(c);
    cart.badge();
  },
  set(c) {
    localStorage.cart = JSON.stringify(c);
    cart.badge();
  },
  clear() {
    this.set({});
  },
  badge() {
    const n = Object.values(this.get()).reduce((a, b) => a + b, 0);
    const e = document.getElementById('cn');
    if (e) e.textContent = n;
  }
};

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
}[c]));

// Tüm fiyatlar tek biçimde: 1.500,00 ₺
const money = n => (+n || 0).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ₺';

// Sipariş durumuna göre renkli nokta sınıfı
const statusCls = s => ({
  'Ödeme Bekliyor': 's-wait', 'Havale Bekleniyor': 's-wait', 'Hazırlanıyor': 's-prep',
  'Kargoda': 's-ship', 'Teslim Edildi': 's-done', 'İptal': 's-cancel'
}[s] || '');

const reveal = () => {
  const io = new IntersectionObserver(
    es => es.forEach(e => e.isIntersecting && (e.target.classList.add('show'), io.unobserve(e.target))),
    { threshold: .12 }
  );
  document.querySelectorAll('.reveal:not(.show)').forEach(e => io.observe(e));
};

addEventListener('DOMContentLoaded', async () => {
  if (location.protocol === 'file:') {
    document.body.innerHTML = '<h2 style="padding:40px;color:#fff">Bu sayfa dosyadan açılamaz. Sunucu üzerinden açın.</h2>';
    return;
  }

  reveal(); // sabit içerik API'yi beklemeden görünsün
  const me = await api('me');
  // Temiz adresler: /magaza, /sepet … (".html" görünmez)
  const p = location.pathname.replace(/\.html$/, '').replace(/\/index$/, '/') || '/';
  const L = [
    ['/', 'Ana sayfa'],
    ['/magaza', 'Mağaza'],
    ['/blog', 'Blog'],
    ['/iletisim', 'İletişim'],
    ['/sepet', 'Sepet<span class="cnt" id="cn">0</span>']
  ];

  if (me.user) L.push(['/siparislerim', 'Siparişlerim']);
  L.push(me.user ? ['#', 'Çıkış (' + esc(me.name) + ')'] : ['/giris', 'Giriş yap']);
  if (me.admin) L.push(['/admin', 'Admin']);

  const h = document.createElement('header');
  h.innerHTML = '<a class="logo" href="/"><i></i>berkburada</a><nav>' +
    L.map(([u, t]) => `<a href="${u}" class="${u == p ? 'on' : ''}" ${u == '#' ? 'id="out"' : ''}>${t}</a>`).join('') +
    '</nav>';
  document.body.prepend(h);

  const o = document.getElementById('out');
  if (o) {
    o.title = 'Çıkış için tıkla';
    o.onclick = async e => {
      e.preventDefault();
      await api('logout', 'POST');
      location.href = '/';
    };
  }

  const f = document.createElement('footer');
  f.innerHTML = '<span>© ' + new Date().getFullYear() + ' berkburada</span><span>Kart, havale veya kapıda ödeme</span>';
  document.body.append(f);
  cart.badge();
  window.pageInit && await window.pageInit(me);
  reveal();
});
