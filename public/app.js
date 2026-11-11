const $ = s => document.querySelector(s), root = $("#root");
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = n => Math.round(n).toLocaleString("id-ID"), pct = (a, b) => b ? (a / b * 100).toFixed(1).replace(".", ",") + "%" : "–";
const S = { auth: false, setup: false, user: "", view: "dash", posts: [], conns: [], f: { p: "", from: "", to: "", q: "" }, sort: { k: "interaksi", d: -1 } };
async function api(path, method = "GET", body) {
  const r = await fetch("/api" + path, { method, headers: { "Content-Type": "application/json", "X-Requested-With": "fetch" }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || "Gagal"); return j;
}
const load = async () => { [S.posts, S.conns] = await Promise.all([api("/posts"), api("/connections")]); };
const inter = x => x.likes + x.komentar + x.shares + x.klik;

function render() {
  if (!S.auth) return authView();
  root.innerHTML = `<div class="shell"><aside><h2>Laporan<br>Media Sosial</h2><nav>${[["dash", "Dasbor"], ["conn", "Koneksi akun"], ["imp", "Impor CSV"]]
    .map(([k, t]) => `<button data-v="${k}" class="${S.view === k ? "on" : ""}">${t}</button>`).join("")}</nav>
    <div class="who">${esc(S.user)}<button id="lo">Keluar</button></div></aside><section id="main"></section></div>`;
  root.querySelectorAll("nav button").forEach(b => b.onclick = () => { S.view = b.dataset.v; render(); });
  $("#lo").onclick = async () => { await api("/logout", "POST"); S.auth = false; S.posts = []; S.conns = []; render(); };
  ({ dash, conn, imp })[S.view]();
}

function authView() {
  root.innerHTML = `<main class="auth"><form id="af" class="card"><svg class="logo" width="46" height="54" viewBox="0 0 48 56" fill="none" stroke="#C8A96A" stroke-width="1.5" stroke-linejoin="round" aria-hidden="true"><path d="M24 2l19 10v32L24 54 5 44V12z"/><path d="M24 44V24"/><path d="M24 32c-6 0-9-5-9-9 5 0 9 4 9 9zM24 32c6 0 9-5 9-9-5 0-9 4-9 9zM24 24c-4-4-4-9 0-12 4 3 4 8 0 12z" fill="#C8A96A"/></svg><h1>Laporan<br>Media Sosial</h1><hr class="rule">
    <p class="mute">${S.setup ? "Buat akun admin pertama. Data tersimpan di komputer ini dan kunci akun dienkripsi." : "Masuk untuk melihat laporan."}</p>
    <label>Username<input name="u" required autocomplete="username"></label>
    <label>Kata sandi<input name="p" type="password" required minlength="${S.setup ? 10 : 1}" autocomplete="${S.setup ? "new-password" : "current-password"}"></label>
    <p class="err" id="er"></p><button class="btn p">${S.setup ? "Buat akun" : "Masuk"}</button></form></main>`;
  $("#af").onsubmit = async e => { e.preventDefault(); const f = e.target;
    try { await api(S.setup ? "/setup" : "/login", "POST", { username: f.u.value, password: f.p.value });
      S.user = f.u.value; S.setup = false; S.auth = true; await load(); render(); } catch (x) { $("#er").textContent = x.message; } };
}

function filtered() {
  const { p, from, to, q } = S.f, ql = q.toLowerCase();
  return S.posts.filter(x => (!p || x.platform === p) && (!from || x.tanggal >= from) && (!to || x.tanggal <= to) && (!ql || x.konten.toLowerCase().includes(ql)));
}

function dash() {
  const m = $("#main");
  if (!S.posts.length) {
    m.innerHTML = `<div class="empty"><h1>Belum ada data</h1><p>Hubungkan akun media sosial atau impor CSV. Data baru muncul setelah Anda mengambilnya.</p><button class="btn p" id="go">Hubungkan akun</button></div>`;
    $("#go").onclick = () => { S.view = "conn"; render(); }; return;
  }
  const plats = [...new Set(S.posts.map(x => x.platform))].sort();
  m.innerHTML = `<div class="row"><h1>Dasbor</h1><div class="noprint"><button class="btn" id="ex">Ekspor CSV</button> <button class="btn" id="pr">Cetak / PDF</button></div></div>
    <div class="filters"><label>Platform<select id="fp"><option value="">Semua</option>${plats.map(p => `<option ${S.f.p === p ? "selected" : ""}>${esc(p)}</option>`).join("")}</select></label>
    <label>Dari<input type="date" id="ff" value="${S.f.from}"></label><label>Sampai<input type="date" id="ft" value="${S.f.to}"></label>
    <label>Cari konten<input id="fq" value="${esc(S.f.q)}"></label></div><div id="res"></div>`;
  const on = (id, k) => $(id).oninput = e => { S.f[k] = e.target.value; results(); };
  on("#fp", "p"); on("#ff", "from"); on("#ft", "to"); on("#fq", "q");
  $("#pr").onclick = () => print();
  $("#ex").onclick = () => { const d = filtered(), H = ["tanggal", "platform", "konten", "jangkauan", "tayangan", "likes", "komentar", "shares", "klik"];
    const csv = [H.join(",")].concat(d.map(x => H.map(k => `"${String(x[k]).replace(/"/g, '""')}"`).join(","))).join("\n");
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob(["\ufeff" + csv], { type: "text/csv" })); a.download = "laporan-media-sosial.csv"; a.click(); };
  results();
}

function results() {
  const d = filtered(), R = $("#res"), sum = k => d.reduce((a, x) => a + x[k], 0), reach = sum("jangkauan"), it = d.reduce((a, x) => a + inter(x), 0);
  if (!d.length) { R.innerHTML = `<div class="card mute">Tidak ada konten pada filter ini.</div>`; return; }
  const by = {}, bp = {}; d.forEach(x => { by[x.tanggal] = (by[x.tanggal] || 0) + x.jangkauan; bp[x.platform] = (bp[x.platform] || 0) + inter(x); });
  const days = Object.keys(by).sort(), vals = days.map(k => by[k]), mx = Math.max(...vals, 1), W = 640, H = 220;
  const X = i => 40 + (days.length < 2 ? 280 : i * (W - 56) / (days.length - 1)), Y = v => H - 28 - v / mx * (H - 48);
  const svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Tren jangkauan harian">${[0, .5, 1].map(t => `<line class="ax" x1="40" x2="${W - 16}" y1="${Y(mx * t)}" y2="${Y(mx * t)}"/><text class="tx" x="36" y="${Y(mx * t) + 4}" text-anchor="end">${fmt(mx * t)}</text>`).join("")}
    <polyline fill="none" stroke="#134E43" stroke-width="2.5" points="${vals.map((v, i) => X(i) + "," + Y(v)).join(" ")}"/>${vals.map((v, i) => `<circle cx="${X(i)}" cy="${Y(v)}" r="3" fill="#134E43"/>`).join("")}
    <text class="tx" x="40" y="${H - 6}">${days[0]}</text><text class="tx" x="${W - 16}" y="${H - 6}" text-anchor="end">${days[days.length - 1]}</text></svg>`;
  const pm = Math.max(...Object.values(bp), 1);
  const bars = Object.entries(bp).sort((a, b) => b[1] - a[1]).map(([p, v]) => `<div><b>${esc(p)}</b> <span class="mute">${fmt(v)}</span><i style="width:${Math.max(3, v / pm * 100)}%"></i></div>`).join("");
  const { k, d: dir } = S.sort, val = x => k === "er" ? (x.jangkauan ? inter(x) / x.jangkauan : 0) : k === "interaksi" ? inter(x) : x[k];
  const rows = d.slice().sort((a, b) => (val(a) > val(b) ? 1 : val(a) < val(b) ? -1 : 0) * dir).slice(0, 50);
  const cols = [["tanggal", "Tanggal"], ["platform", "Platform"], ["konten", "Konten"], ["jangkauan", "Jangkauan", 1], ["tayangan", "Tayangan", 1], ["interaksi", "Interaksi", 1], ["er", "ER", 1]];
  R.innerHTML = `<div class="kpis">${[["Jangkauan", fmt(reach)], ["Tayangan", fmt(sum("tayangan"))], ["Interaksi", fmt(it)], ["Engagement rate", pct(it, reach)], ["Jumlah konten", fmt(d.length)]]
    .map(([a, b]) => `<div class="card kpi"><span>${a}</span><b>${b}</b></div>`).join("")}</div>
    <div class="two"><div class="card"><h2 style="margin-top:0">Tren jangkauan harian</h2>${svg}</div><div class="card"><h2 style="margin-top:0">Interaksi per platform</h2><div class="bars">${bars}</div></div></div>
    <div class="card"><h2 style="margin-top:0">Konten (maks. 50 teratas, klik judul kolom untuk mengurutkan)</h2><div class="tw"><table><thead><tr>${cols.map(c => `<th data-k="${c[0]}" class="${c[2] ? "n" : ""}">${c[1]}${k === c[0] ? (dir > 0 ? " ▲" : " ▼") : ""}</th>`).join("")}</tr></thead>
    <tbody>${rows.map(x => `<tr><td>${esc(x.tanggal)}</td><td>${esc(x.platform)}</td><td class="t">${esc(x.konten)}</td><td class="n">${fmt(x.jangkauan)}</td><td class="n">${fmt(x.tayangan)}</td><td class="n">${fmt(inter(x))}</td><td class="n">${pct(inter(x), x.jangkauan)}</td></tr>`).join("")}</tbody></table></div></div>`;
  R.querySelectorAll("th").forEach(th => th.onclick = () => { S.sort = { k: th.dataset.k, d: S.sort.k === th.dataset.k ? -S.sort.d : -1 }; results(); });
}

const HINT = {
  youtube: ["Channel ID (UC…) atau @handle", "API key YouTube Data v3", "Data publik saja: views, likes, komentar (YouTube tidak memberi data jangkauan)."],
  instagram: ["Instagram Business Account ID", "Access token Graph API", "Akun Business/Creator yang terhubung ke Facebook Page. Izin: instagram_basic, instagram_manage_insights."],
  facebook: ["Facebook Page ID", "Page access token", "Butuh Page access token dengan izin pages_read_engagement dan read_insights. Metrik Meta dapat berubah."]
};
function conn() {
  const m = $("#main");
  m.innerHTML = `<h1>Koneksi akun</h1><div class="card"><form id="cf" class="grid2">
    <label>Platform<select name="pl"><option value="youtube">YouTube</option><option value="instagram">Instagram</option><option value="facebook">Facebook Page</option></select></label>
    <label>Nama koneksi<input name="lb" placeholder="mis. Akun Utama" maxlength="40"></label>
    <label><span id="l1"></span><input name="a1" required autocomplete="off"></label>
    <label><span id="l2"></span><input name="a2" type="password" required autocomplete="off"></label>
    <div><button class="btn p" id="sb">Hubungkan &amp; ambil data</button></div></form><p class="hint" id="hn"></p><p class="err" id="er"></p></div>
    <h2>Akun terhubung</h2>${S.conns.length ? S.conns.map(c => `<div class="card conn"><div><b>${esc(c.label)}</b> <span class="mute">· ${esc(c.platform)} · ${c.count} konten · sinkron terakhir ${c.last ? new Date(c.last).toLocaleString("id-ID") : "–"}</span></div>
    <div><button class="btn" data-s="${c.id}">Sinkronkan</button> <button class="btn d" data-d="${c.id}">Hapus</button></div></div>`).join("") : `<p class="mute">Belum ada akun terhubung.</p>`}`;
  const f = $("#cf"), hint = () => { const h = HINT[f.pl.value]; $("#l1").textContent = h[0]; $("#l2").textContent = h[1]; $("#hn").textContent = h[2]; };
  f.pl.onchange = hint; hint();
  f.onsubmit = async e => { e.preventDefault(); $("#sb").disabled = true; $("#er").textContent = ""; $("#sb").textContent = "Mengambil data…";
    try { await api("/connections", "POST", { platform: f.pl.value, label: f.lb.value, a1: f.a1.value.trim(), a2: f.a2.value.trim() }); await load(); S.view = "dash"; render(); }
    catch (x) { $("#er").textContent = x.message; $("#sb").disabled = false; $("#sb").textContent = "Hubungkan & ambil data"; } };
  m.querySelectorAll("[data-s]").forEach(b => b.onclick = async () => { b.disabled = true; b.textContent = "Menyinkronkan…";
    try { await api(`/connections/${b.dataset.s}/sync`, "POST"); await load(); conn(); } catch (x) { alert(x.message); conn(); } });
  m.querySelectorAll("[data-d]").forEach(b => b.onclick = async () => { if (!confirm("Hapus koneksi ini beserta datanya?")) return; await api(`/connections/${b.dataset.d}`, "DELETE"); await load(); conn(); });
}

function parseCSV(t) {
  const rows = []; let r = [], f = "", q = false;
  for (let i = 0; i < t.length; i++) { const c = t[i];
    if (q) { if (c === '"') { if (t[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true; else if (c === ",") { r.push(f); f = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && t[i + 1] === "\n") i++; r.push(f); f = ""; if (r.some(x => x !== "")) rows.push(r); r = []; } else f += c; }
  r.push(f); if (r.some(x => x !== "")) rows.push(r);
  const h = (rows.shift() || []).map(x => x.trim().toLowerCase().replace(/^\ufeff/, "")); return rows.map(a => Object.fromEntries(h.map((k, i) => [k, a[i]])));
}
function imp() {
  $("#main").innerHTML = `<h1>Impor CSV</h1><div class="card"><p>Untuk data yang tidak bisa diambil otomatis. Kolom: <code>tanggal,platform,konten,jangkauan,tayangan,likes,komentar,shares,klik</code> (tanggal: YYYY-MM-DD).</p>
    <input type="file" id="fi" accept=".csv"><p id="im" class="hint"></p><button class="btn d" id="dl">Hapus semua data impor</button></div>`;
  $("#fi").onchange = async e => { const f = e.target.files[0]; if (!f) return;
    try { const r = await api("/import", "POST", { rows: parseCSV(await f.text()) }); await load(); $("#im").className = "ok"; $("#im").textContent = `${r.n} baris diimpor, ${r.dilewati} dilewati.`; }
    catch (x) { $("#im").className = "err"; $("#im").textContent = x.message; } };
  $("#dl").onclick = async () => { if (confirm("Hapus semua data hasil impor CSV?")) { await api("/import", "DELETE"); await load(); imp(); } };
}

(async () => { const s = await api("/state"); S.auth = s.auth; S.setup = s.setup; S.user = s.user || ""; if (S.auth) await load(); render(); })();
