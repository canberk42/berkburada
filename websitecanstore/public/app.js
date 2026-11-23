// Ortak: üst bar, ürün kartı, ürün penceresi, sepet, API yardımcıları
const api = (u, m = 'GET', b) => fetch('/api/' + u, {
  method: m,
  headers: { 'Content-Type': 'application/json' },
  body: b ? JSON.stringify(b) : undefined
}).then(r => r.json());

const cart = {
  get: () => { try { return JSON.parse(localStorage.cart || '{}') } catch { return {} } },
  add(id, n = 1) {
    const c = this.get();
    c[id] = Math.min((c[id] || 0) + n, 99);
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
    if (e) { e.textContent = n; e.classList.toggle('zero', !n) }
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

// Lucide çizgi ikonları
const ICON = {
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  cart: '<circle cx="8" cy="21" r="1"/><circle cx="19" cy="21" r="1"/><path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12"/>',
  img: '<rect width="18" height="18" x="3" y="3" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/>',
  left: '<path d="m15 18-6-6 6-6"/>',
  right: '<path d="m9 18 6-6-6-6"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  shield: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>',
  card: '<rect width="20" height="14" x="2" y="5" rx="2"/><line x1="2" x2="22" y1="10" y2="10"/>',
  truck: '<path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"/><path d="M15 18H9"/><path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.624l-3.48-4.35A1 1 0 0 0 17.52 8H14"/><circle cx="17" cy="18" r="2"/><circle cx="7" cy="18" r="2"/>',
  chat: '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>',
  moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>',
  instagram: '<rect width="20" height="20" x="2" y="2" rx="5" ry="5"/><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/><line x1="17.5" x2="17.51" y1="6.5" y2="6.5"/>',
  youtube: '<path d="M2.5 17a24.12 24.12 0 0 1 0-10 2 2 0 0 1 1.4-1.4 49.56 49.56 0 0 1 16.2 0A2 2 0 0 1 21.5 7a24.12 24.12 0 0 1 0 10 2 2 0 0 1-1.4 1.4 49.55 49.55 0 0 1-16.2 0A2 2 0 0 1 2.5 17"/><path d="m10 15 5-3-5-3z"/>'
};
const icon = n => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${ICON[n]}</svg>`;
// TikTok logosu dolgulu çizilir
const tiktokIcon = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M16.6 5.82A4.28 4.28 0 0 1 15.54 3h-3.09v12.4a2.59 2.59 0 0 1-2.59 2.5 2.6 2.6 0 0 1-2.6-2.6 2.6 2.6 0 0 1 3.4-2.47V9.67a5.69 5.69 0 0 0-.8-.06 5.7 5.7 0 0 0-5.7 5.7 5.7 5.7 0 0 0 5.7 5.69 5.7 5.7 0 0 0 5.69-5.69V9.01a7.35 7.35 0 0 0 4.3 1.38V7.3a4.3 4.3 0 0 1-3.25-1.48Z"/></svg>';

// ---------- Sosyal medya hesapları (boş bırakılan görünmez) ----------
const SOCIAL = [
  { cls: 'ig', name: 'Instagram', url: 'https://www.instagram.com/polat.brk/', svg: () => icon('instagram') },
  { cls: 'tt', name: 'TikTok', url: 'https://www.tiktok.com/@s2ghizli', svg: () => tiktokIcon },
  { cls: 'yt', name: 'YouTube', url: '', svg: () => icon('youtube') }
];

// ---------- Açık / karanlık mod ----------
const setTheme = t => {
  document.documentElement.dataset.theme = t;
  try { localStorage.theme = t } catch {}
  const b = document.getElementById('themeBtn');
  if (b) b.setAttribute('aria-label', t === 'dark' ? 'Açık moda geç' : 'Karanlık moda geç');
};
(() => { let t = null; try { t = localStorage.theme } catch {} if (t === 'dark') document.documentElement.dataset.theme = 'dark' })();

// Ürün listesini normalize et (resim dizisi, temiz kategori)
const normProducts = list => (Array.isArray(list) ? list : []).map(p => ({
  ...p,
  category: String(p.category || 'Genel').trim(),
  images: Array.isArray(p.images) && p.images.length ? p.images : (p.image ? [p.image] : [])
}));

// ---------- Ürün kartı ----------
function productCard(p) {
  const im = p.images, n = im.length;
  const ph = n
    ? `<img src="${esc(im[0])}" alt="${esc(p.name)}" loading="lazy">${n > 1 ? `<img class="alt" src="${esc(im[1])}" alt="" loading="lazy">` : ''}`
    : `<span class="noimg">${icon('img')}</span>`;
  return `<article class="pcard reveal" data-pid="${p.id}" tabindex="0" aria-label="${esc(p.name)}">
    <div class="ph">${ph}${n > 1 ? `<span class="badge">${icon('img')}${n}</span>` : ''}</div>
    <div class="body"><span class="cat">${esc(p.category)}</span><span class="name">${esc(p.name)}</span>
    <span class="price">${money(p.price)}</span><button class="add" data-add="${p.id}">Sepete ekle</button></div></article>`;
}

// Bir kapsayıcıdaki kartlara tıklama: buton sepete ekler, kart pencereyi açar
function bindCards(box, list) {
  const byId = id => list.find(p => String(p.id) === String(id));
  box.onclick = e => {
    const add = e.target.closest('[data-add]');
    if (add) {
      e.stopPropagation(); cart.add(add.dataset.add);
      add.textContent = 'Sepete eklendi'; add.classList.add('done');
      setTimeout(() => { add.textContent = 'Sepete ekle'; add.classList.remove('done') }, 1600);
      return;
    }
    const c = e.target.closest('[data-pid]'); if (c) openProduct(byId(c.dataset.pid));
  };
  box.onkeydown = e => { if (e.key === 'Enter' && e.target.dataset.pid) openProduct(byId(e.target.dataset.pid)) };
}

// ---------- Ürün penceresi ----------
let pmState = null;
function openProduct(p) {
  if (!p) return;
  closeProduct(true);
  const im = p.images, many = im.length > 1;
  const back = document.createElement('div');
  back.className = 'pm-back';
  back.innerHTML = `<div class="pm" role="dialog" aria-modal="true" aria-label="${esc(p.name)}">
    <button class="icon x" aria-label="Kapat">${icon('x')}</button>
    <div class="gal">
      <div class="main">${im.length ? `<img id="pmImg" src="${esc(im[0])}" alt="${esc(p.name)}">` : `<span class="noimg" style="position:absolute;inset:0;display:grid;place-items:center;color:var(--mut)">${icon('img')}</span>`}
        ${many ? `<button class="nav prev" aria-label="Önceki resim">${icon('left')}</button><button class="nav next" aria-label="Sonraki resim">${icon('right')}</button><span class="count" id="pmCount">1 / ${im.length}</span>` : ''}</div>
      ${many ? `<div class="thumbs">${im.map((u, i) => `<button data-i="${i}" class="${i ? '' : 'on'}" aria-label="Resim ${i + 1}"><img src="${esc(u)}" alt="" loading="lazy"></button>`).join('')}</div>` : ''}
    </div>
    <div class="pinfo">
      <span class="cat">${esc(p.category)}</span>
      <h2>${esc(p.name)}</h2>
      <div class="price">${money(p.price)}</div>
      ${p.description ? `<div class="desc">${esc(p.description)}</div>` : ''}
      <div class="buy"><div class="qty"><button data-q="-1" aria-label="Azalt">−</button><span id="pmQty">1</span><button data-q="1" aria-label="Artır">+</button></div>
      <button class="btn big" id="pmAdd">${icon('cart')}Sepete ekle</button></div>
      <div class="done-msg" id="pmDone"></div>
      <div class="perks"><div>${icon('card')}Kart, havale / EFT veya kapıda ödeme</div><div>${icon('shield')}E-posta doğrulamalı güvenli üyelik</div><div>${icon('truck')}Sipariş durumunu Siparişlerim sayfasından takip et</div></div>
    </div></div>`;
  document.body.append(back);
  document.body.classList.add('lock');
  requestAnimationFrame(() => back.classList.add('open'));
  pmState = { p, i: 0, qty: 1, back, prevFocus: document.activeElement };

  const show = i => {
    if (!im.length) return;
    pmState.i = (i + im.length) % im.length;
    $('pmImg').src = im[pmState.i];
    if (many) {
      $('pmCount').textContent = (pmState.i + 1) + ' / ' + im.length;
      back.querySelectorAll('.thumbs button').forEach((b, k) => b.classList.toggle('on', k === pmState.i));
      back.querySelector('.thumbs .on')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  };
  pmState.show = show;
  back.onclick = e => {
    if (e.target === back || e.target.closest('.x')) return closeProduct();
    if (e.target.closest('.prev')) return show(pmState.i - 1);
    if (e.target.closest('.next')) return show(pmState.i + 1);
    const t = e.target.closest('[data-i]'); if (t) return show(+t.dataset.i);
    const q = e.target.closest('[data-q]');
    if (q) { pmState.qty = Math.max(1, Math.min(99, pmState.qty + +q.dataset.q)); $('pmQty').textContent = pmState.qty; return }
    if (e.target.closest('#pmAdd')) {
      cart.add(p.id, pmState.qty);
      $('pmDone').innerHTML = `${pmState.qty} adet sepete eklendi · <a href="/sepet">Sepete git</a>`;
    }
  };
  // Parmakla kaydırarak resim değiştir
  const main = back.querySelector('.main'); let sx = null;
  main.addEventListener('touchstart', e => { sx = e.touches[0].clientX }, { passive: true });
  main.addEventListener('touchend', e => { if (sx === null) return; const dx = e.changedTouches[0].clientX - sx; if (Math.abs(dx) > 40) show(pmState.i + (dx < 0 ? 1 : -1)); sx = null });

  const u = new URL(location.href); u.searchParams.set('urun', p.id); history.replaceState(null, '', u);
  back.querySelector('.x').focus();
}
function closeProduct(silent) {
  if (!pmState) return;
  const { back, prevFocus } = pmState; pmState = null;
  back.classList.remove('open'); document.body.classList.remove('lock');
  setTimeout(() => back.remove(), silent ? 0 : 200);
  const u = new URL(location.href); u.searchParams.delete('urun'); history.replaceState(null, '', u);
  if (!silent && prevFocus && prevFocus.focus) prevFocus.focus();
}
addEventListener('keydown', e => {
  if (!pmState) return;
  if (e.key === 'Escape') closeProduct();
  else if (e.key === 'ArrowLeft') pmState.show(pmState.i - 1);
  else if (e.key === 'ArrowRight') pmState.show(pmState.i + 1);
});
// Adreste ?urun=7 varsa o ürünü aç (paylaşılan linkler için)
const openFromUrl = list => { const id = new URLSearchParams(location.search).get('urun'); if (id) openProduct(list.find(p => String(p.id) === id)) };

const reveal = () => {
  const io = new IntersectionObserver(
    es => es.forEach(e => e.isIntersecting && (e.target.classList.add('show'), io.unobserve(e.target))),
    { threshold: .08 }
  );
  document.querySelectorAll('.reveal:not(.show)').forEach(e => io.observe(e));
};

addEventListener('DOMContentLoaded', async () => {
  if (location.protocol === 'file:') {
    document.body.innerHTML = '<h2 style="padding:40px">Bu sayfa dosyadan açılamaz. Sunucu üzerinden açın.</h2>';
    return;
  }

  // Üst bar hemen çizilir; giriş durumu gelince menü güncellenir
  const p = location.pathname.replace(/\.html$/, '').replace(/\/index$/, '/') || '/';
  const q0 = new URLSearchParams(location.search).get('q') || '';
  const h = document.createElement('header');
  h.innerHTML = `<div class="hbar"><a class="logo" href="/"><i></i>berkburada</a>
    <form class="search" action="/magaza" role="search">${icon('search')}<input name="q" id="q" placeholder="Ürün ara" value="${esc(q0)}" autocomplete="off" aria-label="Ürün ara"></form>
    <nav id="nav"></nav>
    <button class="icon theme" id="themeBtn" type="button" aria-label="Karanlık moda geç"><span class="moon">${icon('moon')}</span><span class="sun">${icon('sun')}</span></button></div>`;
  document.body.prepend(h);
  setTheme(document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');
  $('themeBtn').onclick = () => setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
  const f = document.createElement('footer');
  const soc = SOCIAL.filter(s => s.url).map(s => `<a class="${s.cls}" href="${esc(s.url)}" target="_blank" rel="noopener noreferrer" aria-label="${s.name}" title="${s.name}">${s.svg()}</a>`).join('');
  f.innerHTML = `<div class="in"><span>© ${new Date().getFullYear()} berkburada · Kart, havale / EFT veya kapıda ödeme</span><div class="social">${soc}</div></div>`;
  document.body.append(f);
  reveal(); // sabit içerik API'yi beklemeden görünsün

  const drawNav = me => {
    const L = [['/magaza', 'Mağaza'], ['/blog', 'Blog', 'hide-m'], ['/iletisim', 'İletişim', 'hide-m']];
    if (me.user) L.push(['/siparislerim', 'Siparişlerim']);
    if (me.admin) L.push(['/admin', 'Admin']);
    L.push(me.user ? ['#', 'Çıkış'] : ['/giris', 'Giriş yap']);
    $('nav').innerHTML = L.map(([u, t, c]) => `<a href="${u}" class="${u == p ? 'on ' : ''}${c || ''}" ${u == '#' ? 'id="out" title="' + esc(me.name || '') + ' hesabından çık"' : ''}>${t}</a>`).join('') +
      `<a href="/sepet" class="cart${p == '/sepet' ? ' on' : ''}" aria-label="Sepet">${icon('cart')}<span>Sepet</span><span class="cnt zero" id="cn">0</span></a>`;
    cart.badge();
    const o = $('out');
    if (o) o.onclick = async e => { e.preventDefault(); await api('logout', 'POST'); location.href = '/' };
  };
  drawNav({});

  const me = await api('me').catch(() => ({}));
  drawNav(me);
  window.pageInit && await window.pageInit(me);
  reveal();
});
