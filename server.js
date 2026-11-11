// Jalankan: node server.js   (Node.js 18+, tanpa dependensi)
const http = require("http"), fs = require("fs"), path = require("path"), crypto = require("crypto");
const PORT = process.env.PORT || 3000, HOST = process.env.HOST || "127.0.0.1";
const DIR = path.join(__dirname, "data");
fs.mkdirSync(DIR, { recursive: true });

// ---- kunci enkripsi (dibuat otomatis, hanya sekali) ----
const KF = path.join(DIR, "secret.key");
if (!fs.existsSync(KF)) fs.writeFileSync(KF, crypto.randomBytes(32).toString("hex"), { mode: 0o600 });
const KEY = Buffer.from(fs.readFileSync(KF, "utf8").trim(), "hex");

// ---- database file (JSON) ----
const DBF = path.join(DIR, "db.json");
let db = fs.existsSync(DBF) ? JSON.parse(fs.readFileSync(DBF, "utf8")) : { user: null, connections: [], posts: [] };
const save = () => { fs.writeFileSync(DBF + ".tmp", JSON.stringify(db)); fs.renameSync(DBF + ".tmp", DBF); };

// ---- kripto ----
const enc = t => { const iv = crypto.randomBytes(12), c = crypto.createCipheriv("aes-256-gcm", KEY, iv);
  const e = Buffer.concat([c.update(t, "utf8"), c.final()]); return [iv, c.getAuthTag(), e].map(b => b.toString("base64")).join("."); };
const dec = s => { const [iv, tag, e] = s.split(".").map(x => Buffer.from(x, "base64"));
  const d = crypto.createDecipheriv("aes-256-gcm", KEY, iv); d.setAuthTag(tag); return Buffer.concat([d.update(e), d.final()]).toString("utf8"); };
const hash = p => { const s = crypto.randomBytes(16); return s.toString("hex") + ":" + crypto.scryptSync(p, s, 64).toString("hex"); };
const check = (p, h) => { const [s, k] = h.split(":"); return crypto.timingSafeEqual(crypto.scryptSync(p, Buffer.from(s, "hex"), 64), Buffer.from(k, "hex")); };

// ---- sesi & pembatasan login ----
const sessions = new Map(), fails = new Map();
const sid = req => (/(?:^|; )sid=([a-f0-9]{64})/.exec(req.headers.cookie || "") || [])[1];
const authed = req => { const s = sid(req), e = s && sessions.get(s); return e && e > Date.now() ? s : null; };
const E = (code, msg) => Object.assign(new Error(msg), { code });
const send = (res, code, obj) => { res.statusCode = code; res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(obj)); };
const startSession = (req, res) => { const id = crypto.randomBytes(32).toString("hex"); sessions.set(id, Date.now() + 8 * 3600e3);
  res.setHeader("Set-Cookie", `sid=${id}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800` + (req.headers["x-forwarded-proto"] === "https" ? "; Secure" : "")); send(res, 200, {}); };

// ---- pengambil data ----
const mask = s => String(s).replace(/(key|access_token)=[^&\s"]+/g, "$1=***");
async function j(url) {
  let r, t;
  try { r = await fetch(url); t = await r.json(); } catch (e) { throw E(502, "Tidak bisa terhubung ke server platform"); }
  if (!r.ok || t.error) throw E(400, mask((t.error && (t.error.message || t.error)) || "Gagal (HTTP " + r.status + ")"));
  return t;
}
const iso = d => String(d || "").slice(0, 10), n0 = v => Math.max(0, Math.round(Number(v) || 0));
const row = (id, tgl, pl, k, o) => ({ id: String(id), tanggal: iso(tgl), platform: pl, konten: String(k || "(tanpa teks)").slice(0, 120),
  jangkauan: n0(o.jangkauan), tayangan: n0(o.tayangan), likes: n0(o.likes), komentar: n0(o.komentar), shares: n0(o.shares), klik: n0(o.klik) });

const FETCH = {
  async youtube(id, key) {
    const B = "https://www.googleapis.com/youtube/v3/";
    const q = id.startsWith("@") ? "forHandle=" + encodeURIComponent(id) : "id=" + id;
    const ch = await j(`${B}channels?part=contentDetails&${q}&key=${key}`);
    if (!ch.items || !ch.items.length) throw E(400, "Channel tidak ditemukan");
    const pl = await j(`${B}playlistItems?part=contentDetails&maxResults=50&playlistId=${ch.items[0].contentDetails.relatedPlaylists.uploads}&key=${key}`);
    const v = await j(`${B}videos?part=snippet,statistics&id=${pl.items.map(i => i.contentDetails.videoId).join(",")}&key=${key}`);
    return v.items.map(x => row(x.id, x.snippet.publishedAt, "YouTube", x.snippet.title,
      { jangkauan: x.statistics.viewCount, tayangan: x.statistics.viewCount, likes: x.statistics.likeCount, komentar: x.statistics.commentCount }));
  },
  async instagram(id, token) {
    const G = "https://graph.facebook.com/v21.0/";
    const m = await j(`${G}${id}/media?fields=id,caption,timestamp,like_count,comments_count&limit=30&access_token=${token}`);
    return Promise.all(m.data.map(async x => { const o = {};
      try { (await j(`${G}${x.id}/insights?metric=reach,views,shares,saved&access_token=${token}`)).data.forEach(d => o[d.name] = d.values[0].value); } catch (e) {}
      return row(x.id, x.timestamp, "Instagram", x.caption, { jangkauan: o.reach, tayangan: o.views, likes: x.like_count, komentar: x.comments_count, shares: o.shares, klik: o.saved }); }));
  },
  async facebook(id, token) {
    const G = "https://graph.facebook.com/v21.0/";
    const m = await j(`${G}${id}/posts?fields=id,message,created_time,shares,reactions.summary(true).limit(0),comments.summary(true).limit(0)&limit=30&access_token=${token}`);
    return Promise.all(m.data.map(async x => { const o = {};
      try { (await j(`${G}${x.id}/insights?metric=post_impressions_unique,post_impressions,post_clicks&access_token=${token}`)).data.forEach(d => o[d.name] = d.values[0].value); } catch (e) {}
      return row(x.id, x.created_time, "Facebook", x.message, { jangkauan: o.post_impressions_unique, tayangan: o.post_impressions,
        likes: x.reactions && x.reactions.summary.total_count, komentar: x.comments && x.comments.summary.total_count, shares: x.shares && x.shares.count, klik: o.post_clicks }); }));
  }
};
const VALID = { youtube: [/^(@[\w.\-]{1,60}|UC[\w\-]{22})$/, /^[\w\-]{20,80}$/], instagram: [/^\d{5,25}$/, /^[\w\-.|]{20,700}$/], facebook: [/^\d{5,25}$/, /^[\w\-.|]{20,700}$/] };

async function sync(c) {
  const { a1, a2 } = JSON.parse(dec(c.cred)), rows = await FETCH[c.platform](a1, a2);
  const keep = new Map(db.posts.filter(x => x.cid === c.id).map(x => [x.id, x]));
  rows.forEach(r => keep.set(c.id + ":" + r.id, { ...r, id: c.id + ":" + r.id, cid: c.id }));
  db.posts = db.posts.filter(x => x.cid !== c.id).concat([...keep.values()]);
  c.last = new Date().toISOString(); return rows.length;
}

const readBody = req => new Promise((ok, no) => { let b = ""; req.on("data", c => { b += c; if (b.length > 8e6) { req.destroy(); no(E(413, "Data terlalu besar")); } });
  req.on("end", () => { try { ok(b ? JSON.parse(b) : {}); } catch (e) { no(E(400, "Format salah")); } }); });
const STATIC = { "/": ["index.html", "text/html; charset=utf-8"], "/app.js": ["app.js", "text/javascript; charset=utf-8"], "/app.css": ["app.css", "text/css; charset=utf-8"] };

http.createServer(async (req, res) => {
  res.setHeader("Content-Security-Policy", "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  res.setHeader("X-Content-Type-Options", "nosniff"); res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer"); res.setHeader("Cache-Control", "no-store");
  const p = new URL(req.url, "http://x").pathname, m = req.method;
  if (!p.startsWith("/api/")) { const f = STATIC[p]; if (!f) { res.statusCode = 404; return res.end("404"); }
    res.setHeader("Content-Type", f[1]); return res.end(fs.readFileSync(path.join(__dirname, "public", f[0]))); }
  try {
    if (m !== "GET" && req.headers["x-requested-with"] !== "fetch") throw E(403, "Permintaan ditolak");
    const body = m === "GET" || m === "DELETE" ? {} : await readBody(req);
    if (p === "/api/state") return send(res, 200, { setup: !db.user, auth: !!authed(req), user: db.user && db.user.name });
    if (p === "/api/setup" && m === "POST") {
      if (db.user) throw E(403, "Akun sudah dibuat");
      if (!/^[\w.\-]{3,30}$/.test(body.username || "") || String(body.password || "").length < 10) throw E(400, "Username 3–30 karakter, kata sandi minimal 10 karakter");
      db.user = { name: body.username, pw: hash(body.password) }; save(); return startSession(req, res);
    }
    if (p === "/api/login" && m === "POST") {
      const ip = req.socket.remoteAddress, f = fails.get(ip) || { n: 0, until: 0 };
      if (f.n >= 5 && f.until > Date.now()) throw E(429, "Terlalu banyak percobaan. Coba lagi dalam 15 menit.");
      if (!db.user || body.username !== db.user.name || !check(String(body.password || ""), db.user.pw)) {
        fails.set(ip, { n: f.n + 1, until: Date.now() + 15 * 60e3 }); throw E(401, "Username atau kata sandi salah"); }
      fails.delete(ip); return startSession(req, res);
    }
    const s = authed(req); if (!s) throw E(401, "Belum masuk");
    if (p === "/api/logout") { sessions.delete(s); res.setHeader("Set-Cookie", "sid=; Max-Age=0; Path=/"); return send(res, 200, {}); }
    if (p === "/api/posts" && m === "GET") return send(res, 200, db.posts);
    if (p === "/api/connections" && m === "GET")
      return send(res, 200, db.connections.map(({ cred, ...c }) => ({ ...c, count: db.posts.filter(x => x.cid === c.id).length })));
    if (p === "/api/connections" && m === "POST") {
      const v = VALID[body.platform]; if (!v) throw E(400, "Platform tidak didukung");
      if (!v[0].test(body.a1 || "")) throw E(400, "ID akun tidak valid"); if (!v[1].test(body.a2 || "")) throw E(400, "Kunci/token tidak valid");
      const c = { id: crypto.randomUUID(), platform: body.platform, label: String(body.label || body.platform).slice(0, 40), cred: enc(JSON.stringify({ a1: body.a1, a2: body.a2 })), last: null };
      const n = await sync(c); db.connections.push(c); save(); return send(res, 200, { n });
    }
    let mt = /^\/api\/connections\/([\w\-]+)(\/sync)?$/.exec(p);
    if (mt) {
      const id = mt[1];
      if (m === "DELETE") { db.connections = db.connections.filter(c => c.id !== id); db.posts = db.posts.filter(x => x.cid !== id); save(); return send(res, 200, {}); }
      const c = db.connections.find(c => c.id === id); if (!c) throw E(404, "Koneksi tidak ditemukan");
      if (mt[2] && m === "POST") { const n = await sync(c); save(); return send(res, 200, { n }); }
    }
    if (p === "/api/import" && m === "POST") {
      const rows = Array.isArray(body.rows) ? body.rows.slice(0, 20000) : [], ok = [];
      rows.forEach(r => { if (!/^\d{4}-\d{2}-\d{2}$/.test(String(r.tanggal || "")) || !r.platform) return;
        const x = row("", r.tanggal, String(r.platform).slice(0, 30), r.konten, r); x.id = "csv:" + x.tanggal + "|" + x.platform + "|" + x.konten; x.cid = "csv"; ok.push(x); });
      const ids = new Set(ok.map(x => x.id)); db.posts = db.posts.filter(x => !ids.has(x.id)).concat(ok); save();
      return send(res, 200, { n: ok.length, dilewati: rows.length - ok.length });
    }
    if (p === "/api/import" && m === "DELETE") { db.posts = db.posts.filter(x => x.cid !== "csv"); save(); return send(res, 200, {}); }
    throw E(404, "Tidak ditemukan");
  } catch (e) { send(res, e.code >= 400 && e.code < 600 ? e.code : 500, { error: e.message }); }
}).listen(PORT, HOST, () => console.log(`Aplikasi berjalan di http://${HOST === "127.0.0.1" ? "localhost" : HOST}:${PORT}`));
