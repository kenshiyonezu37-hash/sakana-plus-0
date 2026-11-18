const enc = new TextEncoder();
const json = (body, status = 200, extra = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", ...extra } });
const fail = (status, error) => json({ error }, status);
const norm = (s) => String(s ?? "").normalize("NFKC").toLowerCase();
const b64 = (bytes) => btoa(String.fromCharCode(...bytes));
const unb64 = (s) => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const hex = (bytes) => [...bytes].map(x => x.toString(16).padStart(2,"0")).join("");
async function digest(s) { return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", typeof s === "string" ? enc.encode(s) : s))); }
async function passwordHash(password, salt, iterations) {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name:"PBKDF2", hash:"SHA-256", salt, iterations }, key, 256);
  return new Uint8Array(bits);
}
const userView = r => r && ({ id:r.id, username:r.username, displayName:r.display_name || "", bio:r.bio || "", role:r.role });
function cookies(request) { return Object.fromEntries((request.headers.get("cookie") || "").split(/;\s*/).map(s => { const i=s.indexOf("="); return i > 0 ? [s.slice(0,i),s.slice(i+1)] : ["",""]; }).filter(([k])=>k)); }
const cookie = (key,value,age) => `${key}=${value}; Path=/; Max-Age=${age}; HttpOnly; Secure; SameSite=Strict`;
async function currentUser(env, request) {
  const sid = cookies(request).sid; if (!sid) return null;
  const row = await env.DB.prepare("SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.id_hash=? AND s.expires_at>? AND u.active=1").bind(await digest(sid), Date.now()).first();
  return row || null;
}
async function createSession(env,userId) {
  const sid = b64(crypto.getRandomValues(new Uint8Array(32))).replace(/[+/=]/g, "x");
  const days = Math.min(90, Math.max(1, Number(env.SESSION_DAYS) || 30));
  await env.DB.prepare("INSERT INTO sessions(id_hash,user_id,expires_at) VALUES(?,?,?)").bind(await digest(sid),userId,Date.now()+days*864e5).run();
  return cookie("sid",sid,days*86400);
}
async function requireUser(env,request) { const user=await currentUser(env,request); if (!user) throw Object.assign(new Error("ログインが必要です。"),{status:401}); return user; }
function validateMutation(request,url) {
  if (request.headers.get("x-sakana-request") !== "1") throw Object.assign(new Error("不正なリクエストです。"),{status:403});
  const origin=request.headers.get("origin"); if (origin && new URL(origin).host !== url.host) throw Object.assign(new Error("不正なリクエストです。"),{status:403});
}
async function readJson(request) { try { const b=await request.json(); if (!b || typeof b !== "object" || Array.isArray(b)) throw 0; return b; } catch { throw Object.assign(new Error("リクエスト形式が正しくありません。"),{status:400}); } }
function passwordPolicy(username,password) {
  const n=[...password].length; if (n<10 || n>128) throw Object.assign(new Error("パスワードは10〜128文字で入力してください。"),{status:400});
  if (norm(username)===norm(password)) throw Object.assign(new Error("ユーザー名と同じパスワードは使えません。"),{status:400});
}
async function handle(request,env) {
  const url=new URL(request.url), path=url.pathname, method=request.method;
  if (!path.startsWith("/api/")) return env.ASSETS.fetch(request);
  if (method !== "GET" && method !== "HEAD") validateMutation(request,url);
  if (path === "/api/me" && method === "GET") { const u=await currentUser(env,request); return json({user:userView(u)}); }
  if (path === "/api/register" && method === "POST") {
    const b=await readJson(request), username=String(b.username||"").trim(), password=String(b.password||""), nameKey=norm(username);
    if (!/^[\p{L}\p{N}_.-]{3,24}$/u.test(username)) throw Object.assign(new Error("ユーザー名は3〜24文字で入力してください。"),{status:400}); passwordPolicy(username,password);
    const exists=await env.DB.prepare("SELECT id FROM users WHERE name_key=?").bind(nameKey).first(); if(exists) throw Object.assign(new Error("そのユーザー名はすでに使われています。"),{status:409});
    const salt=crypto.getRandomValues(new Uint8Array(16)), iterations=Math.max(10000,Number(env.PBKDF2_ITERATIONS)||100000), hash=await passwordHash(password,salt,iterations), now=new Date().toISOString();
    const result=await env.DB.prepare("INSERT INTO users(username,name_key,password_hash,password_salt,password_iterations,created_at) VALUES(?,?,?,?,?,?)").bind(username,nameKey,b64(hash),b64(salt),iterations,now).run();
    const id=Number(result.meta.last_row_id), u=await env.DB.prepare("SELECT * FROM users WHERE id=?").bind(id).first();
    return json({user:userView(u)},201,{"set-cookie":await createSession(env,id)});
  }
  if (path === "/api/login" && method === "POST") {
    const b=await readJson(request), username=String(b.username||"").trim(), password=String(b.password||""), u=await env.DB.prepare("SELECT * FROM users WHERE name_key=?").bind(norm(username)).first();
    let valid=false; if(u) { const got=await passwordHash(password,unb64(u.password_salt),u.password_iterations); valid=hex(got)===hex(unb64(u.password_hash)); }
    if (!valid) throw Object.assign(new Error("ユーザー名またはパスワードが違います。"),{status:401}); if(!u.active) throw Object.assign(new Error("このアカウントは停止中です。"),{status:403});
    return json({user:userView(u)},200,{"set-cookie":await createSession(env,u.id)});
  }
  if (path === "/api/logout" && method === "POST") { const sid=cookies(request).sid; if(sid) await env.DB.prepare("DELETE FROM sessions WHERE id_hash=?").bind(await digest(sid)).run(); return json({ok:true},200,{"set-cookie":cookie("sid","",0)}); }
  const user=await requireUser(env,request);
  if (path === "/api/posts" && method === "GET") {
    const rows=await env.DB.prepare("SELECT p.id,p.user_id,p.body,p.created_at,p.hidden,u.username,u.display_name,EXISTS(SELECT 1 FROM follows f WHERE f.from_id=? AND f.to_id=u.id) AS following FROM posts p JOIN users u ON u.id=p.user_id WHERE p.hidden=0 AND u.active=1 ORDER BY p.id DESC LIMIT 100").bind(user.id).all();
    return json({posts:rows.results.map(p=>({id:p.id,userId:p.user_id,body:p.body,createdAt:p.created_at,username:p.username,displayName:p.display_name,following:!!p.following}))});
  }
  if (path === "/api/posts" && method === "POST") {
    if(user.muted) throw Object.assign(new Error("現在、投稿は制限されています。"),{status:403});
    const b=await readJson(request), body=String(b.body||"").trim(); if(!body || [...body].length>200) throw Object.assign(new Error("ポストは1〜200文字で入力してください。"),{status:400});
    if(/[\w.+-]+@[\w-]+\.[\w.-]+|https?:\/\/|www\./i.test(body)) throw Object.assign(new Error("メールアドレスやリンクは投稿できません。"),{status:400});
    const day=new Date().toISOString().slice(0,10), count=await env.DB.prepare("SELECT COUNT(*) AS n FROM posts WHERE user_id=? AND substr(created_at,1,10)=?").bind(user.id,day).first(); if(count.n>=30) throw Object.assign(new Error("1日の投稿上限に達しました。"),{status:429});
    const result=await env.DB.prepare("INSERT INTO posts(user_id,body,created_at) VALUES(?,?,?)").bind(user.id,body,new Date().toISOString()).run(); return json({id:Number(result.meta.last_row_id)},201);
  }
  if (path === "/api/follows" && method === "POST") {
    const b=await readJson(request), to=Number(b.userId); if(!Number.isInteger(to)||to===user.id) throw Object.assign(new Error("フォロー先が正しくありません。"),{status:400});
    const target=await env.DB.prepare("SELECT id FROM users WHERE id=? AND active=1").bind(to).first(); if(!target) throw Object.assign(new Error("ユーザーが見つかりません。"),{status:404});
    await env.DB.prepare("INSERT OR IGNORE INTO follows(from_id,to_id,created_at) VALUES(?,?,?)").bind(user.id,to,new Date().toISOString()).run(); return json({ok:true});
  }
  throw Object.assign(new Error("見つかりません。"),{status:404});
}
export default { async fetch(request,env) { try { return await handle(request,env); } catch(e) { return fail(e.status||500,e.status?e.message:"サーバーエラーが発生しました。"); } } };
