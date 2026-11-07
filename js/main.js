"use strict";
const APP_URL = "https://orlevs.github.io/levcatom-app/";
const VIEWS = { home: Home, calendar: Cal, tasks: Tasks, notes: Notes };
const NAV = [["home", "בית", "home"], ["calendar", "יומן", "calendar"], ["tasks", "משימות", "tasks"], ["notes", "פתקים", "notes"]];
let current = null;

function route() {
  if (!DB.user) return;
  const [name, ...params] = (location.hash.slice(1) || "home").split("/");
  const v = VIEWS[name] ? name : "home";
  if (current) VIEWS[current].unmount?.();
  $(".pop")?.remove();
  current = v;
  document.body.dataset.view = v;
  VIEWS[v].mount($("#view"), params);
  drawNav();
  document.title = IS_EXT && v === "home" ? "טאב חדש" : `${NAV.find(n => n[0] === v)[1]} · LevCatom`;
}
function drawNav() {
  const statusIc = { saved: ["check", "הכל שמור"], saving: ["sync", "שומר…"], offline: ["cloudOff", "אין חיבור. נשמר במכשיר ויסתנכרן כשיחזור"] }[DB.status];
  $("#nav").replaceChildren(
    el("a", { class: "brand", href: "#home", title: "LevCatom" }, el("img", { src: "icons/icon48.png", alt: "LevCatom" })),
    el("div", { class: "nav-items" }, NAV.map(([k, l, ic]) => el("a", { class: "nav-item" + (k === current ? " on" : ""), href: "#" + k }, icon(ic), el("span", {}, l)))),
    el("div", { class: "nav-foot" },
      el("span", { class: "sync " + DB.status, title: statusIc[1] }, icon(statusIc[0])),
      el("button", { class: "icon-btn", title: "חשבון", onclick: e => UI.menu(e.currentTarget, [
        { label: DB.user?.email || "", icon: "user", fn: () => {} },
        IS_EXT ? { label: "פתיחה בטלפון: " + APP_URL.replace("https://", ""), icon: "layers", fn: () => window.open(APP_URL, "_blank") } : null,
        { sep: true },
        { label: "יציאה מהחשבון", icon: "logout", fn: () => sb.auth.signOut() },
      ]) }, icon("user"))));
}
DB.on(t => { if (current) VIEWS[current].update?.(t); });
DB.statusListeners.add(() => { if (DB.user) drawNav(); });
addEventListener("hashchange", route);

/* ---------- auth ---------- */
function showAuth() {
  $("#shell").hidden = true;
  const box = $("#auth");
  box.hidden = false;
  let mode = "in";
  const email = el("input", { class: "inp", type: "email", placeholder: "אימייל", autocomplete: "email", dir: "ltr", required: true });
  const pass = el("input", { class: "inp", type: "password", placeholder: "סיסמה (לפחות 6 תווים)", autocomplete: "current-password", dir: "ltr", required: true, minlength: 6 });
  const msg = el("p", { class: "auth-msg" });
  const btn = el("button", { class: "btn wide" }, "כניסה");
  const tabs = el("div", { class: "seg" });
  const drawTabs = () => {
    tabs.replaceChildren(
      el("button", { type: "button", class: mode === "in" ? "on" : "", onclick: () => { mode = "in"; drawTabs(); } }, "כניסה"),
      el("button", { type: "button", class: mode === "up" ? "on" : "", onclick: () => { mode = "up"; drawTabs(); } }, "חשבון חדש"));
    btn.textContent = mode === "in" ? "כניסה" : "יצירת חשבון";
    pass.autocomplete = mode === "in" ? "current-password" : "new-password";
    msg.textContent = "";
  };
  drawTabs();
  const form = el("form", { class: "auth-form" }, tabs, email, pass, btn, msg,
    el("button", { type: "button", class: "linkish", onclick: async () => {
      if (!email.value) { msg.textContent = "קודם לכתוב את האימייל למעלה."; return; }
      const { error } = await sb.auth.resetPasswordForEmail(email.value, { redirectTo: APP_URL });
      msg.textContent = error ? "לא הצלחתי לשלוח. לנסות שוב בעוד רגע." : "שלחתי קישור לאיפוס סיסמה למייל.";
    } }, "שכחתי סיסמה"));
  form.addEventListener("submit", async e => {
    e.preventDefault();
    btn.disabled = true; msg.textContent = "רגע…";
    const creds = { email: email.value.trim(), password: pass.value };
    const { data, error } = mode === "in"
      ? await sb.auth.signInWithPassword(creds)
      : await sb.auth.signUp({ ...creds, options: { emailRedirectTo: APP_URL } });
    btn.disabled = false;
    if (error) {
      msg.textContent = /invalid login/i.test(error.message) ? "האימייל או הסיסמה לא נכונים."
        : /not confirmed/i.test(error.message) ? "צריך קודם ללחוץ על הקישור שנשלח למייל."
        : /already registered/i.test(error.message) ? "כבר יש חשבון עם המייל הזה. אפשר להיכנס."
        : /network|fetch/i.test(error.message) ? "אין חיבור לאינטרנט."
        : error.message;
      return;
    }
    if (mode === "up" && !data.session) msg.textContent = "כמעט! שלחתי לך מייל אישור. לוחצים על הקישור, חוזרים לכאן ונכנסים.";
  });
  box.replaceChildren(el("div", { class: "auth-card" },
    el("img", { class: "auth-logo", src: "icons/icon128.png", alt: "" }),
    el("h1", {}, "LevCatom"),
    el("p", { class: "muted" }, "היומן, המשימות והפתקים שלך. בטלפון ובמחשב, מאותו מקום."),
    form));
  email.focus();
}
async function startApp(user) {
  if (DB.user?.id === user.id) return;
  $("#auth").hidden = true;
  $("#shell").hidden = false;
  DB.user = user;
  route();
  await DB.start(user);
}
(async () => {
  /* local preview only: ?demo on localhost runs without an account and without the server */
  if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname) && new URLSearchParams(location.search).has("demo")) {
    DB.local = true;
    return startApp({ id: "demo-user", email: "תצוגה מקומית" });
  }
  const { data: { session } } = await sb.auth.getSession();
  if (session) startApp(session.user); else showAuth();
  sb.auth.onAuthStateChange((ev, s) => {
    if (s?.user && (ev === "SIGNED_IN" || ev === "INITIAL_SESSION")) startApp(s.user);
    if (ev === "SIGNED_OUT") { DB.stop(); current && VIEWS[current].unmount?.(); current = null; showAuth(); }
  });
})();

if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
