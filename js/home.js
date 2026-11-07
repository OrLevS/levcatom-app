"use strict";
const Home = {
  day: null,
  mount(root) {
    this.day = startOfDay(new Date());
    this.clock = el("h1", { class: "clock" });
    this.date = el("p", { class: "date" });
    this.greet = el("p", { class: "greet" });
    const search = !isMobile() ? el("form", { class: "search", action: "https://www.google.com/search", method: "get", role: "search" },
      icon("search"), el("input", { name: "q", placeholder: "לחפש בגוגל או להקליד כתובת", autocomplete: "off", dir: "auto" })) : "";
    if (search) search.addEventListener("submit", e => {
      const v = search.q.value.trim();
      if (/^(https?:\/\/)?[\w-]+(\.[\w-]+)+(\/\S*)?$/i.test(v) && !/\s/.test(v)) { e.preventDefault(); location.href = /^https?:/i.test(v) ? v : "https://" + v; }
    });
    this.cal = el("article", { class: "card home-cal" });
    this.tasks = el("article", { class: "card home-tasks" });
    this.notes = el("article", { class: "card home-notes" });
    this.root = el("div", { class: "home" },
      el("section", { class: "hero" }, this.date, this.clock, this.greet, search),
      /* in Chrome's new tab the home screen skips the notes card */
      el("div", { class: "home-grid" + (IS_EXT ? " two" : "") }, this.tasks, this.cal, IS_EXT ? "" : this.notes));
    root.replaceChildren(this.root);
    this.tick();
    this.render();
    this.t = setInterval(() => this.tick(), 10000);
  },
  unmount() { clearInterval(this.t); },
  update(t) { if (["events", "calendars", "tasks", "notes", "tags", "projects", "*"].includes(t)) this.render(); },
  tick() {
    const now = new Date(), h = now.getHours();
    this.clock.textContent = hhmm(now);
    this.date.textContent = `${fullDate(now)} · ${hebDate.format(now)}`;
    this.greet.textContent = (h >= 5 && h < 12 ? "בוקר טוב" : h < 17 && h >= 12 ? "צהריים טובים" : h >= 17 && h < 21 ? "ערב טוב" : "לילה טוב") + ", אורלב";
  },
  render() {
    if (!this.root?.isConnected) return;
    this.renderCal(); this.renderTasks(); if (!IS_EXT) this.renderNotes();
  },
  renderCal() {
    const d = this.day, now = new Date();
    const occs = Cal.occurrences(d, addDays(d, 1));
    const allDay = occs.filter(o => o.allDay || o.end - o.start >= 864e5), timed = occs.filter(o => !allDay.includes(o));
    this.cal.replaceChildren(
      el("header", {},
        el("h2", { class: "c-teal" }, "יומן"),
        el("div", { class: "daynav" },
          el("button", { class: "icon-btn sm", title: "יום קודם", onclick: () => { this.day = addDays(d, -1); this.renderCal(); } }, icon("chevR")),
          el("button", { class: "daylabel" + (sameDay(d, now) ? " today" : ""), title: "חזרה להיום", onclick: () => { this.day = startOfDay(new Date()); this.renderCal(); } }, `${dayWord(d)} · ${d.getDate()}.${d.getMonth() + 1}`),
          el("button", { class: "icon-btn sm", title: "יום הבא", onclick: () => { this.day = addDays(d, 1); this.renderCal(); } }, icon("chevL")))),
      allDay.length ? el("div", { class: "allday" }, allDay.map(o => el("button", { class: "ad", style: { "--c": cvar(Cal.colorOf(o.ev)) }, onclick: () => Cal.openEditor(o) }, o.ev.title || "(ללא שם)"))) : "",
      el("div", { class: "scroll" }, timed.length ? timed.map(o => el("button", {
        class: "row ev-row" + (o.end < now ? " past" : o.start <= now && o.end > now ? " now" : ""), style: { "--c": cvar(Cal.colorOf(o.ev)) },
        onclick: () => Cal.openEditor(o),
      }, el("span", { class: "bar-c" }),
        el("span", { class: "main" }, el("span", { class: "t1", dir: "auto" }, o.ev.title || "(ללא שם)"), o.ev.location ? el("span", { class: "t2", dir: "auto" }, o.ev.location) : ""),
        el("span", { class: "side" }, `${hhmm(o.start)}–${hhmm(o.end)}`)))
        : !allDay.length ? el("div", { class: "state" }, "יום פנוי ביומן.") : ""),
      el("footer", {},
        el("button", { class: "tb", onclick: () => Cal.newEvent(atMinutes(d, Math.min(22, now.getHours() + 1) * 60), atMinutes(d, Math.min(23, now.getHours() + 2) * 60)) }, icon("plus", "tiny"), "אירוע"),
        el("a", { class: "more", href: "#calendar" }, "ליומן המלא ←")));
  },
  renderTasks() {
    const t0 = todayKey(), t1 = dkey(addDays(new Date(), 1));
    const open = DB.all("tasks").filter(t => !t.done && t.due_date && t.due_date <= t1).sort(Tasks.sortFn("due"));
    /* a subtask is drawn under its parent when the parent is also listed */
    const ids = new Set(open.map(t => t.id));
    const top = open.filter(t => !t.parent_id || !ids.has(t.parent_id));
    const today = top.filter(t => t.due_date <= t0), tomorrow = top.filter(t => t.due_date === t1);
    const rows = list => list.flatMap(t => [Tasks.row(t), ...open.filter(s => s.parent_id === t.id).map(s => Tasks.row(s, null, { nested: true }))]);
    const inp = el("input", { class: "inp add-in", placeholder: "משימה להיום… (או ״מחר״, #תגית, @פרויקט, !1)", dir: "auto", autocomplete: "off" });
    inp.addEventListener("keydown", e => {
      if (e.key !== "Enter" || e.isComposing) return;
      if (Tasks.quickAdd(inp.value, { due: t0 })) { inp.value = ""; this.renderTasks(); $(".home-tasks .add-in")?.focus(); }
    });
    this.tasks.replaceChildren(
      el("header", {}, el("h2", { class: "c-coral" }, "מה היום?"), today.length ? el("span", { class: "cnt-pill" }, today.length) : "", el("a", { class: "more", href: "#tasks" }, "לכל המשימות ←")),
      el("div", { class: "scroll" },
        el("ul", { class: "tlist" }, today.length ? rows(today) : el("li", { class: "state" }, "אין משימות להיום. יום נקי!")),
        tomorrow.length ? el("h3", { class: "day-h" }, "מחר", el("span", { class: "cnt" }, tomorrow.length)) : "",
        tomorrow.length ? el("ul", { class: "tlist tomorrow" }, rows(tomorrow)) : ""),
      el("footer", {}, inp));
  },
  renderNotes() {
    const notes = DB.all("notes").sort((a, b) => b.updated_at.localeCompare(a.updated_at)).slice(0, 4);
    this.notes.replaceChildren(
      el("header", {}, el("h2", { class: "c-sand" }, "פתקים"),
        el("a", { class: "more", href: "#notes" }, "ללוח הפתקים ←")),
      el("div", { class: "mini-notes" }, notes.length ? notes.map(n => el("a", { class: "mn", href: "#notes", style: { "--nc": cvar(n.color), "--rot": rotOf(n.id) + "deg" } },
        el("b", { dir: "auto" }, n.title || "בלי שם"),
        el("ul", {}, (n.items || []).filter(i => i.text).slice(0, 4).map(i => el("li", { class: (i.check ? "ck" : "") + (i.done ? " dn" : ""), dir: "auto" }, i.text)))))
        : el("div", { class: "state" }, "עוד אין פתקים.")),
      el("footer", {}, el("button", { class: "tb", onclick: () => { location.hash = "#notes"; setTimeout(() => Notes.add(), 50); } }, icon("plus", "tiny"), "פתק חדש")));
  },
};
