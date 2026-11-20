// Ortak: menü, fare efekti, scroll animasyonu, sepet, API yardımcıları
const api=(u,m='GET',b)=>fetch('/api/'+u,{method:m,headers:{'Content-Type':'application/json'},body:b?JSON.stringify(b):undefined}).then(r=>r.json());
const cart={get:()=>JSON.parse(localStorage.cart||'{}'),add(id){const c=this.get();c[id]=(c[id]||0)+1;localStorage.cart=JSON.stringify(c);cart.badge()},
 set(c){localStorage.cart=JSON.stringify(c);cart.badge()},clear(){this.set({})},badge(){const n=Object.values(this.get()).reduce((a,b)=>a+b,0),e=document.getElementById('cn');if(e)e.textContent=n}};
const $=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const reveal=()=>{const io=new IntersectionObserver(es=>es.forEach(e=>e.isIntersecting&&(e.target.classList.add('show'),io.unobserve(e.target))),{threshold:.12});document.querySelectorAll('.reveal:not(.show)').forEach(e=>io.observe(e))};
addEventListener('DOMContentLoaded',async()=>{
 if(location.protocol==='file:'){document.body.innerHTML='<h2 style="padding:40px;color:#fff">Bu sayfa dosyadan açılamaz. Terminalde <code>npm start</code> yazıp <b>http://localhost:3000</b> adresini açın.</h2>';return}
 const g=document.createElement('div');g.id='glow';document.body.prepend(g);addEventListener('mousemove',e=>{g.style.left=e.clientX+'px';g.style.top=e.clientY+'px'});
 const me=await api('me'),p=location.pathname.split('/').pop()||'index.html';
 const L=[['index.html','Ana Sayfa'],['magaza.html','Mağaza'],['blog.html','Blog'],['iletisim.html','İletişim'],['sepet.html','Sepet (<span id="cn">0</span>)']];
 if(me.user)L.push(['siparislerim.html','Siparişlerim']);L.push(me.user?['#','Çıkış ('+esc(me.name)+')']:['giris.html','Giriş / Üye Ol']);if(me.admin)L.push(['admin.html','Admin']);
 const h=document.createElement('header');h.innerHTML='<span class="logo">MAĞAZAM</span><nav>'+L.map(([u,t])=>`<a href="${u}" class="${u==p?'on':''}" ${u=='#'?'id="out"':''}>${t}</a>`).join('')+'</nav>';document.body.prepend(h);
 const o=document.getElementById('out');if(o){o.title='Çıkış için tıkla';o.onclick=async e=>{e.preventDefault();await api('logout','POST');location.href='index.html'}}
 const f=document.createElement('footer');f.textContent='© Mağazam';document.body.append(f);cart.badge();
 window.pageInit&&await window.pageInit(me);reveal()});
