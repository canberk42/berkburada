// Çalıştır: npm install && npm start  -> http://localhost:3000
const express = require('express'), bcrypt = require('bcryptjs'), crypto = require('crypto'), fs = require('fs'), path = require('path');
// Varsayılan admin şifresi yok: ADMIN_PASS ayarlı değilse admin girişi kapalı kalır.
const E = process.env, ADMIN_USER = E.ADMIN_USER || 'admin', ADMIN_PASS = E.ADMIN_PASS || '';
if (!ADMIN_PASS) console.warn('[ADMIN] ADMIN_PASS ayarlı değil — admin girişi kapalı.');
const BASE = ((E.BASE_URL || 'http://localhost:3000').match(/https?:\/\/[^\s)\]]+/) || ['http://localhost:3000'])[0].replace(/\/+$/, '');
const PORT = +E.PORT || 3000, PROD = E.NODE_ENV === 'production' || !!E.RENDER;

// ---- Cloudflare D1 REST API ----
const clean = v => (v || '').trim();
const CF_ACCOUNT_ID = clean(E.CF_ACCOUNT_ID);
const CF_D1_DB_ID = clean(E.CF_D1_DB_ID);
const CF_D1_TOKEN = clean(E.CF_D1_TOKEN);

async function d1Query(sql, params = []) {
  if (!CF_ACCOUNT_ID || !CF_D1_DB_ID || !CF_D1_TOKEN) {
    throw new Error('Cloudflare D1 ortam değişkenleri eksik (CF_ACCOUNT_ID, CF_D1_DB_ID, CF_D1_TOKEN)');
  }
  const url = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/d1/database/${CF_D1_DB_ID}/query`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${CF_D1_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ sql, params }),
    signal: AbortSignal.timeout(15000)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.success === false) {
    const errMsg = (data.errors && data.errors[0] && data.errors[0].message) || data.message || `HTTP ${res.status}`;
    throw new Error(`D1 Sorgu Hatası: ${errMsg}`);
  }
  const first = Array.isArray(data.result) ? data.result[0] : data.result;
  return {
    rows: Array.isArray(first?.results) ? first.results : [],
    meta: first?.meta || {}
  };
}

const d1All = async (sql, params = []) => (await d1Query(sql, params)).rows;
const d1Get = async (sql, params = []) => (await d1Query(sql, params)).rows[0] || null;

// ---- Otomatik Blog Metin Düzenleyici ----
function formatInlineSpaces(str) {
  return String(str || '')
    .replace(/[ \t]+/g, ' ')
    .replace(/ ([.,!?:;])/g, '$1')
    .replace(/([,!?;:])([^\s\n"'’”)\]])/g, '$1 $2')
    .replace(/\.([^\s\n\d"'’”)\]])/g, '. $1')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

function formatBlogPost(rawTitle, rawBody) {
  const title = formatInlineSpaces(rawTitle);
  const normalizedLines = String(rawBody || '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map(line => formatInlineSpaces(line));

  const paragraphs = [];
  let buf = [];
  for (const line of normalizedLines) {
    if (!line) {
      if (buf.length) {
        paragraphs.push(buf.join(' '));
        buf = [];
      }
    } else {
      buf.push(line);
    }
  }
  if (buf.length) paragraphs.push(buf.join(' '));

  const body = paragraphs.join('\n\n');
  return { title, body };
}

async function initDb() {
  const statements = [
    `CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT UNIQUE, name TEXT, pass TEXT, verified INTEGER DEFAULT 0, code TEXT, code_exp INTEGER)`,
    `CREATE TABLE IF NOT EXISTS products (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, category TEXT, price REAL, image TEXT, description TEXT)`,
    `CREATE TABLE IF NOT EXISTS orders (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, items TEXT, total REAL, status TEXT, method TEXT, address TEXT, iyzi_token TEXT, created TEXT DEFAULT (datetime('now')))`,
    `CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, email TEXT, text TEXT)`,
    `CREATE TABLE IF NOT EXISTS posts (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, body TEXT)`
  ];
  for (const s of statements) await d1Query(s);
  for (const c of ['status TEXT', 'method TEXT', 'address TEXT', 'iyzi_token TEXT']) {
    try { await d1Query('ALTER TABLE orders ADD COLUMN ' + c); } catch {}
  }
  console.log('[DB] Cloudflare D1 bağlantısı hazır.');
}

const UP = path.join(__dirname, 'public', 'uploads'); fs.mkdirSync(UP, { recursive: true });

// ---- Cloudinary Kalıcı Görsel Yükleme ----
const CLD_CLOUD = String(E.CLOUDINARY_CLOUD_NAME || '').replace(/\s+/g, '');
const CLD_KEY = String(E.CLOUDINARY_API_KEY || '').replace(/\s+/g, '');
const CLD_SECRET = String(E.CLOUDINARY_API_SECRET || '').replace(/\s+/g, '');
const CLD_PRESET = String(E.CLOUDINARY_UPLOAD_PRESET || '').replace(/\s+/g, '');
const hasCloudinary = !!(CLD_CLOUD && (CLD_PRESET || (CLD_KEY && CLD_SECRET)));

if (hasCloudinary) console.log(`[MEDIA] Cloudinary aktif (cloud: ${CLD_CLOUD}${CLD_PRESET ? ', preset: ' + CLD_PRESET : ''})`);
else console.warn('[MEDIA] Cloudinary ayarlı değil — yerel /uploads kullanılacak (deploy sonrası silinebilir).');

async function uploadToCloudinary(dataUrl) {
  const cloudName = String(E.CLOUDINARY_CLOUD_NAME || '').replace(/\s+/g, '');
  const uploadPreset = String(E.CLOUDINARY_UPLOAD_PRESET || '').replace(/\s+/g, '');

  const form = new FormData();
  form.append('file', dataUrl);

  if (uploadPreset) {
    form.append('upload_preset', uploadPreset);
  } else {
    const apiKey = String(E.CLOUDINARY_API_KEY || '').replace(/\s+/g, '');
    const apiSecret = String(E.CLOUDINARY_API_SECRET || '').replace(/\s+/g, '');
    const timestamp = Math.floor(Date.now() / 1000);
    const toSign = `timestamp=${timestamp}${apiSecret}`;
    const signature = crypto.createHash('sha1').update(toSign).digest('hex');
    form.append('api_key', apiKey);
    form.append('timestamp', String(timestamp));
    form.append('signature', signature);
  }

  const res = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/upload`, {
    method: 'POST',
    body: form,
    signal: AbortSignal.timeout(20000)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.secure_url) {
    throw new Error(data.error?.message || `Cloudinary yükleme hatası (${res.status})`);
  }
  return data.secure_url;
}

// ---- E-posta (Resend HTTPS API) ----
const RESEND_API_KEY = clean(E.RESEND_API_KEY);
const RESEND_FROM = clean(E.RESEND_FROM || E.SMTP_FROM) || 'Mağazam <noreply@berkburada.com>';

if (RESEND_API_KEY) console.log(`[MAIL] Resend (HTTPS) kullanılıyor, gönderen: ${RESEND_FROM}`);
else console.warn('[MAIL] RESEND_API_KEY ayarlı değil' + (PROD ? ' — canlıda kod gönderilemez!' : ' — kodlar konsola yazılacak.'));

async function sendResendMail({ to, subject, text }) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: RESEND_FROM,
      to: [to],
      subject,
      text
    }),
    signal: AbortSignal.timeout(10000)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Resend ${res.status}: ${data.message || data.error || 'Bilinmeyen hata'}`);
  }
  return data;
}

const Iyzipay = E.IYZICO_API_KEY ? require('iyzipay') : null;
const iyzi = Iyzipay && new Iyzipay({ apiKey: E.IYZICO_API_KEY, secretKey: E.IYZICO_SECRET, uri: E.IYZICO_URI || 'https://sandbox-api.iyzipay.com' });
const STATUSES = ['Ödeme Bekliyor', 'Havale Bekleniyor', 'Hazırlanıyor', 'Kargoda', 'Teslim Edildi', 'İptal'];
const sessions = new Map(), tries = new Map();
const limited = (k, max = 5, win = 15 * 60000) => { const n = Date.now(), a = (tries.get(k) || []).filter(t => n - t < win); tries.set(k, a); return a.length >= max };
const fail = k => { const a = tries.get(k) || []; a.push(Date.now()); tries.set(k, a) };
const norm = e => String(e ?? '').trim().toLowerCase();
const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');

// ---- Güvenlik başlıkları ----
app.use((q, r, n) => {
  r.setHeader('X-Content-Type-Options', 'nosniff');
  r.setHeader('X-Frame-Options', 'DENY');
  r.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  r.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  r.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'");
  if (BASE.startsWith('https')) r.setHeader('Strict-Transport-Security', 'max-age=31536000');
  n();
});

// ---- İstek boyutu: görsel yükleme dışında küçük tut ----
const jsonSmall = express.json({ limit: '100kb' }), jsonBig = express.json({ limit: '8mb' });
app.use((q, r, n) => (q.path === '/api/admin/upload' ? jsonBig : jsonSmall)(q, r, n));
app.use(express.urlencoded({ extended: false, limit: '100kb' }));

// ---- Başka sitelerden gelen istekleri reddet (CSRF) ----
app.use('/api', (q, r, n) => {
  if (q.method === 'GET' || q.method === 'HEAD' || q.path === '/pay/callback') return n();
  const o = q.headers.origin;
  if (o) { let h = ''; try { h = new URL(o).host } catch {} if (h !== q.headers.host) return r.status(403).json({ error: 'Geçersiz istek kaynağı' }) }
  n();
});

// ---- Temiz adresler: /magaza.html -> /magaza, /index.html -> / ----
app.use((q, r, n) => {
  if (q.method !== 'GET' && q.method !== 'HEAD') return n();
  const m = q.path.match(/^(.*\/)?([^/]+)\.html$/);
  if (!m) return n();
  const dir = m[1] || '/', target = m[2] === 'index' ? dir : dir + m[2];
  r.redirect(301, target + q.originalUrl.slice(q.path.length));
});
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

// ---- Oturumlar: süreli, admin daha kısa ----
const SESSION_TTL = 7 * 24 * 3600e3, ADMIN_TTL = 8 * 3600e3;
const cookie = (id, ms) => `sid=${id}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${Math.floor(ms / 1000)}${BASE.startsWith('https') ? '; Secure' : ''}`;
const sid = q => ((q.headers.cookie || '').match(/(?:^|;\s*)sid=([a-f0-9]{48})(?:;|$)/) || [])[1];
const sess = q => { const id = sid(q), s = id && sessions.get(id); if (!s) return null; if (Date.now() > s.exp) { sessions.delete(id); return null } return s };
const login = (r, d) => { const id = crypto.randomBytes(24).toString('hex'), ttl = d.admin ? ADMIN_TTL : SESSION_TTL; sessions.set(id, { ...d, exp: Date.now() + ttl }); r.setHeader('Set-Cookie', cookie(id, ttl)) };
const dropUserSessions = uid => { for (const [k, s] of sessions) if (s.uid === uid) sessions.delete(k) };
setInterval(() => {
  const t = Date.now();
  for (const [k, s] of sessions) if (t > s.exp) sessions.delete(k);
  for (const [k, a] of tries) if (!a.length || t - a[a.length - 1] > 15 * 60000) tries.delete(k);
}, 10 * 60000).unref();
const safeEq = (a, b) => crypto.timingSafeEqual(crypto.createHash('sha256').update(String(a ?? '')).digest(), crypto.createHash('sha256').update(String(b ?? '')).digest());
const str = (v, max) => String(v ?? '').trim().slice(0, max);
const okEmail = e => e.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
const needUser = (q, r, n) => { const s = sess(q); if (!s || !s.uid) return r.status(401).json({ error: 'Giriş yapın' }); q.s = s; n() };
const needAdmin = (q, r, n) => { const s = sess(q); if (!s || !s.admin) return r.status(403).json({ error: 'Yetkisiz' }); n() };
const getUser = email => d1Get('SELECT * FROM users WHERE lower(email)=?', [email]);
const sendCode = async (email, subject) => {
  const code = String(crypto.randomInt(100000, 1000000));
  await d1Query('UPDATE users SET code=?,code_exp=? WHERE lower(email)=?', [code, Date.now() + 10 * 60000, email]);
  const bodyText = `Kodunuz: ${code}\nBu kod 10 dakika geçerlidir. Talebi siz yapmadıysanız bu e-postayı yok sayın.`;
  if (RESEND_API_KEY) await sendResendMail({ to: email, subject, text: bodyText });
  else if (PROD) throw new Error('RESEND_API_KEY ayarlı değil');
  else console.log(`[KOD] ${email}: ${code}`);
};
const sendLimited = email => { const k = 's' + email; if (limited(k, 5)) return true; fail(k); return false };
const checkCode = async (email, code) => {
  const k = 'c' + email; if (limited(k)) return null; const u = await getUser(email);
  if (!u || !u.code || u.code !== String(code ?? '').trim() || Date.now() > u.code_exp) { fail(k); return null } return u
};

app.post('/api/register', async (q, r) => {
  try {
    const name = str(q.body.name, 80), email = norm(q.body.email), pass = typeof q.body.pass === 'string' ? q.body.pass : '';
    if (!name || !okEmail(email) || pass.length < 6) return r.status(400).json({ error: 'Geçerli ad, e-posta ve en az 6 haneli şifre girin' });
    if (pass.length > 72) return r.status(400).json({ error: 'Şifre en fazla 72 karakter olabilir' });
    const kr = 'r' + q.ip; if (limited(kr, 10)) return r.status(429).json({ error: 'Çok fazla deneme, 15 dk sonra tekrar deneyin' }); fail(kr);
    const ex = await getUser(email); if (ex && ex.verified) return r.status(400).json({ error: 'Bu e-posta kayıtlı' });
    if (sendLimited(email)) return r.status(429).json({ error: 'Çok fazla kod istendi, 15 dk sonra tekrar deneyin' });
    const h = bcrypt.hashSync(pass, 10);
    if (ex) await d1Query('UPDATE users SET name=?,pass=? WHERE id=?', [name, h, ex.id]);
    else await d1Query('INSERT INTO users(email,name,pass) VALUES(?,?,?)', [email, name, h]);
    try { await sendCode(email, 'Doğrulama kodunuz') } catch (e) { console.error('[MAIL] Gönderilemedi:', e.message); return r.status(500).json({ error: 'E-posta gönderilemedi, lütfen daha sonra tekrar deneyin' }) }
    r.json({ ok: true })
  } catch (e) { console.error(e); r.status(500).json({ error: 'Sunucu hatası' }) }
});
app.post('/api/verify', async (q, r) => {
  try {
    const u = await checkCode(norm(q.body.email), q.body.code); if (!u) return r.status(400).json({ error: 'Kod hatalı, süresi dolmuş veya çok fazla deneme. Yeni kod isteyebilirsiniz.' });
    await d1Query('UPDATE users SET verified=1,code=NULL WHERE id=?', [u.id]); login(r, { uid: u.id, name: u.name }); r.json({ ok: true })
  } catch (e) { console.error(e); r.status(500).json({ error: 'Sunucu hatası' }) }
});
app.post('/api/login', async (q, r) => {
  try {
    const email = norm(q.body.email), k = 'l' + q.ip, ke = 'le' + email;
    if (limited(k, 8) || limited(ke, 10)) return r.status(429).json({ error: 'Çok fazla deneme, 15 dk sonra tekrar deneyin' });
    const u = await d1Get('SELECT * FROM users WHERE lower(email)=? AND verified=1', [email]);
    if (!u || !bcrypt.compareSync(String(q.body.pass ?? '').slice(0, 72), u.pass)) { fail(k); fail(ke); return r.status(400).json({ error: 'E-posta veya şifre hatalı' }) } login(r, { uid: u.id, name: u.name }); r.json({ ok: true })
  } catch (e) { console.error(e); r.status(500).json({ error: 'Sunucu hatası' }) }
});
app.post('/api/forgot', async (q, r) => {
  try {
    const k = 'f' + q.ip; if (limited(k, 5)) return r.status(429).json({ error: 'Çok fazla deneme' }); fail(k);
    const email = norm(q.body.email); const u = await d1Get('SELECT * FROM users WHERE lower(email)=? AND verified=1', [email]);
    if (u && !sendLimited(email)) try { await sendCode(email, 'Şifre sıfırlama kodu') } catch (e) { console.error('[MAIL] Gönderilemedi:', e.message) } r.json({ ok: true })
  } catch (e) { console.error(e); r.status(500).json({ error: 'Sunucu hatası' }) }
});
app.post('/api/reset', async (q, r) => {
  try {
    const pass = typeof q.body.pass === 'string' ? q.body.pass : '';
    if (pass.length < 6 || pass.length > 72) return r.status(400).json({ error: 'Şifre 6 ile 72 karakter arasında olmalı' });
    const u = await checkCode(norm(q.body.email), q.body.code); if (!u) return r.status(400).json({ error: 'Kod hatalı veya süresi dolmuş. Yeni kod isteyebilirsiniz.' });
    await d1Query('UPDATE users SET pass=?,code=NULL WHERE id=?', [bcrypt.hashSync(pass, 10), u.id]);
    dropUserSessions(u.id); // şifre değişince eski oturumlar kapanır
    login(r, { uid: u.id, name: u.name }); r.json({ ok: true })
  } catch (e) { console.error(e); r.status(500).json({ error: 'Sunucu hatası' }) }
});
app.post('/api/logout', (q, r) => { const id = sid(q); if (id) sessions.delete(id); r.setHeader('Set-Cookie', cookie('', 0)); r.json({ ok: true }) });
app.get('/api/me', (q, r) => { const s = sess(q); r.json(s ? { name: s.name, admin: !!s.admin, user: !!s.uid } : {}) });
app.get('/api/products', async (q, r) => {
  try { r.json(await d1All('SELECT * FROM products ORDER BY id DESC')) }
  catch (e) { console.error(e); r.status(500).json({ error: 'Ürünler yüklenemedi' }) }
});
app.get('/api/posts', async (q, r) => {
  try { r.json(await d1All('SELECT * FROM posts ORDER BY id DESC')) }
  catch (e) { console.error(e); r.status(500).json({ error: 'Yazılar yüklenemedi' }) }
});
app.post('/api/contact', async (q, r) => {
  try {
    const name = str(q.body.name, 80), email = norm(q.body.email).slice(0, 254), text = str(q.body.text, 3000);
    if (!name || !email || !text) return r.status(400).json({ error: 'Tüm alanlar gerekli' });
    if (!okEmail(email)) return r.status(400).json({ error: 'Geçerli bir e-posta girin' });
    const k = 'm' + q.ip; if (limited(k, 5)) return r.status(429).json({ error: 'Çok fazla mesaj gönderildi, 15 dk sonra tekrar deneyin' }); fail(k);
    await d1Query('INSERT INTO messages(name,email,text) VALUES(?,?,?)', [name, email, text]); r.json({ ok: true })
  } catch (e) { console.error(e); r.status(500).json({ error: 'Mesaj gönderilemedi' }) }
});
app.get('/api/my-orders', needUser, async (q, r) => {
  try { r.json(await d1All('SELECT id,items,total,status,method,created FROM orders WHERE user_id=? ORDER BY id DESC', [q.s.uid])) }
  catch (e) { console.error(e); r.status(500).json({ error: 'Siparişler alınamadı' }) }
});

app.post('/api/order', needUser, async (q, r) => {
  try {
    const { method } = q.body, items = q.body.items && typeof q.body.items === 'object' ? q.body.items : {}, a0 = q.body.address || {};
    if (!['card', 'cod', 'eft'].includes(method)) return r.status(400).json({ error: 'Ödeme yöntemi seçin' });
    const address = { name: str(a0.name, 100), phone: str(a0.phone, 20), city: str(a0.city, 60), address: str(a0.address, 500) };
    if (!address.name || !address.phone || !address.city || !address.address) return r.status(400).json({ error: 'Teslimat bilgilerini doldurun' });
    if (!/^\+?[0-9 ()-]{10,20}$/.test(address.phone)) return r.status(400).json({ error: 'Geçerli bir telefon numarası girin' });
    const entries = Object.entries(items);
    if (entries.length > 50) return r.status(400).json({ error: 'Sepette çok fazla ürün var' });
    const ko = 'o' + q.s.uid; if (limited(ko, 10)) return r.status(429).json({ error: 'Çok fazla sipariş denemesi, 15 dk sonra tekrar deneyin' }); fail(ko);
    let total = 0; const list = [];
    for (const [id, n] of entries) {
      const p = await d1Get('SELECT * FROM products WHERE id=?', [id]), qty = Math.min(parseInt(n) || 0, 99);
      if (p && qty > 0) { total += p.price * qty; list.push({ id: p.id, name: p.name, category: p.category, qty, price: p.price }) }
    }
    if (!list.length) return r.status(400).json({ error: 'Sepet boş' });
    if (method === 'card' && !iyzi) return r.status(400).json({ error: 'Kart ödemesi henüz yapılandırılmadı (iyzico anahtarları gerekli)' });
    const status = { card: 'Ödeme Bekliyor', eft: 'Havale Bekleniyor', cod: 'Hazırlanıyor' }[method];
    const ins = await d1Query('INSERT INTO orders(user_id,items,total,status,method,address) VALUES(?,?,?,?,?,?)', [q.s.uid, JSON.stringify(list), total, status, method, JSON.stringify(address)]);
    const id = ins.meta?.last_row_id;
    if (method !== 'card') return r.json({ ok: true, total, id, iban: method === 'eft' ? (E.IBAN || 'TR720006701000000016171030') : null });
    const u = await d1Get('SELECT * FROM users WHERE id=?', [q.s.uid]), [fn, ...ln] = address.name.trim().split(' '), ad = { contactName: address.name, city: address.city, country: 'Turkey', address: address.address };
    iyzi.checkoutFormInitialize.create({
      locale: 'tr', conversationId: String(id), price: total.toFixed(2), paidPrice: total.toFixed(2), currency: 'TRY', basketId: String(id), paymentGroup: 'PRODUCT', callbackUrl: BASE + '/api/pay/callback', enabledInstallments: [1],
      buyer: { id: String(u.id), name: fn, surname: ln.join(' ') || fn, gsmNumber: address.phone, email: u.email, identityNumber: '11111111111', registrationAddress: address.address, ip: q.ip || '85.34.78.112', city: address.city, country: 'Turkey' },
      shippingAddress: ad, billingAddress: ad, basketItems: list.map(i => ({ id: String(i.id), name: i.name, category1: i.category || 'Genel', itemType: 'PHYSICAL', price: (i.price * i.qty).toFixed(2) }))
    }, async (err, res) => {
      if (err || res.status !== 'success') { await d1Query('UPDATE orders SET status=? WHERE id=?', ['İptal', id]); return r.status(500).json({ error: 'Ödeme başlatılamadı: ' + (res && res.errorMessage || '') }) }
      await d1Query('UPDATE orders SET iyzi_token=? WHERE id=?', [res.token, id]); r.json({ ok: true, url: res.paymentPageUrl })
    })
  } catch (e) { console.error(e); r.status(500).json({ error: 'Sipariş oluşturulamadı' }) }
});
app.post('/api/pay/callback', async (q, r) => {
  try {
    const token = q.body.token, o = iyzi && await d1Get('SELECT * FROM orders WHERE iyzi_token=? AND status=?', [token, 'Ödeme Bekliyor']);
    if (!o) return r.redirect('/siparislerim');
    iyzi.checkoutForm.retrieve({ locale: 'tr', conversationId: String(o.id), token }, async (err, res) => {
      const ok = !err && res.paymentStatus === 'SUCCESS' && String(res.basketId) === String(o.id) && Math.abs(parseFloat(res.paidPrice) - o.total) < 0.01;
      await d1Query('UPDATE orders SET status=? WHERE id=?', [ok ? 'Hazırlanıyor' : 'İptal', o.id]); r.redirect('/siparislerim?' + (ok ? 'ok' : 'fail'))
    })
  } catch (e) { console.error(e); r.redirect('/siparislerim?fail') }
});

// Admin
app.post('/api/admin/login', (q, r) => {
  const k = 'a' + q.ip; if (limited(k)) return r.status(429).json({ error: 'Çok fazla deneme, 15 dk bekleyin' });
  if (!ADMIN_PASS) return r.status(503).json({ error: 'Admin girişi yapılandırılmamış' });
  const okUser = safeEq(q.body.user, ADMIN_USER), okPass = safeEq(q.body.pass, ADMIN_PASS);
  if (okUser && okPass) { login(r, { admin: true, name: 'Admin' }); return r.json({ ok: true }) } fail(k); r.status(400).json({ error: 'Hatalı bilgi' })
});
app.post('/api/admin/upload', needAdmin, async (q, r) => {
  try {
    const dataUrl = String(q.body.data || '');
    const m = /^data:image\/(png|jpeg|webp);base64,(.+)$/.exec(dataUrl);
    if (!m) return r.status(400).json({ error: 'Sadece png/jpg/webp' });
    if (hasCloudinary) {
      const url = await uploadToCloudinary(dataUrl);
      return r.json({ url });
    }
    const f = crypto.randomBytes(8).toString('hex') + '.' + (m[1] == 'jpeg' ? 'jpg' : m[1]);
    fs.writeFileSync(path.join(UP, f), Buffer.from(m[2], 'base64'));
    r.json({ url: '/uploads/' + f });
  } catch (e) {
    console.error('[UPLOAD]', e.message);
    r.status(500).json({ error: 'Görsel yüklenemedi: ' + e.message });
  }
});
app.post('/api/admin/products', needAdmin, async (q, r) => {
  try {
    const name = str(q.body.name, 120), category = str(q.body.category, 60) || 'Genel', price = Number(q.body.price), image = str(q.body.image, 500), description = str(q.body.description, 3000);
    if (!name || !(price > 0) || price > 1e7) return r.status(400).json({ error: 'Ad ve fiyat gerekli' });
    if (image && !/^(https:\/\/|\/uploads\/)/.test(image)) return r.status(400).json({ error: 'Görsel adresi https:// ile başlamalı' });
    await d1Query('INSERT INTO products(name,category,price,image,description) VALUES(?,?,?,?,?)', [name, category, price, image, description]); r.json({ ok: true })
  } catch (e) { console.error(e); r.status(500).json({ error: 'Ürün eklenemedi' }) }
});
app.delete('/api/admin/products/:id', needAdmin, async (q, r) => {
  try { await d1Query('DELETE FROM products WHERE id=?', [q.params.id]); r.json({ ok: true }) }
  catch (e) { console.error(e); r.status(500).json({ error: 'Ürün silinemedi' }) }
});
app.post('/api/admin/posts', needAdmin, async (q, r) => {
  try {
    const { title, body } = formatBlogPost(q.body.title, q.body.body);
    if (!title || !body) return r.status(400).json({ error: 'Başlık ve içerik gerekli' });
    await d1Query('INSERT INTO posts(title,body) VALUES(?,?)', [title, body]); r.json({ ok: true, post: { title, body } })
  } catch (e) { console.error(e); r.status(500).json({ error: 'Yazı eklenemedi' }) }
});
app.delete('/api/admin/posts/:id', needAdmin, async (q, r) => {
  try {
    const postId = parseInt(q.params.id, 10);
    if (!postId) return r.status(400).json({ error: 'Geçersiz yazı ID' });
    await d1Query('DELETE FROM posts WHERE id=?', [postId]);
    r.json({ ok: true });
  } catch (e) {
    console.error(e);
    r.status(500).json({ error: 'Yazı silinemedi' });
  }
});
app.put('/api/admin/orders/:id', needAdmin, async (q, r) => {
  try {
    if (!STATUSES.includes(q.body.status)) return r.status(400).json({ error: 'Geçersiz durum' });
    await d1Query('UPDATE orders SET status=? WHERE id=?', [q.body.status, q.params.id]); r.json({ ok: true })
  } catch (e) { console.error(e); r.status(500).json({ error: 'Sipariş güncellenemedi' }) }
});
app.get('/api/admin/data', needAdmin, async (q, r) => {
  try {
    const orders = await d1All('SELECT o.*,u.email FROM orders o JOIN users u ON u.id=o.user_id ORDER BY o.id DESC');
    const messages = await d1All('SELECT * FROM messages ORDER BY id DESC');
    r.json({ statuses: STATUSES, orders, messages })
  } catch (e) { console.error(e); r.status(500).json({ error: 'Admin verileri alınamadı' }) }
});

initDb()
  .catch(err => console.error('[DB] Başlangıç kontrolünde hata:', err.message))
  .finally(() => {
    app.listen(PORT, () => console.log('Site: ' + BASE + ' (port ' + PORT + ')'));
  });
