/* Cookies and Cream — Alpha Theta pledge tracker.
   Data lives encrypted in data.enc; the passphrase never leaves the browser. */

const PLEDGES = ["Dev","Max","Advait","Arjun","Shri","Pragyan","Namith","Anthony","Sarkis","Tanish","Casey","Paul","Garrett"];
const DAYNAME = ["","Mon","Tue","Wed","Thu","Fri","Sat","Sun"];
const LS_ME = "cc.me", LS_PASS = "cc.pass", LS_TAB = "cc.tab", LS_DAY = "cc.day";

let DATA = null, ME = null, TAB = "now", FILTER = "mine", QUERY = "", CALDAY = null;
const $ = (s, r = document) => r.querySelector(s);
const el = (t, c, txt) => { const n = document.createElement(t); if (c) n.className = c; if (txt != null) n.textContent = txt; return n; };
const esc = s => String(s == null ? "" : s);

/* ---------- crypto ---------- */
const b64d = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));

async function decrypt(bundle, passphrase) {
  const enc = new TextEncoder();
  const base = await crypto.subtle.importKey("raw", enc.encode(passphrase), "PBKDF2", false, ["deriveKey"]);
  const key = await crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: b64d(bundle.salt), iterations: bundle.iter, hash: "SHA-256" },
    base, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64d(bundle.iv) }, key, b64d(bundle.ct));
  return JSON.parse(new TextDecoder().decode(plain));
}

/* ---------- time ---------- */
const now = () => new Date();

function parseDue(s) { if (!s) return null; const d = new Date(s); return isNaN(d) ? null : d; }

function relTime(d, ref) {
  if (!d) return "no deadline";
  let ms = d - (ref || now()), past = ms < 0;
  ms = Math.abs(ms);
  const m = Math.round(ms / 6e4), h = Math.floor(m / 60), dy = Math.floor(h / 24);
  let s;
  if (m < 1) s = "now";
  else if (m < 60) s = m + "m";
  else if (h < 24) s = h + "h " + (m % 60) + "m";
  else if (dy < 7) s = dy + "d " + (h % 24) + "h";
  else s = dy + "d";
  if (s === "now") return "due now";
  return past ? s + " late" : "in " + s;
}

function absTime(d) {
  if (!d) return "";
  const t = now(), sameDay = d.toDateString() === t.toDateString();
  const tm = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (sameDay) return "today " + tm;
  const tm2 = new Date(t.getTime() + 864e5);
  if (d.toDateString() === tm2.toDateString()) return "tomorrow " + tm;
  return d.toLocaleDateString([], { weekday: "short", month: "numeric", day: "numeric" }) + " " + tm;
}

const urgency = d => { if (!d) return "none"; const ms = d - now(); return ms < 0 ? "overdue" : ms < 6 * 36e5 ? "soon" : ""; };

function hm(str) { const [h, m] = str.split(":").map(Number); return h * 60 + m; }
function fmtHM(str) { const [h, m] = str.split(":").map(Number); const ap = h < 12 ? "am" : "pm"; const hh = h % 12 || 12; return m ? `${hh}:${String(m).padStart(2,"0")}${ap}` : `${hh}${ap}`; }

/* ---------- task helpers ---------- */
function assignedTo(t) {
  const a = t.assigned_to || [];
  if (a.includes("ALL")) return PLEDGES.slice();
  return a.filter(x => PLEDGES.includes(x));
}
function isGroup(t) { const a = t.assigned_to || []; return a.includes("ALL") || a.includes("ANY_ONE") || a.includes("ANY_TWO") || a.includes("UNBANNED"); }
function ownedBy(t, who) {
  const a = t.assigned_to || [];
  if (!who) return false;
  if (a.includes(who)) return true;
  if (a.includes("ALL")) return true;
  if (a.includes("UNBANNED")) return !isBanned(who);
  return false;
}
const isDone = t => t.status === "accepted" || t.status === "cancelled";
const isLive = t => !isDone(t);

function banFor(name) {
  const ps = (DATA.pledge_status || []).find(p => p.name === name);
  if (!ps || !ps.bans) return null;
  const t = now();
  return ps.bans.find(b => { const u = parseDue(b.until), f = parseDue(b.from); return u && u > t && (!f || f <= t); }) || null;
}
const isBanned = name => !!banFor(name);

function sortTasks(list) {
  const rank = t => isDone(t) ? 2 : 0;
  return list.slice().sort((a, b) => {
    const r = rank(a) - rank(b); if (r) return r;
    const da = parseDue(a.due), db = parseDue(b.due);
    if (da && db) return da - db;
    if (da) return -1; if (db) return 1;
    return (a.priority === "critical" ? -1 : 0) - (b.priority === "critical" ? -1 : 0);
  });
}

function matchQuery(t) {
  if (!QUERY) return true;
  const q = QUERY.toLowerCase();
  return [t.what, t.assigned_by, t.thread_subject, t.notes, (t.assigned_to || []).join(" ")]
    .some(v => v && String(v).toLowerCase().includes(q));
}

/* ---------- rendering: task card ---------- */
function taskCard(t) {
  const due = parseDue(t.due), u = urgency(due);
  const card = el("div", "card " + (u && isLive(t) ? u : "") + (ownedBy(t, ME) ? " mine" : "") + (isDone(t) ? " done" : ""));

  const head = el("div", "t-head");
  head.appendChild(el("div", "t-what", t.what));
  const dueBox = el("div", "t-due " + (isLive(t) ? u : "") + (due ? "" : " none"));
  const rel = el("span", "rel", isDone(t) ? (t.status === "cancelled" ? "cancelled" : "done") : relTime(due));
  if (due) rel.dataset.due = t.due;
  dueBox.appendChild(rel);
  dueBox.appendChild(el("span", "abs", due ? absTime(due) : esc(t.due_text || "")));
  head.appendChild(dueBox);
  card.appendChild(head);

  const meta = el("div", "t-meta");
  meta.appendChild(el("span", "pill " + t.status, t.status));
  if (t.priority === "critical" && isLive(t)) meta.appendChild(el("span", "pill critical", "critical"));
  const who = t.assigned_to || [];
  const label = who.includes("ALL") ? "whole PC"
    : who.includes("ANY_ONE") ? "any one of you"
    : who.includes("ANY_TWO") ? "any two of you"
    : who.includes("UNBANNED") ? "anyone not banned"
    : who.join(", ");
  const chip = el("span", "chip" + (ownedBy(t, ME) ? " me" : ""), label);
  meta.appendChild(chip);
  meta.appendChild(el("span", "chip from", "from " + (t.assigned_by_address || t.assigned_by)));
  card.appendChild(meta);

  const more = el("div", "t-more");
  const add = (k, v, cls) => { if (!v) return; const d = el("div", cls); d.appendChild(el("b", null, k + " ")); d.appendChild(document.createTextNode(v)); more.appendChild(d); };
  add("Proof:", t.proof);
  add("Said:", t.due_text && due ? t.due_text : null);
  add("If late:", t.escalation, "esc");
  add("Status:", t.status_evidence);
  add("Notes:", t.notes);
  add("Thread:", t.thread_subject);
  card.appendChild(more);

  if (more.children.length) {
    const tog = el("button", "t-toggle", "details");
    tog.onclick = () => card.classList.toggle("open");
    card.appendChild(tog);
  }
  return card;
}

/* ---------- views ---------- */
function viewNow() {
  const v = el("div");
  const live = (DATA.tasks || []).filter(isLive);

  const mine = sortTasks(live.filter(t => ownedBy(t, ME) && matchQuery(t)));
  const overdue = mine.filter(t => { const d = parseDue(t.due); return d && d < now(); });
  const soon = mine.filter(t => { const d = parseDue(t.due); return d && d >= now() && d - now() < 24 * 36e5; });

  const head = el("div", "row");
  const seg = el("div", "seg");
  [["mine", "Mine"], ["all", "Everyone"]].forEach(([k, lbl]) => {
    const b = el("button", FILTER === k ? "on" : "", lbl);
    b.onclick = () => { FILTER = k; render(); };
    seg.appendChild(b);
  });
  head.appendChild(seg);
  const s = el("input", "search"); s.placeholder = "search tasks"; s.value = QUERY;
  s.oninput = e => { QUERY = e.target.value; const box = $("#taskList"); if (box) fillList(box); };
  head.appendChild(s);
  v.appendChild(head);

  if (ME) {
    const line = el("div", "tiny");
    line.textContent = `${overdue.length} late · ${soon.length} due in 24h · ${mine.length} open total`;
    v.appendChild(line);
  }

  const box = el("div"); box.id = "taskList";
  v.appendChild(box);
  fillList(box);
  v.appendChild(foot());
  return v;
}

function fillList(box) {
  box.textContent = "";
  const live = (DATA.tasks || []).filter(isLive);
  let list = FILTER === "mine" && ME ? live.filter(t => ownedBy(t, ME)) : live;
  list = sortTasks(list.filter(matchQuery));
  if (!list.length) { box.appendChild(el("div", "empty", FILTER === "mine" && ME ? "Nothing open for you. Check Everyone." : "Nothing matches.")); return; }

  const buckets = [
    ["Late", t => { const d = parseDue(t.due); return d && d < now(); }],
    ["Next 24 hours", t => { const d = parseDue(t.due); return d && d >= now() && d - now() < 24 * 36e5; }],
    ["Later", t => { const d = parseDue(t.due); return d && d - now() >= 24 * 36e5; }],
    ["No deadline given", t => !parseDue(t.due)],
  ];
  const used = new Set();
  buckets.forEach(([name, test]) => {
    const group = list.filter(t => !used.has(t) && test(t));
    group.forEach(t => used.add(t));
    if (!group.length) return;
    const h = el("h2", null, name); h.appendChild(el("small", null, String(group.length)));
    box.appendChild(h);
    group.forEach(t => box.appendChild(taskCard(t)));
  });

  const done = sortTasks((DATA.tasks || []).filter(isDone).filter(matchQuery)
    .filter(t => FILTER !== "mine" || !ME || ownedBy(t, ME)));
  if (done.length) {
    const h = el("h2", null, "Closed"); h.appendChild(el("small", null, String(done.length)));
    box.appendChild(h);
    done.slice(0, 40).forEach(t => box.appendChild(taskCard(t)));
  }
}

function viewBoard() {
  const v = el("div");
  const live = (DATA.tasks || []).filter(isLive);
  const grid = el("div", "grid");

  PLEDGES.forEach(name => {
    const ps = (DATA.pledge_status || []).find(p => p.name === name) || {};
    const ban = banFor(name);
    const mine = sortTasks(live.filter(t => ownedBy(t, name)));
    const late = mine.filter(t => { const d = parseDue(t.due); return d && d < now(); });

    const c = el("div", "p-card" + (name === ME ? " mine" : "") + (ban ? " banned" : ""));
    const h = el("div", "p-head");
    h.appendChild(el("div", "p-name", name));
    h.appendChild(el("div", "p-count", `${mine.length} open${late.length ? " · " + late.length + " late" : ""}`));
    c.appendChild(h);

    if (ban) {
      const b = el("div", "p-ban");
      b.appendChild(el("b", null, "Email banned"));
      b.appendChild(document.createTextNode(` until ${absTime(parseDue(ban.until))} (${ban.by}${ban.reason ? ", " + ban.reason : ""})`));
      c.appendChild(b);
    }
    (ps.running_punishments || []).forEach(p => {
      const d = el("div", "p-line"); d.appendChild(el("b", null, "Running: ")); d.appendChild(document.createTextNode(p)); c.appendChild(d);
    });
    if (ps.heat) { const d = el("div", "p-line"); d.appendChild(el("b", null, "Heat: ")); d.appendChild(document.createTextNode(ps.heat)); c.appendChild(d); }
    if (ps.praise) { const d = el("div", "p-line"); d.appendChild(el("b", null, "Praise: ")); d.appendChild(document.createTextNode(ps.praise)); c.appendChild(d); }

    if (mine.length) {
      const ul = el("ul", "p-list");
      mine.slice(0, 8).forEach(t => {
        const d = parseDue(t.due), u = urgency(d);
        const li = el("li", u);
        li.textContent = t.what.length > 90 ? t.what.slice(0, 88) + "…" : t.what;
        li.appendChild(el("span", "tiny", "  " + relTime(d)));
        ul.appendChild(li);
      });
      if (mine.length > 8) ul.appendChild(el("li", "tiny", `+${mine.length - 8} more`));
      c.appendChild(ul);
    }
    grid.appendChild(c);
  });
  v.appendChild(grid);
  v.appendChild(foot());
  return v;
}

function viewRules() {
  const v = el("div");
  const rules = DATA.rules || [];
  const s = el("input", "search"); s.placeholder = "search rules"; s.value = QUERY;
  s.oninput = e => { QUERY = e.target.value; render(); };
  const row = el("div", "row"); row.appendChild(s); v.appendChild(row);

  const q = QUERY.toLowerCase();
  const shown = rules.filter(r => !q || [r.rule, r.by, r.quote, r.penalty].some(x => x && String(x).toLowerCase().includes(q)));
  const order = ["forbidden", "addressing", "email format", "threads", "timing", "tasks", "conduct", "other"];
  const groups = {};
  shown.forEach(r => (groups[r.category || "other"] = groups[r.category || "other"] || []).push(r));

  if (!shown.length) v.appendChild(el("div", "empty", "No rules match."));
  order.concat(Object.keys(groups).filter(k => !order.includes(k))).forEach(cat => {
    const g = groups[cat]; if (!g || !g.length) return;
    const sec = el("div", "cat");
    sec.appendChild(el("h3", null, cat));
    g.forEach(r => {
      const d = el("div", "rule");
      d.appendChild(el("div", "rule-text", r.rule));
      const m = el("div", "rule-meta");
      m.appendChild(document.createTextNode(r.by || ""));
      if (r.quote) { m.appendChild(document.createTextNode(" — ")); const qq = el("q", null, r.quote); m.appendChild(qq); }
      d.appendChild(m);
      if (r.penalty) { const p = el("div", "rule-meta rule-pen"); p.textContent = "Penalty: " + r.penalty; d.appendChild(p); }
      sec.appendChild(d);
    });
    v.appendChild(sec);
  });
  v.appendChild(foot());
  return v;
}

function viewActives() {
  const v = el("div");
  const actives = DATA.actives || [];
  const s = el("input", "search"); s.placeholder = "search actives"; s.value = QUERY;
  s.oninput = e => { QUERY = e.target.value; render(); };
  const row = el("div", "row"); row.appendChild(s); v.appendChild(row);

  const lin = DATA.lineage || [];
  if (lin.length) {
    const h = el("h2", null, "Pledge classes, oldest first");
    v.appendChild(h);
    const box = el("div", "lineage");
    lin.forEach((c, i) => {
      box.appendChild(el("span", "chip", c));
      if (i < lin.length - 1) box.appendChild(el("span", "arrow", "›"));
    });
    v.appendChild(box);
    v.appendChild(el("div", "tiny", "Alpha Theta is you. Anyone in a class above you is an active."));
  }

  const q = QUERY.toLowerCase();
  const shown = actives.filter(a => !q || [a.name, a.address_as, a.cares_about, a.role, a.pledge_class].some(x => x && String(x).toLowerCase().includes(q)));
  const byClass = {};
  shown.forEach(a => (byClass[a.pledge_class || "Unknown"] = byClass[a.pledge_class || "Unknown"] || []).push(a));

  const classOrder = lin.length ? lin.slice().reverse() : Object.keys(byClass);
  classOrder.concat(Object.keys(byClass).filter(k => !classOrder.includes(k))).forEach(cls => {
    const g = byClass[cls]; if (!g || !g.length) return;
    const h = el("h2", null, cls); h.appendChild(el("small", null, String(g.length)));
    v.appendChild(h);
    g.sort((a, b) => (b.role ? 1 : 0) - (a.role ? 1 : 0) || a.name.localeCompare(b.name));
    g.forEach(a => {
      const r = el("div", "a-row");
      const n = el("div", "a-name"); n.textContent = a.name;
      if (a.role) { n.appendChild(document.createTextNode(" ")); n.appendChild(el("span", "a-role", a.role)); }
      r.appendChild(n);
      r.appendChild(el("div", "a-addr", a.address_as || ""));
      if (a.major) r.appendChild(el("div", "a-sub", a.major));
      if (a.cares_about) r.appendChild(el("div", "a-cares", a.cares_about));
      v.appendChild(r);
    });
  });
  if (!shown.length) v.appendChild(el("div", "empty", "No actives match."));
  v.appendChild(foot());
  return v;
}

function viewCal() {
  const v = el("div");
  const cal = DATA.calendar || { schedule: [], exams: [] };
  const t = now(), today = t.getDay() === 0 ? 7 : t.getDay(), mins = t.getHours() * 60 + t.getMinutes();
  if (CALDAY == null) CALDAY = today;

  /* right now */
  const box = el("div", "now-box");
  const hdr = el("div", "hdr");
  hdr.appendChild(el("b", null, "Right now"));
  hdr.appendChild(el("span", "clock", t.toLocaleString([], { weekday: "long", hour: "numeric", minute: "2-digit" })));
  box.appendChild(hdr);

  const busyNow = {}, awayNow = {};
  (cal.schedule || []).forEach(s => {
    if (s.day !== today) return;
    if (mins >= hm(s.start) && mins < hm(s.end)) s.who.forEach(w => { busyNow[w] = s.what; });
  });
  (DATA.away || []).forEach(a => {
    const f = parseDue(a.from), u = parseDue(a.until);
    if (f && u && t >= f && t < u) awayNow[a.who] = a.what;
  });
  const free = PLEDGES.filter(p => !busyNow[p] && !awayNow[p]);
  const mk = (cls, label, names) => {
    if (!names.length) return;
    const d = el("div", "who-line " + cls);
    d.appendChild(el("b", null, label + " "));
    d.appendChild(document.createTextNode(names.join(", ")));
    box.appendChild(d);
  };
  mk("free", `Free (${free.length}):`, free);
  mk("busy", `In class (${Object.keys(busyNow).length}):`, Object.entries(busyNow).map(([k, w]) => `${k} (${w})`));
  mk("away", `Away:`, Object.entries(awayNow).map(([k, w]) => `${k} (${w})`));
  v.appendChild(box);

  /* exams */
  const upcoming = (cal.exams || []).map(e => ({ ...e, d: parseDue(e.date + "T23:59") }))
    .filter(e => e.d && e.d >= new Date(t.getFullYear(), t.getMonth(), t.getDate()))
    .sort((a, b) => a.d - b.d);
  if (upcoming.length) {
    v.appendChild(el("h2", null, "Exams coming up"));
    upcoming.forEach(e => {
      const d = el("div", "exam");
      d.appendChild(el("b", null, e.who.join(", ")));
      d.appendChild(document.createTextNode(` — ${e.what}, ${new Date(e.date + "T12:00").toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" })}${e.time ? ", " + e.time : ""}`));
      v.appendChild(d);
    });
    v.appendChild(el("div", "warn", "Do not hand these guys a task during someone's midterm. Check here first."));
  }

  /* day picker */
  const days = el("div", "days");
  [1, 2, 3, 4, 5, 6, 7].forEach(dn => {
    const b = el("button", CALDAY === dn ? "on" : "", DAYNAME[dn] + (dn === today ? " ·" : ""));
    b.onclick = () => { CALDAY = dn; try { localStorage.setItem(LS_DAY, dn); } catch (e) {} render(); };
    days.appendChild(b);
  });
  v.appendChild(days);

  const slots = (cal.schedule || []).filter(s => s.day === CALDAY).sort((a, b) => hm(a.start) - hm(b.start));
  if (!slots.length) v.appendChild(el("div", "empty", "Nothing on the shared calendar that day."));
  slots.forEach(s => {
    const live = CALDAY === today && mins >= hm(s.start) && mins < hm(s.end);
    const d = el("div", "slot" + (live ? " now" : ""));
    d.appendChild(el("div", "time", fmtHM(s.start) + " – " + fmtHM(s.end)));
    const r = el("div");
    r.appendChild(el("div", "what", s.what));
    const names = el("div", "names");
    s.who.forEach(w => names.appendChild(el("span", "chip" + (w === ME ? " me" : ""), w)));
    r.appendChild(names);
    if (s.where) r.appendChild(el("div", "where", s.where));
    d.appendChild(r);
    v.appendChild(d);
  });
  v.appendChild(el("div", "tiny", "Source: the Cookies and Cream shared Google Calendar. Only people who put their schedule in show up here."));
  v.appendChild(foot());
  return v;
}

function viewThreads() {
  const v = el("div");
  const s = el("input", "search"); s.placeholder = "search threads"; s.value = QUERY;
  s.oninput = e => { QUERY = e.target.value; render(); };
  const row = el("div", "row"); row.appendChild(s); v.appendChild(row);

  const q = QUERY.toLowerCase();
  const list = (DATA.threads || [])
    .filter(th => !q || [th.subject, th.summary, th.started_by].some(x => x && String(x).toLowerCase().includes(q)))
    .slice().sort((a, b) => (parseDue(b.last_at) || 0) - (parseDue(a.last_at) || 0));

  if (!list.length) v.appendChild(el("div", "empty", "No threads match."));
  list.forEach(th => {
    const d = el("div", "th");
    const h = el("div", "th-head");
    h.appendChild(el("div", "th-sub", th.subject));
    h.appendChild(el("div", "th-when", absTime(parseDue(th.last_at))));
    d.appendChild(h);
    d.appendChild(el("div", "th-sum", th.summary || ""));
    const m = el("div", "th-meta");
    m.appendChild(el("span", "chip", `${th.message_count || 0} msgs`));
    (th.actives || []).slice(0, 4).forEach(a => m.appendChild(el("span", "chip", a)));
    d.appendChild(m);
    v.appendChild(d);
  });
  v.appendChild(foot());
  return v;
}

function foot() {
  const f = el("div", "foot");
  f.textContent = DATA.generated_at ? "Last synced " + new Date(DATA.generated_at).toLocaleString() : "";
  return f;
}

/* ---------- banner ---------- */
function updateBanner() {
  const b = $("#banner");
  if (!ME) { b.hidden = true; return; }
  const ban = banFor(ME);
  const live = (DATA.tasks || []).filter(t => isLive(t) && ownedBy(t, ME));
  const late = live.filter(t => { const d = parseDue(t.due); return d && d < now(); });
  const next = sortTasks(live.filter(t => parseDue(t.due) && parseDue(t.due) >= now()))[0];

  b.textContent = "";
  if (ban) {
    b.className = "banner";
    b.appendChild(document.createTextNode(`Do not email. You are banned until ${absTime(parseDue(ban.until))}.`));
    const s = el("span", "tiny", `${ban.by}${ban.reason ? " — " + ban.reason : ""}. Sending anyway is its own punishment.`);
    b.appendChild(s);
    b.hidden = false;
  } else if (late.length) {
    b.className = "banner";
    b.appendChild(document.createTextNode(`${late.length} task${late.length > 1 ? "s" : ""} past due.`));
    b.appendChild(el("span", "tiny", late.map(t => t.what).join(" · ").slice(0, 160)));
    b.hidden = false;
  } else if (next) {
    b.className = "banner ok";
    b.appendChild(document.createTextNode(`Nothing late. Next: ${relTime(parseDue(next.due))}.`));
    b.appendChild(el("span", "tiny", next.what));
    b.hidden = false;
  } else {
    b.hidden = true;
  }
}

/* ---------- shell ---------- */
function render() {
  const v = $("#view");
  v.textContent = "";
  const views = { now: viewNow, board: viewBoard, rules: viewRules, actives: viewActives, cal: viewCal, threads: viewThreads };
  v.appendChild((views[TAB] || viewNow)());
  [...$("#tabs").children].forEach(b => b.classList.toggle("on", b.dataset.tab === TAB));
  updateBanner();
  window.scrollTo(0, 0);
}

function tickClocks() {
  document.querySelectorAll(".rel[data-due]").forEach(n => {
    const d = parseDue(n.dataset.due);
    n.textContent = relTime(d);
    const box = n.closest(".t-due"), card = n.closest(".card");
    const u = urgency(d);
    if (box) { box.classList.remove("overdue", "soon"); if (u) box.classList.add(u); }
    if (card && !card.classList.contains("done")) { card.classList.remove("overdue", "soon"); if (u) card.classList.add(u); }
  });
  updateBanner();
}

function syncLabel() {
  const s = $("#sync");
  if (!DATA || !DATA.generated_at) { s.textContent = ""; return; }
  const age = (now() - new Date(DATA.generated_at)) / 6e4;
  s.textContent = age < 1 ? "just synced" : age < 60 ? Math.round(age) + "m ago" : Math.round(age / 60) + "h ago";
  s.className = "sync" + (age > 30 ? (age > 180 ? " dead" : " stale") : "");
}

function boot(data) {
  DATA = data;
  $("#gate").hidden = true;

  const sel = $("#me");
  sel.textContent = "";
  const o0 = el("option", null, "who are you?"); o0.value = ""; sel.appendChild(o0);
  PLEDGES.forEach(p => { const o = el("option", null, p); o.value = p; sel.appendChild(o); });
  try { ME = localStorage.getItem(LS_ME) || ""; } catch (e) { ME = ""; }
  sel.value = ME || "";
  sel.onchange = () => { ME = sel.value; try { localStorage.setItem(LS_ME, ME); } catch (e) {} render(); };

  [...$("#tabs").children].forEach(b => b.onclick = () => { TAB = b.dataset.tab; QUERY = ""; try { localStorage.setItem(LS_TAB, TAB); } catch (e) {} render(); });
  try { TAB = localStorage.getItem(LS_TAB) || "now"; CALDAY = +localStorage.getItem(LS_DAY) || null; } catch (e) {}

  render();
  syncLabel();
  setInterval(tickClocks, 30000);
  setInterval(syncLabel, 60000);
  setInterval(refresh, 5 * 60 * 1000);
}

let PASS = null;
async function refresh() {
  if (!PASS) return;
  try {
    const r = await fetch("data.enc?t=" + Date.now(), { cache: "no-store" });
    if (!r.ok) return;
    const b = await r.json();
    if (DATA && b.generated_at === DATA.generated_at) { syncLabel(); return; }
    DATA = await decrypt(b, PASS);
    render(); syncLabel();
  } catch (e) { /* offline is fine, keep showing what we have */ }
}

async function tryOpen(pass, fromStorage) {
  const err = $("#gateErr");
  err.textContent = "opening…";
  try {
    const r = await fetch("data.enc?t=" + Date.now(), { cache: "no-store" });
    if (!r.ok) throw new Error("data.enc is missing (" + r.status + ")");
    const bundle = await r.json();
    const data = await decrypt(bundle, pass);
    PASS = pass;
    try { localStorage.setItem(LS_PASS, pass); } catch (e) {}
    err.textContent = "";
    boot(data);
  } catch (e) {
    if (fromStorage) { try { localStorage.removeItem(LS_PASS); } catch (x) {} err.textContent = ""; return; }
    err.textContent = /missing/.test(e.message) ? e.message : "Wrong passphrase.";
    const c = $(".gate-card"); c.classList.remove("shake"); void c.offsetWidth; c.classList.add("shake");
  }
}

$("#gateForm").onsubmit = e => { e.preventDefault(); tryOpen($("#gatePass").value.trim(), false); };
(function () {
  let saved = null;
  try { saved = localStorage.getItem(LS_PASS); } catch (e) {}
  if (saved) tryOpen(saved, true);
})();
