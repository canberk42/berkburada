// Çalıştır: npm install && npm start  -> http://localhost:3000
const express = require('express'), bcrypt = require('bcryptjs'), crypto = require('crypto'), fs = require('fs'), path = require('path');
const E = process.env, ADMIN_USER = E.ADMIN_USER || 'admin', ADMIN_PASS = E.ADMIN_PASS || 'degistir123';
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
  const existingPost = await d1Get('SELECT id FROM posts LIMIT 1');
  if (!existingPost) {
    await d1Query('INSERT INTO posts(title,body) VALUES(?,?)', ['Hoş geldiniz', 'İlk blog yazımız. Admin panelinden yenilerini ekleyebilirsiniz.']);
  }
  console.log('[DB] Cloudflare D1 bağlantısı hazır.');
}

const UP = path.join(__dirname, 'public', 'uploads'); fs.mkdirSync(UP, { recursive: true });

// ---- Cloudinary Kalıcı Görsel Yükleme ----
const CLD_CLOUD = clean(E.CLOUDINARY_CLOUD_NAME);
const CLD_KEY = clean(E.CLOUDINARY_API_KEY);
const CLD_SECRET = clean(E.CLOUDINARY_API_SECRET);
const hasCloudinary = !!(CLD_CLOUD && CLD_KEY && CLD_SECRET);

if (hasCloudinary) console.log(`[MEDIA] Cloudinary aktif (cloud: ${CLD_CLOUD})`);
else console.warn('[MEDIA] Cloudinary ayarlı değil — yerel /uploads kullanılacak (deploy sonrası silinebilir).');

async function uploadToCloudinary(dataUrl) {
  const cloudName = String(E.CLOUDINARY_CLOUD_NAME || '').replace(/\s+/g, '');
  const apiKey = String(E.CLOUDINARY_API_KEY || '').replace(/\s+/g, '');
  const apiSecret = String(E.CLOUDINARY_API_SECRET || '').replace(/\s+/g, '');

  const timestamp = Math.floor(Date.now() / 1000);
  const toSign = `timestamp=${timestamp}${apiSecret}`;
  const signature = crypto.createHash('sha1').update(toSign).digest('hex');

  const form = new FormData();
  form.append('file', dataUrl);
  form.append('api_key', apiKey);
  form.append('timestamp', String(timestamp));
  form.append('signature', signature);

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
app.use(express.json({ limit: '8mb' })); app.use(express.urlencoded({ extended: false })); app.use(express.static(path.join(__dirname, 'public')));
const sess = q => { const t = (q.headers.cookie || '').match(/sid=([a-f0-9]+)/); return t && sessions.get(t[1]) };
const login = (r, d) => { const id = crypto.randomBytes(24).toString('hex'); sessions.set(id, d); r.setHeader('Set-Cookie', `sid=${id}; HttpOnly; Path=/; SameSite=Lax${BASE.startsWith('https') ? '; Secure' : ''}`) };
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
    const name = String(q.body.name || '').trim(), email = norm(q.body.email), pass = q.body.pass;
    if (!name || !/^\S+@\S+\.\S+$/.test(email) || (pass || '').length < 6) return r.status(400).json({ error: 'Geçerli ad, e-posta ve en az 6 haneli şifre girin' });
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
    const k = 'l' + q.ip; if (limited(k, 8)) return r.status(429).json({ error: 'Çok fazla deneme, 15 dk sonra tekrar deneyin' });
    const u = await d1Get('SELECT * FROM users WHERE lower(email)=? AND verified=1', [norm(q.body.email)]);
    if (!u || !bcrypt.compareSync(q.body.pass || '', u.pass)) { fail(k); return r.status(400).json({ error: 'E-posta veya şifre hatalı' }) } login(r, { uid: u.id, name: u.name }); r.json({ ok: true })
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
    if ((q.body.pass || '').length < 6) return r.status(400).json({ error: 'Şifre en az 6 karakter' });
    const u = await checkCode(norm(q.body.email), q.body.code); if (!u) return r.status(400).json({ error: 'Kod hatalı veya süresi dolmuş. Yeni kod isteyebilirsiniz.' });
    await d1Query('UPDATE users SET pass=?,code=NULL WHERE id=?', [bcrypt.hashSync(q.body.pass, 10), u.id]); login(r, { uid: u.id, name: u.name }); r.json({ ok: true })
  } catch (e) { console.error(e); r.status(500).json({ error: 'Sunucu hatası' }) }
});
app.post('/api/logout', (q, r) => { const t = (q.headers.cookie || '').match(/sid=([a-f0-9]+)/); if (t) sessions.delete(t[1]); r.json({ ok: true }) });
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
    const { name, email, text } = q.body; if (!name || !email || !text) return r.status(400).json({ error: 'Tüm alanlar gerekli' });
    await d1Query('INSERT INTO messages(name,email,text) VALUES(?,?,?)', [name, norm(email), text]); r.json({ ok: true })
  } catch (e) { console.error(e); r.status(500).json({ error: 'Mesaj gönderilemedi' }) }
});
app.get('/api/my-orders', needUser, async (q, r) => {
  try { r.json(await d1All('SELECT id,items,total,status,method,created FROM orders WHERE user_id=? ORDER BY id DESC', [q.s.uid])) }
  catch (e) { console.error(e); r.status(500).json({ error: 'Siparişler alınamadı' }) }
});

app.post('/api/
