"use strict";
/* =========================================================
   Recurrence
   ========================================================= */
function spanDays(ev) {
  return Math.max(1, Math.round((startOfDay(new Date(ev.end_at)) - startOfDay(new Date(ev.start_at))) / 864e5));
}
function occEnd(ev, st) {
  return ev.all_day ? addDays(st, spanDays(ev)) : new Date(+st + (new Date(ev.end_at) - new Date(ev.start_at)));
}
function expandEvent(ev, from, to, out) {
  const s0 = new Date(ev.start_at);
  const mk = st => ({ ev, start: st, end: occEnd(ev, st), key: ev.id + "|" + dkey(st), allDay: ev.all_day });
  const r = ev.rrule;
  if (!r || !r.freq) { const o = mk(s0); if (o.end > from && o.start < to) out.push(o); return; }
  const iv = Math.max(1, parseInt(r.interval, 10) || 1);
  const until = r.until ? addDays(fromKey(r.until), 1) : null;
  const count = parseInt(r.count, 10) || 0;
  const ex = new Set(ev.exdates || []);
  const at = d => new Date(d.getFullYear(), d.getMonth(), d.getDate(), s0.getHours(), s0.getMinutes());
  const skipFrom = new Date(+from - (occEnd(ev, s0) - s0) - 2 * 864e5);
  let n = 0, guard = 0;
  const emit = st => {
    if (until && st >= until) return false;
    if (st >= to) return false;
    n++;
    if (count && n > count) return false;
    if (!ex.has(dkey(st))) { const o = mk(st); if (o.end > from) out.push(o); }
    return true;
  };
  if (r.freq === "daily") {
    let i = !count && skipFrom > s0 ? Math.floor((skipFrom - s0) / (864e5 * iv)) : 0;
    for (; guard++ < 4000; i++) if (!emit(at(addDays(s0, i * iv)))) break;
  } else if (r.freq === "weekly") {
    const days = (r.byday && r.byday.length ? [...r.byday] : [s0.getDay()]).sort((a, b) => a - b);
    const w0 = startOfWeek(s0);
    let w = !count && skipFrom > s0 ? Math.max(0, Math.floor((skipFrom - w0) / (7 * 864e5 * iv))) : 0;
    outer: for (; guard++ < 4000; w++) {
      for (const d of days) {
        const st = at(addDays(w0, w * 7 * iv + d));
        if (st < s0) continue;
        if (!emit(st)) break outer;
      }
    }
  } else if (r.freq === "monthly") {
    let m = 0;
    if (!count && skipFrom > s0) m = Math.max(0, Math.floor(((skipFrom.getFullYear() - s0.getFullYear()) * 12 + skipFrom.getMonth() - s0.getMonth()) / iv) - 1);
    for (; guard++ < 4000; m++) {
      const st = new Date(s0.getFullYear(), s0.getMonth() + m * iv, s0.getDate(), s0.getHours(), s0.getMinutes());
      if (st.getDate() !== s0.getDate()) continue;
      if (!emit(st)) break;
    }
  } else if (r.freq === "yearly") {
    let y = !count && skipFrom > s0 ? Math.max(0, Math.floor((skipFrom.getFullYear() - s0.getFullYear()) / iv) - 1) : 0;
    for (; guard++ < 400; y++) {
      const st = new Date(s0.getFullYear() + y * iv, s0.getMonth(), s0.getDate(), s0.getHours(), s0.getMinutes());
      if (st.getMonth() !== s0.getMonth()) continue;
      if (!emit(st)) break;
    }
  }
}
function rruleLabel(r, start) {
  if (!r || !r.freq) return "לא חוזר";
  const iv = parseInt(r.interval, 10) || 1;
  const unit = { daily: ["כל יום", "ימים"], weekly: ["כל שבוע", "שבועות"], monthly: ["כל חודש", "חודשים"], yearly: ["כל שנה", "שנים"] }[r.freq];
  let s = iv === 1 ? unit[0] : `כל ${iv} ${unit[1]}`;
  if (r.freq === "weekly") {
    const days = r.byday?.length ? r.byday : [start.getDay()];
    s += days.length === 5 && [0, 1, 2, 3, 4].every(d => days.includes(d)) ? ", בימי חול" : " בימי " + [...days].sort().map(d => DAYS_SHORT[d]).join(" ");
  }
  if (r.freq === "monthly") s += ` ב-${start.getDate()}`;
  if (r.until) { const u = fromKey(r.until); s += `, עד ${u.getDate()}.${u.getMonth() + 1}.${u.getFullYear()}`; }
  if (r.count) s += `, ${r.count} פעמים`;
  return s;
}
const EVENT_FIELDS = ["calendar_id", "title", "notes", "location", "all_day", "rrule", "exdates"];
const pickEvent = ev => Object.fromEntries(EVENT_FIELDS.map(k => [k, ev[k]]));

/* =========================================================
   Calendar view
   ========================================================= */
const Cal = {
  HOUR: 48,
  state: (() => {
    let s = {};
    try { s = JSON.parse(localStorage.getItem("lc-cal-ui") || "{}"); } catch {}
    return { view: s.view || (matchMedia("(max-width: 760px)").matches ? "3day" : "week"), date: new Date(), lastCal: s.lastCal || null };
  })(),
  saveState() { localStorage.setItem("lc-cal-ui", JSON.stringify({ view: this.state.view, lastCal: this.state.lastCal })); },

  calendars() { return DB.all("calendars").sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name)); },
  colorOf(ev) { return DB.get("calendars", ev.calendar_id)?.color || "teal"; },
  occurrences(from, to) {
    const out = [];
    for (const ev of DB.all("events")) {
      const c = ev.calendar_id && DB.get("calendars", ev.calendar_id);
      if (c && !c.visible) continue;
      expandEvent(ev, from, to, out);
    }
    return out.sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start));
  },

  /* ---------- mount ---------- */
  mount(root, params = []) {
    if (params[0] && params[1]) { this.state.view = params[0]; this.state.date = fromKey(params[1]); history.replaceState(null, "", "#calendar"); }
    this.HOUR = isMobile() ? 44 : 48;
    this.side = el("aside", { class: "side cal-side" });
    this.bar = el("header", { class: "bar" });
    this.body = el("div", { class: "cal-body" });
    this.root = el("div", { class: "cal page-split" }, this.side, el("section", { class: "main" }, this.bar, this.body));
    root.replaceChildren(this.root);
    this.scrollTop = null;
    this.render();
    this.nowT = setInterval(() => this.updateNow(), 60000);
    this.keys = e => this.onKey(e);
    document.addEventListener("keydown", this.keys);
  },
  unmount() { clearInterval(this.nowT); document.removeEventListener("keydown", this.keys); },
  update(t) {
    if (!["events", "calendars", "*"].includes(t)) return;
    if (document.body.classList.contains("dragging")) return;
    this.render();
  },
  onKey(e) {
    if (e.target.closest("input, textarea, [contenteditable], dialog")) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === "t") this.go(null, new Date());
    else if (k === "arrowleft") this.step(1);
    else if (k === "arrowright") this.step(-1);
    else if (k === "d") this.go("day");
    else if (k === "w") this.go("week");
    else if (k === "m") this.go("month");
    else if (k === "a") this.go("agenda");
    else if (k === "c") this.newEvent(atMinutes(this.state.date, 9 * 60), atMinutes(this.state.date, 10 * 60));
    else return;
    e.preventDefault();
  },

  go(view, date) {
    if (view) { this.state.view = view; this.saveState(); }
    if (date) this.state.date = startOfDay(date);
    this.render();
  },
  step(dir) {
    const { view, date } = this.state;
    const d = view === "month" ? addMonths(date, dir) : addDays(date, dir * ({ day: 1, "3day": 3, week: 7, agenda: 14 }[view] || 7));
    this.go(null, d);
  },
  range() {
    const { view, date } = this.state;
    if (view === "day") return [startOfDay(date), 1];
    if (view === "3day") return [startOfDay(date), 3];
    if (view === "week") return [startOfWeek(date), 7];
    if (view === "agenda") return [startOfDay(date), 30];
    const first = startOfMonth(date), gs = startOfWeek(first);
    const weeks = Math.ceil((first.getDay() + daysInMonth(first.getFullYear(), first.getMonth())) / 7);
    return [gs, weeks * 7];
  },
  title() {
    const { view, date } = this.state;
    const [s, n] = this.range();
    if (view === "day") return `${fullDate(date)} ${date.getFullYear()}`;
    if (view === "month") return `${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
    const e = addDays(s, n - 1);
    if (s.getMonth() === e.getMonth()) return `${MONTHS[s.getMonth()]} ${s.getFullYear()}`;
    return `${MONTHS[s.getMonth()]} – ${MONTHS[e.getMonth()]} ${e.getFullYear()}`;
  },

  /* ---------- render ---------- */
  render() {
    if (!this.root?.isConnected) return;
    const sc = $(".tg-scroll", this.body);
    if (sc) this.scrollTop = sc.scrollTop;
    this.renderSide();
    this.renderBar();
    const { view } = this.state;
    const [s, n] = this.range();
    if (view === "month") this.renderMonth(s, n);
    else if (view === "agenda") this.renderAgenda(s, n);
    else this.renderGrid(Array.from({ length: n }, (_, i) => addDays(s, i)));
  },
  renderBar() {
    const views = isMobile()
      ? [["day", "יום"], ["3day", "3 ימים"], ["month", "חודש"], ["agenda", "רשימה"]]
      : [["day", "יום"], ["week", "שבוע"], ["month", "חודש"], ["agenda", "רשימה"]];
    this.bar.replaceChildren(
      el("button", { class: "icon-btn only-mobile", title: "יומנים", onclick: () => this.side.classList.toggle("open") }, icon("menu")),
      el("button", { class: "btn soft sm", onclick: () => this.go(null, new Date()) }, "היום"),
      el("div", { class: "arrows" },
        el("button", { class: "icon-btn", title: "הקודם", onclick: () => this.step(-1) }, icon("chevR")),
        el("button", { class: "icon-btn", title: "הבא", onclick: () => this.step(1) }, icon("chevL"))),
      el("h1", { class: "bar-title" }, this.title()),
      el("div", { class: "seg" }, views.map(([v, l]) => el("button", { class: this.state.view === v ? "on" : "", onclick: () => this.go(v) }, l))),
      el("button", { class: "btn add-btn", onclick: () => { const d = this.state.date, h = Math.min(22, new Date().getHours() + 1); this.newEvent(atMinutes(d, h * 60), atMinutes(d, h * 60 + 60)); } }, icon("plus"), el("span", {}, "אירוע")));
  },

  renderSide() {
    const cals = this.calendars();
    if (!this.mini) this.mini = startOfMonth(this.state.date);
    const m = this.mini, gs = startOfWeek(m);
    const [rs, rn] = this.range();
    const re = addDays(rs, rn);
    const days = Array.from({ length: 42 }, (_, i) => addDays(gs, i));
    this.side.replaceChildren(
      el("button", { class: "icon-btn close-side only-mobile", onclick: () => this.side.classList.remove("open") }, icon("x")),
      el("div", { class: "mini" },
        el("div", { class: "mini-head" },
          el("b", {}, `${MONTHS[m.getMonth()]} ${m.getFullYear()}`),
          el("button", { class: "icon-btn sm", onclick: () => { this.mini = addMonths(m, -1); this.renderSide(); } }, icon("chevR")),
          el("button", { class: "icon-btn sm", onclick: () => { this.mini = addMonths(m, 1); this.renderSide(); } }, icon("chevL"))),
        el("div", { class: "mini-grid" },
          DAYS_SHORT.map(d => el("span", { class: "mini-wd" }, d[0])),
          days.map(d => el("button", {
            class: ["mini-d", d.getMonth() !== m.getMonth() && "out", sameDay(d, new Date()) && "today", d >= rs && d < re && "in"].filter(Boolean).join(" "),
            onclick: () => { this.side.classList.remove("open"); this.go(null, d); },
          }, d.getDate())))),
      el("div", { class: "side-h" }, el("span", {}, "היומנים שלי"),
        el("button", { class: "icon-btn sm", title: "יומן חדש", onclick: () => this.addCalendar() }, icon("plus"))),
      el("div", { class: "cal-list" }, cals.map(c => el("div", { class: "cal-item", style: { "--c": cvar(c.color) } },
        el("label", {},
          el("input", { type: "checkbox", class: "cbox", checked: c.visible, onchange: e => DB.patch("calendars", c.id, { visible: e.target.checked }) }),
          el("span", { dir: "auto" }, c.name || "בלי שם")),
        el("button", { class: "icon-btn sm more", title: "אפשרויות", onclick: e => this.calMenu(e.currentTarget, c) }, icon("dots"))))),
      el("p", { class: "side-tip" }, "גוררים על היומן כדי ליצור אירוע. גוררים אירוע כדי להזיז, ואת הקצה התחתון כדי לשנות אורך."));
  },
  async addCalendar() {
    const name = await UI.prompt({ title: "יומן חדש", placeholder: "למשל: לימודים, משפחה, LevCatom" });
    if (!name) return;
    DB.create("calendars", { name, color: nextColor(this.calendars().map(c => c.color)), sort: Date.now() });
  },
  calMenu(btn, c) {
    UI.menu(btn, [
      { swatches: COLORS, value: c.color, fn: color => DB.patch("calendars", c.id, { color }) },
      { label: "שינוי שם", icon: "text", fn: async () => { const name = await UI.prompt({ title: "שם היומן", value: c.name }); if (name) DB.patch("calendars", c.id, { name }); } },
      { label: "להציג רק את היומן הזה", icon: "layers", fn: () => { for (const x of this.calendars()) DB.patch("calendars", x.id, { visible: x.id === c.id }, { silent: true }); this.render(); } },
      { sep: true },
      { label: "מחיקת היומן", icon: "trash", danger: true, fn: async () => {
        const evs = DB.all("events").filter(e => e.calendar_id === c.id);
        if (!(await UI.confirm({ title: `למחוק את "${c.name}"?`, text: evs.length ? `גם ${evs.length} האירועים שבו יימחקו.` : "" }))) return;
        for (const e of evs) DB.remove("events", e.id, { silent: true });
        DB.remove("calendars", c.id);
      } },
    ]);
  },

  /* ---------- week / day grid ---------- */
  renderGrid(days) {
    const H = this.HOUR, now = new Date();
    const from = days[0], to = addDays(days.at(-1), 1);
    const occs = this.occurrences(from, to);
    const long = o => o.allDay || o.end - o.start >= 864e5;
    const wrap = el("div", { class: "tg", style: { "--cols": days.length, "--hour": H + "px" } });

    wrap.append(el("div", { class: "tg-head" }, el("div", { class: "tg-gut" }),
      days.map(d => el("button", { class: "tg-day" + (sameDay(d, now) ? " today" : ""), onclick: () => this.go("day", d) },
        el("span", { class: "wd" }, DAYS_SHORT[d.getDay()]), el("span", { class: "dn" }, d.getDate())))));

    const allRow = el("div", { class: "tg-all" }, el("div", { class: "tg-gut lbl" }, "כל היום"));
    for (const d of days) {
      const cell = el("div", { class: "tg-allcell", "data-day": dkey(d) });
      for (const o of occs) if (long(o) && o.start < addDays(d, 1) && o.end > d) cell.append(this.chip(o, "bar"));
      cell.addEventListener("click", e => { if (e.target === cell) this.newEvent(d, addDays(d, 1), true); });
      allRow.append(cell);
    }
    wrap.append(allRow);

    const scroll = el("div", { class: "tg-scroll" });
    const grid = el("div", { class: "tg-grid" },
      el("div", { class: "tg-hours" }, Array.from({ length: 24 }, (_, h) => el("div", { class: "tg-h" }, h ? `${pad(h)}:00` : ""))));
    for (const d of days) {
      const col = el("div", { class: "tg-col" + (sameDay(d, now) ? " today" : ""), "data-day": dkey(d) });
      const dayEnd = addDays(d, 1);
      const segs = occs.filter(o => !long(o) && o.start < dayEnd && o.end > d).map(o => {
        const top = o.start <= d ? 0 : minutesOf(o.start);
        const bot = o.end >= dayEnd ? 1440 : minutesOf(o.end) || 1440;
        return { o, top, bot: Math.max(bot, top + 15) };
      });
      this.layout(segs);
      for (const s of segs) col.append(this.evBlock(s, now));
      if (sameDay(d, now)) col.append(el("div", { class: "now-line", style: { top: minutesOf(now) * H / 60 + "px" } }));
      col.addEventListener("pointerdown", e => this.onColDown(e, col, d));
      grid.append(col);
    }
    scroll.append(grid);
    wrap.append(scroll);
    this.body.replaceChildren(wrap);
    scroll.scrollTop = this.scrollTop ?? Math.max(0, (sameDay(days[0], now) || days.some(d => sameDay(d, now)) ? Math.min(now.getHours() - 1, 7) : 7) * H);
  },
  layout(segs) {
    segs.sort((a, b) => a.top - b.top || b.bot - a.bot);
    let cluster = [], cols = [], maxBot = -1;
    const finish = () => { for (const s of cluster) s.n = cols.length; cluster = []; cols = []; };
    for (const s of segs) {
      if (s.top >= maxBot) { finish(); maxBot = -1; }
      let i = cols.findIndex(end => end <= s.top);
      if (i < 0) { i = cols.length; cols.push(0); }
      cols[i] = s.bot; s.col = i;
      cluster.push(s); maxBot = Math.max(maxBot, s.bot);
    }
    finish();
  },
  evBlock(s, now) {
    const { o } = s, H = this.HOUR, w = 100 / s.n;
    const short = s.bot - s.top < 45;
    const node = el("div", {
      class: `ev${short ? " short" : ""}${o.end < now ? " past" : ""}`,
      style: { top: s.top * H / 60 + "px", height: Math.max(16, (s.bot - s.top) * H / 60 - 2) + "px", insetInlineStart: `calc(${s.col * w}% + 1px)`, width: `calc(${w}% - 3px)`, "--c": cvar(this.colorOf(o.ev)) },
    },
      el("div", { class: "ev-t", dir: "auto" }, o.ev.title || "(ללא שם)", o.ev.rrule ? icon("repeat", "tiny") : ""),
      el("div", { class: "ev-time" }, `${hhmm(o.start)}–${hhmm(o.end)}`),
      o.ev.location && !short ? el("div", { class: "ev-loc", dir: "auto" }, o.ev.location) : "",
      el("div", { class: "ev-rs" }));
    node.addEventListener("pointerdown", e => this.onEvDown(e, o, node));
    return node;
  },
  chip(o, kind) {
    const c = cvar(this.colorOf(o.ev));
    const timed = !o.allDay && kind !== "bar";
    const node = el("div", { class: `chip-ev ${timed ? "timed" : "bar"}${o.end < new Date() ? " past" : ""}`, style: { "--c": c }, title: o.ev.title },
      timed ? el("span", { class: "dot" }) : "",
      timed ? el("span", { class: "tm" }, hhmm(o.start)) : "",
      el("span", { class: "tt", dir: "auto" }, o.ev.title || "(ללא שם)"));
    node.addEventListener("pointerdown", e => this.onChipDown(e, o, node));
    return node;
  },
  updateNow() {
    const line = $(".now-line", this.body);
    if (line) line.style.top = minutesOf(new Date()) * this.HOUR / 60 + "px";
    else if (this.state.view !== "month" && this.state.view !== "agenda") this.render();
  },

  /* ---------- pointer: create ---------- */
  onColDown(e, col, day) {
    if (e.button !== 0 || e.target !== col) return;
    const H = this.HOUR;
    const minAt = y => Math.max(0, Math.min(1440, Math.round((y - col.getBoundingClientRect().top) / H * 60 / 15) * 15));
    const m0 = Math.floor((e.clientY - col.getBoundingClientRect().top) / H * 60 / 15) * 15;
    const open = (a, b) => this.newEvent(atMinutes(day, a), atMinutes(day, b));
    if (e.pointerType === "touch") {
      dragTrack(e, { threshold: 8, end: moved => { if (!moved) { const a = Math.floor(m0 / 30) * 30; open(a, a + 60); } } });
      return;
    }
    e.preventDefault();
    let a = m0, b = m0 + 15;
    const ghost = el("div", { class: "ev ghost", style: { "--c": cvar(DB.get("calendars", this.state.lastCal)?.color || this.calendars()[0]?.color || "teal") } });
    const draw = () => {
      Object.assign(ghost.style, { top: a * H / 60 + "px", height: (b - a) * H / 60 + "px", insetInlineStart: "1px", width: "calc(100% - 3px)" });
      ghost.textContent = `${pad(Math.floor(a / 60))}:${pad(a % 60)}–${pad(Math.floor(b / 60) % 24)}:${pad(b % 60)}`;
    };
    dragTrack(e, {
      threshold: 3,
      move: (dx, dy, ev) => {
        if (!ghost.isConnected) col.append(ghost);
        const m = minAt(ev.clientY);
        if (m > m0) { a = m0; b = Math.max(m, m0 + 15); } else { a = Math.min(m, m0); b = m0 + 15; }
        draw();
      },
      end: moved => {
        if (!moved) { a = Math.floor(m0 / 30) * 30; b = a + 60; col.append(ghost); draw(); }
        open(a, Math.min(b, 1440));
      },
    });
  },

  /* ---------- pointer: move / resize timed ---------- */
  onEvDown(e, o, node) {
    if (e.button !== 0) return;
    e.stopPropagation();
    if (e.pointerType === "touch") { dragTrack(e, { threshold: 8, end: moved => { if (!moved) this.openEditor(o); } }); return; }
    e.preventDefault();
    const H = this.HOUR, resize = !!e.target.closest(".ev-rs");
    const day0 = fromKey(node.parentElement.dataset.day);
    const top0 = parseFloat(node.style.top), h0 = parseFloat(node.style.height);
    const label = $(".ev-time", node);
    let ns = o.start, ne = o.end;
    dragTrack(e, {
      threshold: 3,
      move: (dx, dy, ev) => {
        const dmin = Math.round(dy / H * 60 / 15) * 15;
        node.classList.add("moving");
        if (resize) {
          ne = new Date(Math.max(+o.end + dmin * 60000, +o.start + 15 * 60000));
          node.style.height = Math.max(16, h0 + (ne - o.end) / 60000 * H / 60) + "px";
        } else {
          const colEl = document.elementFromPoint(ev.clientX, ev.clientY)?.closest(".tg-col");
          const dd = colEl ? Math.round((fromKey(colEl.dataset.day) - day0) / 864e5) : 0;
          ns = new Date(addDays(o.start, dd).getTime() + dmin * 60000);
          ne = new Date(+ns + (o.end - o.start));
          if (colEl && colEl !== node.parentElement) colEl.append(node);
          node.style.top = top0 + dmin * H / 60 + "px";
          Object.assign(node.style, { insetInlineStart: "1px", width: "calc(100% - 3px)" });
        }
        label.textContent = `${hhmm(ns)}–${hhmm(ne)}`;
      },
      end: moved => {
        if (!moved) return this.openEditor(o);
        if (+ns === +o.start && +ne === +o.end) return this.render();
        this.changeTime(o, ns, ne);
      },
    });
  },
  /* chips (all-day row, month cells): click to edit, drag to another day */
  onChipDown(e, o, node) {
    if (e.button !== 0) return;
    e.stopPropagation();
    if (e.pointerType === "touch") { dragTrack(e, { threshold: 8, end: moved => { if (!moved) this.openEditor(o); } }); return; }
    e.preventDefault();
    const cell0 = node.closest("[data-day]");
    let target = null;
    dragTrack(e, {
      threshold: 4,
      move: (dx, dy, ev) => {
        node.classList.add("moving");
        node.style.transform = `translate(${dx}px, ${dy}px)`;
        target = document.elementFromPoint(ev.clientX, ev.clientY)?.closest(".mc, .tg-allcell");
        $$(".drop", this.body).forEach(x => x.classList.remove("drop"));
        target?.classList.add("drop");
      },
      end: moved => {
        if (!moved) return this.openEditor(o);
        if (!target || !cell0) return this.render();
        const dd = Math.round((fromKey(target.dataset.day) - fromKey(cell0.dataset.day)) / 864e5);
        if (!dd) return this.render();
        this.changeTime(o, addDays(o.start, dd), addDays(o.end, dd));
      },
    });
  },
  async changeTime(o, ns, ne) {
    const ch = { start_at: ns.toISOString(), end_at: ne.toISOString() };
    if (!o.ev.rrule) return DB.patch("events", o.ev.id, ch);
    const scope = await this.askScope("להזיז אירוע חוזר");
    if (!scope) return this.render();
    this.applyScoped(o, scope, ch);
  },
  askScope(title) {
    return UI.choose({ title, options: [
      { label: "רק את האירוע הזה", value: "this" },
      { label: "את האירוע הזה וכל הבאים", value: "following" },
      { label: "את כל האירועים", value: "all" },
    ] });
  },
  applyScoped(o, scope, ch) {
    const ev = o.ev, isFirst = sameDay(o.start, new Date(ev.start_at));
    const withoutCount = r => { if (!r) return r; const x = { ...r }; delete x.count; return x; };
    if (scope === "this") {
      DB.patch("events", ev.id, { exdates: [...new Set([...(ev.exdates || []), dkey(o.start)])] }, { silent: true });
      DB.create("events", { ...pickEvent(ev), start_at: o.start.toISOString(), end_at: o.end.toISOString(), ...ch, rrule: null, exdates: [] });
    } else if (scope === "all" || isFirst) {
      const ns = ch.start_at ? new Date(ch.start_at) : o.start, ne = ch.end_at ? new Date(ch.end_at) : o.end;
      const dayDelta = Math.round((startOfDay(ns) - startOfDay(o.start)) / 864e5);
      const s0 = new Date(ev.start_at);
      const newS = ch.all_day ?? ev.all_day ? addDays(startOfDay(s0), dayDelta) : atMinutes(addDays(s0, dayDelta), minutesOf(ns));
      const newE = new Date(+newS + (ne - ns));
      let rrule = "rrule" in ch ? ch.rrule : ev.rrule;
      if (!("rrule" in ch) && rrule?.freq === "weekly" && dayDelta && rrule.byday?.length) rrule = { ...rrule, byday: rrule.byday.map(d => ((d + dayDelta) % 7 + 7) % 7) };
      DB.patch("events", ev.id, { ...ch, start_at: newS.toISOString(), end_at: newE.toISOString(), rrule });
    } else {
      DB.patch("events", ev.id, { rrule: { ...withoutCount(ev.rrule), until: dkey(addDays(o.start, -1)) } }, { silent: true });
      DB.create("events", { ...pickEvent(ev), start_at: o.start.toISOString(), end_at: o.end.toISOString(), exdates: [], ...ch, rrule: withoutCount("rrule" in ch ? ch.rrule : ev.rrule) });
    }
  },
  async deleteOcc(o) {
    const ev = o.ev;
    if (!ev.rrule) { DB.remove("events", ev.id); UI.toast("האירוע נמחק", { label: "ביטול", fn: () => DB.put("events", { ...ev, deleted: false }) }); return true; }
    const scope = await UI.choose({ title: "למחוק אירוע חוזר", options: [
      { label: "רק את האירוע הזה", value: "this" },
      { label: "את האירוע הזה וכל הבאים", value: "following" },
      { label: "את כל האירועים", value: "all", cls: "danger" },
    ] });
    if (!scope) return false;
    if (scope === "all" || (scope === "following" && sameDay(o.start, new Date(ev.start_at)))) DB.remove("events", ev.id);
    else if (scope === "this") DB.patch("events", ev.id, { exdates: [...new Set([...(ev.exdates || []), dkey(o.start)])] });
    else { const r = { ...ev.rrule, until: dkey(addDays(o.start, -1)) }; delete r.count; DB.patch("events", ev.id, { rrule: r }); }
    return true;
  },

  /* ---------- month ---------- */
  renderMonth(gs, n) {
    const occs = this.occurrences(gs, addDays(gs, n));
    const month = this.state.date.getMonth(), now = new Date();
    const max = isMobile() ? 3 : 4;
    const grid = el("div", { class: "month", style: { "--rows": n / 7 } },
      DAYS_LONG.map((d, i) => el("div", { class: "mh" }, isMobile() ? DAYS_SHORT[i] : d)));
    for (let i = 0; i < n; i++) {
      const d = addDays(gs, i), de = addDays(d, 1);
      const list = occs.filter(o => o.start < de && o.end > d)
        .sort((a, b) => (b.allDay - a.allDay) || a.start - b.start);
      const cell = el("div", { class: "mc" + (d.getMonth() !== month ? " out" : "") + (sameDay(d, now) ? " today" : ""), "data-day": dkey(d) },
        el("button", { class: "mc-n", onclick: () => this.go("day", d) }, d.getDate() === 1 && !isMobile() ? `${d.getDate()} ב${MONTHS[d.getMonth()]}` : d.getDate()),
        list.slice(0, list.length > max ? max - 1 : max).map(o => this.chip(o)),
        list.length > max ? el("button", { class: "mc-more", onclick: () => this.go("day", d) }, `עוד ${list.length - max + 1}`) : "");
      cell.addEventListener("click", e => { if (e.target === cell) this.newEvent(d, de, true); });
      grid.append(cell);
    }
    this.body.replaceChildren(grid);
  },

  /* ---------- agenda ---------- */
  renderAgenda(s, n) {
    const occs = this.occurrences(s, addDays(s, n));
    const now = new Date();
    const groups = [];
    for (let i = 0; i < n; i++) {
      const d = addDays(s, i), de = addDays(d, 1);
      const list = occs.filter(o => o.start < de && o.end > d);
      if (list.length) groups.push([d, list]);
    }
    this.body.replaceChildren(el("div", { class: "agenda" },
      groups.length ? groups.map(([d, list]) => el("section", { class: "ag-day" + (sameDay(d, now) ? " today" : "") },
        el("button", { class: "ag-date", onclick: () => this.go("day", d) },
          el("span", { class: "dn" }, d.getDate()), el("span", { class: "wd" }, `${DAYS_SHORT[d.getDay()]} · ${MONTHS[d.getMonth()]}`)),
        el("div", { class: "ag-list" }, list.map(o => {
          const row = el("button", { class: "ag-ev" + (o.end < now ? " past" : ""), style: { "--c": cvar(this.colorOf(o.ev)) }, onclick: () => this.openEditor(o) },
            el("span", { class: "dot" }),
            el("span", { class: "ag-time" }, o.allDay ? "כל היום" : `${hhmm(o.start)}–${hhmm(o.end)}`),
            el("span", { class: "ag-title", dir: "auto" }, o.ev.title || "(ללא שם)"),
            o.ev.location ? el("span", { class: "ag-loc", dir: "auto" }, o.ev.location) : "");
          return row;
        }))))
        : el("div", { class: "empty" }, el("p", {}, "אין אירועים בשבועות הקרובים."), el("button", { class: "btn", onclick: () => this.newEvent(atMinutes(s, 600), atMinutes(s, 660)) }, "אירוע חדש"))));
  },

  /* ---------- editor ---------- */
  newEvent(start, end, allDay = false) {
    this.openEditor({ ev: null, start, end, allDay });
  },
  openEditor(o) {
    const ev = o.ev, isNew = !ev;
    const cals = this.calendars();
    let calId = ev?.calendar_id || (cals.find(c => c.id === this.state.lastCal) ? this.state.lastCal : cals[0]?.id) || null;
    let rrule = ev?.rrule ? { ...ev.rrule } : null;

    const title = el("input", { class: "ed-title", placeholder: "הוספת כותרת", value: ev?.title || "", dir: "auto" });
    const allDay = el("input", { type: "checkbox", class: "cbox", checked: o.allDay });
    const sd = el("input", { type: "date", class: "inp", value: dkey(o.start) });
    const st = el("input", { type: "time", class: "inp", value: hhmm(o.start), step: 900 });
    const et = el("input", { type: "time", class: "inp", value: hhmm(o.end), step: 900 });
    const lastDay = o.allDay ? addDays(o.end, -1) : (minutesOf(o.end) === 0 && o.end > o.start ? addDays(o.end, -1) : o.end);
    const ed = el("input", { type: "date", class: "inp", value: dkey(o.allDay ? lastDay : o.end) });
    if (!o.allDay && minutesOf(o.end) === 0 && o.end > o.start) { et.value = "23:59"; ed.value = dkey(lastDay); }
    const loc = el("input", { class: "inp", placeholder: "מיקום", value: ev?.location || "", dir: "auto" });
    const notes = el("textarea", { class: "inp", rows: 3, placeholder: "הערות", dir: "auto" }, ev?.notes || "");

    const startDate = () => fromKey(sd.value || dkey(o.start));
    const rep = el("select", { class: "inp" });
    const presets = () => {
      const d = startDate();
      return [
        ["none", "לא חוזר", null],
        ["daily", "כל יום", { freq: "daily", interval: 1 }],
        ["weekly", `כל שבוע ביום ${DAYS_LONG[d.getDay()]}`, { freq: "weekly", interval: 1, byday: [d.getDay()] }],
        ["weekdays", "כל יום חול (א׳–ה׳)", { freq: "weekly", interval: 1, byday: [0, 1, 2, 3, 4] }],
        ["monthly", `כל חודש ב-${d.getDate()}`, { freq: "monthly", interval: 1 }],
        ["yearly", `כל שנה ב-${d.getDate()} ב${MONTHS[d.getMonth()]}`, { freq: "yearly", interval: 1 }],
      ];
    };
    const matchPreset = r => {
      if (!r) return "none";
      if (r.until || r.count || (r.interval || 1) !== 1) return "custom";
      const d = startDate();
      if (r.freq === "daily") return "daily";
      if (r.freq === "monthly") return "monthly";
      if (r.freq === "yearly") return "yearly";
      if (r.freq === "weekly") {
        const b = r.byday?.length ? [...r.byday].sort().join() : String(d.getDay());
        if (b === "0,1,2,3,4") return "weekdays";
        if (b === String(d.getDay())) return "weekly";
      }
      return "custom";
    };
    const custom = el("div", { class: "rep-custom" });
    const fillRep = () => {
      const cur = rep.value || matchPreset(rrule);
      rep.replaceChildren(...presets().map(([v, l]) => el("option", { value: v }, l)),
        el("option", { value: "custom" }, cur === "custom" && rrule ? rruleLabel(rrule, startDate()) : "מותאם אישית…"));
      rep.value = cur;
      custom.hidden = rep.value !== "custom";
    };
    const drawCustom = () => {
      if (!rrule) rrule = { freq: "weekly", interval: 1, byday: [startDate().getDay()] };
      const r = rrule;
      const iv = el("input", { type: "number", class: "inp short", min: 1, max: 99, value: r.interval || 1, oninput: e => { r.interval = Math.max(1, +e.target.value || 1); } });
      const fq = el("select", { class: "inp", onchange: e => { r.freq = e.target.value; if (r.freq === "weekly" && !r.byday?.length) r.byday = [startDate().getDay()]; drawCustom(); } },
        [["daily", "ימים"], ["weekly", "שבועות"], ["monthly", "חודשים"], ["yearly", "שנים"]].map(([v, l]) => el("option", { value: v }, l)));
      fq.value = r.freq;
      const ends = r.until ? "until" : r.count ? "count" : "never";
      const untilIn = el("input", { type: "date", class: "inp", value: r.until || dkey(addMonths(startDate(), 3)), oninput: e => { r.until = e.target.value; } });
      const countIn = el("input", { type: "number", class: "inp short", min: 1, value: r.count || 10, oninput: e => { r.count = Math.max(1, +e.target.value || 1); } });
      const endSel = el("select", { class: "inp", onchange: e => { delete r.until; delete r.count; if (e.target.value === "until") r.until = untilIn.value; if (e.target.value === "count") r.count = +countIn.value; drawCustom(); } },
        el("option", { value: "never" }, "בלי סוף"), el("option", { value: "until" }, "עד תאריך"), el("option", { value: "count" }, "מספר פעמים"));
      endSel.value = ends;
      custom.replaceChildren(
        el("div", { class: "rc-row" }, el("span", {}, "כל"), iv, fq),
        r.freq === "weekly" ? el("div", { class: "rc-days" }, DAYS_SHORT.map((l, i) => el("button", {
          type: "button", class: "dbtn" + (r.byday?.includes(i) ? " on" : ""),
          onclick: e => { const s = new Set(r.byday || []); s.has(i) ? s.delete(i) : s.add(i); if (!s.size) s.add(i); r.byday = [...s].sort(); e.currentTarget.classList.toggle("on", s.has(i)); },
        }, l))) : "",
        el("div", { class: "rc-row" }, el("span", {}, "מסתיים"), endSel, ends === "until" ? untilIn : "", ends === "count" ? countIn : "", ends === "count" ? el("span", {}, "פעמים") : ""));
    };
    rep.addEventListener("change", () => {
      if (rep.value === "custom") { drawCustom(); custom.hidden = false; }
      else { rrule = presets().find(p => p[0] === rep.value)?.[2] || null; custom.hidden = true; }
    });
    sd.addEventListener("change", () => {
      const v = rep.value; fillRep(); rep.value = v;
      if (v !== "custom" && v !== "none") rrule = presets().find(p => p[0] === v)?.[2] || rrule;
      if (fromKey(ed.value) < fromKey(sd.value)) ed.value = sd.value;
    });
    fillRep();
    if (rep.value === "custom") drawCustom();

    const calPick = el("div", { class: "cal-pick" });
    const drawCals = () => calPick.replaceChildren(...cals.map(c => el("button", {
      type: "button", class: "cp" + (c.id === calId ? " on" : ""), style: { "--c": cvar(c.color) },
      onclick: () => { calId = c.id; drawCals(); },
    }, el("span", { class: "dot" }), el("span", { dir: "auto" }, c.name))));
    drawCals();

    const timeBits = [st, et];
    const syncAllDay = () => timeBits.forEach(x => (x.hidden = allDay.checked));
    allDay.addEventListener("change", syncAllDay);
    syncAllDay();

    const save = async () => {
      let s, e;
      if (allDay.checked) {
        s = fromKey(sd.value);
        e = addDays(fromKey(ed.value || sd.value), 1);
        if (e <= s) e = addDays(s, 1);
      } else {
        const [sh, sm] = (st.value || "09:00").split(":").map(Number);
        const [eh, em] = (et.value || "10:00").split(":").map(Number);
        s = atMinutes(fromKey(sd.value), sh * 60 + sm);
        e = atMinutes(fromKey(ed.value || sd.value), eh * 60 + em);
        if (et.value === "23:59") e = addDays(startOfDay(e), 1);
        if (e <= s) e = new Date(+s + 3600e3);
      }
      if (rep.value !== "custom") rrule = presets().find(p => p[0] === rep.value)?.[2] || null;
      const ch = {
        title: title.value.trim(), calendar_id: calId, all_day: allDay.checked,
        start_at: s.toISOString(), end_at: e.toISOString(), rrule: rrule ? { ...rrule } : null,
        location: loc.value.trim(), notes: notes.value.trim(),
      };
      this.state.lastCal = calId; this.saveState();
      if (isNew) DB.create("events", ch);
      else if (!ev.rrule) DB.patch("events", ev.id, ch);
      else {
        const scope = await this.askScope("לשמור שינוי באירוע חוזר");
        if (!scope) return;
        this.applyScoped(o, scope, ch);
      }
      dlg.close();
    };
    title.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); save(); } });

    const dlg = UI.dialog(el("div", { class: "editor" },
      el("div", { class: "ed-top" }, title, el("button", { class: "icon-btn", title: "סגירה", onclick: () => dlg.close() }, icon("x"))),
      el("div", { class: "ed-row" }, icon("clock"),
        el("div", { class: "when" },
          el("div", { class: "when-line" }, sd, st, el("span", { class: "dash" }, "–"), et, ed),
          el("label", { class: "inline" }, allDay, "כל היום"))),
      el("div", { class: "ed-row" }, icon("repeat"), el("div", { class: "grow" }, rep, custom)),
      el("div", { class: "ed-row" }, icon("calendar"), calPick),
      el("div", { class: "ed-row" }, icon("pin"), loc),
      el("div", { class: "ed-row" }, icon("text"), notes),
      el("div", { class: "dlg-actions" },
        !isNew ? el("button", { class: "btn ghost danger-text", onclick: async () => { if (await this.deleteOcc(o)) dlg.close(); } }, icon("trash"), "מחיקה") : "",
        el("span", { class: "grow" }),
        el("button", { class: "btn ghost", onclick: () => dlg.close() }, "ביטול"),
        el("button", { class: "btn", onclick: save }, "שמירה"))), "wide");
    dlg.addEventListener("close", () => { if (this.root?.isConnected) this.render(); });
    if (isNew) title.focus();
  },
};
