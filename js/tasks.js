"use strict";
/* =========================================================
   Quick-add parsing:  "להכין מצגת #שיעורים @הוראה !1 מחר 14:00"
   ========================================================= */
function parseQuick(text) {
  let t = " " + text.replace(/\s+/g, " ") + " ";
  const r = { tags: [], project: null, priority: null, due: null, time: null, dueLabel: null };
  t = t.replace(/ #([^\s#@!]+)(?= )/g, (_, n) => (r.tags.push(n), " "));
  t = t.replace(/ @([^\s#@!]+)(?= )/g, (_, n) => ((r.project = n), " "));
  t = t.replace(/ !([1-4])(?= )/g, (_, p) => ((r.priority = +p), " "));
  t = t.replace(/ (?:ב-?|בשעה )?(\d{1,2}):(\d{2})(?= )/, (m, h, mi) => {
    if (+h < 24 && +mi < 60) { r.time = `${pad(+h)}:${mi}`; return " "; }
    return m;
  });
  const today = startOfDay(new Date());
  const rules = [
    [/ (?:ל|עד )?היום(?= )/, () => today],
    [/ (?:ל|עד )?מחרתיים(?= )/, () => addDays(today, 2)],
    [/ (?:ל|עד )?מחר(?= )/, () => addDays(today, 1)],
    [/ (?:ב)?שבוע הבא(?= )/, () => addDays(today, 7)],
    [/ בעוד שבוע(?= )/, () => addDays(today, 7)],
    [/ בעוד (\d+) ימים(?= )/, (m, n) => addDays(today, +n)],
    [/ (?:ב?יום |ב|עד יום )(ראשון|שני|שלישי|רביעי|חמישי|שישי|שבת)(?= )/, (m, d) => {
      let diff = (DAYS_LONG.indexOf(d) - today.getDay() + 7) % 7;
      return addDays(today, diff || 7);
    }],
    [/ (?:ב-?|ל-?|עד )?(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?(?= )/, (m, d, mo, y) => {
      let yy = y ? (+y < 100 ? 2000 + +y : +y) : today.getFullYear();
      let dt = new Date(yy, +mo - 1, +d);
      if (dt.getMonth() !== +mo - 1) return null;
      if (!y && dt < today) dt = new Date(yy + 1, +mo - 1, +d);
      return dt;
    }],
  ];
  for (const [re, fn] of rules) {
    const m = t.match(re);
    if (!m) continue;
    const d = fn(...m);
    if (d && !isNaN(d)) { r.due = dkey(d); t = t.replace(m[0], " "); break; }
  }
  if (r.time && !r.due) r.due = dkey(today);
  r.title = t.trim().replace(/\s+/g, " ");
  return r;
}

/* =========================================================
   Tasks
   ========================================================= */
const PRI = { 1: "coral", 2: "sand", 3: "teal", 4: null };
const PRI_LABEL = { 1: "דחוף", 2: "חשוב", 3: "רגיל", 4: "בלי עדיפות" };
const GROUPS = { none: "בלי קיבוץ", project: "פרויקט", tag: "תגית", date: "תאריך", priority: "עדיפות" };
const SORTS = { due: "תאריך", priority: "עדיפות", created: "נוצרו לאחרונה", title: "א-ב" };
const BASE_DEFAULTS = {
  today: { groupBy: "none", sortBy: "due" }, upcoming: { groupBy: "date", sortBy: "due" },
  all: { groupBy: "project", sortBy: "due" }, inbox: { groupBy: "none", sortBy: "due" },
  done: { groupBy: "none", sortBy: "due", showDone: true },
};

const Tasks = {
  ui: (() => {
    let s = {};
    try { s = JSON.parse(localStorage.getItem("lc-tasks-ui") || "{}"); } catch {}
    return { base: s.base || "today", view: s.view || null, opts: s.opts || {}, layout: s.layout || {}, q: "" };
  })(),
  saveUi() { const { q, ...rest } = this.ui; localStorage.setItem("lc-tasks-ui", JSON.stringify(rest)); },
  opts() {
    const b = this.ui.base;
    const d = BASE_DEFAULTS[b] || { groupBy: "none", sortBy: "due" };
    return (this.ui.opts[b] ||= { groupBy: d.groupBy, sortBy: d.sortBy, tagFilter: [], tagMode: "any", showDone: !!d.showDone, layout: "list" });
  },
  setOpt(k, v) { this.opts()[k] = v; this.saveUi(); this.render(); },

  /* ---------- data helpers ---------- */
  projects() { return DB.all("projects").sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name, "he")); },
  tagList() {
    const names = new Set(DB.all("tags").map(t => t.name));
    for (const t of DB.all("tasks")) for (const n of t.tags || []) names.add(n);
    return [...names].sort((a, b) => a.localeCompare(b, "he"));
  },
  tagRow(name) { return DB.all("tags").find(t => t.name === name); },
  tagColor(name) { return this.tagRow(name)?.color || "sand"; },
  ensureTag(name) {
    if (!this.tagRow(name)) DB.create("tags", { name, color: nextColor(DB.all("tags").map(t => t.color)) }, { silent: true });
  },
  ensureProject(name) {
    const p = DB.all("projects").find(p => p.name.toLowerCase() === name.toLowerCase());
    return p || DB.create("projects", { name, color: nextColor(DB.all("projects").map(p => p.color)) }, { silent: true });
  },
  quickAdd(text, ctx = {}) {
    const p = parseQuick(text);
    if (!p.title) return null;
    let project_id = ctx.project_id ?? null;
    if (p.project) project_id = this.ensureProject(p.project).id;
    const tags = [...new Set([...(ctx.tags || []), ...p.tags])];
    tags.forEach(n => this.ensureTag(n));
    return DB.create("tasks", { title: p.title, project_id, tags, due_date: p.due ?? ctx.due ?? null, due_time: p.time, priority: p.priority ?? 4 });
  },
  toggle(t, li) {
    const done = !t.done;
    const go = () => DB.patch("tasks", t.id, { done, done_at: done ? new Date().toISOString() : null });
    if (li && done) { li.classList.add("completing"); setTimeout(go, 380); } else go();
    if (done) UI.toast("המשימה הושלמה", { label: "ביטול", fn: () => DB.patch("tasks", t.id, { done: false, done_at: null }) });
  },
  sortFn(by) {
    const due = t => (t.due_date ? t.due_date + (t.due_time || "99") : "9999");
    return {
      due: (a, b) => due(a).localeCompare(due(b)) || a.priority - b.priority || (b.created_at || "").localeCompare(a.created_at || ""),
      priority: (a, b) => a.priority - b.priority || due(a).localeCompare(due(b)),
      created: (a, b) => (b.created_at || "").localeCompare(a.created_at || ""),
      title: (a, b) => a.title.localeCompare(b.title, "he"),
      doneAt: (a, b) => (b.done_at || "").localeCompare(a.done_at || ""),
    }[by];
  },
  inBase(t, base) {
    const today = todayKey();
    if (base === "today") return t.due_date && t.due_date <= today;
    if (base === "upcoming") return t.due_date && t.due_date <= dkey(addDays(new Date(), 7));
    if (base === "inbox") return !t.project_id;
    if (base === "done") return t.done;
    if (base.startsWith("p:")) return t.project_id === base.slice(2);
    if (base.startsWith("t:")) return (t.tags || []).includes(base.slice(2));
    return true;
  },
  filtered() {
    const o = this.opts(), base = this.ui.base, q = this.ui.q.trim().toLowerCase();
    let list = DB.all("tasks").filter(t => (q ? true : this.inBase(t, base)));
    if (q) list = list.filter(t => (t.title + " " + t.notes + " " + (t.tags || []).join(" ")).toLowerCase().includes(q));
    if (base !== "done" && !o.showDone) list = list.filter(t => !t.done);
    if (o.tagFilter?.length) list = list.filter(t => o.tagMode === "all" ? o.tagFilter.every(n => t.tags?.includes(n)) : o.tagFilter.some(n => t.tags?.includes(n)));
    return list.sort(base === "done" ? this.sortFn("doneAt") : this.sortFn(o.sortBy));
  },
  groups(list) {
    const by = this.opts().groupBy;
    if (by === "project") {
      const gs = [{ key: "p:", title: "תיבה", color: "beige", drop: { project_id: null }, items: [] },
        ...this.projects().map(p => ({ key: "p:" + p.id, title: p.name, color: p.color, drop: { project_id: p.id }, items: [] }))];
      for (const t of list) (gs.find(g => g.key === "p:" + (t.project_id || "")) || gs[0]).items.push(t);
      return gs.filter(g => g.items.length || g.key !== "p:");
    }
    if (by === "tag") {
      const gs = this.tagList().map(n => ({ key: "t:" + n, tag: n, title: "#" + n, color: this.tagColor(n), items: list.filter(t => t.tags?.includes(n)) }));
      gs.push({ key: "t:", tag: null, title: "בלי תגית", color: "beige", items: list.filter(t => !t.tags?.length) });
      return gs.filter(g => g.items.length);
    }
    if (by === "priority") {
      return [1, 2, 3, 4].map(p => ({ key: "pr:" + p, title: PRI_LABEL[p], color: PRI[p] || "beige", drop: { priority: p }, items: list.filter(t => t.priority === p) })).filter(g => g.items.length);
    }
    if (by === "date") {
      const t0 = todayKey(), t1 = dkey(addDays(new Date(), 1)), t7 = dkey(addDays(new Date(), 7));
      const b = [
        { key: "d:late", title: "באיחור", color: "coral", test: d => d && d < t0 },
        { key: "d:today", title: "היום", color: "teal", test: d => d === t0, drop: { due_date: t0 } },
        { key: "d:tomorrow", title: "מחר", color: "sand", test: d => d === t1, drop: { due_date: t1 } },
        { key: "d:week", title: "השבוע", color: "gold", test: d => d > t1 && d <= t7 },
        { key: "d:later", title: "בהמשך", color: "navy", test: d => d > t7 },
        { key: "d:none", title: "בלי תאריך", color: "beige", test: d => !d, drop: { due_date: null, due_time: null } },
      ];
      return b.map(g => ({ ...g, items: list.filter(t => g.test(t.due_date)) })).filter(g => g.items.length);
    }
    return [{ key: "all", title: null, items: list }];
  },
  baseTitle() {
    const b = this.ui.base;
    if (this.ui.q) return `חיפוש: ${this.ui.q}`;
    if (this.ui.view) return DB.get("views", this.ui.view)?.name || "תצוגה";
    if (b.startsWith("p:")) return DB.get("projects", b.slice(2))?.name || "פרויקט";
    if (b.startsWith("t:")) return "#" + b.slice(2);
    return { today: "היום", upcoming: "7 הימים הקרובים", all: "כל המשימות", inbox: "תיבה", done: "הושלמו" }[b];
  },
  context() {
    const b = this.ui.base;
    return {
      project_id: b.startsWith("p:") ? b.slice(2) : null,
      tags: b.startsWith("t:") ? [b.slice(2)] : this.opts().tagMode === "all" ? [...(this.opts().tagFilter || [])] : [],
      due: b === "today" || b === "upcoming" ? todayKey() : null,
    };
  },

  /* ---------- mount ---------- */
  mount(root) {
    this.side = el("aside", { class: "side task-side" });
    this.bar = el("header", { class: "bar" });
    this.body = el("div", { class: "tasks-body" });
    this.root = el("div", { class: "tasks page-split" }, this.side, el("section", { class: "main" }, this.bar, this.body));
    root.replaceChildren(this.root);
    this.render();
  },
  update(t) {
    if (!["tasks", "projects", "tags", "views", "*"].includes(t)) return;
    if (document.body.classList.contains("dragging")) return;
    this.render();
  },
  select(base, view = null) {
    this.ui.base = base; this.ui.view = view; this.ui.q = "";
    if (view) { const v = DB.get("views", view); if (v) this.ui.opts[base] = { ...this.opts(), ...structuredClone(v.config.opts || {}) }; }
    this.saveUi(); this.side.classList.remove("open"); this.render();
  },
  render() {
    if (!this.root?.isConnected) return;
    this.renderSide(); this.renderBar(); this.renderBody();
  },

  renderSide() {
    const open = DB.all("tasks").filter(t => !t.done);
    const count = f => open.filter(f).length || "";
    const item = (key, label, ic, n, extra = {}) => el("button", {
      class: "side-item" + (this.ui.base === key && !this.ui.view && !this.ui.q ? " on" : ""), onclick: () => this.select(key), ...extra,
    }, ic, el("span", { class: "nm", dir: "auto" }, label), el("span", { class: "cnt" }, n));
    const t0 = todayKey(), t7 = dkey(addDays(new Date(), 7));
    this.side.replaceChildren(
      el("button", { class: "icon-btn close-side only-mobile", onclick: () => this.side.classList.remove("open") }, icon("x")),
      el("nav", { class: "side-group" },
        item("today", "היום", icon("sun"), count(t => t.due_date && t.due_date <= t0)),
        item("upcoming", "7 הימים הקרובים", icon("week"), count(t => t.due_date && t.due_date <= t7)),
        item("all", "כל המשימות", icon("list"), count(() => true)),
        item("inbox", "תיבה (בלי פרויקט)", icon("inbox"), count(t => !t.project_id)),
        item("done", "הושלמו", icon("check"), "")),
      el("div", { class: "side-h" }, el("span", {}, "פרויקטים"),
        el("button", { class: "icon-btn sm", title: "פרויקט חדש", onclick: () => this.addProject() }, icon("plus"))),
      el("nav", { class: "side-group" }, this.projects().map(p => el("div", { class: "side-row", style: { "--c": cvar(p.color) } },
        item("p:" + p.id, p.name, el("span", { class: "dot" }), count(t => t.project_id === p.id)),
        el("button", { class: "icon-btn sm more", onclick: e => this.projectMenu(e.currentTarget, p) }, icon("dots"))))),
      el("div", { class: "side-h" }, el("span", {}, "תגיות"),
        el("button", { class: "icon-btn sm", title: "תגית חדשה", onclick: () => this.addTag() }, icon("plus"))),
      el("nav", { class: "side-group" }, this.tagList().map(n => el("div", { class: "side-row", style: { "--c": cvar(this.tagColor(n)) } },
        item("t:" + n, n, el("span", { class: "hash" }, "#"), count(t => t.tags?.includes(n))),
        el("button", { class: "icon-btn sm more", onclick: e => this.tagMenu(e.currentTarget, n) }, icon("dots"))))),
      DB.all("views").length ? el("div", { class: "side-h" }, el("span", {}, "תצוגות שמורות")) : "",
      el("nav", { class: "side-group" }, DB.all("views").sort((a, b) => a.sort - b.sort).map(v => el("div", { class: "side-row" },
        el("button", { class: "side-item" + (this.ui.view === v.id ? " on" : ""), onclick: () => this.select(v.config.base || "all", v.id) },
          icon("layers"), el("span", { class: "nm", dir: "auto" }, v.name)),
        el("button", { class: "icon-btn sm more", onclick: e => this.viewMenu(e.currentTarget, v) }, icon("dots"))))),
    );
  },

  renderBar() {
    const o = this.opts();
    const search = el("input", { class: "inp search-in", placeholder: "חיפוש במשימות", value: this.ui.q, dir: "auto" });
    search.addEventListener("input", debounce(() => { this.ui.q = search.value; this.renderBody(); $(".bar-title", this.bar).textContent = this.baseTitle(); }, 200));
    const pick = (label, cur, map, key) => el("button", { class: "tb", onclick: e => UI.menu(e.currentTarget, Object.entries(map).map(([k, l]) => ({ label: (k === cur ? "✓ " : "") + l, fn: () => this.setOpt(key, k) }))) },
      el("span", { class: "muted" }, label), map[cur], icon("chevD", "tiny"));
    const tags = this.tagList();
    this.bar.replaceChildren(
      el("div", { class: "bar-line" },
        el("button", { class: "icon-btn only-mobile", title: "רשימות", onclick: () => this.side.classList.toggle("open") }, icon("menu")),
        el("h1", { class: "bar-title", dir: "auto" }, this.baseTitle()),
        search),
      el("div", { class: "toolbar" },
        el("div", { class: "seg" },
          el("button", { class: o.layout !== "board" ? "on" : "", onclick: () => this.setOpt("layout", "list") }, icon("list", "tiny"), "רשימה"),
          el("button", { class: o.layout === "board" ? "on" : "", onclick: () => this.setOpt("layout", "board") }, icon("grid", "tiny"), "לוח")),
        pick("קיבוץ:", o.groupBy, GROUPS, "groupBy"),
        this.ui.base !== "done" ? pick("מיון:", o.sortBy, SORTS, "sortBy") : "",
        this.ui.base !== "done" ? el("button", { class: "tb" + (o.showDone ? " on" : ""), onclick: () => this.setOpt("showDone", !o.showDone) }, icon("check", "tiny"), "גם שהושלמו") : "",
        el("button", { class: "tb", onclick: () => this.saveView() }, icon("save", "tiny"), this.ui.view ? "עדכון התצוגה" : "שמירה כתצוגה")),
      tags.length ? el("div", { class: "tagbar" },
        el("span", { class: "muted" }, "סינון:"),
        tags.map(n => el("button", {
          class: "tagchip" + (o.tagFilter?.includes(n) ? " on" : ""), style: { "--c": cvar(this.tagColor(n)) }, dir: "auto",
          onclick: () => { const s = new Set(o.tagFilter || []); s.has(n) ? s.delete(n) : s.add(n); this.setOpt("tagFilter", [...s]); },
        }, "#" + n)),
        o.tagFilter?.length > 1 ? el("button", { class: "tb", onclick: () => this.setOpt("tagMode", o.tagMode === "all" ? "any" : "all") }, o.tagMode === "all" ? "כל התגיות יחד" : "לפחות אחת") : "",
        o.tagFilter?.length ? el("button", { class: "tb", onclick: () => this.setOpt("tagFilter", []) }, icon("x", "tiny"), "ניקוי") : "") : "");
  },

  renderBody() {
    const o = this.opts();
    const list = this.filtered();
    const groups = this.groups(list);
    const add = this.ui.base === "done" ? "" : this.addBox();
    const content = el("div", { class: "groups" + (o.layout === "board" ? " board" : "") },
      groups.map(g => el("section", { class: "grp", "data-key": g.key, style: { "--c": cvar(g.color || "teal") } },
        g.title ? el("h3", { class: "grp-h", dir: "auto" }, el("span", { class: "dot" }), g.title, el("span", { class: "cnt" }, g.items.length)) : "",
        el("ul", { class: "tlist" }, g.items.map(t => this.row(t, g))))));
    const empty = !list.length ? el("div", { class: "empty" },
      el("p", {}, this.ui.q ? "לא נמצאו משימות." : this.ui.base === "today" ? "אין משימות להיום. יום נקי!" : "אין כאן משימות עדיין.")) : "";
    this.body.replaceChildren(add, empty, list.length ? content : "");
  },
  addBox() {
    const ctx = this.context();
    const inp = el("input", { class: "inp add-in", placeholder: "משימה חדשה…   #תגית  @פרויקט  !1  מחר  14:00", dir: "auto", autocomplete: "off" });
    const prev = el("div", { class: "parse" });
    inp.addEventListener("input", () => {
      const p = parseQuick(inp.value);
      prev.replaceChildren(
        p.due ? el("span", { class: "pchip" }, icon("calendar", "tiny"), dayWord(fromKey(p.due)), p.time ? " " + p.time : "") : "",
        p.project ? el("span", { class: "pchip" }, icon("folder", "tiny"), p.project) : "",
        ...p.tags.map(n => el("span", { class: "pchip", style: { "--c": cvar(this.tagColor(n)) } }, "#" + n)),
        p.priority ? el("span", { class: "pchip", style: { "--c": cvar(PRI[p.priority] || "beige") } }, icon("flag", "tiny"), PRI_LABEL[p.priority]) : "");
    });
    inp.addEventListener("keydown", e => {
      if (e.key !== "Enter" || e.isComposing) return;
      if (this.quickAdd(inp.value, ctx)) { inp.value = ""; prev.replaceChildren(); this.render(); $(".add-in", this.body)?.focus(); }
    });
    return el("div", { class: "addbox" }, el("span", { class: "add-ic" }, icon("plus")), inp, prev);
  },
  row(t, g) {
    const late = t.due_date && t.due_date < todayKey() && !t.done;
    const proj = t.project_id && DB.get("projects", t.project_id);
    const meta = [
      t.due_date ? el("span", { class: "m-date" + (late ? " late" : t.due_date === todayKey() ? " today" : "") }, icon("calendar", "tiny"), dayWord(fromKey(t.due_date)), t.due_time ? " " + t.due_time : "") : "",
      proj && this.opts().groupBy !== "project" ? el("span", { class: "m-proj", style: { "--c": cvar(proj.color) } }, el("span", { class: "dot" }), proj.name) : "",
      ...(t.tags || []).filter(n => n !== g?.tag).map(n => el("span", { class: "tagchip sm", style: { "--c": cvar(this.tagColor(n)) } }, "#" + n)),
      t.notes ? el("span", { class: "m-notes", title: t.notes }, icon("text", "tiny")) : "",
    ].filter(Boolean);
    const li = el("li", { class: "task" + (t.done ? " done" : ""), "data-id": t.id },
      el("button", { class: "chk", style: { "--c": cvar(PRI[t.priority] || "beige") }, title: t.done ? "החזרה" : "סיום", onclick: e => { e.stopPropagation(); this.toggle(t, li); } }, icon("check")),
      el("div", { class: "t-main" },
        el("div", { class: "t-title", dir: "auto" }, t.title || "(ללא שם)"),
        meta.length ? el("div", { class: "t-meta" }, meta) : ""));
    li.addEventListener("pointerdown", e => this.onRowDown(e, t, li, g));
    return li;
  },
  onRowDown(e, t, li, g) {
    if (e.button !== 0 || e.target.closest(".chk")) return;
    if (e.pointerType === "touch") { dragTrack(e, { threshold: 8, end: moved => { if (!moved) this.openTask(t); } }); return; }
    let target = null;
    dragTrack(e, {
      threshold: 5,
      move: (dx, dy, ev) => {
        li.classList.add("moving");
        li.style.transform = `translate(${dx}px, ${dy}px)`;
        target = document.elementFromPoint(ev.clientX, ev.clientY)?.closest(".grp");
        $$(".grp.drop", this.body).forEach(x => x.classList.remove("drop"));
        if (target && target.dataset.key !== g?.key) target.classList.add("drop");
      },
      end: moved => {
        if (!moved) return this.openTask(t);
        li.style.transform = ""; li.classList.remove("moving");
        $$(".grp.drop", this.body).forEach(x => x.classList.remove("drop"));
        if (!target || target.dataset.key === g?.key) return this.render();
        this.dropInto(t, g, this.groups(this.filtered()).find(x => x.key === target.dataset.key));
      },
    });
  },
  dropInto(t, from, to) {
    if (!to) return this.render();
    if (to.drop) return DB.patch("tasks", t.id, to.drop);
    if (to.key.startsWith("t:")) {
      const tags = new Set(t.tags || []);
      if (from?.tag) tags.delete(from.tag);
      if (to.tag) tags.add(to.tag); else tags.clear();
      return DB.patch("tasks", t.id, { tags: [...tags] });
    }
    UI.toast("אי אפשר לגרור לקבוצה הזאת");
    this.render();
  },

  /* ---------- task editor ---------- */
  openTask(t0) {
    const id = t0.id;
    const cur = () => DB.get("tasks", id);
    const set = ch => DB.patch("tasks", id, ch);
    const t = cur();
    const title = el("input", { class: "ed-title", value: t.title, dir: "auto", placeholder: "שם המשימה" });
    title.addEventListener("input", debounce(() => set({ title: title.value.trim() }), 300));
    const notes = el("textarea", { class: "inp", rows: 4, placeholder: "הערות, קישורים, פרטים…", dir: "auto" }, t.notes);
    notes.addEventListener("input", debounce(() => set({ notes: notes.value }), 400));
    const date = el("input", { type: "date", class: "inp", value: t.due_date || "", onchange: e => set({ due_date: e.target.value || null }) });
    const time = el("input", { type: "time", class: "inp", value: t.due_time || "", onchange: e => set({ due_time: e.target.value || null, due_date: cur().due_date || (e.target.value ? todayKey() : null) }) });
    const quickDates = el("div", { class: "qd" },
      [["היום", 0], ["מחר", 1], ["בעוד שבוע", 7]].map(([l, n]) => el("button", { class: "tb", onclick: () => { date.value = dkey(addDays(new Date(), n)); set({ due_date: date.value }); } }, l)),
      el("button", { class: "tb", onclick: () => { date.value = ""; time.value = ""; set({ due_date: null, due_time: null }); } }, "בלי תאריך"));
    const priBox = el("div", { class: "seg pri" });
    const drawPri = () => priBox.replaceChildren(...[1, 2, 3, 4].map(p => el("button", {
      class: cur().priority === p ? "on" : "", style: { "--c": cvar(PRI[p] || "beige") },
      onclick: () => { set({ priority: p }); drawPri(); },
    }, icon("flag", "tiny"), PRI_LABEL[p])));
    drawPri();
    const proj = el("select", { class: "inp", onchange: async e => {
      if (e.target.value === "__new") {
        const name = await UI.prompt({ title: "פרויקט חדש" });
        if (name) { const p = this.ensureProject(name); set({ project_id: p.id }); fillProj(); } else fillProj();
      } else set({ project_id: e.target.value || null });
    } });
    const fillProj = () => {
      proj.replaceChildren(el("option", { value: "" }, "תיבה (בלי פרויקט)"), ...this.projects().map(p => el("option", { value: p.id }, p.name)), el("option", { value: "__new" }, "+ פרויקט חדש…"));
      proj.value = cur().project_id || "";
    };
    fillProj();
    const tagWrap = el("div", { class: "tag-edit" });
    const listId = "tagopts-" + id;
    const tagIn = el("input", { class: "inp tag-in", placeholder: "הוספת תגית ואז Enter", list: listId, dir: "auto" });
    const drawTags = () => tagWrap.replaceChildren(
      ...(cur().tags || []).map(n => el("span", { class: "tagchip", style: { "--c": cvar(this.tagColor(n)) } }, "#" + n,
        el("button", { class: "x", title: "הסרה", onclick: () => { set({ tags: cur().tags.filter(x => x !== n) }); drawTags(); } }, icon("x", "tiny")))),
      tagIn, el("datalist", { id: listId }, this.tagList().map(n => el("option", { value: n }))));
    const addTag = () => {
      const n = tagIn.value.trim().replace(/^#/, "").replace(/\s+/g, "_");
      if (!n) return;
      this.ensureTag(n);
      set({ tags: [...new Set([...(cur().tags || []), n])] });
      tagIn.value = ""; drawTags(); tagIn.focus();
    };
    tagIn.addEventListener("keydown", e => { if ((e.key === "Enter" || e.key === ",") && !e.isComposing) { e.preventDefault(); addTag(); } });
    tagIn.addEventListener("change", () => { if (this.tagList().includes(tagIn.value.trim())) addTag(); });
    drawTags();
    const doneBox = el("input", { type: "checkbox", class: "cbox", checked: t.done, onchange: e => set({ done: e.target.checked, done_at: e.target.checked ? new Date().toISOString() : null }) });
    const dlg = UI.dialog(el("div", { class: "editor" },
      el("div", { class: "ed-top" }, el("label", { class: "inline big-check" }, doneBox), title, el("button", { class: "icon-btn", onclick: () => dlg.close() }, icon("x"))),
      el("div", { class: "ed-row" }, icon("calendar"), el("div", { class: "grow" }, el("div", { class: "when-line" }, date, time), quickDates)),
      el("div", { class: "ed-row" }, icon("flag"), priBox),
      el("div", { class: "ed-row" }, icon("folder"), proj),
      el("div", { class: "ed-row" }, icon("tag"), tagWrap),
      el("div", { class: "ed-row" }, icon("text"), notes),
      el("div", { class: "dlg-actions" },
        el("button", { class: "btn ghost danger-text", onclick: () => { const row = cur(); DB.remove("tasks", id); dlg.close(); UI.toast("המשימה נמחקה", { label: "ביטול", fn: () => DB.put("tasks", { ...row, deleted: false }) }); } }, icon("trash"), "מחיקה"),
        el("span", { class: "grow muted small" }, t.created_at ? `נוצרה ${dayWord(new Date(t.created_at))}` : ""),
        el("button", { class: "btn", onclick: () => dlg.close() }, "סיום"))), "wide");
  },

  /* ---------- menus ---------- */
  async addProject() {
    const name = await UI.prompt({ title: "פרויקט חדש", placeholder: "למשל: דוד ילין, LevCatom, בית" });
    if (name) { const p = this.ensureProject(name); this.select("p:" + p.id); }
  },
  async addTag() {
    const name = await UI.prompt({ title: "תגית חדשה", placeholder: "למשל: דחוף, מחשבים, שיחה" });
    if (name) { this.ensureTag(name.replace(/^#/, "").replace(/\s+/g, "_")); DB.emit("tags"); }
  },
  projectMenu(btn, p) {
    UI.menu(btn, [
      { swatches: COLORS, value: p.color, fn: color => DB.patch("projects", p.id, { color }) },
      { label: "שינוי שם", icon: "text", fn: async () => { const name = await UI.prompt({ title: "שם הפרויקט", value: p.name }); if (name) DB.patch("projects", p.id, { name }); } },
      { sep: true },
      { label: "מחיקת הפרויקט", icon: "trash", danger: true, fn: async () => {
        const ts = DB.all("tasks").filter(t => t.project_id === p.id);
        if (!(await UI.confirm({ title: `למחוק את "${p.name}"?`, text: ts.length ? `${ts.length} המשימות שבו יעברו לתיבה.` : "" }))) return;
        for (const t of ts) DB.patch("tasks", t.id, { project_id: null }, { silent: true });
        DB.remove("projects", p.id);
        if (this.ui.base === "p:" + p.id) this.select("all");
      } },
    ]);
  },
  tagMenu(btn, name) {
    const row = this.tagRow(name);
    UI.menu(btn, [
      { swatches: COLORS, value: this.tagColor(name), fn: color => row ? DB.patch("tags", row.id, { color }) : DB.create("tags", { name, color }) },
      { label: "שינוי שם", icon: "text", fn: async () => {
        const nn = (await UI.prompt({ title: "שם התגית", value: name }))?.replace(/^#/, "").replace(/\s+/g, "_");
        if (!nn || nn === name) return;
        for (const t of DB.all("tasks")) if (t.tags?.includes(name)) DB.patch("tasks", t.id, { tags: [...new Set(t.tags.map(x => (x === name ? nn : x)))] }, { silent: true });
        if (row) DB.patch("tags", row.id, { name: nn }, { silent: true });
        for (const o of Object.values(this.ui.opts)) if (o.tagFilter) o.tagFilter = o.tagFilter.map(x => (x === name ? nn : x));
        if (this.ui.base === "t:" + name) this.ui.base = "t:" + nn;
        this.saveUi(); DB.emit("tags");
      } },
      { sep: true },
      { label: "מחיקת התגית", icon: "trash", danger: true, fn: async () => {
        if (!(await UI.confirm({ title: `למחוק את #${name}?`, text: "התגית תוסר מכל המשימות. המשימות עצמן נשארות." }))) return;
        for (const t of DB.all("tasks")) if (t.tags?.includes(name)) DB.patch("tasks", t.id, { tags: t.tags.filter(x => x !== name) }, { silent: true });
        if (row) DB.remove("tags", row.id, { silent: true });
        if (this.ui.base === "t:" + name) this.ui.base = "all";
        this.saveUi(); DB.emit("tags");
      } },
    ]);
  },
  viewMenu(btn, v) {
    UI.menu(btn, [
      { label: "שינוי שם", icon: "text", fn: async () => { const name = await UI.prompt({ title: "שם התצוגה", value: v.name }); if (name) DB.patch("views", v.id, { name }); } },
      { label: "מחיקת התצוגה", icon: "trash", danger: true, fn: () => { DB.remove("views", v.id); if (this.ui.view === v.id) this.select(v.config.base || "all"); } },
    ]);
  },
  async saveView() {
    const config = { base: this.ui.base, opts: structuredClone(this.opts()) };
    if (this.ui.view && DB.get("views", this.ui.view)) {
      DB.patch("views", this.ui.view, { config });
      UI.toast("התצוגה עודכנה");
      return;
    }
    const name = await UI.prompt({ title: "שמירה כתצוגה", placeholder: "למשל: הכנה לשיעורים", value: this.baseTitle() });
    if (!name) return;
    const v = DB.create("views", { name, config, sort: Date.now() });
    this.ui.view = v.id; this.saveUi(); this.render();
  },
};
