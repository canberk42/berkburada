// Çalıştır: npm install && npm start  -> http://localhost:3000
const express = require('express'), Database = require('better-sqlite3'), bcrypt = require('bcryptjs'), crypto = require('crypto'), fs = require('fs'), path = require('path');
const E = process.env, ADMIN_USER = E.ADMIN_USER || 'admin', ADMIN_PASS = E.ADMIN_PASS || 'degistir123';
// BASE_URL'e yanlışlıkla markdown ([url](url)) yapıştırılırsa temizle
const BASE = ((E.BASE_URL || 'http://localhost:3000').match(/https?:\/\/[^\s)\]]+/) || ['http://localhost:3000'])[0].replace(/\/+$/, '');
const PORT = +E.PORT || 3000, PROD = E.NODE_ENV === 'production' || !!E.RENDER;
const db = new Database(path.join(__dirname, 'magaza.db'));
db.exec(`CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY,email TEXT UNIQUE,name TEXT,pass TEXT,verified INTEGER DEFAULT 0,code TEXT,code_exp INTEGER);
CREATE TABLE IF NOT EXISTS products(id INTEGER PRIMARY KEY,name TEXT,category TEXT,price REAL,image TEXT,description TEXT);
CREATE TABLE IF NOT EXISTS orders(id INTEGER PRIMARY KEY,user_id INTEGER,items TEXT,total REAL,created DATETIME DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS messages(id INTEGER PRIMARY KEY,name TEXT,email TEXT,text TEXT);
CREATE TABLE IF NOT EXISTS posts(id INTEGER PRIMARY KEY,title TEXT,body TEXT);`);
for (const c of ['status TEXT', 'method TEXT', 'address TEXT', 'iyzi_token TEXT']) try { db.exec('ALTER TABLE orders ADD COLUMN ' + c) } catch {}
if (!db.prepare('SELECT 1 FROM posts').get()) db.prepare('INSERT INTO posts(title,body) VALUES(?,?)').run('Hoş geldiniz', 'İlk blog yazımız. Admin panelinden yenilerini ekleyebilirsiniz.');
const UP = path.join(__dirname, 'public', 'uploads'); fs.mkdirSync(UP, { recursive: true });

// ---- E-posta (Resend HTTPS API) ----
const clean = v => (v || '').trim();
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
app.set('trust proxy', 1); // Render/proxy arkasında gerçek istemci IP'si
app.use(express.json({ limit: '8mb' })); app.use(express.urlencoded({ extended: false })); app.use(express.static(path.join(__dirname, 'public')));
const sess = q => { const t = (q.headers.cookie || '').match(/sid=([a-f0-9]+)/); return t && sessions.get(t[1]) };
const login = (r, d) => { const id = crypto.randomBytes(24).toString('hex'); sessions.set(id, d); r.setHeader('Set-Cookie', `sid=${id}; HttpOnly; Path=/; SameSite=Lax${BASE.startsWith('https') ? '; Secure' : ''}`) };
const needUser = (q, r, n) => { const s = sess(q); if (!s || !s.uid) return r.status(401).json({ error: 'Giriş yapın' }); q.s = s; n() };
const needAdmin = (q, r, n) => { const s = sess(q); if (!s || !s.admin) return r.status(403).json({ error: 'Yetkisiz' }); n() };
const getUser = email => db.prepare('SELECT * FROM users WHERE lower(email)=?').get(email);
const sendCode = async (email, subject) => {
  const code = String(crypto.randomInt(100000, 1000000));
  db.prepare('UPDATE users SET code=?,code_exp=? WHERE lower(email)=?').run(code, Date.now() + 10 * 60000, email);
  const bodyText = `Kodunuz: ${code}\nBu kod 10 dakika geçerlidir. Talebi siz yapmadıysanız bu e-postayı yok sayın.`;
  if (RESEND_API_KEY) await sendResendMail({ to: email, subject, text: bodyText });
  else if (PROD) throw new Error('RESEND_API_KEY ayarlı değil');
  else console.log(`[KOD] ${email}: ${code}`);
};
// Aynı e-postaya kısa sürede çok fazla kod gönderimini engelle
const sendLimited = email => { const k = 's' + email; if (limited(k, 5)) return true; fail(k); return false };
const checkCode = (email, code) => {
  const k = 'c' + email; if (limited(k)) return null; const u = getUser(email);
  if (!u || !u.code || u.code !== String(code ?? '').trim() || Date.now() > u.code_exp) { fail(k); return null } return u
};

app.post('/api/register', async (q, r) => {
  const name = String(q.body.name || '').trim(), email = norm(q.body.email), pass = q.body.pass;
  if (!name || !/^\S+@\S+\.\S+$/.test(email) || (pass || '').length < 6) return r.status(400).json({ error: 'Geçerli ad, e-posta ve en az 6 haneli şifre girin' });
  const ex = getUser(email); if (ex && ex.verified) return r.status(400).json({ error: 'Bu e-posta kayıtlı' });
  if (sendLimited(email)) return r.status(429).json({ error: 'Çok fazla kod istendi, 15 dk sonra tekrar deneyin' });
  const h = bcrypt.hashSync(pass, 10);
  if (ex) db.prepare('UPDATE users SET name=?,pass=? WHERE id=?').run(name, h, ex.id); else db.prepare('INSERT INTO users(email,name,pass) VALUES(?,?,?)').run(email, name, h);
  try { await sendCode(email, 'Doğrulama kodunuz') } catch (e) { console.error('[MAIL] Gönderilemedi:', e.message); return r.status(500).json({ error: 'E-posta gönderilemedi, lütfen daha sonra tekrar deneyin' }) } r.json({ ok: true })
});
app.post('/api/verify', (q, r) => {
  const u = checkCode(norm(q.body.email), q.body.code); if (!u) return r.status(400).json({ error: 'Kod hatalı, süresi dolmuş veya çok fazla deneme. Yeni kod isteyebilirsiniz.' });
  db.prepare('UPDATE users SET verified=1,code=NULL WHERE id=?').run(u.id); login(r, { uid: u.id, name: u.name }); r.json({ ok: true })
});
app.post('/api/login', (q, r) => {
  const k = 'l' + q.ip; if (limited(k, 8)) return r.status(429).json({ error: 'Çok fazla deneme, 15 dk sonra tekrar deneyin' });
  const u = db.prepare('SELECT * FROM users WHERE lower(email)=? AND verified=1').get(norm(q.body.email));
  if (!u || !bcrypt.compareSync(q.body.pass || '', u.pass)) { fail(k); return r.status(400).json({ error: 'E-posta veya şifre hatalı' }) } login(r, { uid: u.id, name: u.name }); r.json({ ok: true })
});
app.post('/api/forgot', async (q, r) => {
  const k = 'f' + q.ip; if (limited(k, 5)) return r.status(429).json({ error: 'Çok fazla deneme' }); fail(k);
  const email = norm(q.body.email); const u = db.prepare('SELECT * FROM users WHERE lower(email)=? AND verified=1').get(email);
  if (u && !sendLimited(email)) try { await sendCode(email, 'Şifre sıfırlama kodu') } catch (e) { console.error('[MAIL] Gönderilemedi:', e.message) } r.json({ ok: true })
});
app.post('/api/reset', (q, r) => {
  if ((q.body.pass || '').length < 6) return r.status(400).json({ error: 'Şifre en az 6 karakter' });
  const u = checkCode(norm(q.body.email), q.body.code); if (!u) return r.status(400).json({ error: 'Kod hatalı veya süresi dolmuş. Yeni kod isteyebilirsiniz.' });
  db.prepare('UPDATE users SET pass=?,code=NULL WHERE id=?').run(bcrypt.hashSync(q.body.pass, 10), u.id); login(r, { uid: u.id, name: u.name }); r.json({ ok: true })
});
app.post('/api/logout', (q, r) => { const t = (q.headers.cookie || '').match(/sid=([a-f0-9]+)/); if (t) sessions.delete(t[1]); r.json({ ok: true }) });
app.get('/api/me', (q, r) => { const s = sess(q); r.json(s ? { name: s.name, admin: !!s.admin, user: !!s.uid } : {}) });
app.get('/api/products', (q, r) => r.json(db.prepare('SELECT * FROM products ORDER BY id DESC').all()));
app.get('/api/posts', (q, r) => r.json(db.prepare('SELECT * FROM posts ORDER BY id DESC').all()));
app.post('/api/contact', (q, r) => { const { name, email, text } = q.body; if (!name || !email || !text) return r.status(400).json({ error: 'Tüm alanlar gerekli' }); db.prepare('INSERT INTO messages(name,email,text) VALUES(?,?,?)').run(name, norm(email), text); r.json({ ok: true }) });
app.get('/api/my-orders', needUser, (q, r) => r.json(db.prepare('SELECT id,items,total,status,method,created FROM orders WHERE user_id=? ORDER BY id DESC').all(q.s.uid)));

app.post('/api/order', needUser, (q, r) => {
  const { items = {}, address = {}, method } = q.body;
  if (!['card', 'cod', 'eft'].includes(method)) return r.status(400).json({ error: 'Ödeme yöntemi seçin' });
  if (!address.name || !address.phone || !address.city || !address.address) return r.status(400).json({ error: 'Teslimat bilgilerini doldurun' });
  let total = 0; const list = []; for (const [id, n] of Object.entries(items)) { const p = db.prepare('SELECT * FROM products WHERE id=?').get(id), qty = Math.min(parseInt(n) || 0, 99); if (p && qty > 0) { total += p.price * qty; list.push({ id: p.id, name: p.name, category: p.category, qty, price: p.price }) } }
  if (!list.length) return r.status(400).json({ error: 'Sepet boş' });
  if (method === 'card' && !iyzi) return r.status(400).json({ error: 'Kart ödemesi henüz yapılandırılmadı (iyzico anahtarları gerekli)' });
  const status = { card: 'Ödeme Bekliyor', eft: 'Havale Bekleniyor', cod: 'Hazırlanıyor' }[method];
  const id = db.prepare('INSERT INTO orders(user_id,items,total,status,method,address) VALUES(?,?,?,?,?,?)').run(q.s.uid, JSON.stringify(list), total, status, method, JSON.stringify(address)).lastInsertRowid;
  if (method !== 'card') return r.json({ ok: true, total, id, iban: method === 'eft' ? (E.IBAN || 'IBAN bilgisi admin tarafından eklenmedi') : null });
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(q.s.uid), [fn, ...ln] = address.name.trim().split(' '), ad = { contactName: address.name, city: address.city, country: 'Turkey', address: address.address };
  iyzi.checkoutFormInitialize.create({
    locale: 'tr', conversationId: String(id), price: total.toFixed(2), paidPrice: total.toFixed(2), currency: 'TRY', basketId: String(id), paymentGroup: 'PRODUCT', callbackUrl: BASE + '/api/pay/callback', enabledInstallments: [1],
    buyer: { id: String(u.id), name: fn, surname: ln.join(' ') || fn, gsmNumber: address.phone, email: u.email, identityNumber: '11111111111', registrationAddress: address.address, ip: q.ip || '85.34.78.112', city: address.city, country: 'Turkey' },
    shippingAddress: ad, billingAddress: ad, basketItems: list.map(i => ({ id: String(i.id), name: i.name, category1: i.category || 'Genel', itemType: 'PHYSICAL', price: (i.price * i.qty).toFixed(2) }))
  }, (err, res) => {
    if (err || res.status !== 'success') { db.prepare('UPDATE orders SET status=? WHERE id=?').run('İptal', id); return r.status(500).json({ error: 'Ödeme başlatılamadı: ' + (res && res
