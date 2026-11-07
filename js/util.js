"use strict";
/* ---------- DOM ---------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === "class") n.className = v;
    else if (k === "style" && typeof v === "object") {
      for (const [p, val] of Object.entries(v)) p.startsWith("--") ? n.style.setProperty(p, val) : (n.style[p] = val);
    }
    else if (k.startsWith("on") && typeof v === "function") n.addEventListener(k.slice(2), v);
    else if (k === "html") n.innerHTML = v;
    else if (k === "value") n.value = v;
    else if (k === "checked") n.checked = !!v;
    else if (v === true) n.setAttribute(k, "");
    else n.setAttribute(k, v);
  }
  for (const c of kids.flat(Infinity)) if (c != null && c !== false && c !== "") n.append(c.nodeType ? c : String(c));
  return n;
}
/* debounce that can be flushed: pending calls run right away when the page is hidden or closed */
const PENDING = new Set();
function debounce(fn, ms) {
  let t, args;
  const run = () => { clearTimeout(t); PENDING.delete(d); const a = args; args = null; if (a) fn(...a); };
  const d = (...a) => { args = a; clearTimeout(t); PENDING.add(d); t = setTimeout(run, ms); };
  d.flush = run;
  return d;
}
const flushAll = () => { for (let i = 0; i < 5 && PENDING.size; i++) for (const d of [...PENDING]) d.flush(); };
addEventListener("pagehide", flushAll);
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flushAll(); });
const uuid = () => crypto.randomUUID();
const isMobile = () => matchMedia("(max-width: 760px)").matches;
const IS_EXT = location.protocol === "chrome-extension:";

/* ---------- icons ---------- */
const ICONS = {
  home: '<path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10v9.5h13V10"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  tasks: '<rect x="3.5" y="3.5" width="17" height="17" rx="4"/><path d="m8 12.2 2.7 2.6L16.5 9"/>',
  notes: '<path d="M5 3.5h14a1.5 1.5 0 0 1 1.5 1.5v9.5l-6 6H5A1.5 1.5 0 0 1 3.5 19V5A1.5 1.5 0 0 1 5 3.5Z"/><path d="M14.5 20.5V16a1.5 1.5 0 0 1 1.5-1.5h4.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  chevR: '<path d="m9 6 6 6-6 6"/>',
  chevL: '<path d="m15 6-6 6 6 6"/>',
  chevD: '<path d="m6 9 6 6 6-6"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  trash: '<path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13"/>',
  dots: '<circle cx="5.5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="18.5" cy="12" r="1.3"/>',
  user: '<circle cx="12" cy="8.5" r="3.8"/><path d="M4.5 20c1.2-3.8 4-5.5 7.5-5.5s6.3 1.7 7.5 5.5"/>',
  logout: '<path d="M14 4.5h4.5v15H14M10 8l-4 4 4 4M6 12h9"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>',
  tag: '<path d="M3.5 12.2V4.5a1 1 0 0 1 1-1h7.7l8.3 8.3-8.7 8.7Z"/><circle cx="8" cy="8" r="1.4"/>',
  folder: '<path d="M3.5 7.5v10.5a1.5 1.5 0 0 0 1.5 1.5h14a1.5 1.5 0 0 0 1.5-1.5v-9a1.5 1.5 0 0 0-1.5-1.5h-7l-2-2.5H5A1.5 1.5 0 0 0 3.5 6.5Z"/>',
  inbox: '<path d="M3.5 13.5 6 5h12l2.5 8.5v5a1.5 1.5 0 0 1-1.5 1.5H5a1.5 1.5 0 0 1-1.5-1.5Z"/><path d="M3.5 13.5H8l1.5 2.5h5l1.5-2.5h4.5"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/>',
  week: '<rect x="3.5" y="5" width="17" height="15.5" rx="3"/><path d="M3.5 10h17M8 14h3M8 17h6"/>',
  list: '<path d="M9 6.5h11M9 12h11M9 17.5h11"/><circle cx="4.8" cy="6.5" r="1.1"/><circle cx="4.8" cy="12" r="1.1"/><circle cx="4.8" cy="17.5" r="1.1"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  checkbox: '<rect x="4" y="4" width="16" height="16" rx="4"/><path d="m8.5 12.2 2.4 2.3 4.6-4.9"/>',
  repeat: '<path d="M4.5 11V9.5A3.5 3.5 0 0 1 8 6h11.5M16.5 3l3 3-3 3M19.5 13v1.5A3.5 3.5 0 0 1 16 18H4.5M7.5 21l-3-3 3-3"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  pin: '<path d="M12 21s-6.5-6.2-6.5-11a6.5 6.5 0 0 1 13 0c0 4.8-6.5 11-6.5 11Z"/><circle cx="12" cy="10" r="2.3"/>',
  text: '<path d="M5 6.5h14M5 12h14M5 17.5h9"/>',
  filter: '<path d="M4 5.5h16l-6 7v6l-4-2v-4Z"/>',
  layers: '<path d="m12 3.5 8.5 4.5-8.5 4.5L3.5 8Z"/><path d="m3.5 12.5 8.5 4.5 8.5-4.5"/>',
  save: '<path d="M5.5 3.5h10l3 3v12a2 2 0 0 1-2 2h-11a2 2 0 0 1-2-2v-13a2 2 0 0 1 2-2Z"/><path d="M8 3.5v5h7v-5M8 20.5v-6h8v6"/>',
  grid: '<rect x="4" y="4" width="7" height="7" rx="2"/><rect x="13" y="4" width="7" height="7" rx="2"/><rect x="4" y="13" width="7" height="7" rx="2"/><rect x="13" y="13" width="7" height="7" rx="2"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  flag: '<path d="M5.5 21V4.5M5.5 4.5h11l-2 4 2 4h-11"/>',
  note2: '<path d="M6 3.5h12v17H6z"/><path d="M9 8h6M9 12h6M9 16h3"/>',
  sync: '<path d="M19.5 12a7.5 7.5 0 0 1-13 5M4.5 12a7.5 7.5 0 0 1 13-5"/><path d="M17.5 3.5V7H14M6.5 20.5V17H10"/>',
  cloudOff: '<path d="M7 18.5h10.5a3.5 3.5 0 0 0 .6-6.95A6 6 0 0 0 7.2 9.1 4.7 4.7 0 0 0 7 18.5Z"/><path d="M4 4l16 16"/>',
};
function icon(name, cls = "") {
  return el("span", { class: "ic " + cls, "aria-hidden": "true", html: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ""}</svg>` });
}

/* ---------- palette ---------- */
const COLORS = ["coral", "sand", "gold", "teal", "navy", "brown"];
const COLOR_NAMES = { coral: "קורל", sand: "כתום", gold: "זהב", teal: "טורקיז", navy: "כחול", brown: "חום", beige: "בז׳" };
const cvar = c => `var(--${COLORS.includes(c) || c === "beige" ? c : "teal"})`;
function nextColor(used) {
  const counts = Object.fromEntries(COLORS.map(c => [c, 0]));
  for (const c of used) if (c in counts) counts[c]++;
  return COLORS.reduce((a, b) => (counts[b] < counts[a] ? b : a));
}

/* ---------- dates ---------- */
const pad = n => String(n).padStart(2, "0");
const dkey = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fromKey = k => { const [y, m, d] = k.split("-").map(Number); return new Date(y, m - 1, d); };
const startOfDay = d => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const daysInMonth = (y, m) => new Date(y, m + 1, 0).getDate();
const addMonths = (d, n) => { const x = new Date(d); const day = x.getDate(); x.setDate(1); x.setMonth(x.getMonth() + n); x.setDate(Math.min(day, daysInMonth(x.getFullYear(), x.getMonth()))); return x; };
const sameDay = (a, b) => a && b && dkey(a) === dkey(b);
const startOfWeek = d => addDays(startOfDay(d), -d.getDay());
const startOfMonth = d => new Date(d.getFullYear(), d.getMonth(), 1);
const minutesOf = d => d.getHours() * 60 + d.getMinutes();
const atMinutes = (day, min) => new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, min);
const hhmm = d => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const todayKey = () => dkey(new Date());
const DAYS_SHORT = ["א׳", "ב׳", "ג׳", "ד׳", "ה׳", "ו׳", "ש׳"];
const DAYS_LONG = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];
const MONTHS = ["ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני", "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר"];
const hebDate = new Intl.DateTimeFormat("he-u-ca-hebrew", { day: "numeric", month: "long" });
const fullDate = d => `יום ${DAYS_LONG[d.getDay()]}, ${d.getDate()} ב${MONTHS[d.getMonth()]}`;
function dayWord(d) {
  const diff = Math.round((startOfDay(d) - startOfDay(new Date())) / 864e5);
  if (diff === 0) return "היום";
  if (diff === 1) return "מחר";
  if (diff === -1) return "אתמול";
  if (diff > 1 && diff < 7) return `יום ${DAYS_LONG[d.getDay()]}`;
  return `${d.getDate()}.${d.getMonth() + 1}${d.getFullYear() !== new Date().getFullYear() ? "." + String(d.getFullYear()).slice(2) : ""}`;
}

/* ---------- UI helpers ---------- */
const UI = {
  toast(msg, action, ms = 4500) {
    const t = $("#toast");
    t.replaceChildren(el("span", {}, msg),
      action ? el("button", { class: "toast-btn", onclick: () => { action.fn(); t.classList.remove("show"); } }, action.label) : "");
    t.classList.add("show");
    clearTimeout(this._tt);
    this._tt = setTimeout(() => t.classList.remove("show"), ms);
  },
  dialog(content, cls = "") {
    const d = el("dialog", { class: "dlg " + cls }, el("div", { class: "dlg-in" }, content));
    document.body.append(d);
    d.addEventListener("close", () => setTimeout(() => d.remove(), 0));
    d.addEventListener("mousedown", e => { if (e.target === d) d.close(); });
    d.showModal();
    return d;
  },
  prompt({ title, value = "", placeholder = "", ok = "שמירה" }) {
    return new Promise(res => {
      let result = null;
      const inp = el("input", { class: "inp", value, placeholder, dir: "auto" });
      const d = this.dialog(el("form", { class: "dlg-form", onsubmit: e => { e.preventDefault(); result = inp.value.trim(); d.close(); } },
        el("h3", {}, title), inp,
        el("div", { class: "dlg-actions" },
          el("button", { type: "button", class: "btn ghost", onclick: () => d.close() }, "ביטול"),
          el("button", { class: "btn" }, ok))), "small");
      d.addEventListener("close", () => res(result || null));
      inp.focus(); inp.select();
    });
  },
  choose({ title, text = "", options }) {
    return new Promise(res => {
      let result = null;
      const d = this.dialog(el("div", { class: "dlg-form" },
        el("h3", {}, title), text ? el("p", { class: "muted" }, text) : "",
        el("div", { class: "choices" }, options.map(o => el("button", {
          class: "btn " + (o.cls || "soft"), onclick: () => { result = o.value; d.close(); },
        }, o.label))),
        el("div", { class: "dlg-actions" }, el("button", { class: "btn ghost", onclick: () => d.close() }, "ביטול"))), "small");
      d.addEventListener("close", () => res(result));
    });
  },
  async confirm({ title, text = "", ok = "מחיקה" }) {
    return (await this.choose({ title, text, options: [{ label: ok, value: true, cls: "danger" }] })) === true;
  },
  menu(anchor, items) {
    $(".pop")?.remove();
    const pop = el("div", { class: "pop", role: "menu" });
    for (const it of items) {
      if (!it) continue;
      if (it.swatches) {
        pop.append(el("div", { class: "swatches" }, it.swatches.map(c => el("button", {
          class: "sw" + (c === it.value ? " on" : ""), title: COLOR_NAMES[c], style: { background: cvar(c) },
          onclick: () => { close(); it.fn(c); },
        }))));
      } else if (it.sep) pop.append(el("hr"));
      else pop.append(el("button", { class: "pop-item" + (it.danger ? " danger" : ""), onclick: () => { close(); it.fn(); } },
        it.icon ? icon(it.icon) : "", el("span", {}, it.label)));
    }
    document.body.append(pop);
    const r = anchor.getBoundingClientRect(), pw = pop.offsetWidth, ph = pop.offsetHeight;
    let left = r.right - pw, top = r.bottom + 6;
    if (left < 8) left = Math.min(r.left, innerWidth - pw - 8);
    if (top + ph > innerHeight - 8) top = Math.max(8, r.top - ph - 6);
    Object.assign(pop.style, { left: left + "px", top: top + "px" });
    const close = () => { pop.remove(); document.removeEventListener("pointerdown", outside, true); document.removeEventListener("keydown", esc); };
    const outside = e => { if (!pop.contains(e.target)) close(); };
    const esc = e => { if (e.key === "Escape") close(); };
    setTimeout(() => { document.addEventListener("pointerdown", outside, true); document.addEventListener("keydown", esc); });
    return pop;
  },
};

/* generic pointer drag: calls move(dx, dy, e) and end(moved, e). Returns nothing. */
function dragTrack(e, { move, end, threshold = 4 }) {
  const x0 = e.clientX, y0 = e.clientY;
  let moved = false;
  const mv = ev => {
    const dx = ev.clientX - x0, dy = ev.clientY - y0;
    if (!moved && Math.hypot(dx, dy) < threshold) return;
    if (!moved) { moved = true; document.body.classList.add("dragging"); }
    ev.preventDefault();
    move?.(dx, dy, ev);
  };
  const up = ev => {
    document.removeEventListener("pointermove", mv);
    document.removeEventListener("pointerup", up);
    document.removeEventListener("pointercancel", up);
    document.body.classList.remove("dragging");
    end?.(moved && ev.type !== "pointercancel", ev, moved);
  };
  document.addEventListener("pointermove", mv, { passive: false });
  document.addEventListener("pointerup", up);
  document.addEventListener("pointercancel", up);
}
