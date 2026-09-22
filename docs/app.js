/* Cookies and Cream — Alpha Theta pledge tracker.
   Data lives encrypted in data.enc; the passphrase never leaves the browser. */

let PLEDGES = [];   // filled from the decrypted payload; never hardcoded, this file is public
const DAYNAME = ["","Mon","Tue","Wed","Thu","Fri","Sat","Sun"];
const LS_ME = "cc.me", LS_PASS = "cc.pass", LS_TAB = "cc.tab", LS_DAY = "cc.day", LS_TICK = "cc.ticked";

/* Tasks you have ticked off yourself. Stored on this device only: the page is
   static, so a tick is your own note, not something the others see. */
let TICKED = new Set();
function loadTicks() { try { TICKED = new Set(JSON.parse(localStorage.getItem(LS_TICK) || "[]")); } catch (e) { TICKED = new Set(); } }
function saveTicks() { try { localStorage.setItem(LS_TICK, JSON.stringify([...TICKED])); } catch (e) {} }
const taskKey = t => t.id || (t.what || "").slice(0, 60);
const isTicked = t => TICKED.has(taskKey(t));
function toggleTick(t) { const k = taskKey(t); TICKED.has(k) ? TICKED.delete(k) : TICKED.add(k); saveTicks(); }

let DATA = null, ME = null, TAB = "now", FILTER = "mine", QUERY = "", CALDAY = null, WHO = undefined;

function setData(d) { DATA = d; PLEDGES = (d && d.pledges) || []; }
function currentWho() { return WHO === undefined ? (ME || null) : WHO; }
const $ = (s, r = document) => r.querySelector(s);
const el = (t, c, txt) => { const n = document.createElement(t); if (c) n.className = c; if (txt != null) n.textContent = txt; return n; };

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

/* Every time in this data is Pacific. A pledge in New York must still see the
   Berkeley clock, so derive day-of-week and minutes in America/Los_Angeles. */
const PT = "America/Los_Angeles";
function ptNow() {
  let p;
  try {
    p = new Intl.DateTimeFormat("en-US", {
      timeZone: PT, weekday: "short", hour: "2-digit", minute: "2-digit",
      hour12: false, year: "numeric", month: "2-digit", day: "2-digit",
    }).formatToParts(now()).reduce((o, x) => (o[x.type] = x.value, o), {});
  } catch (e) {
    const d = now();
    return { day: d.getDay() === 0 ? 7 : d.getDay(), mins: d.getHours() * 60 + d.getMinutes(),
             ymd: d.toISOString().slice(0, 10), label: d.toLocaleString() };
  }
  const wd = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }[p.weekday] || 1;
  return {
    day: wd,
    mins: (Number(p.hour) % 24) * 60 + Number(p.minute),
    ymd: `${p.year}-${p.month}-${p.day}`,
    label: now().toLocaleString([], { timeZone: PT, weekday: "long", hour: "numeric", minute: "2-digit" }),
  };
}

function parseDue(s) {
  if (!s || typeof s !== "string") return null;
  // must at least be YYYY-MM-DD; a bare year or a stray number is an extraction
  // error, and treating it as a date invents an overdue task that does not exist
  if (!/^\d{4}-\d{2}-\d{2}/.test(s.trim())) return null;
  const d = new Date(s);
  return isNaN(d) ? null : d;
}

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

/* Everything is stated in Berkeley time, including "today" and "tomorrow", so a
   pledge in New York reads the same words the deadline was written in. */
function ptYMD(d) {
  try {
    const p = new Intl.DateTimeFormat("en-CA", { timeZone: PT, year: "numeric", month: "2-digit", day: "2-digit" })
      .formatToParts(d).reduce((o, x) => (o[x.type] = x.value, o), {});
    return `${p.year}-${p.month}-${p.day}`;
  } catch (e) { return d.toISOString().slice(0, 10); }
}
function absTime(d) {
  if (!d) return "";
  const tm = d.toLocaleTimeString([], { timeZone: PT, hour: "numeric", minute: "2-digit" });
  const here = ptYMD(d), today = ptYMD(now());
  if (here === today) return "today " + tm;
  const tmw = ptYMD(new Date(now().getTime() + 864e5));
  if (here === tmw) return "tomorrow " + tm;
  return d.toLocaleDateString([], { timeZone: PT, weekday: "short", month: "numeric", day: "numeric" }) + " " + tm;
}

const urgency = d => { if (!d) return "none"; const ms = d - now(); return ms < 0 ? "overdue" : ms < 6 * 36e5 ? "soon" : ""; };

function hm(str) { const [h, m] = str.split(":").map(Number); return h * 60 + m; }
function fmtHM(str) { const [h, m] = str.split(":").map(Number); const ap = h < 12 ? "am" : "pm"; const hh = h % 12 || 12; return m ? `${hh}:${String(m).padStart(2,"0")}${ap}` : `${hh}${ap}`; }

/* A deadline that lands while you are in a lecture, on a plane, or at the
   Thursday meeting is a deadline you will miss. Say so on the card. */
function clashFor(t, who) {
  const d = parseDue(t.due);
  if (!d || !who) return null;
  for (const a of (DATA.away || [])) {
    if (a.who !== who) continue;
    const f = parseDue(a.from), u = parseDue(a.until);
    if (f && u && d >= f && d < u) return a.what || "away";
  }
  const cal = (DATA.calendar || {}).schedule || [];
  let p;
  try {
    p = new Intl.DateTimeFormat("en-US", { timeZone: PT, weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false })
      .formatToParts(d).reduce((o, x) => (o[x.type] = x.value, o), {});
  } catch (e) { return null; }
  const day = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }[p.weekday];
  const mins = (Number(p.hour) % 24) * 60 + Number(p.minute);
  const hit = cal.find(x => x.day === day && x.who.includes(who) && mins >= hm(x.start) && mins < hm(x.end));
  return hit ? hit.what : null;
}

/* ---------- task helpers ---------- */
function assignedTo(t) {
  const a = t.assigned_to || [];
  if (a.includes("ALL")) return PLEDGES.slice();
  if (a.includes("UNBANNED")) return PLEDGES.filter(p => !isBanned(p));
  if (a.includes("ANY_ONE") || a.includes("ANY_TWO")) return PLEDGES.slice();
  return a.filter(x => PLEDGES.includes(x));
}
function isGroup(t) { const a = t.assigned_to || []; return a.includes("ALL") || a.includes("ANY_ONE") || a.includes("ANY_TWO") || a.includes("UNBANNED"); }
function ownedBy(t, who) {
  const a = t.assigned_to || [];
  if (!who) return false;
  if (a.includes(who)) return true;
  if (a.includes("ALL")) return true;
  // "any one of you" is everybody's problem until somebody does it
  if (a.includes("ANY_ONE") || a.includes("ANY_TWO")) return true;
  if (a.includes("UNBANNED")) {
    if (!isBanned(who)) return true;
    // if every single person is banned the task still belongs to someone
    return PLEDGES.every(p => isBanned(p));
  }
  return false;
}
const isDone = t => t.status === "accepted" || t.status === "cancelled";
const isLive = t => !isDone(t);

/* Which of the three lists a task belongs in. Your own tick always wins, so you
   can close something out before an active gets round to acknowledging it. */
function bucket(t) {
  if (isTicked(t)) return "done";
  if (t.status === "accepted" || t.status === "cancelled" || t.status === "submitted") return "done";
  if (t.status === "unclear") return "unclear";
  return "todo";
}

/* Per person. A class-wide task you have already turned in is done for YOU even
   though it stays open for whoever has not sent theirs. */
function bucketFor(t, who) {
  if (who && Array.isArray(t.done_by) && t.done_by.includes(who)) return "done";
  return bucket(t);
}
function turnedIn(t, who) { return !!(who && Array.isArray(t.done_by) && t.done_by.includes(who)); }

function banFor(name) {
  const ps = (DATA.pledge_status || []).find(p => p.name === name);
  if (!ps || !ps.bans) return null;
  const t = now();
  // until === null means indefinite: still in force until an active lifts it
  return ps.bans.find(b => {
    const f = parseDue(b.from);
    if (f && f > t) return false;
    if (b.until === null || b.until === undefined) return true;
    const u = parseDue(b.until);
    return u ? u > t : true;
  }) || null;
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
  const b = bucketFor(t, currentWho());
  const card = el("div", "card " + (u && b === "todo" ? u : "") + (ownedBy(t, ME) ? " mine" : "") + (b !== "todo" ? " done" : ""));

  const head = el("div", "t-head");
  const left = el("div", "t-left");
  if (ME && ownedBy(t, ME)) {
    const tick = el("button", "tick" + (isTicked(t) ? " on" : ""));
    tick.type = "button";
    tick.setAttribute("aria-pressed", isTicked(t) ? "true" : "false");
    tick.title = isTicked(t) ? "Mark as not done" : "Mark done (your own note, this device only)";
    tick.onclick = (ev) => { ev.stopPropagation(); toggleTick(t); render(true); };
    left.appendChild(tick);
  } else {
    left.appendChild(el("span", "tick-gap"));
  }
  left.appendChild(el("div", "t-what", t.what || "(no description)"));
  head.appendChild(left);
  const dueBox = el("div", "t-due " + (isLive(t) ? u : "") + (due ? "" : " none"));
  const meWho = currentWho();
  const rel = el("span", "rel", isTicked(t) ? "ticked off"
    : turnedIn(t, meWho) ? "you turned it in"
    : isDone(t) ? (t.status === "cancelled" ? "cancelled" : "done") : relTime(due));
  if (due) rel.dataset.due = t.due;
  dueBox.appendChild(rel);
  dueBox.appendChild(el("span", "abs", due ? absTime(due) : String(t.due_text || "")));
  head.appendChild(dueBox);
  card.appendChild(head);

  const meta = el("div", "t-meta");
  meta.appendChild(el("span", "pill " + t.status, t.status));
  if (t.status === "accepted" && t.confirmed === false)
    meta.appendChild(el("span", "pill unconfirmed", "no active confirmed"));
  if (t.priority === "critical" && isLive(t)) meta.appendChild(el("span", "pill critical", "critical"));
  const who = t.assigned_to || [];
  const label = who.includes("ALL") ? "whole PC"
    : who.includes("ANY_ONE") ? "any one of you"
    : who.includes("ANY_TWO") ? "any two of you"
    : who.includes("UNBANNED") ? "anyone not banned"
    : who.join(", ");
  const chip = el("span", "chip" + (ownedBy(t, ME) ? " me" : ""), label);
  meta.appendChild(chip);
  if (isGroup(t) && Array.isArray(t.done_by) && t.done_by.length) {
    const need = who.includes("ANY_TWO") ? 2 : who.includes("ANY_ONE") ? 1 : assignedTo(t).length;
    meta.appendChild(el("span", "chip done-by", `${t.done_by.length} of ${need} in`));
    if (t.done_by.length < need) {
      const owed = assignedTo(t).filter(p => !t.done_by.includes(p));
      if (owed.length && owed.length <= 6) meta.appendChild(el("span", "chip owing", "still owed: " + owed.join(", ")));
    }
  }
  meta.appendChild(el("span", "chip from", "from " + (t.assigned_by_address || t.assigned_by)));
  if (t.proof && !/^none/i.test(t.proof)) meta.appendChild(el("span", "chip proof", t.proof));
  const at2 = parseDue(t.assigned_at);
  if (at2) meta.appendChild(el("span", "chip when", "set " + absTime(at2)));
  const clash = b === "todo" ? clashFor(t, meWho) : null;
  if (clash) meta.appendChild(el("span", "chip clash", "due while you are in " + clash));
  card.appendChild(meta);

  const more = el("div", "t-more");
  const add = (k, v, cls) => { if (!v) return; const d = el("div", cls); d.appendChild(el("b", null, k + " ")); d.appendChild(document.createTextNode(v)); more.appendChild(d); };
  const at = parseDue(t.assigned_at);
  add("Assigned:", at ? absTime(at) + " by " + (t.assigned_by || "") : (t.assigned_by ? "by " + t.assigned_by : null));
  add("Proof:", t.proof);
  add("Said:", t.due_text && due ? t.due_text : null);
  add("If late:", t.escalation, "esc");
  add("Status:", t.status_evidence);
  add("Notes:", t.notes);
  add("Thread:", t.thread_subject);
  if (t.thread_id) {
    const row = el("div");
    const a = el("a", "openmail", "Open this email in Gmail");
    a.href = "https://mail.google.com/mail/u/0/#all/" + t.thread_id;
    a.target = "_blank"; a.rel = "noopener";
    row.appendChild(a);
    more.appendChild(row);
  }
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

  // one tab per person, plus Everyone. WHO undefined means "follow the name picker".
  const who = currentWho();
  const todoAll = (DATA.tasks || []).filter(t => bucket(t) === "todo");   // class-wide view
  const strip = el("div", "people");
  const allBtn = el("button", who === null ? "on" : "", "Everyone");
  allBtn.onclick = () => { WHO = null; render(); };
  strip.appendChild(allBtn);
  PLEDGES.forEach(p => {
    const n = (DATA.tasks || []).filter(t => ownedBy(t, p) && bucketFor(t, p) === "todo");
    const lateN = n.filter(t => { const d = parseDue(t.due); return d && d < now(); }).length;
    const b = el("button", (who === p ? "on " : "") + (p === ME ? "self" : ""));
    b.appendChild(document.createTextNode(p));
    // always the total outstanding; red only signals that some of it is late
    if (n.length) {
      const badge = el("span", "n" + (lateN ? " bad" : ""), String(n.length));
      badge.title = lateN ? `${n.length} to do, ${lateN} of them late` : `${n.length} to do`;
      b.appendChild(badge);
    }
    b.onclick = () => { WHO = p; render(); };
    strip.appendChild(b);
  });
  v.appendChild(strip);

  // the one thing to do next, with a live countdown
  if (who) {
    const mineTodo = (DATA.tasks || []).filter(t => ownedBy(t, who) && bucketFor(t, who) === "todo");
    const dated = mineTodo.filter(t => parseDue(t.due)).sort((a, b) => parseDue(a.due) - parseDue(b.due));
    const nextUp = dated.find(t => parseDue(t.due) >= now());
    const oldest = dated.find(t => parseDue(t.due) < now());
    const pick = oldest || nextUp;
    if (pick) {
      const box = el("div", "upnext" + (oldest ? " bad" : ""));
      box.appendChild(el("div", "upnext-k", oldest ? "Most overdue" : "Up next"));
      box.appendChild(el("div", "upnext-w", pick.what || "(no description)"));
      const cd = el("div", "upnext-t rel", relTime(parseDue(pick.due)));
      cd.dataset.due = pick.due;
      box.appendChild(cd);
      const sub = el("div", "upnext-s");
      sub.textContent = (pick.assigned_by_address || pick.assigned_by || "") +
        (pick.proof && !/^none/i.test(pick.proof) ? " · needs " + pick.proof : "");
      box.appendChild(sub);
      box.onclick = () => { const q = (pick.what || "").slice(0, 28); if (q.trim()) { TAB = "now"; QUERY = q; render(); } };
      v.appendChild(box);
    }
  }

  // replies already written and sitting in Gmail waiting to be checked and sent
  const drafts = DATA.drafts || [];
  if (who === ME && drafts.length) {
    const box = el("div", "draftbar");
    const a = el("a", null, `${drafts.length} repl${drafts.length > 1 ? "ies" : "y"} drafted and waiting in Gmail`);
    a.href = "https://mail.google.com/mail/u/0/#drafts";
    a.target = "_blank"; a.rel = "noopener";
    box.appendChild(a);
    box.appendChild(el("div", "tiny", "Nothing is ever sent for you. Read it, fix it, send it yourself."));
    v.appendChild(box);
  }

  // anything with a date and a place, so nobody misses a physical event
  const soonEvents = (DATA.events || [])
    .map(e => ({ ...e, d: parseDue(e.when) }))
    .filter(e => e.d && e.d >= now() && e.d - now() < 14 * 864e5)
    .sort((a, b) => a.d - b.d).slice(0, 3);
  if (soonEvents.length) {
    const box = el("div", "evbar");
    soonEvents.forEach(e => {
      const row = el("div", "evrow");
      const sch = /^SCHOOL:/.test(e.what || "");
      row.appendChild(el("b", sch ? "sch" : null, absTime(e.d)));
      row.appendChild(document.createTextNode(" " + (e.what || "").replace(/^SCHOOL:\s*/, "") + (e.where ? " · " + e.where : "")));
      box.appendChild(row);
    });
    v.appendChild(box);
  }

  const head = el("div", "row");
  const s = el("input", "search"); s.placeholder = "search tasks"; s.value = QUERY;
  s.oninput = e => { QUERY = e.target.value; const box = $("#taskList"); if (box) fillList(box); };
  head.appendChild(s);
  v.appendChild(head);

  if (who) {
    const wl = (DATA.tasks || []).filter(t => ownedBy(t, who) && bucketFor(t, who) === "todo");
    const wo = wl.filter(t => { const d = parseDue(t.due); return d && d < now(); });
    const ws = wl.filter(t => { const d = parseDue(t.due); return d && d >= now() && d - now() < 24 * 36e5; });
    const line = el("div", "tiny");
    line.textContent = `${who}: ${wo.length} late · ${ws.length} due in 24h · ${wl.length} still to do`;
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
  const who = currentWho();
  const all = (DATA.tasks || []).filter(matchQuery).filter(t => !who || ownedBy(t, who));

  const todo    = sortTasks(all.filter(t => bucketFor(t, who) === "todo"));
  const unclear = sortTasks(all.filter(t => bucketFor(t, who) === "unclear"));
  const done    = sortTasks(all.filter(t => bucketFor(t, who) === "done"));

  if (!all.length) {
    box.appendChild(el("div", "empty", who ? `Nothing for ${who}. Tap Everyone.` : "Nothing matches."));
    return;
  }

  /* TO DO, split by how soon it bites */
  const h = el("h2", null, "To do");
  h.appendChild(el("small", null, String(todo.length)));
  box.appendChild(h);
  if (!todo.length) box.appendChild(el("div", "empty", "Nothing outstanding. Rare."));
  const buckets = [
    ["Late", t => { const d = parseDue(t.due); return d && d < now(); }],
    ["Next 24 hours", t => { const d = parseDue(t.due); return d && d >= now() && d - now() < 24 * 36e5; }],
    ["Later", t => { const d = parseDue(t.due); return d && d - now() >= 24 * 36e5; }],
    ["No deadline given", () => true],
  ];
  const used = new Set();
  buckets.forEach(([name, test]) => {
    const g = todo.filter(t => !used.has(t) && test(t));
    g.forEach(t => used.add(t));
    if (!g.length) return;
    const sub = el("h3", "sub"); sub.textContent = name;
    sub.appendChild(el("small", null, String(g.length)));
    box.appendChild(sub);
    g.forEach(t => box.appendChild(taskCard(t)));
  });

  if (unclear.length) {
    const h2 = el("h2", null, "Unclear");
    h2.appendChild(el("small", null, String(unclear.length)));
    box.appendChild(h2);
    box.appendChild(el("div", "tiny", "Nobody could tell from the thread whether these were finished or what exactly was asked. Check before assuming you are safe."));
    unclear.forEach(t => box.appendChild(taskCard(t)));
  }

  const h3 = el("h2", null, "Done");
  h3.appendChild(el("small", null, String(done.length)));
  box.appendChild(h3);
  if (!done.length) box.appendChild(el("div", "empty", "Nothing closed out yet."));
  done.slice(0, 80).forEach(t => box.appendChild(taskCard(t)));
  if (done.length > 80) box.appendChild(el("div", "tiny", `${done.length - 80} more not shown.`));
}

function viewBoard() {
  const v = el("div");
  const allTasks = DATA.tasks || [];
  const grid = el("div", "grid three");

  PLEDGES.forEach(name => {
    const ps = (DATA.pledge_status || []).find(p => p.name === name) || {};
    const ban = banFor(name);
    const mine = sortTasks(allTasks.filter(t => ownedBy(t, name) && bucketFor(t, name) === "todo"));
    const late = mine.filter(t => { const d = parseDue(t.due); return d && d < now(); });
    const murky = allTasks.filter(t => ownedBy(t, name) && bucketFor(t, name) === "unclear").length;

    const c = el("div", "p-card" + (name === ME ? " mine" : "") + (ban ? " banned" : ""));
    const h = el("div", "p-head");
    h.appendChild(el("div", "p-name", name));
    h.appendChild(el("div", "p-count", `${mine.length} to do${late.length ? " · " + late.length + " late" : ""}${murky ? " · " + murky + " unclear" : ""}`));
    c.appendChild(h);

    if (ban) {
      const b = el("div", "p-ban");
      b.appendChild(el("b", null, ban.scope ? "Partly banned" : "Email banned"));
      const u = ban.until ? "until " + absTime(parseDue(ban.until)) : "indefinitely";
      const sc = ban.scope ? ` from ${ban.scope},` : "";
      b.appendChild(document.createTextNode(`${sc} ${u} (${ban.by}${ban.reason ? ", " + ban.reason : ""})`));
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
        const w = t.what || "(no description)";
        li.textContent = w.length > 90 ? w.slice(0, 88) + "\u2026" : w;
        li.appendChild(el("span", "tiny", "  " + relTime(d)));
        ul.appendChild(li);
      });
      if (mine.length > 8) ul.appendChild(el("li", "tiny", `+${mine.length - 8} more`));
      c.appendChild(ul);
    }
    c.onclick = () => { WHO = name; TAB = "now"; render(); };
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
      const sub = el("div", "a-sub");
      sub.textContent = a.major || "";
      if (a.posts === false) {
        sub.appendChild(document.createTextNode(a.major ? " · " : ""));
        sub.appendChild(el("span", "quiet", "never posts on the listserv"));
      }
      r.appendChild(sub);
      if (a.cares_about) r.appendChild(el("div", "a-cares", a.cares_about));
      if (a.expects || a.proof_format) {
        const d2 = el("div", "a-demands");
        if (a.expects) { d2.appendChild(el("b", null, "Wants a reply: ")); d2.appendChild(document.createTextNode(a.expects + "  ")); }
        if (a.proof_format) { d2.appendChild(el("b", null, "Proof: ")); d2.appendChild(document.createTextNode(a.proof_format)); }
        r.appendChild(d2);
      }
      if (a.quote) r.appendChild(el("div", "a-quote", "\u201c" + a.quote + "\u201d"));
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
  const t = now(), pt = ptNow(), today = pt.day, mins = pt.mins;
  if (CALDAY == null) CALDAY = today;

  /* right now */
  const box = el("div", "now-box");
  const hdr = el("div", "hdr");
  hdr.appendChild(el("b", null, "Right now"));
  hdr.appendChild(el("span", "clock", pt.label + " Berkeley time"));
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
  const upcoming = (cal.exams || []).map(e => ({ ...e, d: parseDue(e.date + "T23:59:00-07:00") }))
    .filter(e => e.date >= pt.ymd)
    .sort((a, b) => a.d - b.d);
  if (upcoming.length) {
    v.appendChild(el("h2", null, "Exams coming up"));
    upcoming.forEach(e => {
      const d = el("div", "exam");
      d.appendChild(el("b", null, e.who.join(", ")));
      d.appendChild(document.createTextNode(` — ${e.what}, ${new Date(e.date + "T12:00:00-07:00").toLocaleDateString([], { timeZone: PT, weekday: "long", month: "short", day: "numeric" })}${e.time ? ", " + e.time + " Berkeley time" : ""}`));
      v.appendChild(d);
    });
    v.appendChild(el("div", "warn", "Do not hand these guys a task during someone's midterm. Check here first."));
  }

  /* dated commitments pulled out of the threads */
  const evs = (DATA.events || []).map(e => ({ ...e, d: parseDue(e.when) }))
    .sort((a, b) => (a.d ? a.d.getTime() : 8e15) - (b.d ? b.d.getTime() : 8e15));
  const future = evs.filter(e => !e.d || e.d >= parseDue(pt.ymd + "T00:00:00-07:00"));
  if (future.length) {
    const h = el("h2", null, "Commitments"); h.appendChild(el("small", null, String(future.length)));
    v.appendChild(h);
    future.forEach(e => {
      const school = /^SCHOOL:/.test(e.what || "");
      const d = el("div", "exam" + (school ? " school" : ""));
      const who = (e.who || []).includes("ALL") ? "Whole PC" : (e.who || []).join(", ");
      d.appendChild(el("b", null, school ? "Class" : (who || "PC")));
      const when = e.d ? absTime(e.d) : (e.when_text || "no date given");
      d.appendChild(document.createTextNode(" " + (e.what || "").replace(/^SCHOOL:\s*/, "")));
      const sub = el("div", "tiny");
      sub.textContent = when + (e.where ? " · " + e.where : "") + (e.thread_subject ? " · " + e.thread_subject : "");
      d.appendChild(sub);
      v.appendChild(d);
    });
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
    d.appendChild(el("div", "time", fmtHM(s.start) + " to " + fmtHM(s.end)));
    const r = el("div");
    r.appendChild(el("div", "what", s.what));
    const names = el("div", "names");
    s.who.forEach(w => names.appendChild(el("span", "chip" + (w === ME ? " me" : ""), w)));
    r.appendChild(names);
    if (s.where) r.appendChild(el("div", "where", s.where));
    d.appendChild(r);
    v.appendChild(d);
  });
  v.appendChild(el("div", "tiny", "All times on this page are Berkeley time, wherever you are reading it. Source: the Cookies and Cream shared Google Calendar, so only people who put their schedule in appear here."));
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
    const untilTxt = ban.until ? "until " + absTime(parseDue(ban.until)) : "indefinitely, until it is lifted";
    b.appendChild(document.createTextNode(ban.scope
      ? `Do not email about ${ban.scope}. Restricted ${untilTxt}.`
      : `Do not email at all. You are banned ${untilTxt}.`));
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
function render(keepScroll) {
  const v = $("#view");
  v.textContent = "";
  const views = { now: viewNow, board: viewBoard, rules: viewRules, actives: viewActives, cal: viewCal, threads: viewThreads };
  v.appendChild((views[TAB] || viewNow)());
  [...$("#tabs").children].forEach(b => b.classList.toggle("on", b.dataset.tab === TAB));
  updateBanner();
  if (!keepScroll) window.scrollTo(0, 0);
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
  setData(data);
  loadTicks();
  $("#gate").hidden = true;

  const sel = $("#me");
  sel.textContent = "";
  const o0 = el("option", null, "who are you?"); o0.value = ""; sel.appendChild(o0);
  PLEDGES.forEach(p => { const o = el("option", null, p); o.value = p; sel.appendChild(o); });
  try { ME = localStorage.getItem(LS_ME) || ""; } catch (e) { ME = ""; }
  if (ME && !PLEDGES.includes(ME)) { ME = ""; try { localStorage.removeItem(LS_ME); } catch (e) {} }
  sel.value = ME || "";
  sel.onchange = () => { ME = sel.value; WHO = undefined; try { localStorage.setItem(LS_ME, ME); } catch (e) {} render(); };

  [...$("#tabs").children].forEach(b => b.onclick = () => { TAB = b.dataset.tab; QUERY = ""; try { localStorage.setItem(LS_TAB, TAB); } catch (e) {} render(); });
  const TABS = ["now", "board", "rules", "actives", "cal", "threads"];
  try {
    const savedTab = localStorage.getItem(LS_TAB);
    TAB = TABS.includes(savedTab) ? savedTab : "now";
    const dayN = Number(localStorage.getItem(LS_DAY));
    CALDAY = (dayN >= 1 && dayN <= 7) ? dayN : null;
  } catch (e) { TAB = "now"; CALDAY = null; }

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
    setData(await decrypt(b, PASS));
    const open = [...document.querySelectorAll(".card.open")].map(c => c.textContent.slice(0, 60));
    const y = window.scrollY;
    render(true);
    // put back the cards the reader had expanded, and their place on the page
    document.querySelectorAll(".card").forEach(c => {
      if (open.some(o => c.textContent.slice(0, 60) === o)) c.classList.add("open");
    });
    window.scrollTo(0, y);
    syncLabel();
  } catch (e) { /* offline is fine, keep showing what we have */ }
}

async function tryOpen(pass, fromStorage) {
  const err = $("#gateErr");
  err.textContent = "opening…";
  let bundle;
  try {
    const r = await fetch("data.enc?t=" + Date.now(), { cache: "no-store" });
    if (!r.ok) throw new Error("fetch:" + r.status);
    bundle = await r.json();
  } catch (e) {
    // Network problem, not a bad passphrase. Keep what is saved so a pledge on
    // bad signal is not locked out, and offer a retry.
    err.textContent = "Cannot reach the data right now. Check your signal.";
    if (fromStorage) {
      const again = el("button", null, "Retry");
      again.type = "button";
      again.onclick = () => tryOpen(pass, true);
      err.appendChild(document.createTextNode(" "));
      err.appendChild(again);
    }
    return;
  }
  try {
    const data = await decrypt(bundle, pass);
    PASS = pass;
    try { localStorage.setItem(LS_PASS, pass); } catch (e) {}
    err.textContent = "";
    boot(data);
  } catch (e) {
    // Only a genuine decrypt failure means the passphrase is wrong.
    try { localStorage.removeItem(LS_PASS); } catch (x) {}
    if (fromStorage) { err.textContent = "The passphrase changed. Enter the new one."; return; }
    err.textContent = "Wrong passphrase.";
    const c = $(".gate-card"); c.classList.remove("shake"); void c.offsetWidth; c.classList.add("shake");
  }
}

$("#gateForm").onsubmit = e => { e.preventDefault(); tryOpen($("#gatePass").value.trim(), false); };
(function () {
  let saved = null;
  try { saved = localStorage.getItem(LS_PASS); } catch (e) {}
  if (saved) tryOpen(saved, true);
})();

/* Register the offline shell. Failure here is never fatal: the page works
   online regardless, so a refusal in private mode changes nothing. */
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  });
}
