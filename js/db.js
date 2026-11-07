"use strict";
/* Supabase connection + local-first store with an outbox.
   Every change is applied locally at once, saved to localStorage,
   then sent to Supabase. If offline, it waits and retries. */
const SB_URL = "https://swfgkaesxhixrmvfmofx.supabase.co";
const SB_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN3ZmdrYWVzeGhpeHJtdmZtb2Z4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQwNTM4OTAsImV4cCI6MjEwOTYyOTg5MH0.7vQBIoe0hqV2mClSXDUknJS_xFcXBtR7fPDOyjsQbiw";
const sb = supabase.createClient(SB_URL, SB_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: "lc-auth" },
});
const TABLES = ["calendars", "events", "projects", "tags", "tasks", "views", "notes"];

/* full default rows, so bulk upserts never send missing columns */
const DEFAULTS = {
  calendars: () => ({ name: "", color: "teal", visible: true, sort: Date.now() }),
  events: () => ({ calendar_id: null, title: "", notes: "", location: "", start_at: null, end_at: null, all_day: false, rrule: null, exdates: [] }),
  projects: () => ({ name: "", color: "coral", sort: Date.now() }),
  tags: () => ({ name: "", color: "sand" }),
  tasks: () => ({ project_id: null, title: "", notes: "", tags: [], due_date: null, due_time: null, priority: 4, done: false, done_at: null, sort: Date.now(), created_at: new Date().toISOString() }),
  views: () => ({ name: "", config: {}, sort: Date.now() }),
  notes: () => ({ title: "", color: "gold", x: 40, y: 40, w: 250, h: 240, z: 1, items: [] }),
};

const DB = {
  user: null,
  data: Object.fromEntries(TABLES.map(t => [t, new Map()])),
  outbox: new Map(),
  listeners: new Set(),
  status: "saved",
  statusListeners: new Set(),

  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); },
  emit(t) { for (const fn of this.listeners) { try { fn(t); } catch (e) { console.error(e); } } },
  setStatus(s) { if (this.status !== s) { this.status = s; for (const fn of this.statusListeners) fn(s); } },

  all(t) { return [...this.data[t].values()]; },
  get(t, id) { return this.data[t].get(id); },

  /* create a new row with defaults */
  create(t, fields = {}, opts) {
    const row = { ...DEFAULTS[t](), ...fields, id: fields.id || uuid(), user_id: this.user.id, deleted: false };
    return this.put(t, row, opts);
  },
  put(t, row, { silent = false } = {}) {
    row = { ...row, updated_at: new Date().toISOString() };
    this.data[t].set(row.id, row);
    this.outbox.set(`${t}:${row.id}`, { t, row });
    this.saveCache();
    if (!silent) this.emit(t);
    this.flushSoon();
    return row;
  },
  patch(t, id, changes, opts) {
    const cur = this.get(t, id);
    if (!cur) return null;
    return this.put(t, { ...cur, ...changes }, opts);
  },
  remove(t, id, { silent = false } = {}) {
    const cur = this.get(t, id);
    if (!cur) return;
    this.data[t].delete(id);
    this.outbox.set(`${t}:${id}`, { t, row: { ...cur, deleted: true, updated_at: new Date().toISOString() } });
    this.saveCache();
    if (!silent) this.emit(t);
    this.flushSoon();
  },

  /* ---- local cache ---- */
  cacheKey() { return "lc-data-" + this.user.id; },
  loadCache() {
    try {
      const raw = JSON.parse(localStorage.getItem(this.cacheKey()) || "null");
      if (!raw) return false;
      for (const t of TABLES) this.data[t] = new Map((raw.data[t] || []).map(r => [r.id, r]));
      this.outbox = new Map(raw.outbox || []);
      return true;
    } catch { return false; }
  },
  saveCache: debounce(function () {
    if (!DB.user) return;
    try {
      localStorage.setItem(DB.cacheKey(), JSON.stringify({
        data: Object.fromEntries(TABLES.map(t => [t, DB.all(t)])),
        outbox: [...DB.outbox],
      }));
    } catch (e) { console.warn("cache", e); }
  }, 250),

  /* ---- server ---- */
  flushSoon: debounce(() => DB.flush(), 500),
  async flush() {
    if (this.local) return;
    if (this.flushing || !this.user || !this.outbox.size) return;
    if (!navigator.onLine) { this.setStatus("offline"); return; }
    this.flushing = true;
    this.setStatus("saving");
    try {
      while (this.outbox.size) {
        const byT = {};
        for (const [k, v] of this.outbox) (byT[v.t] ||= []).push([k, v]);
        for (const [t, list] of Object.entries(byT)) {
          const { error } = await sb.from(t).upsert(list.map(([, v]) => v.row), { defaultToNull: false });
          if (error) {
            if (!error.code || /fetch|network/i.test(error.message)) throw error;
            console.error("save failed", t, error);
          }
          for (const [k, v] of list) if (this.outbox.get(k) === v) this.outbox.delete(k);
        }
      }
      this.setStatus("saved");
    } catch (e) {
      console.warn("offline, will retry", e);
      this.setStatus("offline");
      clearTimeout(this.retryT);
      this.retryT = setTimeout(() => this.flush(), 8000);
    } finally {
      this.flushing = false;
      this.saveCache();
    }
  },
  async selectAll(t) {
    const out = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await sb.from(t).select("*").eq("deleted", false).range(from, from + 999);
      if (error) throw error;
      out.push(...data);
      if (data.length < 1000) return out;
    }
  },
  async pull() {
    if (this.local) { this.lastPull = Date.now(); return; }
    if (!this.user || !navigator.onLine) return;
    try {
      const rows = await Promise.all(TABLES.map(t => this.selectAll(t)));
      TABLES.forEach((t, i) => {
        const m = new Map(rows[i].map(r => [r.id, r]));
        for (const { t: tt, row } of this.outbox.values()) if (tt === t) row.deleted ? m.delete(row.id) : m.set(row.id, row);
        this.data[t] = m;
      });
      this.lastPull = Date.now();
      this.saveCache();
      this.emit("*");
    } catch (e) { console.warn("pull failed", e); this.setStatus("offline"); }
  },
  subscribe() {
    if (this.local) return;
    if (this.channel) sb.removeChannel(this.channel);
    this.channel = sb.channel("db-" + this.user.id);
    for (const t of TABLES) {
      this.channel.on("postgres_changes", { event: "*", schema: "public", table: t }, p => this.applyRemote(t, p));
    }
    this.channel.subscribe();
  },
  applyRemote(t, p) {
    const row = p.new && p.new.id ? p.new : null;
    const id = row?.id || p.old?.id;
    if (!id || this.outbox.has(`${t}:${id}`)) return;
    const cur = this.data[t].get(id);
    if (!row || row.deleted) { if (!cur) return; this.data[t].delete(id); }
    else {
      if (cur && cur.updated_at >= row.updated_at) return;
      this.data[t].set(id, row);
    }
    this.saveCache();
    this.emit(t);
  },

  async start(user) {
    this.user = user;
    const had = this.loadCache();
    if (had) this.emit("*");
    await this.pull();
    this.subscribe();
    this.flush();
    await this.seed();
  },
  stop() {
    if (this.channel) sb.removeChannel(this.channel);
    this.channel = null;
    this.user = null;
    for (const t of TABLES) this.data[t] = new Map();
    this.outbox = new Map();
  },
  async seed() {
    if (!this.all("calendars").length && this.lastPull) {
      this.create("calendars", { name: "אישי", color: "teal", sort: 1 });
      this.create("calendars", { name: "הוראה", color: "coral", sort: 2 });
    }
  },
};

window.addEventListener("online", () => { DB.flush(); DB.pull(); });
window.addEventListener("offline", () => DB.setStatus("offline"));
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && DB.user && Date.now() - (DB.lastPull || 0) > 20000) { DB.pull(); DB.flush(); }
});
