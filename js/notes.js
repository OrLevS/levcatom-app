"use strict";
const NOTE_COLORS = ["gold", "sand", "coral", "teal", "beige", "navy"];
const rotOf = id => { let h = 0; for (const c of id) h = (h * 31 + c.charCodeAt(0)) | 0; return ((h % 300) / 100).toFixed(2) / 2; };

function caretOffset(elm) {
  const s = getSelection();
  if (!s.rangeCount || !elm.contains(s.anchorNode)) return 0;
  const r = s.getRangeAt(0), pre = r.cloneRange();
  pre.selectNodeContents(elm);
  pre.setEnd(r.endContainer, r.endOffset);
  return pre.toString().length;
}
function setCaret(elm, off) {
  elm.focus();
  const walker = document.createTreeWalker(elm, NodeFilter.SHOW_TEXT);
  let n, left = off;
  while ((n = walker.nextNode())) {
    if (left <= n.length) { const r = document.createRange(); r.setStart(n, left); r.collapse(true); const s = getSelection(); s.removeAllRanges(); s.addRange(r); return; }
    left -= n.length;
  }
  const r = document.createRange(); r.selectNodeContents(elm); r.collapse(false);
  const s = getSelection(); s.removeAllRanges(); s.addRange(r);
}

const Notes = {
  mount(root) {
    this.flow = isMobile();
    this.board = el("div", { class: "board" + (this.flow ? " flow" : ""), dir: "ltr" });
    this.wrap = el("div", { class: "board-wrap", dir: "ltr" }, this.board);
    this.count = el("span", { class: "cnt-pill" });
    this.root = el("div", { class: "notes" },
      el("header", { class: "bar" },
        el("h1", { class: "bar-title" }, "פתקים"), this.count,
        el("span", { class: "grow" }),
        !this.flow ? el("button", { class: "tb", title: "לסדר את הפתקים בטורים", onclick: () => this.arrange() }, icon("grid", "tiny"), "סידור") : "",
        el("button", { class: "btn add-btn", onclick: () => this.add() }, icon("plus"), el("span", {}, "פתק חדש"))),
      this.wrap);
    root.replaceChildren(this.root);
    this.nodes = new Map();
    this.sync(true);
    this.onResize = debounce(() => { if (isMobile() !== this.flow) this.mount(root); }, 200);
    addEventListener("resize", this.onResize);
  },
  unmount() { removeEventListener("resize", this.onResize); },
  update(t) { if (t === "notes" || t === "*") this.sync(); },

  list() { return DB.all("notes").sort((a, b) => a.y - b.y || b.x - a.x); },
  sync(first = false) {
    if (!this.root?.isConnected) return;
    const notes = this.list();
    const ids = new Set(notes.map(n => n.id));
    for (const [id, node] of this.nodes) if (!ids.has(id)) { node.remove(); this.nodes.delete(id); }
    for (const n of notes) {
      const old = this.nodes.get(n.id);
      if (old && (old.contains(document.activeElement) || old.classList.contains("busy"))) continue;
      if (old && old.dataset.v === n.updated_at) continue;
      const node = this.renderNote(n);
      if (old) old.replaceWith(node); else this.board.append(node);
      this.nodes.set(n.id, node);
    }
    this.count.textContent = notes.length || "";
    if (!notes.length) {
      if (!$(".empty", this.board)) this.board.append(el("div", { class: "empty board-empty", dir: "rtl" },
        el("p", {}, "עוד אין פתקים."), el("button", { class: "btn", onclick: () => this.add() }, "פתק ראשון")));
    } else $(".board-empty", this.board)?.remove();
    this.fit();
    if (first && !this.flow && notes.length) {
      const minX = Math.min(...notes.map(n => n.x));
      this.wrap.scrollLeft = Math.max(0, Math.max(...notes.map(n => n.x + n.w)) - this.wrap.clientWidth + 40);
      if (minX > this.wrap.scrollLeft + this.wrap.clientWidth) this.wrap.scrollLeft = minX - 40;
    }
  },
  fit() {
    if (this.flow) return;
    const ns = DB.all("notes");
    const w = Math.max(this.wrap.clientWidth, ...ns.map(n => n.x + n.w + 300));
    const h = Math.max(this.wrap.clientHeight, ...ns.map(n => n.y + n.h + 300));
    Object.assign(this.board.style, { width: w + "px", height: h + "px" });
  },
  maxZ() { return Math.max(1, ...DB.all("notes").map(n => n.z || 1)); },

  add() {
    const jitter = () => Math.round(Math.random() * 40 - 20);
    const w = 250, h = 240;
    const x = Math.max(16, this.wrap.scrollLeft + this.wrap.clientWidth - w - 60 + jitter());
    const y = Math.max(16, this.wrap.scrollTop + 40 + jitter());
    const colors = DB.all("notes").map(n => n.color);
    const color = NOTE_COLORS.find(c => !colors.includes(c)) || NOTE_COLORS[colors.length % NOTE_COLORS.length];
    const n = DB.create("notes", { x, y, w, h, z: this.maxZ() + 1, color, items: [{ id: uuid(), text: "", check: false, done: false }] }, { silent: true });
    this.sync();
    const node = this.nodes.get(n.id);
    if (this.flow) node.scrollIntoView({ block: "center" });
    $(".sn-title", node)?.focus();
  },
  arrange() {
    const notes = this.list();
    const gap = 22, colW = 270, W = this.wrap.clientWidth;
    const cols = Math.max(1, Math.floor((W - 40) / (colW + gap)));
    const heights = Array(cols).fill(30);
    for (const n of notes) {
      const c = heights.indexOf(Math.min(...heights));
      const x = W - 30 - (c + 1) * (colW + gap) + gap;
      DB.patch("notes", n.id, { x: Math.max(16, x), y: heights[c], w: 250 }, { silent: true });
      heights[c] += n.h + gap;
    }
    this.wrap.scrollTo({ left: 0, top: 0 });
    this.sync();
  },

  renderNote(n) {
    const id = n.id;
    const save = debounce(() => {
      const items = $$(".it", node).map(r => ({ id: r.dataset.iid, text: $(".txt", r).textContent, check: r.classList.contains("check"), done: r.classList.contains("done") }));
      const row = DB.patch("notes", id, { items, title: titleIn.value }, { silent: true });
      if (row) node.dataset.v = row.updated_at;
    }, 350);
    const titleIn = el("input", { class: "sn-title", value: n.title, placeholder: "בלי שם", dir: "auto" });
    titleIn.addEventListener("input", save);
    titleIn.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); const f = $(".txt", node); f ? setCaret(f, f.textContent.length) : addItem(null); } });

    const body = el("div", { class: "sn-body" });
    const itemEl = it => {
      const txt = el("div", { class: "txt", contenteditable: "plaintext-only", dir: "auto", spellcheck: "true" }, it.text);
      const row = el("div", { class: `it${it.check ? " check" : ""}${it.done ? " done" : ""}`, "data-iid": it.id || uuid() },
        el("button", { class: "box", tabindex: -1, title: "סימון", onclick: () => { row.classList.toggle("done"); save(); } }, icon("check")),
        el("span", { class: "bullet" }),
        txt);
      txt.addEventListener("input", () => {
        const m = txt.textContent.match(/^(?:- )?\[ ?\] ?/);
        if (m) {
          const off = caretOffset(txt);
          txt.textContent = txt.textContent.slice(m[0].length);
          row.classList.add("check");
          setCaret(txt, Math.max(0, off - m[0].length));
        }
        save();
      });
      txt.addEventListener("keydown", e => onKey(e, row, txt));
      txt.addEventListener("paste", e => {
        const text = e.clipboardData.getData("text/plain");
        if (!text.includes("\n")) return;
        e.preventDefault();
        const lines = text.replace(/\r/g, "").split("\n");
        document.execCommand("insertText", false, lines.shift());
        let after = row;
        for (const l of lines) {
          const m = l.match(/^\s*(?:[-*•]\s*)?(\[( |x)?\]\s*)?(.*)$/i);
          const r2 = itemEl({ text: m[3], check: !!m[1] || row.classList.contains("check"), done: m[2]?.toLowerCase() === "x" });
          after.after(r2); after = r2;
        }
        save();
      });
      return row;
    };
    const addItem = (afterRow, text = "", check = null) => {
      const check0 = check ?? (afterRow ? afterRow.classList.contains("check") : $$(".it", body).at(-1)?.classList.contains("check") || false);
      const r = itemEl({ text, check: check0, done: false });
      afterRow ? afterRow.after(r) : body.append(r);
      setCaret($(".txt", r), 0);
      save();
      return r;
    };
    const onKey = (e, row, txt) => {
      if (e.isComposing) return;
      const off = caretOffset(txt), len = txt.textContent.length;
      const collapsed = getSelection().isCollapsed;
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        if (!len && row.classList.contains("check")) { row.classList.remove("check", "done"); save(); return; }
        const rest = txt.textContent.slice(off);
        txt.textContent = txt.textContent.slice(0, off);
        addItem(row, rest);
      } else if (e.key === "Backspace" && collapsed && off === 0) {
        if (row.classList.contains("check")) { e.preventDefault(); row.classList.remove("check", "done"); save(); return; }
        const prev = row.previousElementSibling;
        if (!prev) {
          if (!len && row.nextElementSibling) { e.preventDefault(); const nx = $(".txt", row.nextElementSibling); row.remove(); setCaret(nx, 0); save(); }
          return;
        }
        e.preventDefault();
        const pt = $(".txt", prev), at = pt.textContent.length;
        pt.textContent += txt.textContent;
        row.remove();
        setCaret(pt, at);
        save();
      } else if (e.key === "ArrowUp" && off === 0 && row.previousElementSibling) {
        e.preventDefault(); const p = $(".txt", row.previousElementSibling); setCaret(p, p.textContent.length);
      } else if (e.key === "ArrowDown" && off === len && row.nextElementSibling) {
        e.preventDefault(); setCaret($(".txt", row.nextElementSibling), 0);
      }
    };
    for (const it of n.items || []) body.append(itemEl(it));

    const toggleChecks = () => {
      const focused = document.activeElement?.closest?.(".it");
      if (focused && node.contains(focused)) { focused.classList.toggle("check"); focused.classList.remove("done"); }
      else {
        const rows = $$(".it", body);
        if (!rows.length) { addItem(null, "", true); return; }
        const anyPlain = rows.some(r => !r.classList.contains("check"));
        rows.forEach(r => { r.classList.toggle("check", anyPlain); if (!anyPlain) r.classList.remove("done"); });
      }
      save();
    };
    const menu = btn => UI.menu(btn, [
      { swatches: NOTE_COLORS, value: n.color, fn: color => { node.style.setProperty("--nc", cvar(color)); DB.patch("notes", id, { color }, { silent: true }); n.color = color; } },
      { label: "הסרת השורות שסומנו", icon: "check", fn: () => { $$(".it.done", body).forEach(r => r.remove()); save(); } },
      { sep: true },
      { label: "מחיקת הפתק", icon: "trash", danger: true, fn: () => {
        const row = DB.get("notes", id);
        DB.remove("notes", id);
        UI.toast("הפתק נמחק", { label: "ביטול", fn: () => DB.put("notes", { ...row, deleted: false }) });
      } },
    ]);
    const keepFocus = e => e.preventDefault();
    const head = el("header", { class: "sn-head" },
      titleIn,
      el("button", { class: "icon-btn sm", title: "תיבת סימון לשורה (או לכל הפתק)", onmousedown: keepFocus, onclick: toggleChecks }, icon("checkbox")),
      el("button", { class: "icon-btn sm", title: "צבע ומחיקה", onclick: e => menu(e.currentTarget) }, icon("dots")));

    const node = el("article", {
      class: "sticky", "data-id": id, "data-v": n.updated_at,
      style: { left: n.x + "px", top: n.y + "px", width: n.w + "px", height: n.h + "px", zIndex: n.z || 1, "--nc": cvar(n.color), "--rot": rotOf(id) + "deg" },
    },
      head, body,
      el("button", { class: "sn-add", onclick: () => addItem($$(".it", body).at(-1) || null) }, icon("plus", "tiny"), "שורה"),
      el("div", { class: "sn-rs", title: "שינוי גודל" }));
    body.addEventListener("click", e => { if (e.target === body) { const last = $$(".txt", body).at(-1); last ? setCaret(last, last.textContent.length) : addItem(null); } });

    /* front, drag, resize */
    const front = () => {
      const top = this.maxZ();
      const cur = DB.get("notes", id);
      if (cur && (cur.z || 1) < top) { node.style.zIndex = top + 1; DB.patch("notes", id, { z: top + 1 }, { silent: true }); }
    };
    node.addEventListener("pointerdown", () => { if (!this.flow) front(); }, true);
    head.addEventListener("pointerdown", e => {
      if (this.flow || e.button !== 0 || e.target.closest("button")) return;
      if (e.target === titleIn && document.activeElement === titleIn) return;
      if (e.target === titleIn) e.preventDefault();
      const x0 = parseFloat(node.style.left), y0 = parseFloat(node.style.top);
      let x = x0, y = y0;
      node.classList.add("busy");
      dragTrack(e, {
        threshold: 4,
        move: (dx, dy) => { node.classList.add("lifted"); x = Math.max(0, x0 + dx); y = Math.max(0, y0 + dy); node.style.left = x + "px"; node.style.top = y + "px"; },
        end: moved => {
          node.classList.remove("busy", "lifted");
          if (moved) { DB.patch("notes", id, { x, y }, { silent: true }); this.fit(); }
          else if (e.target === titleIn) titleIn.focus();
        },
      });
    });
    $(".sn-rs", node).addEventListener("pointerdown", e => {
      if (e.button !== 0) return;
      e.preventDefault(); e.stopPropagation();
      const x0 = parseFloat(node.style.left), w0 = node.offsetWidth, h0 = node.offsetHeight;
      let x = x0, w = w0, h = h0;
      node.classList.add("busy");
      dragTrack(e, {
        threshold: 1,
        move: (dx, dy) => {
          w = Math.max(180, w0 - dx); x = Math.max(0, x0 + (w0 - w)); h = Math.max(140, h0 + dy);
          Object.assign(node.style, { left: x + "px", width: w + "px", height: h + "px" });
        },
        end: () => { node.classList.remove("busy"); DB.patch("notes", id, { x, w, h }, { silent: true }); this.fit(); },
      });
    });
    return node;
  },
};
