// =====================================================================
// 공무팀 업무관리 웹 (JMRP 92_engwork.sql · Edge Function eng-web) — 화면만. 규칙 · 권한 · 이력은 모두 서버 (DB 함수)
// 예전 EngWork (Flask, 관리자 PC 8081) 화면을 그대로 옮김: 대시보드 · 오늘 F/U · 업무목록 · 우선순위 · 등록/수정 · 상세 · 관리
// 2026-11-10 1단계. 2단계 (업무일지 · 주간계획 · 주간미팅 · 결재란 · 엑셀) 는 다음에
// =====================================================================
"use strict";

const PROD_API = "https://amietbxergoqrdlwhsji.supabase.co/functions/v1/eng-web";
const DEV_API = "https://gajxnrxmhnhapfclgsax.supabase.co/functions/v1/eng-web";
const DEV = (() => {
  try {
    const q = new URLSearchParams(location.search).get("dev");
    if (q === "1") sessionStorage.setItem("ew_dev", "1");
    if (q === "0") sessionStorage.removeItem("ew_dev");
    return sessionStorage.getItem("ew_dev") === "1";
  } catch (e) { return false; }
})();
const API = DEV ? DEV_API : PROD_API;
const KEY = DEV ? "ew_token_dev" : "ew_token";

const STATUSES = ["접수", "진행", "검토요청", "완료", "보류", "취소"];
const CLOSED = ["완료", "취소"];
const PRIO_LABEL = { 1: "P1 긴급·중요", 2: "P2 중요", 3: "P3 긴급", 4: "P4 일반" };
const CHANNELS = ["구두", "회의", "메신저", "메일", "기타"];
const COMMENT_KINDS = ["요청", "진행보고", "이슈", "결정"];
const ALERT_KINDS = { late: "지연", overdue: "조치기한 경과", soon: "조치 임박", stale: "미갱신" };
const FU_REASONS = { late: "완료 기한 지남", overdue: "조치기한 지남", today: "오늘 F/U", step: "단계 기한 도래",
                     review: "승인 대기", stale: "미갱신", soon: "곧 F/U" };
const KINDS = ["작업전", "작업중", "작업후", "참고"];
const KIND_LABEL = { 작업전: "작업 전", 작업중: "작업 중", 작업후: "작업 후", 참고: "참고" };
const ROLE_LABEL = { admin: "관리자", director: "결정권자", coordinator: "업무 담당", member: "실행자" };
const DUTY = { coordinator: "업무 등록 · F/U · 일지 작성 · 우선순위 제안", member: "업무 실행",
               director: "업무 요청 · 우선순위 결정 · 완료 승인", admin: "업무 요청 · 우선순위 결정 · 완료 승인" };

let token = stored();
let B = null;                       // boot: me · users · cats · settings · locations · today · fu_count
const $main = document.getElementById("main");

// ── 기본 ────────────────────────────────────────────────────────────
function stored() { try { return localStorage.getItem(KEY); } catch (e) { return null; } }
function store(v) { try { if (v) localStorage.setItem(KEY, v); else localStorage.removeItem(KEY); } catch (e) { /* 이 창에서만 */ } }

function esc(v) {
  return String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function d(v) { return v ? String(v).slice(0, 10) : ""; }
function dt(v) { return v ? String(v).slice(0, 16).replace("T", " ") : ""; }
function md(v) { return v ? String(v).slice(5, 10) : ""; }
function wd(v) { return v ? "일월화수목금토"[new Date(d(v) + "T00:00:00").getDay()] : ""; }
function hrs(v) { const n = Number(v || 0); return n ? String(+n.toFixed(1)) : "0"; }

function toast(msg, kind) {
  if (!msg) return;
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.className = "toast " + (kind || "ok");
  t.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { t.hidden = true; }, kind === "error" ? 6000 : 3000);
}

async function call(action, body) {
  let r;
  try {
    r = await fetch(API, { method: "POST", headers: { "content-type": "application/json", ...(token ? { "x-ew-token": token } : {}) },
                          body: JSON.stringify({ action, ...body }) });
  } catch (e) {
    throw new Error("인터넷 연결을 확인하세요.");
  }
  let j = {};
  try { j = await r.json(); } catch (e) { /* 빈 응답 */ }
  if (r.status === 401) { token = null; store(null); B = null; renderLogin(j.msg || "다시 로그인하세요."); throw new Error(""); }
  if (!r.ok) throw new Error(j.msg || "잠시 뒤 다시 하세요.");
  return j;
}
const api = (op, p) => call("api", { op, p: p || {} });

function me() { return B.me; }
const isAdmin = () => me().role === "admin";
const isDirector = () => ["admin", "director"].includes(me().role);
const canManage = () => ["admin", "coordinator"].includes(me().role);
const canEdit = (t) => canManage() || isDirector() || t.owner_id === me().id;
function users(includeId) { return B.users.filter((u) => u.active || u.id === includeId); }
function flowUsers() { return B.users.filter((u) => u.active && u.flow_order > 0).sort((a, b) => a.flow_order - b.flow_order); }
function directors() { return B.users.filter((u) => u.active && ["admin", "director"].includes(u.role)); }
function uname(id) { const u = B.users.find((x) => x.id === id); return u ? u.name : ""; }

function opts(list, cur, empty) {
  return (empty !== undefined ? `<option value="">${esc(empty)}</option>` : "")
    + list.map((o) => `<option value="${esc(o.v)}" ${String(o.v) === String(cur ?? "") ? "selected" : ""}>${esc(o.t)}</option>`).join("");
}
const userOpts = (cur, empty) => opts(users(cur).map((u) => ({ v: u.id, t: u.name + (u.position ? " " + u.position : "") })), cur, empty);

// ── 배지 ────────────────────────────────────────────────────────────
function prio(t) {
  if (!t.prio_value) return `<span class="pr pr0" title="우선순위 없음">-</span>`;
  const dec = t.priority !== null && t.priority !== undefined;
  return `<span class="pr pr${t.prio_value}${dec ? "" : " prop"}" title="${esc(PRIO_LABEL[t.prio_value])}${dec ? "" : " (제안 · 미확정)"}">P${t.prio_value}${dec ? "" : "?"}</span>`;
}
const stBadge = (s) => `<span class="badge st-${esc(s)}">${esc(s)}</span>`;
const alBadge = (t) => (t.alert_kind && t.alert_label ? `<span class="badge al-${esc(t.alert_kind)}">${esc(t.alert_label)}</span>` : "");
const bar = (p) => `<div class="bar"><span style="width:${Number(p) || 0}%"></span><b>${Number(p) || 0}%</b></div>`;
const tlink = (t) => `<a class="tno" href="#/item/${t.id}">${esc(t.item_no)}</a>`;

// ── 시작 · 로그인 ───────────────────────────────────────────────────
function renderLogin(msg) {
  document.getElementById("top").hidden = true;
  $main.innerHTML = `
  <div class="login"><div class="card">
    <div class="brand2">공무팀 업무관리${DEV ? '<span class="devflag">개발</span>' : ""}</div>
    <div class="sub2">(주)우지 · 휴대폰 · PC 어디서나</div>
    ${msg ? `<div class="flash error">${esc(msg)}</div>` : ""}
    <form id="f-login">
      <label>아이디</label><input type="text" name="login" autocomplete="username" autocapitalize="off" required>
      <label>비밀번호</label><input type="password" name="password" autocomplete="current-password" required>
      <button class="btn">로그인</button>
    </form>
    <p class="muted small" style="margin:12px 0 0">처음이면 관리자에게 임시 비밀번호를 받으세요. 로그인하면 새 비밀번호로 바꿉니다.</p>
  </div></div>`;
  document.getElementById("f-login").onsubmit = async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    const btn = e.target.querySelector("button");
    btn.disabled = true;
    try {
      const r = await call("login", { login: f.login, password: f.password });
      if (!r.ok) { renderLogin(r.msg); return; }
      token = r.token;
      store(token);
      await start();
    } catch (err) {
      if (err.message) renderLogin(err.message);
    } finally { btn.disabled = false; }
  };
}

async function start() {
  if (!token) { renderLogin(); return; }
  try {
    B = await api("boot");
  } catch (e) {
    if (e.message) renderLogin(e.message);
    return;
  }
  document.getElementById("top").hidden = false;
  document.getElementById("devflag").hidden = !DEV;
  document.getElementById("me").textContent = me().name + (me().position ? " " + me().position : "");
  if (me().must_change_pw) { location.hash = "#/pw"; }
  route();
}

document.getElementById("logout").onclick = async () => {
  try { await call("logout", {}); } catch (e) { /* 그래도 나감 */ }
  token = null; store(null); B = null; renderLogin();
};

function nav(cur) {
  const links = [["#/", "대시보드", ""], ["#/fu", "오늘 F/U", "fu"], ["#/items", "업무목록", "items"], ["#/priority", "우선순위", "priority"],
                 ["#/daily", "업무일지", "daily"], ["#/weekly", "주간계획", "weekly"], ["#/meeting", "주간미팅", "meeting"],
                 ["#/new", "+ 업무 등록", "new"]];
  if (isAdmin()) links.push(["#/admin", "관리", "admin"]);
  document.getElementById("nav").innerHTML = links.map(([h, t, k]) =>
    `<a href="${h}" class="${k === cur ? "on" : ""}">${t}${k === "fu" && B.fu_count ? `<span class="cnt">${B.fu_count}</span>` : ""}</a>`).join("");
}

function parseHash() {
  const h = location.hash.replace(/^#/, "") || "/";
  const [path, q] = h.split("?");
  return { parts: path.split("/").filter(Boolean), q: new URLSearchParams(q || "") };
}

async function route() {
  if (!B) return;
  const { parts, q } = parseHash();
  const top = parts[0] || "";
  if (me().must_change_pw && top !== "pw") { location.hash = "#/pw"; return; }
  nav(top === "item" || top === "edit" || top === "compare" ? "items" : top);
  window.scrollTo(0, 0);
  try {
    if (top === "") await viewDashboard();
    else if (top === "fu") await viewFollowup();
    else if (top === "items") await viewItems(q);
    else if (top === "priority") await viewPriority();
    else if (top === "new") viewForm(null);
    else if (top === "edit") await viewForm(Number(parts[1]));
    else if (top === "item") await viewDetail(Number(parts[1]));
    else if (top === "compare") await viewCompare(Number(parts[1]));
    else if (top === "admin" && parts[1] === "master") await viewMaster();
    else if (top === "admin") await viewUsers();
    else if (top === "pw") viewPassword();
    else if (top === "daily" && parts[1] === "report") await viewDailyReport(q);
    else if (top === "daily" && parts[1] === "month") await viewDailyMonth(q);
    else if (top === "daily") await viewDaily(q);
    else if (top === "weekly") await viewWeekly(q);
    else if (top === "meeting") await viewMeeting(q);
    else location.hash = "#/";
  } catch (e) {
    if (e.message) $main.innerHTML = `<div class="flash error">${esc(e.message)}</div><p><a href="#/">대시보드로</a></p>`;
  }
}
window.addEventListener("hashchange", route);

function setFu(r) { if (r && typeof r.fu_count === "number") { B.fu_count = r.fu_count; nav(parseHash().parts[0] || ""); } }

// 버튼 눌러 서버 일 → 알림 → 다시 그림
async function act(op, p, opt) {
  opt = opt || {};
  if (opt.confirm && !confirm(opt.confirm)) return null;
  try {
    const r = await api(op, p);
    toast(r.msg);
    if (r.warn) setTimeout(() => toast(r.warn, "error"), 1200);
    if (opt.go) location.hash = opt.go; else if (opt.reload !== false) await route();
    return r;
  } catch (e) {
    if (e.message) toast(e.message, "error");
    return null;
  }
}

// ── 대시보드 ────────────────────────────────────────────────────────
async function viewDashboard() {
  const r = await api("dashboard");
  setFu(r);
  const items = r.items, open = items.filter((t) => !CLOSED.includes(t.status));
  const today = B.today, first = today.slice(0, 8) + "01";
  const ws = new Date(today + "T00:00:00"); ws.setDate(ws.getDate() - ((ws.getDay() + 6) % 7));
  const we = new Date(ws); we.setDate(we.getDate() + 6);
  const weekEnd = `${we.getFullYear()}-${String(we.getMonth() + 1).padStart(2, "0")}-${String(we.getDate()).padStart(2, "0")}`;
  const flow = flowUsers().map((u) => {
    const mine = open.filter((t) => [t.owner_id, t.support_id].includes(u.id));
    let stats;
    if (["director", "admin"].includes(u.role)) {
      stats = [["요청한 업무", open.filter((t) => t.requested_by === u.id).length, `#/items?req=${u.id}`],
               ["승인 대기", open.filter((t) => t.status === "검토요청").length, "#/items?status=검토요청"],
               ["우선순위 미확정", open.filter((t) => t.priority === null).length, "#/items?prio=undecided"]];
    } else {
      const n = r.daily_today[String(u.id)];
      stats = [["담당 업무", mine.length, `#/items?owner=${u.id}`],
               ["지연·경과", mine.filter((t) => ["late", "overdue"].includes(t.alert_kind)).length, `#/items?owner=${u.id}&alert=watch`],
               ["오늘 일지", n === undefined ? "미작성" : n + "건", ""]];
    }
    const exec = !["director", "admin"].includes(u.role);
    return `<div class="flow-card ${exec ? "exec" : "dir"}"><div class="pos">${esc(u.position || ROLE_LABEL[u.role])}</div>
      <div class="nm">${esc(u.name)}</div><div class="duty">${esc(DUTY[u.role] || "")}</div>
      <div class="st">${stats.map(([l, v, h]) => h ? `<a href="${h}">${l} <b>${v}</b></a>` : `<span>${l} <b>${v}</b></span>`).join("")}</div></div>`;
  }).join("");
  const kpis = [
    ["진행 중 업무", open.length, "status=open", "navy"],
    ["지연", open.filter((t) => t.alert_kind === "late").length, "alert=late", "red"],
    ["조치기한 경과", open.filter((t) => t.alert_kind === "overdue").length, "alert=overdue", "red"],
    ["이번 주 마감", open.filter((t) => t.due_date && t.due_date <= weekEnd).length, "status=open", "amber"],
    ["우선순위 미확정", open.filter((t) => t.priority === null).length, "prio=undecided", "orange"],
    ["승인 대기", open.filter((t) => t.status === "검토요청").length, "status=검토요청", "blue"],
    ["미갱신", open.filter((t) => t.alert_kind === "stale").length, "alert=stale", "gray"],
    ["이번 달 완료", items.filter((t) => t.status === "완료" && t.completed_at && t.completed_at >= first).length, "status=완료", "green"],
  ].map(([l, n, q, c]) => `<a class="kpi ${c}" href="#/items?${q}"><div class="lbl">${l}</div><div class="num">${n}</div></a>`).join("");
  const byPrio = [1, 2, 3, 4].map((p) => {
    const list = open.filter((t) => t.prio_value === p);
    return `<div class="col"><h3><span class="pr pr${p}">P${p}</span> ${esc(PRIO_LABEL[p].slice(3))} <span class="muted">${list.length}</span></h3>
      ${list.map((t) => `<div class="it"><a href="#/item/${t.id}">${esc(t.item_no)} ${esc(t.title)}</a>
        <div class="m">${esc(t.owner_name || "")} · ${stBadge(t.status)} ${alBadge(t)}${t.priority === null ? " · 제안" : ""}</div></div>`).join("") || '<p class="muted small">없음</p>'}</div>`;
  }).join("");
  const unset = open.filter((t) => !t.prio_value);
  const watch = open.filter((t) => ALERT_KINDS[t.alert_kind] || t.status === "검토요청");
  $main.innerHTML = `
    <h1>대시보드 <span class="sub">${esc(today)} (${wd(today)}) · 주간 미팅 ${esc(B.settings.meeting)}</span></h1>
    <div class="flow">${flow}</div>
    <div class="flow-note">결재 라인: 업무 담당 → 실행 → 결정 (관리 > 사용자에서 순서를 바꿉니다)</div>
    <div class="kpis">${kpis}</div>
    <div class="card"><h2>우선순위별 진행 업무</h2><div class="board" style="grid-template-columns:repeat(${unset.length ? 5 : 4},1fr)">${byPrio}
      ${unset.length ? `<div class="col"><h3><span class="pr pr0">-</span> 미정 <span class="muted">${unset.length}</span></h3>${unset.map((t) =>
        `<div class="it"><a href="#/item/${t.id}">${esc(t.item_no)} ${esc(t.title)}</a><div class="m">${esc(t.owner_name || "")} · ${stBadge(t.status)}</div></div>`).join("")}</div>` : ""}</div></div>
    <div class="grid2">
      <div class="card"><h2>확인 필요 <span class="sub">${watch.length}건</span></h2>
        ${watch.length ? `<div class="tablewrap"><table class="t"><tbody>${watch.map((t) => `<tr><td class="c">${prio(t)}</td>
          <td class="title">${tlink(t)} ${esc(t.title)}</td><td class="c">${esc(t.owner_name || "")}</td><td class="c">${stBadge(t.status)} ${alBadge(t)}</td></tr>`).join("")}
          </tbody></table></div>` : '<p class="muted">없음</p>'}</div>
      <div class="card"><h2>최근 요청·보고</h2>
        ${r.recent.length ? `<ul class="timeline">${r.recent.map((c) => `<li class="fb"><div class="meta"><b>${esc(c.author || "")}</b> · ${esc(c.kind)} · ${dt(c.created_at)}
          · <a href="#/item/${c.item_id}">${esc(c.item_no)}</a> ${esc(c.title)}</div><div class="pre">${esc(c.content)}</div></li>`).join("")}</ul>` : '<p class="muted">없음</p>'}</div>
    </div>`;
}

// ── 업무목록 ────────────────────────────────────────────────────────
function filterItems(rows, f) {
  return rows.filter((t) => {
    if (f.status === "open" && CLOSED.includes(t.status)) return false;
    if (!["open", "all"].includes(f.status) && t.status !== f.status) return false;
    if (f.owner === "me") { if (![t.owner_id, t.support_id].includes(me().id)) return false; }
    else if (f.owner && String(t.owner_id) !== f.owner && String(t.support_id) !== f.owner) return false;
    if (f.req && String(t.requested_by) !== f.req) return false;
    if (f.prio === "undecided") { if (t.priority !== null) return false; }
    else if (f.prio && String(t.prio_value) !== f.prio) return false;
    if (f.cat && String(t.category_id) !== f.cat) return false;
    if (f.alert === "watch" && !ALERT_KINDS[t.alert_kind]) return false;
    if (f.alert && f.alert !== "watch" && t.alert_kind !== f.alert) return false;
    if (f.q) {
      const hay = ["item_no", "title", "description", "location", "next_action", "project_ref", "owner_name"].map((k) => t[k] || "").join(" ").toLowerCase();
      if (!hay.includes(f.q.toLowerCase())) return false;
    }
    return true;
  });
}

async function viewItems(q) {
  const r = await api("items");
  setFu(r);
  const f = {};
  ["status", "owner", "req", "prio", "cat", "alert", "q"].forEach((k) => { f[k] = (q.get(k) || "").trim(); });
  f.status = f.status || "open";
  const rows = filterItems(r.items, f);
  const link = (patch) => "#/items?" + new URLSearchParams(Object.entries({ ...f, ...patch }).filter(([, v]) => v)).toString();
  const chips = [["open", "진행 중"], ["all", "전체"], ...STATUSES.map((s) => [s, s])].map(([v, t]) =>
    `<a class="chip ${f.status === v ? "on" : ""}" href="${link({ status: v })}">${esc(t)}</a>`).join("");
  $main.innerHTML = `
    <h1>업무목록 <span class="sub">${rows.length}건 / 전체 ${r.items.length}건</span> <button class="btn sm light" id="b-xls">엑셀</button></h1>
    <div class="card">
      <form class="filters" id="f-filter">
        <div><label>담당</label><select name="owner">${opts([{ v: "me", t: "내 업무" }, ...users().map((u) => ({ v: u.id, t: u.name }))], f.owner, "전체")}</select></div>
        <div><label>요청자</label><select name="req">${opts(directors().concat(users().filter((u) => !["admin", "director"].includes(u.role))).map((u) => ({ v: u.id, t: u.name })), f.req, "전체")}</select></div>
        <div><label>우선순위</label><select name="prio">${opts([{ v: "undecided", t: "미확정" }, ...[1, 2, 3, 4].map((p) => ({ v: p, t: PRIO_LABEL[p] }))], f.prio, "전체")}</select></div>
        <div><label>구분</label><select name="cat">${opts(B.cats.map((c) => ({ v: c.id, t: c.name })), f.cat, "전체")}</select></div>
        <div><label>알림</label><select name="alert">${opts([{ v: "watch", t: "알림 있는 것" }, ...Object.entries(ALERT_KINDS).map(([v, t]) => ({ v, t }))], f.alert, "전체")}</select></div>
        <div class="q"><label>검색</label><input type="text" name="q" value="${esc(f.q)}" placeholder="번호 · 업무명 · 현장 · 다음 조치"></div>
        <div><button class="btn">찾기</button></div>
      </form>
      <div class="chips">${chips}</div>
    </div>
    <div class="tablewrap"><table class="t">
      <thead><tr><th>우선</th><th>번호 · 업무명</th><th class="hide-sm">구분 · 현장</th><th class="hide-sm">요청자</th><th>담당</th><th>상태</th>
        <th>진행률</th><th>완료 기한</th><th>알림</th><th class="hide-sm">다음 조치 (F/U일)</th></tr></thead>
      <tbody>${rows.map((t) => `<tr class="${CLOSED.includes(t.status) ? "closed" : ""}">
        <td class="c">${prio(t)}</td>
        <td class="title">${tlink(t)} ${esc(t.title)}${t.photo_cnt ? `<span class="photo-chip">📷 ${t.photo_cnt}</span>` : ""}${t.step_total ? `<span class="photo-chip st">☑ ${t.step_done}/${t.step_total}</span>` : ""}</td>
        <td class="hide-sm">${esc(t.category || "")}${t.location ? `<div class="muted small">${esc(t.location)}</div>` : ""}</td>
        <td class="c hide-sm">${esc(t.requester_name || "")}</td>
        <td class="c">${esc(t.owner_name || "")}${t.support_name ? `<div class="muted small">+${esc(t.support_name)}</div>` : ""}</td>
        <td class="c">${stBadge(t.status)}</td><td>${bar(t.progress)}</td><td class="c">${d(t.due_date)}</td><td class="c">${alBadge(t)}</td>
        <td class="hide-sm clip">${esc(t.next_action || "")}${t.next_action_due ? ` <span class="muted small">(${md(t.next_action_due)})</span>` : ""}</td></tr>`).join("")
        || '<tr><td colspan="10" class="muted c">해당하는 업무가 없습니다.</td></tr>'}</tbody>
    </table></div>`;
  document.getElementById("f-filter").onsubmit = (e) => {
    e.preventDefault();
    const g = Object.fromEntries(new FormData(e.target));
    location.hash = link({ ...g });
  };
  document.querySelectorAll("#f-filter select").forEach((s) => { s.onchange = () => s.form.requestSubmit(); });
  document.getElementById("b-xls").onclick = () => saveXlsx(`공무팀_업무목록_${B.today.replace(/-/g, "")}.xlsx`,
    [{ name: "업무목록", head: ITEM_HEAD, rows: itemRows(rows), widths: ITEM_W }]);
}

// ── 우선순위 ────────────────────────────────────────────────────────
function decideButtons(t) {
  if (!(isDirector() || canManage())) return "";
  const cur = isDirector() ? t.priority : t.priority_proposed;
  const action = isDirector() ? "decide" : "propose";
  return `<div class="decide">${[1, 2, 3, 4].map((p) => `<button data-prio="${t.id}" data-act="${action}" data-v="${p}" class="p${p}${cur === p ? " on" : ""}" title="${esc(PRIO_LABEL[p])}">P${p}</button>`).join("")}</div>`;
}
function bindPrio() {
  document.querySelectorAll("[data-prio]").forEach((b) => {
    b.onclick = () => act("priority", { item_id: Number(b.dataset.prio), action: b.dataset.act, value: b.dataset.v === "" ? null : Number(b.dataset.v) });
  });
}

async function viewPriority() {
  const r = await api("items");
  setFu(r);
  const items = r.items.filter((t) => !CLOSED.includes(t.status));
  const und = items.filter((t) => t.priority === null);
  $main.innerHTML = `
    <h1>우선순위 <span class="sub">업무 담당이 제안 (점선) → 결정권자가 확정 (실선). ${isDirector() ? "버튼을 누르면 바로 확정됩니다." : canManage() ? "버튼을 누르면 제안값이 바뀝니다." : ""}</span></h1>
    <div class="card"><h2>확정 기준</h2><div class="small" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:8px">
      <div><span class="pr pr1">P1</span> <b>긴급·중요</b> — 생산·안전에 바로 영향, 즉시 착수</div>
      <div><span class="pr pr2">P2</span> <b>중요</b> — 영향 크지만 일정 조정 가능, 이번 주 계획에 반영</div>
      <div><span class="pr pr3">P3</span> <b>긴급</b> — 빨리 끝내야 하지만 영향 작음, 틈틈이 처리</div>
      <div><span class="pr pr4">P4</span> <b>일반</b> — 여유 있을 때 처리</div></div></div>
    <div class="card"><h2>미확정 업무 <span class="sub">${und.length}건 — 주간 미팅에서 결정</span></h2>
      ${und.length ? `<div class="tablewrap"><table class="t"><thead><tr><th>업무</th><th>요청자</th><th>담당</th><th>상태</th><th>기한</th><th>제안</th><th>${isDirector() ? "확정" : canManage() ? "제안 변경" : ""}</th></tr></thead>
        <tbody>${und.map((t) => `<tr><td class="title">${tlink(t)} ${esc(t.title)}</td><td class="c">${esc(t.requester_name || "")}</td><td class="c">${esc(t.owner_name || "")}</td>
          <td class="c">${stBadge(t.status)} ${alBadge(t)}</td><td class="c">${d(t.due_date)}</td><td class="c">${prio(t)}</td><td>${decideButtons(t)}</td></tr>`).join("")}</tbody></table></div>`
        : '<p class="muted">미확정 업무가 없습니다.</p>'}</div>
    <div class="card"><h2>확정된 우선순위</h2><div class="board" style="grid-template-columns:repeat(auto-fit,minmax(220px,1fr))">
      ${[1, 2, 3, 4].map((p) => { const list = items.filter((t) => t.priority === p); return `<div class="col"><h3><span class="pr pr${p}">P${p}</span> ${esc(PRIO_LABEL[p].slice(3))} <span class="muted">${list.length}</span></h3>
        ${list.map((t) => `<div class="it"><a href="#/item/${t.id}">${esc(t.item_no)} ${esc(t.title)}</a>
          <div class="m">${esc(t.owner_name || "")} · ${stBadge(t.status)} ${alBadge(t)} · 확정 ${esc(t.priority_decider || "")}</div>
          ${isDirector() ? `<div style="margin-top:4px">${decideButtons(t)}</div>` : ""}</div>`).join("") || '<p class="muted small">없음</p>'}</div>`; }).join("")}
    </div></div>`;
  bindPrio();
}

// ── 등록 · 수정 ─────────────────────────────────────────────────────
async function viewForm(id) {
  let t;
  if (id) {
    const r = await api("item", { id });
    t = r.item;
    if (!r.can_edit) { $main.innerHTML = '<div class="flash error">이 업무를 고칠 권한이 없습니다.</div>'; return; }
  } else {
    t = { request_date: B.today, start_date: B.today, progress: 0, request_channel: "구두",
          owner_id: ["member", "coordinator"].includes(me().role) ? me().id : null, requested_by: isDirector() ? me().id : null };
  }
  const steps = t.progress_mode === "steps";
  $main.innerHTML = `
    <h1>${id ? `${esc(t.item_no)} 정보 수정` : "업무 등록"}</h1>
    <form class="card" id="f-item">
      <div class="form-grid">
        <div class="w4"><label class="req">업무명</label><input type="text" name="title" maxlength="200" required value="${esc(t.title || "")}"></div>
        <div><label>구분</label><select name="category_id">${opts(B.cats.filter((c) => c.active || c.id === t.category_id).map((c) => ({ v: c.id, t: c.name })), t.category_id, "-")}</select></div>
        <div><label>현장·설비</label><input type="text" name="location" maxlength="50" list="locs" value="${esc(t.location || "")}">
          <datalist id="locs">${B.locations.map((l) => `<option value="${esc(l)}">`).join("")}</datalist></div>
        <div><label>요청자</label><select name="requested_by">${userOpts(t.requested_by, "-")}</select></div>
        <div><label>요청일 · 경로</label><div style="display:flex;gap:6px"><input type="date" name="request_date" value="${d(t.request_date)}">
          <select name="request_channel" style="width:90px">${opts(CHANNELS.map((c) => ({ v: c, t: c })), t.request_channel, "-")}</select></div></div>
        <div><label class="req">담당 (실행)</label><select name="owner_id" required>${userOpts(t.owner_id, "선택")}</select></div>
        <div><label>협업</label><select name="support_id">${userOpts(t.support_id, "-")}</select></div>
        <div><label>우선순위 제안</label><select name="priority_proposed">${opts([1, 2, 3, 4].map((p) => ({ v: p, t: PRIO_LABEL[p] })), t.priority_proposed, "-")}</select></div>
        <div><label>진행률 (%)</label><input type="number" name="progress" min="0" max="100" step="5" value="${Number(t.progress) || 0}" ${steps ? 'disabled title="체크리스트로 자동 계산"' : ""}></div>
        <div><label>시작일</label><input type="date" name="start_date" value="${d(t.start_date)}"></div>
        <div><label>완료 기한</label><input type="date" name="due_date" value="${d(t.due_date)}"></div>
        <div class="w2"><label>다음 조치</label><input type="text" name="next_action" maxlength="500" value="${esc(t.next_action || "")}"></div>
        <div><label>다음 F/U일 (조치기한)</label><input type="date" name="next_action_due" value="${d(t.next_action_due)}"></div>
        <div><label>과제 관리번호</label><input type="text" name="project_ref" maxlength="20" value="${esc(t.project_ref || "")}" placeholder="예: P-012"></div>
        <div class="w4"><label>상세 내용</label><textarea name="description">${esc(t.description || "")}</textarea></div>
        ${id ? "" : `<div class="w4"><label>요청 내용 (진행 내역에 '요청' 으로 남음)</label><textarea name="instruction" placeholder="요청자가 말한 내용"></textarea></div>`}
        <div class="w4"><label style="display:flex;gap:6px;align-items:center;font-weight:normal"><input type="checkbox" name="needs_approval" style="width:auto" ${t.needs_approval ? "checked" : ""}>
          <b>큰 업무 — 완료할 때 결정권자 승인 필요</b></label></div>
      </div>
      <div class="actions" style="margin-top:14px"><button class="btn">${id ? "저장" : "등록"}</button>
        <a class="btn light" href="${id ? `#/item/${id}` : "#/items"}">취소</a></div>
    </form>`;
  document.getElementById("f-item").onsubmit = async (e) => {
    e.preventDefault();
    const p = Object.fromEntries(new FormData(e.target));
    p.needs_approval = !!e.target.needs_approval.checked;
    if (steps) p.progress = String(t.progress);
    if (id) p.id = id;
    const r = await act("item_save", p, { reload: false });
    if (r) location.hash = `#/item/${r.id}`;
  };
}

// ── 사진 줄이기 · 올리기 (긴 변 1600px JPEG + 400px 썸네일 — 위치 정보 등은 새로 그리면서 빠짐) ──────
async function decode(file) {
  if (window.createImageBitmap) {
    try { return await createImageBitmap(file, { imageOrientation: "from-image" }); } catch (e) { /* 아래로 */ }
  }
  return await new Promise((ok, no) => {
    const img = new Image();
    img.onload = () => ok(img);
    img.onerror = () => no(new Error(`${file.name}: 사진을 읽을 수 없습니다. JPG · PNG 사진을 올려 주세요. (아이폰 HEIC 는 설정 > 카메라 > 포맷 > '높은 호환성')`));
    img.src = URL.createObjectURL(file);
  });
}
function shrink(img, side, q) {
  const w0 = img.width, h0 = img.height, k = Math.min(1, side / Math.max(w0, h0));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w0 * k)); c.height = Math.max(1, Math.round(h0 * k));
  const g = c.getContext("2d");
  g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height);
  g.drawImage(img, 0, 0, c.width, c.height);
  return { data: c.toDataURL("image/jpeg", q).split(",")[1], w: c.width, h: c.height };
}
async function uploadPhotos(itemId, files, meta, progEl) {
  files = Array.from(files || []).filter((f) => f && f.size);
  if (files.length > 10) throw new Error("한 번에 10장까지 올릴 수 있습니다.");
  let n = 0;
  const errs = [];
  for (const f of files) {
    if (progEl) progEl.textContent = `사진 올리는 중 ${n + 1} / ${files.length}…`;
    try {
      if (f.size > 25 * 1024 * 1024) throw new Error(`${f.name}: 사진 1장은 25MB 이하만 올릴 수 있습니다.`);
      const img = await decode(f);
      const big = shrink(img, 1600, 0.85), th = shrink(img, 400, 0.8);
      await call("photo", { item_id: itemId, comment_id: meta.comment_id || null, daily_id: meta.daily_id || null, kind: meta.kind, caption: meta.caption || null,
                            taken_date: meta.taken_date || null, image: big.data, thumb: th.data, width: big.w, height: big.h,
                            orig_name: f.name.slice(0, 200), orig_width: img.width, orig_height: img.height, orig_bytes: f.size });
      n++;
    } catch (e) { if (e.message) errs.push(e.message); }
  }
  if (progEl) progEl.textContent = "";
  return { n, errs };
}

// ── 상세 ────────────────────────────────────────────────────────────
function buildTimeline(r) {
  const byCmt = {}, byDaily = {}, loose = [];
  r.photos.forEach((p) => {
    if (p.comment_id) (byCmt[p.comment_id] = byCmt[p.comment_id] || []).push(p);
    else if (p.daily_id) (byDaily[p.daily_id] = byDaily[p.daily_id] || []).push(p);
    else loose.push(p);
  });
  const tl = r.comments.map((c) => ({ kind: "cmt", at: c.created_at, row: c, photos: byCmt[c.id] || [], changes: [] }));
  const groups = {};
  r.history.forEach((h) => {
    if (h.field === "사진") return;                                   // 사진은 사진 묶음으로
    const k = h.at + "|" + h.by;
    (groups[k] = groups[k] || { kind: "hist", at: h.at, author: h.author, by: h.by, items: [] }).items.push(h);
  });
  Object.values(groups).forEach((g) => {                              // 보고와 같은 순간의 변경은 그 보고에 붙임
    const host = tl.find((e) => e.kind === "cmt" && e.row.author_id === g.by && Math.abs(new Date(e.at) - new Date(g.at)) <= 3000);
    if (host) host.changes.push(...g.items); else tl.push(g);
  });
  const days = {};
  r.work.forEach((w) => {
    const at = d(w.created_at) === d(w.work_date) ? w.created_at : d(w.work_date) + "T18:00:00";
    (days[w.daily_id] = days[w.daily_id] || { kind: "work", at, date: w.work_date, worker: w.worker, lines: [], photos: byDaily[w.daily_id] || [] }).lines.push(w);
  });
  tl.push(...Object.values(days));
  const shots = {};
  loose.forEach((p) => {
    const k = p.uploaded_by + "|" + String(p.created_at).slice(0, 16);
    (shots[k] = shots[k] || { kind: "photo", at: p.created_at, author: p.uploader, photos: [] }).photos.push(p);
  });
  tl.push(...Object.values(shots));
  tl.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  return tl;
}
const thumbs = (list) => `<div class="tl-photos">${list.map((p) => `<a href="${esc(p.url)}" data-big="${esc(p.url)}" title="${esc(KIND_LABEL[p.kind])}${p.caption ? " · " + esc(p.caption) : ""}">
  <img src="${esc(p.thumb_url)}" loading="lazy" alt="${esc(p.kind)}"><span class="ph-kind k-${esc(p.kind)}">${esc(KIND_LABEL[p.kind])}</span></a>`).join("")}</div>`;

function photoCard(p) {
  return `<figure class="ph"><a href="${esc(p.url)}" data-big="${esc(p.url)}"><img src="${esc(p.thumb_url)}" alt="${esc(p.caption || p.kind)}" loading="lazy"></a>
    <figcaption>${p.caption ? `<div>${esc(p.caption)}</div>` : ""}<div class="muted small">${d(p.taken_date)} · ${esc(p.uploader || "")}</div>
      <div class="ph-actions"><a href="${esc(p.url)}" download target="_blank" rel="noopener">내려받기</a>
      ${p.can_change ? `<details><summary>수정</summary><form data-photo="${p.id}">
        <select name="kind">${opts(KINDS.map((k) => ({ v: k, t: KIND_LABEL[k] })), p.kind)}</select>
        <input type="text" name="caption" value="${esc(p.caption || "")}" maxlength="200" placeholder="설명"><button class="btn sm">저장</button>
        <button type="button" class="linkbtn" data-photo-del="${p.id}">사진 삭제</button></form></details>` : ""}</div></figcaption></figure>`;
}

async function viewDetail(id) {
  const r = await api("item", { id });
  setFu(r);
  const t = r.item, ce = r.can_edit, steps = t.progress_mode === "steps";
  const ph = {}; KINDS.forEach((k) => { ph[k] = r.photos.filter((p) => p.kind === k); });
  const stBtn = (to, label, cls, conf) => `<button class="${cls || "btn"}" data-to="${to}" ${conf ? `data-confirm="${esc(conf)}"` : ""}>${label}</button>`;
  let btns = "";
  if (ce) btns += `<a class="btn light" href="#/edit/${t.id}">정보 수정</a>`;
  if (ce && ["접수", "보류"].includes(t.status)) btns += stBtn("진행", "진행 시작", "btn light");
  if (ce && ["접수", "진행", "보류"].includes(t.status)) {
    btns += (isDirector() || (canManage() && !t.needs_approval)) ? stBtn("완료", "완료 처리", "btn", `${t.item_no} 업무를 완료 처리할까요?`) : stBtn("완료", "완료 → 검토요청", "btn");
  }
  if (t.status === "검토요청" && isDirector()) btns += stBtn("승인", "완료 승인", "btn", "완료를 승인할까요?");
  if ((canManage() || isDirector()) && !CLOSED.includes(t.status)) {
    if (t.status !== "보류") btns += stBtn("보류", "보류", "btn light");
    btns += stBtn("취소", "업무 취소", "btn danger", "업무를 취소할까요?");
  }
  if ((canManage() || isDirector()) && CLOSED.includes(t.status)) btns += stBtn("재개", "다시 진행", "btn light");
  btns += `<a class="btn light" href="#/items">목록</a>`;
  const today = B.today;
  const kindOpts = COMMENT_KINDS.filter((k) => isDirector() || !["요청", "결정"].includes(k));
  const tl = buildTimeline(r);
  $main.innerHTML = `
  <h1>${prio(t)} <span class="tno">${esc(t.item_no)}</span> ${esc(t.title)} ${stBadge(t.status)} ${alBadge(t)}</h1>
  <div class="card">
    <div class="kv">
      <div><span>요청</span>${esc(t.requester_name || "-")}${t.request_date ? " · " + d(t.request_date) : ""}${t.request_channel ? ` (${esc(t.request_channel)})` : ""}</div>
      <div><span>담당 / 협업</span>${esc(t.owner_name || "-")}${t.support_name ? " / " + esc(t.support_name) : ""}</div>
      <div><span>구분 · 현장</span>${esc(t.category || "-")}${t.location ? " · " + esc(t.location) : ""}</div>
      <div><span>우선순위</span>${t.priority ? `${esc(PRIO_LABEL[t.priority])} <span class="muted small">확정 ${esc(t.priority_decider || "")} ${dt(t.priority_decided_at)}</span>`
        : t.priority_proposed ? `${esc(PRIO_LABEL[t.priority_proposed])} <span class="muted small">(제안 · 미확정)</span>` : "-"}</div>
      <div><span>진행률 ${steps ? "(체크리스트 자동)" : ""}</span>${bar(t.progress)}</div>
      <div><span>시작 / 완료 기한</span>${d(t.start_date) || "-"} ~ ${d(t.due_date) || "-"}</div>
      <div><span>다음 F/U일 (조치기한)</span>${d(t.next_action_due) || "-"}</div>
      <div><span>누적 투입 · 사진</span>${hrs(t.total_hours)} 시간 · 사진 ${t.photo_cnt}장</div>
      <div class="w4"><span>다음 조치</span><div class="pre">${esc(t.next_action || "-")}</div></div>
      ${t.description ? `<div class="w4"><span>상세 내용</span><div class="pre">${esc(t.description)}</div></div>` : ""}
      <div class="w4"><span>완료 방식</span>${t.needs_approval ? "<b>큰 업무 — 완료 시 결정권자 승인 필요</b>" : "업무 담당 또는 결정권자가 바로 종료 가능"}
        ${t.approved_by ? ` · <span class="muted">승인 ${esc(t.approver_name || "")} ${dt(t.approved_at)}</span>` : ""}
        ${t.project_ref ? ` · 연결 과제 <b>${esc(t.project_ref)}</b>` : ""}</div>
    </div>
    <div class="actions" style="margin-top:14px" id="st-btns">${btns}</div>
    ${t.status === "검토요청" && isDirector() ? `<form class="filters" id="f-reject" style="margin-top:10px"><div class="q"><label>반려 사유</label>
      <input type="text" name="note" required placeholder="보완할 내용"></div><div><button class="btn danger">반려 (진행으로 되돌림)</button></div></form>` : ""}
  </div>

  <div class="card" id="report">
    <h2>F/U 기록 · 진행 보고 <span class="sub">보고 내용, 진행률, 다음 조치·F/U일, 현장 사진을 한 번에 — 바뀐 값은 이력에 자동 기록</span></h2>
    <form id="f-report"><div class="form-grid">
      <div><label>구분</label><select name="kind">${opts(kindOpts.map((k) => ({ v: k, t: k })), isDirector() ? "요청" : "진행보고")}</select></div>
      <div style="grid-column:span 3"><label>내용</label><textarea name="content" style="min-height:42px" placeholder="오늘 확인한 것, 진행 상황, 문제점, 결정 사항"></textarea></div>
      ${ce ? `<div><label>진행률 (현재 ${t.progress}%)</label>${steps ? '<input type="text" disabled value="체크리스트로 자동 계산">'
        : '<input type="number" name="progress" min="0" max="100" step="5" placeholder="그대로">'}</div>
      <div class="w2"><label>다음 조치 변경</label><input type="text" name="next_action" maxlength="500" placeholder="그대로: ${esc(t.next_action || "")}"></div>
      <div><label>다음 F/U일</label><input type="date" name="next_action_due" title="현재 ${d(t.next_action_due)}"></div>` : ""}
      <div class="w2"><label>사진 (여러 장, 휴대폰은 바로 촬영)</label><input type="file" name="photos" accept="image/*" multiple></div>
      <div><label>사진 구분</label><div class="seg">${KINDS.map((k) => `<label><input type="radio" name="photo_kind" value="${k}" ${k === "작업중" ? "checked" : ""}><span>${KIND_LABEL[k]}</span></label>`).join("")}</div></div>
      <div style="display:flex;align-items:flex-end"><button class="btn" style="width:100%">F/U 기록</button></div>
    </div><div class="prog" id="rep-prog"></div></form>
  </div>

  <div class="card" id="steps">
    <h2>단계별 체크리스트 <span class="sub">${t.step_done}/${t.step_total} 완료</span>
      ${ce ? `<button class="btn sm light" id="b-mode" style="margin-left:10px" data-mode="${steps ? "manual" : "steps"}">${steps ? "진행률 직접 입력으로" : "진행률을 체크리스트로 자동 계산"}</button>` : ""}</h2>
    ${r.steps.length ? `<table class="t steps"><tbody>${r.steps.map((s, i) => {
      const late = !s.done && s.due_date && s.due_date < today;
      return `<tr class="${s.done ? "closed" : ""}">
        <td class="c" style="width:44px">${ce ? `<button class="chk ${s.done ? "on" : ""}" data-step-toggle="${s.id}" title="${s.done ? "완료 취소" : "완료"}">${s.done ? "✔" : ""}</button>` : (s.done ? "✔" : "□")}</td>
        <td><span style="${s.done ? "text-decoration:line-through" : ""}">${i + 1}. ${esc(s.title)}</span>${s.done ? `<span class="muted small"> — ${esc(s.done_by_name || "")} ${dt(s.done_at)}</span>` : ""}</td>
        <td class="c" style="width:90px">${esc(s.owner_name || "")}</td>
        <td class="c" style="width:110px">${s.due_date ? `<span class="${late ? "badge al-late" : ""}">${d(s.due_date)}</span>` : ""}</td>
        <td class="c" style="width:120px">${ce ? `<details class="inline-edit"><summary>수정</summary><form data-step="${s.id}">
          <input type="text" name="title" value="${esc(s.title)}" maxlength="200"><select name="owner_id">${userOpts(s.owner_id, "담당 없음")}</select>
          <input type="date" name="due_date" value="${d(s.due_date)}"><button class="btn sm">저장</button>
          <button type="button" class="linkbtn" data-step-del="${s.id}">삭제</button></form></details>` : ""}</td></tr>`; }).join("")}</tbody></table>`
      : '<p class="muted small">단계가 없습니다. 큰 업무는 단계를 나눠 두면 진행 상황과 다음 F/U 가 분명해집니다.</p>'}
    ${ce ? `<form class="filters" id="f-step" style="margin-top:10px"><div class="q"><label>단계 추가 (여러 개는 → 로 구분)</label>
      <input type="text" name="title" maxlength="600" placeholder="예: 실측 → 자재 발주 → 제작 → 설치 → 사진 보고"></div>
      <div><label>담당</label><select name="owner_id">${userOpts(t.owner_id, "-")}</select></div><div><label>기한</label><input type="date" name="due_date"></div>
      <div><button class="btn">추가</button></div></form>` : ""}
  </div>

  <div class="card" id="photos">
    <h2>사진 <span class="sub">긴 변 1600px JPEG 로 저장 · 누르면 크게</span>
      ${ph["작업전"].length || ph["작업후"].length ? `<a class="btn sm light" style="margin-left:8px" href="#/compare/${t.id}">작업 전·후 비교</a>` : ""}</h2>
    <div class="ba ba3">${["작업전", "작업중", "작업후"].map((k) => `<div><div class="ba-head k-${k}">${KIND_LABEL[k]} <span>${ph[k].length}장</span></div>
      <div class="gallery">${ph[k].map(photoCard).join("") || '<p class="muted small">없음</p>'}</div></div>`).join("")}</div>
    ${ph["참고"].length ? `<div class="ba-head k-참고">참고 <span>${ph["참고"].length}장</span></div><div class="gallery">${ph["참고"].map(photoCard).join("")}</div>` : ""}
    <form class="upload" id="f-photo"><div class="form-grid">
      <div><label>구분</label><div class="seg">${KINDS.map((k) => `<label><input type="radio" name="kind" value="${k}" ${k === (ph["작업전"].length ? "작업후" : "작업전") ? "checked" : ""}><span>${KIND_LABEL[k]}</span></label>`).join("")}</div></div>
      <div class="w2"><label>사진만 올리기</label><input type="file" name="photos" accept="image/*" multiple required></div>
      <div><label>촬영일</label><input type="date" name="taken_date" value="${today}" max="${today}"></div>
      <div class="w4" style="display:flex;gap:10px;align-items:flex-end"><div style="flex:1"><label>설명 (선택)</label><input type="text" name="caption" maxlength="200"></div>
        <button class="btn light">사진 올리기</button></div>
    </div><div class="prog" id="ph-prog"></div></form>
  </div>

  ${isDirector() || canManage() ? `<div class="card"><h2>우선순위 <span class="sub">${isDirector() ? "결정권자: 누르면 확정" : "업무 담당: 누르면 제안"}</span></h2>
    <div class="decide">${[1, 2, 3, 4].map((p) => { const cur = isDirector() ? t.priority : t.priority_proposed;
      return `<button data-prio="${t.id}" data-act="${isDirector() ? "decide" : "propose"}" data-v="${p}" class="p${p}${cur === p ? " on" : ""}">${esc(PRIO_LABEL[p])}</button>`; }).join("")}
      ${(isDirector() ? t.priority : t.priority_proposed) ? `<button data-prio="${t.id}" data-act="${isDirector() ? "decide" : "propose"}" data-v="" title="${isDirector() ? "확정 취소" : "제안 지우기"}">✕</button>` : ""}</div>
    ${isDirector() && t.priority_proposed && !t.priority ? `<p class="muted small" style="margin:6px 0 0">업무 담당 제안: ${esc(PRIO_LABEL[t.priority_proposed])}</p>` : ""}</div>` : ""}

  <div class="card"><h2>진행 내역 <span class="sub">요청·보고·사진·업무일지 작업·변경을 날짜순으로 · 누적 ${hrs(t.total_hours)}시간</span></h2>
    ${tl.length ? `<ul class="timeline">${tl.map((e) => {
      if (e.kind === "cmt") {
        const c = e.row;
        return `<li class="fb"><div class="meta"><b>${esc(c.author || "")}</b> · <span class="badge ${["요청", "결정"].includes(c.kind) ? "st-검토요청" : "st-진행"}">${esc(c.kind)}</span> · ${dt(c.created_at)}
          ${c.author_id === me().id || isAdmin() ? `<button class="linkbtn" data-cmt-del="${c.id}">삭제</button>` : ""}</div>
          <div class="pre">${esc(c.content)}</div>
          ${e.changes.map((h) => `<div class="small muted">↳ ${esc(h.field)}: ${esc(h.old || "(없음)")} → <b style="color:#1f2937">${esc(h.new || "(없음)")}</b></div>`).join("")}
          ${e.photos.length ? thumbs(e.photos) : ""}</li>`;
      }
      if (e.kind === "work") {
        return `<li class="wk"><div class="meta"><b>${esc(e.worker)}</b> · <span class="badge st-완료">업무일지</span> · ${d(e.date)} (${wd(e.date)})</div>
          ${e.lines.map((w) => `<div>${esc(w.content)} <span class="muted small">${w.hours ? hrs(w.hours) + "h" : ""}${w.progress !== null && w.progress !== undefined ? " · 진행률 " + w.progress + "%" : ""}</span></div>`).join("")}
          ${e.photos.length ? thumbs(e.photos) : ""}</li>`;
      }
      if (e.kind === "photo") return `<li class="fb"><div class="meta"><b>${esc(e.author || "")}</b> · <span class="badge st-진행">사진</span> · ${dt(e.at)} · ${e.photos.length}장</div>${thumbs(e.photos)}</li>`;
      return `<li><div class="meta"><b>${esc(e.author || "")}</b> · ${dt(e.at)} · 변경</div>
        ${e.items.map((h) => `<div class="small">${esc(h.field)}: <span class="muted">${esc(h.old || "(없음)")}</span> → <b>${esc(h.new || "(없음)")}</b></div>`).join("")}</li>`;
    }).join("")}</ul>` : '<p class="muted">아직 진행 내역이 없습니다.</p>'}
  </div>
  ${isDirector() || canManage() ? `<button class="linkbtn noprint" id="b-del">업무 삭제</button>` : ""}`;

  // ── 이벤트 ──
  document.querySelectorAll("#st-btns [data-to]").forEach((b) => {
    b.onclick = () => act("status", { item_id: t.id, to: b.dataset.to }, { confirm: b.dataset.confirm });
  });
  const rej = document.getElementById("f-reject");
  if (rej) rej.onsubmit = (e) => { e.preventDefault(); act("status", { item_id: t.id, to: "반려", note: e.target.note.value }); };
  bindPrio();
  document.getElementById("f-report").onsubmit = async (e) => {
    e.preventDefault();
    const fm = e.target, f = Object.fromEntries(new FormData(fm));
    const files = fm.photos.files;
    const btn = fm.querySelector("button.btn");
    btn.disabled = true;
    try {
      const r2 = await api("report", { item_id: t.id, kind: f.kind, content: f.content, progress: f.progress, next_action: f.next_action,
                                       next_action_due: f.next_action_due, photo_count: files.length });
      let msg = r2.msg;
      if (files.length && r2.comment_id) {
        const up = await uploadPhotos(t.id, files, { comment_id: r2.comment_id, kind: f.photo_kind }, document.getElementById("rep-prog"));
        msg += up.n ? `, 사진 ${up.n}장` : "";
        if (up.errs.length) setTimeout(() => toast(up.errs.join(" / "), "error"), 1500);
      }
      toast(msg);
      if (r2.warn) setTimeout(() => toast(r2.warn, "error"), 1200);
      await route();
    } catch (err) { if (err.message) toast(err.message, "error"); btn.disabled = false; }
  };
  const fstep = document.getElementById("f-step");
  if (fstep) fstep.onsubmit = (e) => { e.preventDefault(); act("step_add", { item_id: t.id, ...Object.fromEntries(new FormData(e.target)) }); };
  document.querySelectorAll("[data-step-toggle]").forEach((b) => { b.onclick = () => act("step_toggle", { id: Number(b.dataset.stepToggle) }); });
  document.querySelectorAll("form[data-step]").forEach((fm) => {
    fm.onsubmit = (e) => { e.preventDefault(); act("step_update", { id: Number(fm.dataset.step), ...Object.fromEntries(new FormData(fm)) }); };
  });
  document.querySelectorAll("[data-step-del]").forEach((b) => { b.onclick = () => act("step_delete", { id: Number(b.dataset.stepDel) }, { confirm: "이 단계를 삭제할까요?" }); });
  const bm = document.getElementById("b-mode");
  if (bm) bm.onclick = () => act("progress_mode", { item_id: t.id, mode: bm.dataset.mode });
  document.getElementById("f-photo").onsubmit = async (e) => {
    e.preventDefault();
    const fm = e.target, f = Object.fromEntries(new FormData(fm));
    const btn = fm.querySelector("button.btn");
    btn.disabled = true;
    try {
      const up = await uploadPhotos(t.id, fm.photos.files, { kind: f.kind, caption: f.caption, taken_date: f.taken_date }, document.getElementById("ph-prog"));
      if (up.n) toast((await api("photo_done", { item_id: t.id, kind: f.kind, count: up.n })).msg);
      if (up.errs.length) setTimeout(() => toast(up.errs.join(" / "), "error"), up.n ? 1500 : 0);
      await route();
    } catch (err) { if (err.message) toast(err.message, "error"); btn.disabled = false; }
  };
  document.querySelectorAll("form[data-photo]").forEach((fm) => {
    fm.onsubmit = (e) => { e.preventDefault(); act("photo_update", { id: Number(fm.dataset.photo), ...Object.fromEntries(new FormData(fm)) }); };
  });
  document.querySelectorAll("[data-photo-del]").forEach((b) => { b.onclick = () => act("photo_delete", { id: Number(b.dataset.photoDel) }, { confirm: "이 사진을 삭제할까요?" }); });
  document.querySelectorAll("[data-cmt-del]").forEach((b) => { b.onclick = () => act("comment_delete", { id: Number(b.dataset.cmtDel) }, { confirm: "삭제할까요?" }); });
  const bd = document.getElementById("b-del");
  if (bd) bd.onclick = () => act("item_delete", { id: t.id }, { confirm: `${t.item_no} 업무를 삭제할까요?`, go: "#/items" });
  bindBig();
}

function bindBig() {
  document.querySelectorAll("a[data-big]").forEach((a) => {
    a.onclick = (e) => {
      e.preventDefault();
      const bg = document.createElement("div");
      bg.className = "modal-bg";
      bg.innerHTML = `<div class="modal"><img src="${esc(a.dataset.big)}" alt=""><div class="actions" style="margin-top:8px">
        <a class="btn sm light" href="${esc(a.dataset.big)}" target="_blank" rel="noopener">새 창</a><button class="btn sm">닫기</button></div></div>`;
      bg.onclick = (ev) => { if (ev.target === bg || ev.target.tagName === "BUTTON") bg.remove(); };
      document.body.appendChild(bg);
    };
  });
}

// ── 작업 전·후 비교 (인쇄 · 캡처용) ───────────────────────────────
async function viewCompare(id) {
  const r = await api("item", { id });
  const t = r.item, b = r.photos.filter((p) => p.kind === "작업전"), a = r.photos.filter((p) => p.kind === "작업후");
  const n = Math.max(b.length, a.length), pairs = [];
  for (let i = 0; i < n; i++) pairs.push([b[i], a[i]]);
  const cell = (p, label) => p ? `<div class="cmp-cell"><img src="${esc(p.url)}" alt=""><div class="cmp-cap"><b>${label}</b> ${d(p.taken_date)} ${esc(p.caption || "")}</div></div>`
    : `<div class="cmp-cell"><div class="cmp-empty">${label} 사진 없음</div></div>`;
  const mids = r.photos.filter((p) => p.kind === "작업중"), refs = r.photos.filter((p) => p.kind === "참고");
  $main.innerHTML = `<div class="actions noprint" style="margin-bottom:10px"><a class="btn light" href="#/item/${t.id}">← 업무로</a><button class="btn" onclick="window.print()">인쇄 · PDF</button></div>
    <div class="compare"><div class="cmp-title">${esc(t.item_no)} ${esc(t.title)} — 작업 전·후</div>
      <div class="cmp-row"><div class="ba-head before">작업 전 <span>${b.length}장</span></div><div class="ba-head after">작업 후 <span>${a.length}장</span></div></div>
      ${pairs.map(([x, y]) => `<div class="cmp-row">${cell(x, "작업 전")}${cell(y, "작업 후")}</div>`).join("")}
      ${mids.length ? `<div class="ba-head" style="background:#2f6fa8">작업 중 <span>${mids.length}장</span></div><div class="gallery">${mids.map((p) => `<img src="${esc(p.thumb_url)}" style="width:100%" alt="">`).join("")}</div>` : ""}
      ${refs.length ? `<div class="ba-head ref">참고 <span>${refs.length}장</span></div><div class="gallery">${refs.map((p) => `<img src="${esc(p.thumb_url)}" style="width:100%" alt="">`).join("")}</div>` : ""}
    </div>`;
}

// ── 오늘 F/U ────────────────────────────────────────────────────────
async function viewFollowup() {
  const r = await api("followup");
  setFu(r);
  const groups = {};
  r.items.forEach((t) => { (groups[t.fu_reason] = groups[t.fu_reason] || []).push(t); });
  const total = r.items.length;
  $main.innerHTML = `
    <h1>오늘 F/U <span class="sub">${total}건 · 조치 임박 ${esc(B.settings.soon)}일 · 미갱신 ${esc(B.settings.stale)}일 기준${me().role === "member" ? " · 내 담당·협업만" : ""}</span></h1>
    ${r.steps_due.length ? `<div class="card fu-step"><h2>단계 기한 (오늘·내일까지)</h2><table class="t"><tbody>${r.steps_due.map((s) => `<tr>
      <td class="c">${s.due_date < B.today ? `<span class="badge al-late">${d(s.due_date)}</span>` : d(s.due_date)}</td>
      <td><a href="#/item/${s.item_id}">${esc(s.item_no)}</a> ${esc(s.item_title)} — <b>${esc(s.title)}</b></td><td class="c">${esc(s.owner_name || "")}</td></tr>`).join("")}</tbody></table></div>` : ""}
    ${Object.keys(FU_REASONS).filter((k) => groups[k]).map((k) => `<div class="card fu-group fu-${k}"><h2>${FU_REASONS[k]} <span class="sub">${groups[k].length}건</span></h2>
      ${groups[k].map((t) => { const ce = canEdit(t); return `<div class="fu-item">
        <div class="fu-head">${prio(t)} ${tlink(t)} <b>${esc(t.title)}</b> ${stBadge(t.status)} ${alBadge(t)} <span class="muted small">${esc(t.owner_name || "")} · ${bar(t.progress).replace('class="bar"', 'class="bar" style="display:inline-block;width:80px;vertical-align:middle"')}</span></div>
        <div class="small">${t.next_action ? `다음 조치: ${esc(t.next_action)}` : '<span class="muted">다음 조치 없음</span>'}${t.next_action_due ? ` · F/U ${d(t.next_action_due)}` : ""}${t.step_total ? ` · 체크리스트 ${t.step_done}/${t.step_total}` : ""}</div>
        <form class="fu-form" data-fu="${t.id}">
          <input class="fu-c" type="text" name="content" placeholder="F/U 내용 (짧게)">
          ${ce && t.progress_mode !== "steps" ? '<input class="fu-n" type="number" name="progress" min="0" max="100" step="5" placeholder="진행률 %">' : ""}
          ${ce ? '<input class="fu-d" type="date" name="next_action_due" title="다음 F/U일">' : ""}
          <label class="fu-f" title="사진">📷<input type="file" name="photos" accept="image/*" multiple></label>
          <button class="btn sm">기록</button></form>
        ${ce ? `<div class="fu-post small muted">F/U일 미루기: ${[1, 3, 7].map((n) => `<button class="btn sm light" data-post="${t.id}" data-days="${n}">+${n}일</button>`).join("")}</div>` : ""}
        <div class="prog" id="fu-prog-${t.id}"></div></div>`; }).join("")}</div>`).join("")}
    ${total ? "" : '<div class="card"><p class="muted">오늘 챙길 업무가 없습니다.</p></div>'}`;
  document.querySelectorAll("form[data-fu]").forEach((fm) => {
    fm.onsubmit = async (e) => {
      e.preventDefault();
      const id = Number(fm.dataset.fu), f = Object.fromEntries(new FormData(fm)), files = fm.photos.files;
      const btn = fm.querySelector("button");
      btn.disabled = true;
      try {
        const r2 = await api("report", { item_id: id, content: f.content, progress: f.progress, next_action_due: f.next_action_due, photo_count: files.length });
        let msg = r2.msg;
        if (files.length && r2.comment_id) {
          const up = await uploadPhotos(id, files, { comment_id: r2.comment_id, kind: "작업중" }, document.getElementById("fu-prog-" + id));
          msg += up.n ? `, 사진 ${up.n}장` : "";
          if (up.errs.length) setTimeout(() => toast(up.errs.join(" / "), "error"), 1500);
        }
        toast(msg);
        await route();
      } catch (err) { if (err.message) toast(err.message, "error"); btn.disabled = false; }
    };
    fm.photos.onchange = () => { fm.querySelector(".fu-f").setAttribute("data-n", fm.photos.files.length); };
  });
  document.querySelectorAll("[data-post]").forEach((b) => { b.onclick = () => act("postpone", { item_id: Number(b.dataset.post), days: Number(b.dataset.days) }); });
}

// ── 관리: 사용자 ────────────────────────────────────────────────────
async function viewUsers() {
  const r = await api("admin_users");
  const row = (u) => `<tr><td><form data-user="${u.id || ""}" class="fu-form" style="margin:0">
      <input type="text" name="login_id" value="${esc(u.login_id || "")}" placeholder="아이디" style="width:110px" required>
      <input type="text" name="name" value="${esc(u.name || "")}" placeholder="이름" style="width:90px" required>
      <input type="text" name="position" value="${esc(u.position || "")}" placeholder="직책" style="width:90px">
      <select name="role" style="width:110px">${opts(Object.entries(ROLE_LABEL).map(([v, t]) => ({ v, t })), u.role || "member")}</select>
      <input type="number" name="flow_order" value="${u.flow_order || 0}" min="0" max="20" style="width:64px" title="결재 라인 순서 (0 = 아님)">
      <label style="display:flex;gap:4px;align-items:center;margin:0;font-weight:normal"><input type="checkbox" name="active" style="width:auto" ${u.id ? (u.active ? "checked" : "") : "checked"}>사용</label>
      <button class="btn sm">${u.id ? "저장" : "추가"}</button></form></td>
    <td class="c">${u.id ? (u.has_pw ? (u.must_change_pw ? '<span class="badge al-soon">임시</span>' : "있음") : '<span class="badge al-overdue">없음</span>') : ""}</td>
    <td class="c small">${u.id ? dt(u.last_login_at) : ""}</td><td class="c">${u.id ? u.open_items : ""}</td>
    <td class="c">${u.id ? `<button class="btn sm light" data-pw="${u.id}" data-nm="${esc(u.name)}">임시 비밀번호</button>
      ${u.has_pw && u.id !== me().id ? `<button class="linkbtn" data-lock="${u.id}">로그인 차단</button>` : ""}` : ""}</td></tr>`;
  $main.innerHTML = `
    <h1>관리 <span class="sub"><a href="#/admin">사용자</a> · <a href="#/admin/master">업무 구분 · 설정</a></span></h1>
    <div class="card"><h2>사용자 <span class="sub">결재 라인 순서 1, 2, 3 … = 대시보드 흐름 · 0 = 결재 라인 아님</span></h2>
      <div class="tablewrap"><table class="t"><thead><tr><th>아이디 · 이름 · 직책 · 역할 · 순서 · 사용</th><th>비밀번호</th><th>마지막 로그인</th><th>맡은 업무</th><th></th></tr></thead>
        <tbody>${r.users.map(row).join("")}${row({})}</tbody></table></div>
      <p class="muted small">역할: 관리자 = 모든 기능 + 관리 · 결정권자 = 요청 · 우선순위 확정 · 완료 승인 · 업무 담당 = 등록 · 수정 · 제안 · 대리 작성 · 실행자 = 본인 업무.<br>
        [임시 비밀번호] 를 주면 그 사람은 처음 로그인할 때 새 비밀번호로 바꿉니다. 비밀번호는 서버에 해시로만 남습니다.</p></div>`;
  document.querySelectorAll("form[data-user]").forEach((fm) => {
    fm.onsubmit = (e) => {
      e.preventDefault();
      const p = Object.fromEntries(new FormData(fm));
      p.active = !!fm.active.checked;
      if (fm.dataset.user) p.id = Number(fm.dataset.user);
      act("user_save", p);
    };
  });
  document.querySelectorAll("[data-pw]").forEach((b) => {
    b.onclick = async () => {
      const pw = prompt(`${b.dataset.nm} 님 임시 비밀번호 (6자 이상) — 직접 알려 주세요`);
      if (!pw) return;
      try { const x = await call("admin_pw", { user_id: Number(b.dataset.pw), password: pw }); toast(`${x.name} 님 임시 비밀번호를 정했습니다.`); await route(); }
      catch (e) { if (e.message) toast(e.message, "error"); }
    };
  });
  document.querySelectorAll("[data-lock]").forEach((b) => { b.onclick = () => act("user_lock", { id: Number(b.dataset.lock) }, { confirm: "이 사람의 로그인을 차단할까요? (다시 쓰려면 임시 비밀번호)" }); });
}

// ── 관리: 업무 구분 · 설정 ──────────────────────────────────────────
async function viewMaster() {
  const r = await api("cats");
  const row = (c) => `<tr><td><form data-cat="${c.id || ""}" class="fu-form" style="margin:0">
      <input type="text" name="name" value="${esc(c.name || "")}" placeholder="구분 이름" maxlength="50" style="width:200px" required>
      <input type="number" name="sort_order" value="${c.sort_order ?? 0}" style="width:70px" title="순서">
      <label style="display:flex;gap:4px;align-items:center;margin:0;font-weight:normal"><input type="checkbox" name="active" style="width:auto" ${c.id ? (c.active ? "checked" : "") : "checked"}>사용</label>
      <button class="btn sm">${c.id ? "저장" : "추가"}</button>
      ${c.id && !c.refs ? `<button type="button" class="linkbtn" data-cat-del="${c.id}">삭제</button>` : ""}</form></td>
    <td class="c">${c.id ? c.refs : ""}</td></tr>`;
  $main.innerHTML = `
    <h1>관리 <span class="sub"><a href="#/admin">사용자</a> · <a href="#/admin/master">업무 구분 · 설정</a></span></h1>
    <div class="grid2">
      <div class="card"><h2>업무 구분</h2><table class="t"><thead><tr><th>이름 · 순서 · 사용</th><th>업무 수</th></tr></thead>
        <tbody>${r.cats.map(row).join("")}${row({})}</tbody></table>
        <p class="muted small">쓰고 있는 구분은 지울 수 없습니다 — '사용' 을 끄면 새 업무에서 안 보입니다.</p></div>
      <div class="card"><h2>설정</h2><form id="f-set">
        <label>조치 임박 기준 (일)</label><input type="number" name="soon" min="0" max="365" value="${esc(r.settings.soon)}">
        <label style="margin-top:10px">미갱신 기준 (일, 진행 업무)</label><input type="number" name="stale" min="0" max="365" value="${esc(r.settings.stale)}">
        <label style="margin-top:10px">주간 미팅</label><input type="text" name="meeting" maxlength="200" value="${esc(r.settings.meeting)}">
        <div class="actions" style="margin-top:12px"><button class="btn">저장</button></div></form></div>
    </div>`;
  document.querySelectorAll("form[data-cat]").forEach((fm) => {
    fm.onsubmit = (e) => {
      e.preventDefault();
      const p = Object.fromEntries(new FormData(fm));
      p.active = !!fm.active.checked;
      if (fm.dataset.cat) p.id = Number(fm.dataset.cat);
      act("cat_save", p).then(refreshBoot);
    };
  });
  document.querySelectorAll("[data-cat-del]").forEach((b) => { b.onclick = () => act("cat_save", { id: Number(b.dataset.catDel), delete: true }, { confirm: "이 구분을 지울까요?" }).then(refreshBoot); });
  document.getElementById("f-set").onsubmit = (e) => { e.preventDefault(); act("settings_save", Object.fromEntries(new FormData(e.target))).then(refreshBoot); };
}
async function refreshBoot() { try { B = await api("boot"); } catch (e) { /* 다음에 */ } }

// ── 비밀번호 ────────────────────────────────────────────────────────
function viewPassword() {
  const first = me().must_change_pw;
  $main.innerHTML = `<div class="login" style="margin-top:4vh"><div class="card">
    <h2>${first ? "처음 로그인 — 새 비밀번호를 정하세요" : "비밀번호 바꾸기"}</h2>
    <form id="f-pw">
      <label>${first ? "받은 임시 비밀번호" : "현재 비밀번호"}</label><input type="password" name="current" autocomplete="current-password" required>
      <label>새 비밀번호 (6자 이상)</label><input type="password" name="new" autocomplete="new-password" minlength="6" required>
      <label>새 비밀번호 확인</label><input type="password" name="new2" autocomplete="new-password" minlength="6" required>
      <button class="btn">바꾸기</button>
    </form>${first ? "" : '<p class="small" style="margin-top:10px"><a href="#/">← 대시보드</a></p>'}</div></div>`;
  document.getElementById("f-pw").onsubmit = async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    if (f.new !== f.new2) { toast("새 비밀번호 확인이 일치하지 않습니다.", "error"); return; }
    try {
      await call("password", { current: f.current, new: f.new });
      toast("비밀번호를 바꿨습니다.");
      B = await api("boot");
      location.hash = "#/";
    } catch (err) { if (err.message) toast(err.message, "error"); }
  };
}

// =====================================================================
// 2단계 (93_engwork2.sql): 업무일지 · 하루 전체 · 월간 현황 · 주간계획 · 주간미팅 · 결재란 · 엑셀
// =====================================================================
const OUTCOMES = ["달성", "부분", "미달"];
const WDAYS = "월화수목금토";
function ymd(dt0) { return `${dt0.getFullYear()}-${String(dt0.getMonth() + 1).padStart(2, "0")}-${String(dt0.getDate()).padStart(2, "0")}`; }
function addDays(s, n) { const x = new Date(d(s) + "T00:00:00"); x.setDate(x.getDate() + n); return ymd(x); }
function monday(s) { const x = new Date(d(s) + "T00:00:00"); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return ymd(x); }
const outBadge = (o) => (o ? `<span class="badge ${o === "달성" ? "st-완료" : o === "부분" ? "al-soon" : "al-overdue"}">${esc(o)}</span>` : "");
const lineItem = (l) => (l.item_no ? `<b>${esc(l.item_no)}</b> ${esc(l.item_title || "")}` : "기타");

// 결재란: flow = 결재 라인, signs = {user_id: {signed_at, signed_by, signer_name}}
function signbox(flow, signs, type, docId) {
  return `<div class="sign">${flow.map((u) => {
    const s = signs[String(u.id)];
    let body;
    if (s) {
      body = `<span class="ok">${esc(u.name)}</span><small>${md(s.signed_at)} ${String(s.signed_at).slice(11, 16)}${s.signed_by !== u.id ? ` 대리(${esc(s.signer_name)})` : ""}</small>
        ${docId && ([u.id, s.signed_by].includes(me().id) || isAdmin()) ? `<button class="noprint" style="border:none;color:#888;padding:0" data-sign="${u.id}" data-cancel="1">취소</button>` : ""}`;
    } else if (docId && (me().id === u.id || (canManage() && ["member", "coordinator"].includes(u.role)))) {
      body = `<span class="muted small">${esc(u.name)}</span><button class="noprint" data-sign="${u.id}">${me().id === u.id ? "확인" : "대리 확인"}</button>`;
    } else {
      body = `<span class="muted small">${esc(u.name)}</span>`;
    }
    return `<div class="slot"><div class="h">${esc(u.position || u.name)}</div><div class="b">${body}</div></div>`;
  }).join("")}</div>`;
}
function bindSign(type, docId) {
  document.querySelectorAll("[data-sign]").forEach((b) => {
    b.onclick = () => act("sign", { doc_type: b.closest("[data-doc-type]") ? b.closest("[data-doc-type]").dataset.docType : type,
                                    doc_id: b.closest("[data-doc-id]") ? Number(b.closest("[data-doc-id]").dataset.docId) : docId,
                                    slot: Number(b.dataset.sign), action: b.dataset.cancel ? "cancel" : "" },
                       { confirm: b.dataset.cancel ? "확인을 취소할까요?" : null });
  });
}

function itemSelect(name, choices, who, sel) {
  const mine = choices.filter((c) => c.owner_id === who.id), sup = choices.filter((c) => c.support_id === who.id && c.owner_id !== who.id);
  const rest = choices.filter((c) => !mine.includes(c) && !sup.includes(c));
  const o = (list) => list.map((c) => `<option value="${c.id}" ${c.id === sel ? "selected" : ""}>${esc(c.item_no)} ${esc(c.title)}</option>`).join("");
  return `<select name="${name}"><option value="">(기타 · 등록 안 된 일)</option>
    ${mine.length ? `<optgroup label="${esc(who.name)} 담당">${o(mine)}</optgroup>` : ""}${sup.length ? `<optgroup label="협업">${o(sup)}</optgroup>` : ""}
    <optgroup label="기타 진행 업무">${o(rest)}</optgroup></select>`;
}
function whoSelect(workers, who) {
  if (!workers.some((w) => w.id === who.id)) workers = [who, ...workers];
  return `<select id="sel-who" style="width:auto">${workers.map((w) => `<option value="${w.id}" ${w.id === who.id ? "selected" : ""}>${esc(w.name)} (${esc(w.position || "")})</option>`).join("")}</select>`;
}

// ── 업무일지 ────────────────────────────────────────────────────────
async function viewDaily(q) {
  const r = await api("daily_get", { user_id: q.get("user") || null, date: q.get("date") || null });
  const who = r.who, dd = r.date, ed = r.editable, dl = r.daily;
  const go = (u, dt0) => { location.hash = `#/daily?user=${u}&date=${dt0}`; };
  const doneRow = (l, i) => `<tr class="${l && r.carried && !dl ? "carry" : ""}"><td class="no">${i + 1}</td>
    <td class="w-item" data-l="업무">${itemSelect("r_item", r.choices, who, l ? l.item_id : null)}</td>
    <td data-l="한 일"><textarea name="r_content" placeholder="오늘 한 일 (결과 위주로)">${esc(l ? l.content : "")}</textarea></td>
    <td class="w-h" data-l="시간(h)"><input type="number" name="r_hours" min="0" max="24" step="0.5" value="${l && l.hours !== null && l.hours !== undefined ? hrs(l.hours) : ""}" placeholder="h"></td>
    <td class="w-p" data-l="진행률 갱신(%)"><input type="number" name="r_progress" min="0" max="100" step="5" value="${l && l.progress !== null && l.progress !== undefined ? l.progress : ""}" placeholder="%"></td>
    <td class="w-ph" data-l="현장 사진 (업무 선택 시)"><label class="fu-f" title="현장 사진 — 고른 업무의 '작업 중' 사진으로 저장">📷<input type="file" name="r_photo" accept="image/*" multiple></label></td></tr>`;
  const planRow = (l, i) => `<tr><td class="no">${i + 1}</td><td class="w-item" data-l="업무">${itemSelect("p_item", r.choices, who, l ? l.item_id : null)}</td>
    <td data-l="할 일"><textarea name="p_content" placeholder="내일 할 일">${esc(l ? l.content : "")}</textarea></td></tr>`;
  const fill = (list) => list.concat(Array(list.length ? 2 : 3).fill(null));            // EngWork: 있는 줄 + 빈 줄 2 (없으면 3)
  $main.innerHTML = `
  <div class="card doc"><div class="doc-head"><div>
    <div class="doc-title">일 일 업 무 일 지</div>
    <div class="doc-meta"><div class="noprint" style="display:inline-flex;gap:6px;align-items:center;flex-wrap:wrap">
      <button class="btn sm light" id="d-prev">◀</button><input type="date" id="d-date" value="${dd}" style="width:150px"><button class="btn sm light" id="d-next">▶</button>
      ${whoSelect(r.workers, who)}</div>
      <div style="margin-top:6px"><b>${dd} (${wd(dd)})</b> · 성명 <b>${esc(who.name)}</b> ${esc(who.position || "")}
        ${dl ? `· <span class="muted small">저장 ${dt(dl.updated_at)}${dl.written_by !== who.id ? ` (대리 작성 ${esc(dl.writer || "")})` : ""}</span>` : '· <span class="badge al-overdue">미작성</span>'}</div></div></div>
    ${signbox(r.flow, r.signs, "daily", dl ? dl.id : null)}</div>
  ${ed ? `<form id="f-daily">
    <div class="sec-title">1. 금일 실적 <span class="sub">업무를 고르면 그 업무의 진행 내역에 쌓입니다 · 진행률을 적으면 업무 진행률도 바뀝니다 · 📷 = 현장 사진
      ${r.carried && !dl ? '<br><span class="badge al-soon">지난 일지의 \'명일 계획\'을 불러왔습니다 — 실제 한 일로 고치세요</span>' : ""}</span></div>
    <table class="rows fixed"><thead><tr><th style="width:36px">No</th><th style="width:30%">업무</th><th>한 일</th><th style="width:72px">시간(h)</th><th style="width:80px">진행률</th><th style="width:54px">사진</th></tr></thead>
      <tbody id="done">${fill(r.done).map(doneRow).join("")}</tbody></table>
    ${r.photos.length ? `<div class="small muted" style="margin-top:6px">이 일지에서 올린 사진</div>${thumbs(r.photos.map((p) => ({ ...p, kind: p.kind })))}` : ""}
    <button type="button" class="btn sm light rowbtn noprint" id="add-done">+ 줄 추가</button>
    <div class="sec-title">2. 명일 계획</div>
    <table class="rows fixed"><thead><tr><th style="width:36px">No</th><th style="width:30%">업무</th><th>할 일</th></tr></thead><tbody id="plan">${fill(r.plan).map(planRow).join("")}</tbody></table>
    <button type="button" class="btn sm light rowbtn noprint" id="add-plan">+ 줄 추가</button>
    <div class="sec-title">3. 특이사항 · 지원 요청</div>
    <div class="form-grid"><div class="w2"><label>특이사항 · 이슈</label><textarea name="issues" placeholder="설비 이상, 안전, 일정 지연 사유 등">${esc(dl ? dl.issues || "" : "")}</textarea></div>
      <div class="w2"><label>지원·협조 요청</label><textarea name="support_request" placeholder="필요한 결정, 구매, 인력 지원 등">${esc(dl ? dl.support_request || "" : "")}</textarea></div></div>
    <p class="actions noprint" style="margin-top:14px"><button class="btn">저장</button><button type="button" class="btn light" onclick="window.print()">인쇄</button>
      <a class="btn light" href="#/daily/report?date=${dd}">이 날 전체 일지</a><a class="btn light" href="#/daily/month?m=${dd.slice(0, 7)}">월간 작성 현황</a></p>
    <div class="prog" id="d-prog"></div></form>`
    : `<div class="sec-title">1. 금일 실적</div><table class="rows ro"><thead><tr><th>No</th><th>업무</th><th>한 일</th><th>시간</th><th>진행률</th></tr></thead><tbody>
      ${dl && r.done.length ? r.done.map((l, i) => `<tr><td class="no">${i + 1}</td><td>${lineItem(l)}</td><td class="pre">${esc(l.content)}</td><td class="c">${l.hours ? hrs(l.hours) : ""}</td>
        <td class="c">${l.progress !== null && l.progress !== undefined ? l.progress + "%" : ""}</td></tr>`).join("") : '<tr><td colspan="5" class="muted">작성된 실적이 없습니다.</td></tr>'}</tbody></table>
      <div class="sec-title">2. 명일 계획</div><table class="rows ro"><tbody>${r.plan.map((l, i) => `<tr><td class="no">${i + 1}</td><td>${lineItem(l)}</td><td class="pre">${esc(l.content)}</td></tr>`).join("")
        || '<tr><td class="muted">없음</td></tr>'}</tbody></table>
      ${dl ? `<div class="sec-title">3. 특이사항 · 지원 요청</div><div class="pre">${esc(dl.issues || "-")}</div><div class="pre">${esc(dl.support_request || "")}</div>` : ""}
      ${r.photos.length ? thumbs(r.photos) : ""}
      <p class="noprint"><a class="btn light" href="#/daily/report?date=${dd}">이 날 전체 일지</a> <button class="btn light" onclick="window.print()">인쇄</button></p>`}
  </div>`;
  document.getElementById("d-prev").onclick = () => go(who.id, addDays(dd, -1));
  document.getElementById("d-next").onclick = () => go(who.id, addDays(dd, 1));
  document.getElementById("d-date").onchange = (e) => go(who.id, e.target.value || dd);
  document.getElementById("sel-who").onchange = (e) => go(e.target.value, dd);
  bindSign("daily", dl ? dl.id : null);
  bindBig();
  const fm = document.getElementById("f-daily");
  if (!fm) return;
  const renum = (tb) => tb.querySelectorAll("tr").forEach((tr, i) => { tr.querySelector("td.no").textContent = i + 1; });
  document.getElementById("add-done").onclick = () => { const tb = document.getElementById("done"); tb.insertAdjacentHTML("beforeend", doneRow(null, 0)); renum(tb); bindFiles(); };
  document.getElementById("add-plan").onclick = () => { const tb = document.getElementById("plan"); tb.insertAdjacentHTML("beforeend", planRow(null, 0)); renum(tb); };
  const bindFiles = () => fm.querySelectorAll('input[name="r_photo"]').forEach((x) => { x.onchange = () => x.parentNode.setAttribute("data-n", x.files.length); });
  bindFiles();
  fm.onsubmit = async (e) => {
    e.preventDefault();
    const done = [...document.querySelectorAll("#done tr")].map((tr) => ({
      item_id: tr.querySelector('[name="r_item"]').value || null, content: tr.querySelector('[name="r_content"]').value,
      hours: tr.querySelector('[name="r_hours"]').value, progress: tr.querySelector('[name="r_progress"]').value,
      files: tr.querySelector('[name="r_photo"]').files }));
    const bad = done.findIndex((x) => x.files.length && !x.item_id);
    if (bad >= 0) { toast(`${bad + 1}번째 줄: 사진은 업무를 고른 줄에만 붙일 수 있습니다.`, "error"); return; }
    const plan = [...document.querySelectorAll("#plan tr")].map((tr) => ({ item_id: tr.querySelector('[name="p_item"]').value || null,
                                                                          content: tr.querySelector('[name="p_content"]').value }));
    const btn = fm.querySelector("button.btn");
    btn.disabled = true;
    try {
      const r2 = await api("daily_save", { user_id: who.id, work_date: dd, issues: fm.issues.value, support_request: fm.support_request.value,
                                           done: done.map(({ files, ...x }) => x), plan });
      let n = 0;
      const errs = [];
      for (const x of done.filter((y) => y.files.length && y.item_id)) {
        const up = await uploadPhotos(Number(x.item_id), x.files, { daily_id: r2.daily_id, kind: "작업중", caption: (x.content || "").slice(0, 200), taken_date: dd },
                                      document.getElementById("d-prog"));
        n += up.n; errs.push(...up.errs);
      }
      toast(r2.msg + (n ? ` · 사진 ${n}장` : ""));
      if (errs.length) setTimeout(() => toast(errs.join(" / "), "error"), 1500);
      await route();
    } catch (err) { if (err.message) toast(err.message, "error"); btn.disabled = false; }
  };
}

async function viewDailyReport(q) {
  const r = await api("daily_report", { date: q.get("date") || null });
  const dd = r.date;
  $main.innerHTML = `<div class="actions noprint" style="margin-bottom:10px">
      <a class="btn sm light" href="#/daily/report?date=${addDays(dd, -1)}">◀</a><b style="font-size:16px">${dd} (${wd(dd)}) 업무일지 전체</b>
      <a class="btn sm light" href="#/daily/report?date=${addDays(dd, 1)}">▶</a><button class="btn sm light" onclick="window.print()">인쇄 / PDF</button>
      <a class="btn sm light" href="#/daily/month?m=${dd.slice(0, 7)}">월간 현황</a></div>
    ${r.docs.map((x) => `<div class="card doc" data-doc-type="daily" data-doc-id="${x.daily ? x.daily.id : ""}"><div class="doc-head"><div>
        <div class="doc-title">일 일 업 무 일 지</div>
        <div class="doc-meta"><b>${dd} (${wd(dd)})</b> · 성명 <b>${esc(x.who.name)}</b> ${esc(x.who.position || "")} · 실적 ${hrs(x.hours)}시간
          ${x.daily ? (x.daily.written_by !== x.who.id ? ` <span class="muted small">(대리 작성 ${esc(x.daily.writer || "")})</span>` : "") : ' <span class="badge al-overdue">미작성</span>'}
          <a class="noprint small" href="#/daily?user=${x.who.id}&date=${dd}">열기 →</a></div></div>
        ${signbox(r.flow, x.signs, "daily", x.daily ? x.daily.id : null)}</div>
      <div class="sec-title">1. 금일 실적</div><table class="rows ro"><tbody>${x.done.map((l, i) => `<tr><td class="no">${i + 1}</td><td>${lineItem(l)}</td><td class="pre">${esc(l.content)}</td>
        <td class="c">${l.hours ? hrs(l.hours) + "h" : ""}</td><td class="c">${l.progress !== null && l.progress !== undefined ? l.progress + "%" : ""}</td></tr>`).join("") || '<tr><td class="muted">없음</td></tr>'}</tbody></table>
      <div class="sec-title">2. 명일 계획</div><table class="rows ro"><tbody>${x.plan.map((l, i) => `<tr><td class="no">${i + 1}</td><td>${lineItem(l)}</td><td class="pre">${esc(l.content)}</td></tr>`).join("")
        || '<tr><td class="muted">없음</td></tr>'}</tbody></table>
      ${x.daily && (x.daily.issues || x.daily.support_request) ? `<div class="sec-title">3. 특이사항 · 지원 요청</div><div class="pre">${esc(x.daily.issues || "")}</div><div class="pre">${esc(x.daily.support_request || "")}</div>` : ""}
    </div>`).join("") || '<div class="card muted">일지 대상자가 없습니다 (관리 > 사용자에서 결재 순서).</div>'}`;
  bindSign("daily", null);
}

async function viewDailyMonth(q) {
  const r = await api("daily_month", { m: q.get("m") || "" });
  const days = [];
  for (let x = r.first; x <= r.last; x = addDays(x, 1)) days.push(x);
  const m = r.first.slice(0, 7), prev = addDays(r.first, -1).slice(0, 7), next = addDays(r.last, 1).slice(0, 7);
  $main.innerHTML = `<h1>업무일지 월간 현황 <span class="sub">실적 건수 · 시간 · 결재 확인 수</span></h1>
    <div class="actions" style="margin-bottom:10px"><a class="btn sm light" href="#/daily/month?m=${prev}">◀</a><b style="font-size:16px">${m.replace("-", "년 ")}월</b>
      <a class="btn sm light" href="#/daily/month?m=${next}">▶</a></div>
    <div class="card" style="padding:0"><div class="tablewrap"><table class="t"><thead><tr><th>일자</th>${r.workers.map((w) => `<th>${esc(w.name)}</th>`).join("")}<th>전체</th></tr></thead><tbody>
    ${days.map((dy) => { const we = [0, 6].includes(new Date(dy + "T00:00:00").getDay());
      return `<tr style="${we ? "background:#f6f6f6" : ""}"><td class="c ${we ? "muted" : ""}">${md(dy)} (${wd(dy)})</td>
        ${r.workers.map((w) => { const c = r.cells[`${w.id}|${dy}`];
          return `<td class="c">${c ? `<a href="#/daily?user=${w.id}&date=${dy}">${c.n_done}건 · ${hrs(c.hours)}h</a> <span class="small ${c.n_sign < r.n_flow ? "muted" : ""}" title="결재 확인">✔${c.n_sign}/${r.n_flow}</span>`
            : !we && dy <= B.today ? `<a href="#/daily?user=${w.id}&date=${dy}" class="badge al-overdue">미작성</a>` : '<span class="muted">-</span>'}</td>`; }).join("")}
        <td class="c"><a href="#/daily/report?date=${dy}">보기</a></td></tr>`; }).join("")}</tbody></table></div></div>`;
}

// ── 주간계획 ────────────────────────────────────────────────────────
async function viewWeekly(q) {
  const r = await api("weekly_get", { user_id: q.get("user") || null, week: q.get("week") || null });
  const who = r.who, ws = r.week_start, w = r.weekly, ed = r.editable;
  const go = (u, x) => { location.hash = `#/weekly?user=${u}&week=${x}`; };
  const row = (l) => `<tr class="${l && l.carry ? "carry" : ""}"><td class="w-item" data-l="업무">${itemSelect("w_item", r.choices, who, l ? l.item_id : null)}</td>
    <td data-l="이번 주 목표"><textarea name="w_goal" placeholder="이번 주 목표">${esc(l ? l.goal : "")}</textarea></td>
    <td class="w-days days" data-l="계획 요일">${WDAYS.split("").map((c) => `<label><input type="checkbox" value="${c}" ${l && (l.days || "").includes(c) ? "checked" : ""}>${c}</label>`).join("")}</td>
    <td data-l="실적 (금요일)"><textarea name="w_result" placeholder="실적">${esc(l ? l.result || "" : "")}</textarea></td>
    <td class="w-out" data-l="평가"><select name="w_outcome">${opts(OUTCOMES.map((o) => ({ v: o, t: o })), l ? l.outcome : "", "-")}</select></td></tr>`;
  const lines = r.lines.length ? r.lines : [null, null, null];
  $main.innerHTML = `
  <div class="card doc"><div class="doc-head"><div>
    <div class="doc-title">주 간 업 무 계 획</div>
    <div class="doc-meta"><div class="noprint" style="display:inline-flex;gap:6px;align-items:center;flex-wrap:wrap">
      <button class="btn sm light" id="w-prev">◀ 지난주</button><input type="date" id="w-date" value="${ws}" style="width:150px"><button class="btn sm light" id="w-next">다음 주 ▶</button>
      ${whoSelect(r.workers, who)}</div>
      <div style="margin-top:6px"><b>${ws} (월) ~ ${r.week_end} (금)</b> · 성명 <b>${esc(who.name)}</b> ${esc(who.position || "")}
        ${w ? `· <span class="muted small">저장 ${dt(w.updated_at)}${w.written_by !== who.id ? ` (대리 작성 ${esc(w.writer || "")})` : ""}</span>` : '· <span class="badge al-overdue">미작성</span>'}
        ${r.drafted ? '<br><span class="badge al-soon">초안: 지난주 부분·미달 이월 (노란 줄) + 담당 진행 업무 — 고쳐서 저장하세요</span>' : ""}</div></div></div>
    ${signbox(r.flow, r.signs, "weekly", w ? w.id : null)}</div>
  <form id="f-weekly">
    <table class="rows fixed"><thead><tr><th style="width:24%">업무</th><th>이번 주 목표</th><th style="width:230px">계획 요일</th><th>실적 (금요일)</th><th style="width:90px">평가</th></tr></thead>
      <tbody id="wl">${lines.map(row).join("")}</tbody></table>
    ${ed ? '<button type="button" class="btn sm light rowbtn noprint" id="add-w">+ 줄 추가</button>' : ""}
    <div class="form-grid" style="margin-top:12px">
      <div class="w2"><label>주간 이슈 · 지원 요청</label><textarea name="issues" ${ed ? "" : "disabled"}>${esc(w ? w.issues || "" : "")}</textarea></div>
      <div class="w2"><label>결정권자 코멘트</label><textarea name="director_comment" ${r.director ? "" : "disabled"} placeholder="${r.director ? "결정권자 의견" : ""}">${esc(w ? w.director_comment || "" : "")}</textarea></div></div>
    ${ed || r.director ? `<p class="actions noprint" style="margin-top:14px"><button class="btn">${ed ? "저장" : "코멘트 저장"}</button>
      <button type="button" class="btn light" onclick="window.print()">인쇄</button><a class="btn light" href="#/meeting?week=${ws}">주간미팅</a></p>` : ""}
  </form>
  ${r.work.length ? `<div class="sec-title">이번 주 업무일지 실적 (참고)</div><table class="rows ro"><tbody>${r.work.map((x) => `<tr><td class="c">${md(x.work_date)} (${wd(x.work_date)})</td>
    <td>${x.item_no ? `<b>${esc(x.item_no)}</b>` : "기타"}</td><td class="pre">${esc(x.content)}</td><td class="c">${x.hours ? hrs(x.hours) + "h" : ""}</td></tr>`).join("")}</tbody></table>` : ""}
  </div>`;
  if (!ed) document.querySelectorAll("#wl select, #wl textarea, #wl input").forEach((x) => { x.disabled = true; });
  document.getElementById("w-prev").onclick = () => go(who.id, addDays(ws, -7));
  document.getElementById("w-next").onclick = () => go(who.id, addDays(ws, 7));
  document.getElementById("w-date").onchange = (e) => go(who.id, monday(e.target.value || ws));
  document.getElementById("sel-who").onchange = (e) => go(e.target.value, ws);
  bindSign("weekly", w ? w.id : null);
  const add = document.getElementById("add-w");
  if (add) add.onclick = () => document.getElementById("wl").insertAdjacentHTML("beforeend", row(null));
  document.getElementById("f-weekly").onsubmit = async (e) => {
    e.preventDefault();
    const fm = e.target;
    const ls = [...document.querySelectorAll("#wl tr")].map((tr) => ({
      item_id: tr.querySelector('[name="w_item"]').value || null, goal: tr.querySelector('[name="w_goal"]').value,
      days: [...tr.querySelectorAll(".days input:checked")].map((x) => x.value).join(""),
      result: tr.querySelector('[name="w_result"]').value, outcome: tr.querySelector('[name="w_outcome"]').value }));
    await act("weekly_save", { user_id: who.id, week_start: ws, issues: fm.issues.value, director_comment: fm.director_comment.value, lines: ed ? ls : [] });
  };
}

// ── 주간미팅 ────────────────────────────────────────────────────────
async function viewMeeting(q) {
  const r = await api("meeting", { week: q.get("week") || null });
  const ws = r.week_start, items = r.items;
  const und = items.filter((t) => t.priority === null), appr = items.filter((t) => t.status === "검토요청");
  const dueWeek = items.filter((t) => t.due_date && t.due_date >= ws && t.due_date <= addDays(ws, 6));
  const time = r.meeting.includes(" ") ? r.meeting.split(" ").slice(-1)[0] : "";
  $main.innerHTML = `
  <div class="actions noprint" style="margin-bottom:10px"><a class="btn sm light" href="#/meeting?week=${addDays(ws, -7)}">◀ 지난주</a>
    <b style="font-size:16px">주간 미팅 자료 — ${ws} (월) ${esc(time)}</b><a class="btn sm light" href="#/meeting?week=${addDays(ws, 7)}">다음 주 ▶</a>
    <button class="btn sm light" onclick="window.print()">인쇄 / PDF</button><button class="btn sm" id="b-mxls">엑셀</button></div>
  <div class="card"><h2>1. 결정할 것</h2><div class="grid2">
    <div><b>우선순위 미확정 ${und.length}건</b> <a class="small noprint" href="#/priority">결정하러 가기 →</a>
      <ul class="small">${und.map((t) => `<li>${prio(t)} <a href="#/item/${t.id}">${esc(t.item_no)}</a> ${esc(t.title)} — ${esc(t.owner_name || "")}</li>`).join("") || '<li class="muted">없음</li>'}</ul></div>
    <div><b>완료 승인 대기 ${appr.length}건</b>
      <ul class="small">${appr.map((t) => `<li><a href="#/item/${t.id}">${esc(t.item_no)} ${esc(t.title)}</a> — ${esc(t.owner_name || "")}</li>`).join("") || '<li class="muted">없음</li>'}</ul></div></div></div>
  <div class="card"><h2>2. 사람별 지난주 실적 · 이번 주 계획</h2>
    ${r.people.map((p) => { const rate = OUTCOMES.map((o) => `${o} ${p.last.filter((l) => l.outcome === o).length}`).join(" / ");
      return `<div class="sec-title">${esc(p.who.name)} <span class="sub">${esc(p.who.position || "")} · 지난주 일지 ${hrs(p.last_hours)}시간 · 평가 ${rate}
          · <a class="noprint" href="#/weekly?user=${p.who.id}&week=${ws}">이번 주 계획 ${p.cur_doc ? "보기" : "작성"} →</a></span></div>
        <div class="grid2"><table class="rows ro"><thead><tr><th>지난주 목표</th><th>실적</th><th>평가</th></tr></thead><tbody>
          ${p.last.map((l) => `<tr><td>${l.item_no ? `<b>${esc(l.item_no)}</b> ` : ""}${esc(l.goal)}</td><td class="pre">${esc(l.result || "")}</td><td class="c">${outBadge(l.outcome)}</td></tr>`).join("")
            || '<tr><td colspan="3" class="muted">지난주 계획 없음</td></tr>'}</tbody></table>
          <table class="rows ro"><thead><tr><th>이번 주 목표</th><th>요일</th></tr></thead><tbody>
          ${p.cur.map((l) => `<tr><td>${l.item_no ? `<b>${esc(l.item_no)}</b> ` : ""}${esc(l.goal)}</td><td class="c">${esc(l.days || "")}</td></tr>`).join("")
            || '<tr><td colspan="2" class="muted">이번 주 계획 미작성</td></tr>'}</tbody></table></div>
        ${p.last_comment ? `<div class="small" style="margin-top:4px"><b>지난주 결정권자 코멘트:</b> ${esc(p.last_comment)}</div>` : ""}`; }).join("") || '<p class="muted">대상자 없음</p>'}</div>
  <div class="card"><h2>3. 진행 중 업무 (우선순위 순) <span class="sub">${items.length}건 · 이번 주 마감 ${dueWeek.length}건 · 지난주 완료 ${r.done_last.length}건</span></h2>
    <div class="tablewrap"><table class="t"><thead><tr><th>우선</th><th>업무</th><th>요청</th><th>담당</th><th>상태</th><th>진행률</th><th>알림</th><th>다음 조치</th><th>기한</th></tr></thead>
      <tbody>${items.map((t) => `<tr><td class="c">${prio(t)}</td><td class="title">${tlink(t)} ${esc(t.title)}</td><td class="c">${esc(t.requester_name || "")}</td>
        <td class="c">${esc(t.owner_name || "")}</td><td class="c">${stBadge(t.status)}</td><td>${bar(t.progress)}</td><td class="c">${alBadge(t)}</td>
        <td class="clip small">${esc(t.next_action || "")}</td><td class="c">${d(t.due_date)}</td></tr>`).join("") || '<tr><td colspan="9" class="muted c">진행 중 업무 없음</td></tr>'}</tbody></table></div>
    ${r.done_last.length ? `<p class="small"><b>지난주 완료:</b> ${r.done_last.map((t) => `${esc(t.item_no)} ${esc(t.title)} (${esc(t.owner_name || "")})`).join(", ")}</p>` : ""}</div>`;
  document.getElementById("b-mxls").onclick = () => {
    const wk = [];
    r.people.forEach((p) => {
      p.last.forEach((l) => wk.push([p.who.name, "지난주", l.item_no || "", l.goal, l.days || "", l.result || "", l.outcome || ""]));
      p.cur.forEach((l) => wk.push([p.who.name, "이번 주", l.item_no || "", l.goal, l.days || "", "", ""]));
    });
    saveXlsx(`주간미팅_${ws.replace(/-/g, "")}.xlsx`, [
      { name: "업무현황(우선순위순)", head: ITEM_HEAD, rows: itemRows(items), widths: ITEM_W },
      { name: "주간계획·실적", head: ["담당", "주차", "업무번호", "목표", "요일", "실적", "평가"], rows: wk, widths: [9, 8, 9, 44, 10, 40, 7] },
      { name: "지난주 업무일지", head: ["일자", "담당", "구분", "업무번호", "내용", "시간(h)", "진행률"],
        rows: r.daily_last.map((l) => [d(l.work_date), l.name, l.section === "실적" ? "금일 실적" : "명일 계획", l.item_no || "", l.content,
                                       l.hours !== null ? Number(l.hours) : "", l.progress ?? ""]), widths: [11, 8, 9, 9, 60, 8, 7] }]);
  };
}

// ── 엑셀 (SheetJS — 누를 때만 받아 옴) ───────────────────────────────
const ITEM_HEAD = ["업무번호", "업무명", "구분", "현장·설비", "요청자", "담당", "협업", "우선순위", "상태", "진행률(%)",
                   "완료 기한", "알림", "다음 조치", "다음 F/U일", "누적 투입(h)", "과제 번호", "사진", "단계"];
const ITEM_W = [9, 36, 13, 12, 8, 8, 8, 11, 8, 8, 11, 12, 30, 11, 9, 9, 6, 7];
function itemRows(items) {
  return items.map((t) => [t.item_no, t.title, t.category || "", t.location || "", t.requester_name || "", t.owner_name || "", t.support_name || "",
    t.prio_value ? `P${t.prio_value}${t.priority === null ? " (제안)" : ""}` : "", t.status, t.progress, d(t.due_date), t.alert_label || "",
    t.next_action || "", d(t.next_action_due), Number(t.total_hours || 0), t.project_ref || "", t.photo_cnt, t.step_total ? `${t.step_done}/${t.step_total}` : ""]);
}
function loadXlsx() {
  if (window.XLSX) return Promise.resolve(window.XLSX);
  return new Promise((ok, no) => {
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js";
    s.onload = () => ok(window.XLSX);
    s.onerror = () => no(new Error("엑셀 도구를 받지 못했습니다 — 인터넷 연결을 확인하세요."));
    document.head.appendChild(s);
  });
}
async function saveXlsx(name, sheets) {
  try {
    const X = await loadXlsx();
    const wb = X.utils.book_new();
    sheets.forEach((sh) => {
      const ws = X.utils.aoa_to_sheet([sh.head, ...sh.rows]);
      ws["!cols"] = sh.widths.map((w) => ({ wch: w }));
      ws["!autofilter"] = { ref: ws["!ref"] };
      X.utils.book_append_sheet(wb, ws, sh.name.slice(0, 31));
    });
    X.writeFile(wb, name);
  } catch (e) { toast(e.message, "error"); }
}

start();
