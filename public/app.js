const $ = (id) => document.getElementById(id);
const form = $("auth-form");
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
async function api(path, method = "GET", body) {
  const headers = { "Accept": "application/json" };
  if (body !== undefined) { headers["Content-Type"] = "application/json"; headers["X-Sakana-Request"] = "1"; }
  const r = await fetch(path, { method, headers, credentials: "same-origin", body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `通信エラー (${r.status})`);
  return data;
}
async function showSession() {
  try {
    const { user } = await api("/api/me");
    if (!user) { $("auth").hidden = false; $("social").hidden = true; return; }
    $("auth").hidden = true; $("social").hidden = false;
    $("account").textContent = `${user.displayName || user.username} さん · `;
    const logout = document.createElement("button"); logout.textContent = "ログアウト"; logout.onclick = async () => { await api("/api/logout", "POST", {}); location.reload(); };
    $("account").append(logout);
    await loadFeed();
  } catch (e) { $("auth-message").textContent = e.message; }
}
async function loadFeed() {
  try {
    const { posts } = await api("/api/posts"); const feed = $("feed"); feed.replaceChildren();
    if (!posts.length) { feed.textContent = "まだポストはありません。最初のポストをしてみましょう。"; return; }
    for (const p of posts) {
      const article = document.createElement("article"); article.className = "post";
      article.innerHTML = `<b>${esc(p.displayName || p.username)}</b> <small>@${esc(p.username)} · ${esc(new Date(p.createdAt).toLocaleString("ja-JP"))}</small><div>${esc(p.body).replace(/\n/g,"<br>")}</div>`;
      if (p.userId !== window.currentUserId) {
        const follow = document.createElement("button"); follow.textContent = p.following ? "フォロー中" : "フォロー";
        follow.onclick = async () => { try { await api("/api/follows", "POST", { userId: p.userId }); await loadFeed(); } catch(e) { $("feed-message").textContent = e.message; } };
        article.append(follow);
      }
      feed.append(article);
    }
  } catch(e) { $("feed-message").textContent = e.message; }
}
form.addEventListener("submit", async (event) => {
  event.preventDefault(); const data = new FormData(form); const action = event.submitter?.value || "login";
  $("auth-message").textContent = "処理中…";
  try { const result = await api(`/api/${action}`, "POST", { username: data.get("username"), password: data.get("password") }); window.currentUserId = result.user.id; await showSession(); }
  catch(e) { $("auth-message").textContent = e.message; }
});
$("post-form").addEventListener("submit", async (event) => {
  event.preventDefault(); const body = $("post-body").value;
  try { await api("/api/posts", "POST", { body }); $("post-body").value = ""; $("feed-message").textContent = "投稿しました"; await loadFeed(); }
  catch(e) { $("feed-message").textContent = e.message; }
});
showSession();
