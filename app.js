/* Carnet de musculation — application web hors ligne, données synchronisées dans un dépôt GitHub privé. */
"use strict";

// ============================================================ Constantes
const APP_VERSION = "1.0.0";
const LS_KEYS = { db: "cm.db", meta: "cm.meta", cfg: "cm.cfg", draft: "cm.draft" };
const DIFF = [
  { v: 1, t: "Très facile", c: "#16a34a" },
  { v: 2, t: "Facile", c: "#65a30d" },
  { v: 3, t: "Correct", c: "#ca8a04" },
  { v: 4, t: "Dur", c: "#ea580c" },
  { v: 5, t: "Max", c: "#dc2626" }
];
const DEFAULT_CFG = {
  owner: "Hiluluk-Elerias",
  repo: "Carnet-de-musculation-data",
  branch: "main",
  token: "",
  poidsCorps: 70,
  barres: [{ nom: "Barre droite", poids: 20 }, { nom: "Barre EZ", poids: 10 }],
  disques: [20, 15, 10, 5, 2.5, 1.25],
  son: true
};

// ============================================================ Petits outils
const $ = (s, root = document) => root.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const num = (v) => { const n = parseFloat(String(v ?? "").replace(",", ".")); return Number.isFinite(n) ? n : 0; };
const fmt = (x, d = 2) => { const p = Math.pow(10, d); return (Math.round(num(x) * p) / p).toString().replace(".", ","); };
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const todayISO = () => { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
const dateLong = (iso) => iso ? new Date(iso + "T12:00:00").toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short", year: "numeric" }) : "";
const dateShort = (iso) => iso ? new Date(iso + "T12:00:00").toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" }) : "";
const slug = (s) => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "exo";
const dur = (sec) => { sec = Math.max(0, Math.round(sec)); const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60; return h ? `${h} h ${String(m).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`; };
const restLabel = (s) => { s = num(s); return s >= 60 ? `${Math.floor(s / 60)} min${s % 60 ? " " + (s % 60) : ""}` : `${s} s`; };
function lsGet(k, fallback) { try { const v = JSON.parse(localStorage.getItem(k)); return v ?? fallback; } catch (e) { return fallback; } }
function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { toast("Stockage du téléphone plein ou indisponible."); } }
function toast(msg) { const t = document.createElement("div"); t.className = "toast"; t.setAttribute("role", "status"); t.textContent = msg; document.body.appendChild(t); setTimeout(() => t.remove(), 2800); }

// ============================================================ État
let CFG = Object.assign({}, DEFAULT_CFG, lsGet(LS_KEYS.cfg, {}));
let DB = lsGet(LS_KEYS.db, { exercices: [], programmes: [], seances: [] });
let META = Object.assign({ modIds: [], delIds: [], dirtyProg: false, lastSync: 0, lastError: "" }, lsGet(LS_KEYS.meta, {}));
let DRAFT = lsGet(LS_KEYS.draft, null);
const UI = { route: "accueil", param: null, progEdit: null, syncing: false, syncAgain: false, syncText: "" };

function saveDB() { lsSet(LS_KEYS.db, DB); lsSet(LS_KEYS.meta, META); }
function saveCfg() { lsSet(LS_KEYS.cfg, CFG); }
function saveDraft() { lsSet(LS_KEYS.draft, DRAFT); }
const exo = (id) => DB.exercices.find((e) => e.id === id) || { id, nom: id, mode: "charge", min: 8, max: 12, incr: 2, repos: 90, unite: "" };
const sortedSeances = () => DB.seances.slice().sort((a, b) => (b.date || "").localeCompare(a.date || "") || (b.num || 0) - (a.num || 0));
const nextNum = () => DB.seances.reduce((m, s) => Math.max(m, s.num || 0), 0) + 1;

// ============================================================ Calculs (charges, records, progression)
/** Charge affichée : pour un exercice au poids du corps, 0 = poids du corps, positif = lest, négatif = assistance. */
function kgLabel(kg, e) {
  if (kg === null || kg === undefined || kg === "") return "—";
  const k = num(kg);
  if (e.mode === "corps") return k === 0 ? "PdC" : k > 0 ? `PdC +${fmt(k)}` : `PdC −${fmt(-k)}`;
  return `${fmt(k)} kg`;
}
const effLoad = (kg, e) => (e.mode === "corps" ? num(CFG.poidsCorps) + num(kg) : num(kg));
const e1rm = (kg, reps, e) => { const L = effLoad(kg, e); const r = num(reps); return r > 0 && L > 0 ? L * (1 + r / 30) : 0; };
const workSets = (x) => (x.series || []).filter((s) => s.t !== "E");
function exoVolume(x, e) { return workSets(x).reduce((t, s) => t + effLoad(s.kg, e) * num(s.reps), 0); }
function seanceVolume(s) { return (s.exercices || []).reduce((t, x) => t + exoVolume(x, exo(x.exo)), 0); }

/** Historique d'un exercice, du plus ancien au plus récent. */
function historyOf(exoId, seances = DB.seances) {
  return seances.filter((s) => (s.exercices || []).some((x) => x.exo === exoId && workSets(x).length))
    .sort((a, b) => (a.date || "").localeCompare(b.date || "") || (a.num || 0) - (b.num || 0))
    .map((s) => ({ s, x: s.exercices.find((x) => x.exo === exoId && workSets(x).length) }));
}
function bestOf(exoId, seances = DB.seances) {
  const e = exo(exoId);
  const r = { e1rm: 0, e1rmSet: null, maxKg: -Infinity, maxKgSet: null, volSeance: 0, maxReps: 0 };
  for (const { s, x } of historyOf(exoId, seances)) {
    for (const st of workSets(x)) {
      const v = e1rm(st.kg, st.reps, e);
      if (v > r.e1rm) { r.e1rm = v; r.e1rmSet = { ...st, date: s.date }; }
      if (num(st.kg) > r.maxKg || (num(st.kg) === r.maxKg && num(st.reps) > num(r.maxKgSet?.reps))) { r.maxKg = num(st.kg); r.maxKgSet = { ...st, date: s.date }; }
      r.maxReps = Math.max(r.maxReps, num(st.reps));
    }
    r.volSeance = Math.max(r.volSeance, exoVolume(x, e));
  }
  return r;
}

/** Double progression : difficulté ≤ 3 → reps jusqu'au haut de la fourchette puis + charge ; 4 → on consolide ; 5 → on allège. */
function suggest(exoId, defaultSets) {
  const e = exo(exoId);
  const h = historyOf(exoId);
  const last = h.length ? h[h.length - 1] : null;
  if (!last) return { kg: 0, reps: e.min, n: defaultSets || 3, consigne: "Première fois : choisis une charge que tu tiens proprement.", last: null };
  const ws = workSets(last.x);
  const kg = Math.max(...ws.map((s) => num(s.kg)));
  const atKg = ws.filter((s) => num(s.kg) === kg);
  const reps = Math.min(...atKg.map((s) => num(s.reps)));
  const d = num(last.x.difficulte) || 3;
  const n = defaultSets || ws.length;
  let out;
  if (d >= 5) out = { kg: kg - e.incr, reps: e.min, consigne: "Trop dur la dernière fois : on allège." };
  else if (d === 4) out = { kg, reps, consigne: "On consolide : même charge, mêmes reps." };
  else if (reps >= e.max) {
    out = e.incr > 0
      ? { kg: kg + e.incr, reps: e.min, consigne: `Haut de fourchette atteint : +${fmt(e.incr)} kg et retour à ${e.min} reps.` }
      : { kg, reps, consigne: "Haut de fourchette atteint : ajoute une série ou ralentis la descente." };
  } else out = { kg, reps: Math.min(e.max, reps + (d <= 2 ? 2 : 1)), consigne: "Même charge, on ajoute des reps." };
  out.kg = Math.round(out.kg * 100) / 100;
  return { ...out, n, last };
}

// ============================================================ GitHub
const b64encode = (str) => { const bytes = new TextEncoder().encode(str); let bin = ""; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(bin); };
const b64decode = (b64) => { const bin = atob(b64.replace(/\s/g, "")); const bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i); return new TextDecoder().decode(bytes); };
const ghUrl = (path) => `https://api.github.com/repos/${encodeURIComponent(CFG.owner)}/${encodeURIComponent(CFG.repo)}/contents/${path}`;
const ghHeaders = () => ({ Authorization: `Bearer ${CFG.token.trim()}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" });
class GhError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
function ghMessage(status) {
  if (status === 401) return "Jeton GitHub refusé (expiré ou mal copié).";
  if (status === 403) return "Le jeton n'a pas le droit d'écrire dans ce dépôt (permission Contents).";
  if (status === 404) return "Dépôt introuvable : vérifie le nom et que le jeton y a accès.";
  return `GitHub a répondu ${status}.`;
}
async function ghGet(path) {
  const r = await fetch(ghUrl(path) + `?ref=${encodeURIComponent(CFG.branch)}&t=${Date.now()}`, { headers: ghHeaders(), cache: "no-store" });
  if (r.status === 404) return null;
  if (!r.ok) throw new GhError(r.status, ghMessage(r.status));
  const j = await r.json();
  return { sha: j.sha, json: JSON.parse(b64decode(j.content || "")) };
}
async function ghPut(path, obj, sha, message) {
  const body = { message, content: b64encode(JSON.stringify(obj, null, 1) + "\n"), branch: CFG.branch };
  if (sha) body.sha = sha;
  const r = await fetch(ghUrl(path), { method: "PUT", headers: { ...ghHeaders(), "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) throw new GhError(r.status, r.status === 409 || r.status === 422 ? "conflit" : ghMessage(r.status));
  return r.json();
}
async function ghTest() {
  const r = await fetch(`https://api.github.com/repos/${encodeURIComponent(CFG.owner)}/${encodeURIComponent(CFG.repo)}`, { headers: ghHeaders(), cache: "no-store" });
  if (!r.ok) throw new GhError(r.status, ghMessage(r.status));
  const j = await r.json();
  if (j.permissions && j.permissions.push === false) throw new GhError(403, ghMessage(403));
  return j;
}

let syncTimer = null;
function scheduleSync(delay = 1200) { clearTimeout(syncTimer); syncTimer = setTimeout(sync, delay); }
function setSyncText(t, isErr = false) { UI.syncText = t; UI.syncErr = isErr; const el = $("#sync"); if (el) { el.textContent = t; el.classList.toggle("err", isErr); } }
function pendingCount() { return META.modIds.length + META.delIds.length + (META.dirtyProg ? 1 : 0); }

/** Fusionne le carnet local et celui du dépôt, puis envoie les changements locaux. */
async function sync() {
  if (!CFG.token) { setSyncText(pendingCount() ? "Non synchronisé (pas de jeton GitHub)" : "Sur ce téléphone seulement", !!pendingCount()); return; }
  if (!navigator.onLine) { setSyncText(pendingCount() ? `${pendingCount()} modif. en attente (hors ligne)` : "Hors ligne"); return; }
  if (UI.syncing) { UI.syncAgain = true; return; }
  UI.syncing = true; setSyncText("Synchronisation…");
  const mod = META.modIds.slice(), del = META.delIds.slice(), progDirty = META.dirtyProg;
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      const [rs, rp] = await Promise.all([ghGet("seances.json"), ghGet("programmes.json")]);
      const map = new Map(((rs && rs.json.seances) || []).map((s) => [s.id, s]));
      const local = new Map(DB.seances.map((s) => [s.id, s]));
      mod.forEach((id) => { if (local.has(id)) map.set(id, local.get(id)); });
      del.forEach((id) => map.delete(id));
      // Les séances modifiées localement pendant l'envoi restent prioritaires.
      META.modIds.filter((id) => !mod.includes(id)).forEach((id) => { if (local.has(id)) map.set(id, local.get(id)); });
      const merged = [...map.values()].sort((a, b) => (a.date || "").localeCompare(b.date || "") || (a.num || 0) - (b.num || 0));
      try {
        if (mod.length || del.length || !rs) {
          const label = mod.length === 1 && local.get(mod[0]) ? `Séance ${local.get(mod[0]).num} du ${local.get(mod[0]).date}` : del.length ? "Suppression de séance" : "Mise à jour du carnet";
          await ghPut("seances.json", { version: 1, seances: merged }, rs && rs.sha, label);
        }
        if (progDirty || !rp) await ghPut("programmes.json", { version: 1, exercices: DB.exercices, programmes: DB.programmes }, rp && rp.sha, "Programmes et exercices");
        else if (rp && rp.json && !META.dirtyProg) { DB.exercices = rp.json.exercices || DB.exercices; DB.programmes = rp.json.programmes || DB.programmes; }
      } catch (e) { if (e.message === "conflit" && attempt < 2) continue; throw e; }
      DB.seances = merged;
      META.modIds = META.modIds.filter((id) => !mod.includes(id));
      META.delIds = META.delIds.filter((id) => !del.includes(id));
      if (progDirty) META.dirtyProg = false;
      META.lastSync = Date.now(); META.lastError = "";
      break;
    }
    saveDB();
    setSyncText("Synchronisé " + new Date(META.lastSync).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }));
    if (UI.route !== "seance" && UI.route !== "programme" && UI.route !== "exercice-edit") render();
  } catch (e) {
    META.lastError = e.message || "Erreur réseau"; saveDB();
    setSyncText(e instanceof GhError ? e.message : "Réseau indisponible, nouvel essai plus tard", true);
  }
  UI.syncing = false;
  if (UI.syncAgain) { UI.syncAgain = false; scheduleSync(300); }
}
function markSeance(id) { if (!META.modIds.includes(id)) META.modIds.push(id); META.delIds = META.delIds.filter((x) => x !== id); saveDB(); scheduleSync(); }
function markSeanceDeleted(id) { META.modIds = META.modIds.filter((x) => x !== id); if (!META.delIds.includes(id)) META.delIds.push(id); saveDB(); scheduleSync(); }
function markProg() { META.dirtyProg = true; saveDB(); scheduleSync(); }

// ============================================================ Minuteur de repos
const T = { end: 0, total: 0, running: false, buzzed: false, ctx: null, oscs: [], wake: null, notifTimer: null, label: "" };
function audioCtx() {
  try { if (!T.ctx) T.ctx = new (window.AudioContext || window.webkitAudioContext)(); if (T.ctx.state === "suspended") T.ctx.resume(); } catch (e) { T.ctx = null; }
  return T.ctx;
}
function cancelBeeps() { T.oscs.forEach((o) => { try { o.stop(); } catch (e) {} }); T.oscs = []; }
function scheduleBeeps(sec) {
  cancelBeeps();
  if (!CFG.son) return;
  const ctx = audioCtx(); if (!ctx) return;
  const start = ctx.currentTime + Math.max(0, sec);
  [-3, -2, -1, 0].forEach((off, i) => {
    const t0 = start + off; if (t0 < ctx.currentTime) return;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = "square"; o.frequency.value = i === 3 ? 1320 : 880;
    const len = i === 3 ? 0.5 : 0.12;
    g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.22, t0 + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + len);
    o.connect(g).connect(ctx.destination); o.start(t0); o.stop(t0 + len + 0.05); T.oscs.push(o);
  });
}
async function wakeLock(on) {
  try {
    if (on && "wakeLock" in navigator && !T.wake) { T.wake = await navigator.wakeLock.request("screen"); T.wake.addEventListener("release", () => { T.wake = null; }); }
    if (!on && T.wake) { await T.wake.release(); T.wake = null; }
  } catch (e) { T.wake = null; }
}
function scheduleNotif(sec) {
  clearTimeout(T.notifTimer);
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  T.notifTimer = setTimeout(async () => {
    if (!document.hidden) return;
    try { const reg = await navigator.serviceWorker.ready; reg.showNotification("Repos terminé", { body: T.label.replace(/<[^>]+>/g, ""), tag: "repos", renotify: true, vibrate: [300, 150, 300, 150, 500], icon: "icons/icon-192.png" }); } catch (e) {}
  }, sec * 1000);
}
function startTimer(sec, label) {
  T.total = sec; T.end = Date.now() + sec * 1000; T.running = true; T.buzzed = false; T.label = label;
  scheduleBeeps(sec); scheduleNotif(sec);
  $("#timer").hidden = false; $("#timer").classList.remove("over"); document.body.classList.add("timing");
  $("#t-next").innerHTML = label;
  tickTimer();
}
function adjustTimer(delta) {
  if (!T.running) return;
  T.end += delta * 1000; T.total = Math.max(1, T.total + delta);
  const left = (T.end - Date.now()) / 1000;
  if (left > 0) { T.buzzed = false; $("#timer").classList.remove("over"); scheduleBeeps(left); scheduleNotif(left); } else { cancelBeeps(); clearTimeout(T.notifTimer); }
  tickTimer();
}
function stopTimer() { T.running = false; cancelBeeps(); clearTimeout(T.notifTimer); $("#timer").hidden = true; document.body.classList.remove("timing"); }
function tickTimer() {
  if (!T.running) return;
  const left = Math.round((T.end - Date.now()) / 1000), a = Math.abs(left);
  $("#t-time").textContent = (left < 0 ? "+" : "") + Math.floor(a / 60) + ":" + String(a % 60).padStart(2, "0");
  $("#t-bar").style.width = Math.max(0, Math.min(100, (left / T.total) * 100)) + "%";
  if (left <= 0 && !T.buzzed) { T.buzzed = true; $("#timer").classList.add("over"); try { navigator.vibrate && navigator.vibrate([300, 150, 300, 150, 500]); } catch (e) {} }
}
setInterval(() => { tickTimer(); tickChrono(); }, 250);
document.addEventListener("visibilitychange", () => { if (!document.hidden && DRAFT) wakeLock(true); });

// ============================================================ Séance en cours
function newDraftExo(exoId, bloc, n) {
  const s = suggest(exoId, n);
  return { exo: exoId, bloc: bloc || "", difficulte: null, note: "", saute: false, series: Array.from({ length: s.n }, () => ({ t: "T", kg: s.kg, reps: s.reps, ok: false })) };
}
function startSeance(progId) {
  const p = DB.programmes.find((x) => x.id === progId);
  if (!p) return;
  DRAFT = { id: uid(), num: nextNum(), programme: p.id, nomProgramme: p.nom, date: todayISO(), debut: Date.now(), exercices: p.items.map((it) => newDraftExo(it.exo, it.bloc, it.series)) };
  saveDraft(); askNotifications(); wakeLock(true);
  location.hash = "#seance";
}
function askNotifications() { try { if ("Notification" in window && Notification.permission === "default") Notification.requestPermission(); } catch (e) {} }
function prevSetsOf(exoId) { const h = historyOf(exoId); return h.length ? h[h.length - 1].x.series || [] : []; }
function nextAfter(xi) {
  const xs = DRAFT.exercices;
  const group = (b) => (/^[A-Z]\d/.test(b) ? b.charAt(0) : b || "_" + Math.random());
  const left = (x) => x.series.some((s) => !s.ok);
  const g = group(xs[xi].bloc);
  const inGroup = xs.map((x, i) => ({ x, i })).filter((o) => group(o.x.bloc) === g && !o.x.saute);
  const pos = inGroup.findIndex((o) => o.i === xi);
  for (let k = 1; k <= inGroup.length; k++) { const c = inGroup[(pos + k) % inGroup.length]; if (left(c.x)) return c; }
  for (let i = 0; i < xs.length; i++) if (!xs[i].saute && left(xs[i])) return { x: xs[i], i };
  return null;
}
function draftStats() {
  let sets = 0, vol = 0;
  DRAFT.exercices.forEach((x) => { const e = exo(x.exo); x.series.forEach((s) => { if (s.ok) { sets++; if (s.t !== "E") vol += effLoad(s.kg, e) * num(s.reps); } }); });
  return { sets, vol };
}
function tickChrono() { const el = $("#chrono"); if (el && DRAFT) el.textContent = dur((Date.now() - DRAFT.debut) / 1000); }

function finishPreview() {
  const done = DRAFT.exercices.filter((x) => !x.saute).map((x) => ({ exo: x.exo, bloc: x.bloc, difficulte: x.difficulte, note: x.note || "", series: x.series.filter((s) => s.ok).map((s) => ({ t: s.t, kg: num(s.kg), reps: num(s.reps) })) })).filter((x) => x.series.length);
  const seance = { id: DRAFT.id, num: DRAFT.num, date: DRAFT.date, programme: DRAFT.programme, debut: new Date(DRAFT.debut).toISOString(), duree: Math.round((Date.now() - DRAFT.debut) / 1000), exercices: done };
  const others = DB.seances.filter((s) => s.id !== seance.id);
  const records = [];
  done.forEach((x) => {
    const e = exo(x.exo), before = bestOf(x.exo, others);
    if (!historyOf(x.exo, others).length) return;
    const now = bestOf(x.exo, [seance]);
    if (now.e1rm > before.e1rm + 0.01) records.push(`${e.nom} : 1RM estimé ${fmt(now.e1rm, 1)} kg`);
    else if (now.maxKg > before.maxKg) records.push(`${e.nom} : charge max ${kgLabel(now.maxKg, e)}`);
  });
  return { seance, records, missing: DRAFT.exercices.filter((x) => !x.saute && x.series.some((s) => s.ok) && !x.difficulte).map((x) => exo(x.exo).nom) };
}
async function finishSeance() {
  const { seance, records, missing } = finishPreview();
  if (!seance.exercices.length) { await modal("Aucune série validée", "<p>Coche au moins une série avant de terminer la séance.</p>", [{ label: "OK", value: false }]); return; }
  let body = `<p><b>${seance.exercices.length}</b> exercices · <b>${seance.exercices.reduce((t, x) => t + x.series.length, 0)}</b> séries · ${dur(seance.duree)} · volume ${fmt(seanceVolume(seance), 0)} kg</p>`;
  if (records.length) body += `<p><span class="pr">Records</span> ${records.map(esc).join(" · ")}</p>`;
  if (missing.length) body += `<p class="muted">Sans difficulté notée : ${missing.map(esc).join(", ")}. La prochaine proposition supposera une difficulté de 3.</p>`;
  body += `<p class="muted small">Les séries non cochées ne sont pas enregistrées.</p>`;
  const ok = await modal(`Terminer la séance ${seance.num} ?`, body, [{ label: "Continuer", cls: "secondary", value: false }, { label: "Enregistrer", value: true }]);
  if (!ok) return;
  DB.seances = DB.seances.filter((s) => s.id !== seance.id).concat([seance]);
  DRAFT = null; saveDraft(); saveDB(); markSeance(seance.id); stopTimer(); wakeLock(false);
  toast(records.length ? `Séance enregistrée, ${records.length} record${records.length > 1 ? "s" : ""} !` : "Séance enregistrée.");
  location.hash = "#historique/" + seance.id;
}

// ============================================================ Modales
function modal(title, bodyHtml, actions) {
  return new Promise((resolve) => {
    const root = $("#modal-root");
    root.innerHTML = `<div class="modal-bg"><div class="modal" role="dialog" aria-modal="true" aria-labelledby="m-title"><h3 id="m-title">${esc(title)}</h3><div>${bodyHtml}</div><div class="acts">${actions.map((a, i) => `<button type="button" class="btn ${a.cls || ""}" data-m="${i}">${esc(a.label)}</button>`).join("")}</div></div></div>`;
    const close = (v) => { root.innerHTML = ""; resolve(v); };
    root.querySelectorAll("[data-m]").forEach((b) => b.addEventListener("click", () => close(actions[+b.dataset.m].value)));
    root.querySelector(".modal-bg").addEventListener("click", (ev) => { if (ev.target.classList.contains("modal-bg")) close(undefined); });
    root.querySelector(".acts .btn:last-child").focus();
  });
}
function pickExercise(title, excludeIds = []) {
  const opts = DB.exercices.filter((e) => !excludeIds.includes(e.id)).sort((a, b) => a.nom.localeCompare(b.nom, "fr"));
  const body = `<div class="list">${opts.map((e) => `<button type="button" class="item" data-pick="${esc(e.id)}"><span class="grow" style="text-align:left">${esc(e.nom)}</span><span class="r">${e.min}–${e.max} reps</span></button>`).join("") || '<p class="muted">Tous les exercices sont déjà là. Crée-en un dans Progrès.</p>'}</div>`;
  return new Promise((resolve) => {
    modal(title, body, [{ label: "Annuler", cls: "secondary", value: null }]).then(resolve);
    $("#modal-root").querySelectorAll("[data-pick]").forEach((b) => b.addEventListener("click", () => { $("#modal-root").innerHTML = ""; resolve(b.dataset.pick); }));
  });
}

// ============================================================ Vues
function header(title, sub = "", right = "") {
  $("#top").innerHTML = `<div class="top-inner"><h1>${esc(title)}${sub ? `<span class="sub">${sub}</span>` : ""}</h1>${right}<div class="sync" id="sync" aria-live="polite"></div></div>`;
  setSyncText(UI.syncText || (CFG.token ? "" : "Sur ce téléphone seulement"), UI.syncErr);
}

function viewAccueil() {
  header("Carnet de musculation");
  const all = sortedSeances(), last = all[0];
  const now = new Date(), month = now.toISOString().slice(0, 7);
  const thisMonth = all.filter((s) => (s.date || "").startsWith(month)).length;
  let h = "";
  if (!CFG.token) h += `<div class="banner warn">Tes séances sont gardées sur ce téléphone. Pour les sauvegarder sur GitHub, ajoute ton jeton dans <a href="#reglages">Réglages</a>.</div>`;
  if (DRAFT) {
    const st = draftStats();
    h += `<a class="card link" href="#seance" style="border-color:var(--accent)"><div class="row"><div class="grow"><h3>Séance ${DRAFT.num} en cours</h3><div class="muted small">${esc(DRAFT.nomProgramme)} · commencée à ${new Date(DRAFT.debut).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })} · ${st.sets} séries faites</div></div><span class="btn">Reprendre</span></div></a>`;
  }
  h += `<div class="stats"><div class="stat"><b>${all.length}</b><span>séances</span></div><div class="stat"><b>${thisMonth}</b><span>ce mois-ci</span></div><div class="stat"><b>${last ? dateShort(last.date) : "—"}</b><span>dernière séance</span></div></div>`;
  h += `<h2>Programmes</h2>`;
  DB.programmes.forEach((p) => {
    const lastP = all.find((s) => s.programme === p.id);
    h += `<div class="card"><div class="row"><div class="grow"><h3>${esc(p.nom)}</h3><div class="muted small">${p.items.length} exercices · ${lastP ? "dernière fois le " + dateLong(lastP.date) : "jamais fait"}</div></div></div>
      <div class="muted small">${p.items.map((it) => esc(exo(it.exo).nom)).join(" · ")}</div>
      <div class="row"><button type="button" class="btn grow" data-act="start" data-id="${esc(p.id)}" ${DRAFT ? "disabled" : ""}>Commencer</button><a class="btn secondary" href="#programme/${esc(p.id)}">Modifier</a></div></div>`;
  });
  h += `<button type="button" class="btn secondary" data-act="new-prog">Nouveau programme</button>`;
  return h;
}

function viewSeance() {
  if (!DRAFT) { location.hash = "#accueil"; return ""; }
  header(`Séance ${DRAFT.num}`, esc(DRAFT.nomProgramme), `<span class="chrono" id="chrono">${dur((Date.now() - DRAFT.debut) / 1000)}</span>`);
  const st = draftStats();
  let h = `<div class="row wrap"><label class="field grow" for="d-date"><span>Date</span><input type="date" id="d-date" data-bind="date" value="${esc(DRAFT.date)}"></label>
    <div class="stat" style="flex:0 0 auto"><b>${st.sets}</b><span>séries</span></div><div class="stat" style="flex:0 0 auto"><b>${fmt(st.vol, 0)}</b><span>kg soulevés</span></div></div>`;
  DRAFT.exercices.forEach((x, xi) => {
    const e = exo(x.exo), s = suggest(x.exo, x.series.filter((z) => z.t !== "E").length), prev = prevSetsOf(x.exo);
    const complete = x.series.length && x.series.every((z) => z.ok) && x.difficulte;
    h += `<section class="ex${x.saute ? " skipped" : ""}${complete ? " complete" : ""}" aria-labelledby="x-${xi}">
      <div class="ex-head"><span class="bloc">${esc(x.bloc || "–")}</span><div class="grow"><h3 id="x-${xi}">${esc(e.nom)}</h3>
      <div class="ex-meta">${e.min}–${e.max} reps · repos ${restLabel(e.repos)}${e.unite ? " · " + esc(e.unite) : ""}</div></div>
      <button type="button" class="mini" data-act="x-menu" data-x="${xi}" aria-label="Options de l'exercice">•••</button></div>`;
    if (x.saute) { h += `<button type="button" class="btn secondary" data-act="x-skip" data-x="${xi}">Reprendre cet exercice</button></section>`; return; }
    h += `<div class="hint">${s.last ? `<b>${s.n}×${s.reps} · ${esc(kgLabel(s.kg, e))}</b> — ${esc(s.consigne)}` : esc(s.consigne)}</div>
      <table class="sets"><thead><tr><th scope="col">Série</th><th scope="col">Précédent</th><th scope="col">${e.mode === "corps" ? "± kg" : "kg"}</th><th scope="col">Reps</th><th scope="col"><span class="sr">Fait</span>✓</th></tr></thead><tbody>`;
    let wn = 0;
    x.series.forEach((z, si) => {
      const label = z.t === "E" ? "É" : String(++wn);
      const p = prev[si];
      h += `<tr class="${z.ok ? "ok" : ""}"><td><button type="button" class="set-n${z.t === "E" ? " warm" : ""}" data-act="s-type" data-x="${xi}" data-s="${si}" aria-label="Série ${label}, toucher pour passer en ${z.t === "E" ? "série de travail" : "échauffement"}">${label}</button></td>
        <td>${p ? `<button type="button" class="prev" data-act="s-prev" data-x="${xi}" data-s="${si}" aria-label="Reprendre ${esc(kgLabel(p.kg, e))} × ${p.reps}">${esc(kgLabel(p.kg, e).replace(" kg", ""))} × ${p.reps}</button>` : '<span class="muted">—</span>'}</td>
        <td><input id="kg-${xi}-${si}" inputmode="decimal" data-bind="kg" data-x="${xi}" data-s="${si}" value="${esc(fmt(z.kg))}" aria-label="Charge série ${label}"></td>
        <td><input id="reps-${xi}-${si}" inputmode="numeric" data-bind="reps" data-x="${xi}" data-s="${si}" value="${esc(z.reps)}" aria-label="Reps série ${label}"></td>
        <td><button type="button" class="check" data-act="s-ok" data-x="${xi}" data-s="${si}" aria-pressed="${!!z.ok}" aria-label="Série ${label} faite">✓</button></td></tr>`;
    });
    h += `</tbody></table>
      <div class="row"><button type="button" class="btn ghost" data-act="s-add" data-x="${xi}">+ Série</button><button type="button" class="btn ghost" data-act="s-del" data-x="${xi}" ${x.series.length ? "" : "disabled"}>− Série</button></div>
      <div><div class="ex-meta" style="margin-bottom:6px">Difficulté ressentie</div><div class="diff">${DIFF.map((d) => `<button type="button" style="--d:${d.c}" data-act="x-diff" data-x="${xi}" data-v="${d.v}" aria-pressed="${x.difficulte === d.v}"><b>${d.v}</b><small>${d.t}</small></button>`).join("")}</div></div>
      <input class="note" id="note-${xi}" data-bind="note" data-x="${xi}" placeholder="Remarque (montage, sensation…)" value="${esc(x.note)}" aria-label="Remarque">
    </section>`;
  });
  h += `<button type="button" class="btn secondary" data-act="x-add">Ajouter un exercice</button>
    <div class="row"><button type="button" class="btn danger" data-act="abandon">Abandonner</button><button type="button" class="btn grow" data-act="finish">Terminer la séance</button></div>`;
  return h;
}

function viewHistorique() {
  header("Historique");
  const all = sortedSeances();
  if (!all.length) return `<p class="muted">Aucune séance enregistrée.</p>`;
  let h = `<div class="list">`, curMonth = "";
  all.forEach((s) => {
    const m = new Date((s.date || todayISO()) + "T12:00:00").toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
    if (m !== curMonth) { curMonth = m; h += `<h2 style="text-transform:capitalize">${esc(m)}</h2>`; }
    const p = DB.programmes.find((x) => x.id === s.programme);
    h += `<a class="item" href="#historique/${esc(s.id)}"><div class="grow"><b>Séance ${s.num}</b> · ${esc(dateLong(s.date))}<div class="muted small">${esc(p ? p.nom : "Séance libre")} · ${s.exercices.length} exercices${META.modIds.includes(s.id) ? " · en attente d'envoi" : ""}</div></div><div class="r">${s.duree ? dur(s.duree) + "<br>" : ""}${fmt(seanceVolume(s), 0)} kg</div></a>`;
  });
  return h + `</div>`;
}

function viewSeanceDetail(id) {
  const s = DB.seances.find((x) => x.id === id);
  if (!s) { header("Séance introuvable"); return `<p>Cette séance n'existe plus. <a href="#historique">Retour à l'historique</a></p>`; }
  header(`Séance ${s.num}`, esc(dateLong(s.date)));
  const others = DB.seances.filter((x) => (x.date || "") < (s.date || "") || ((x.date || "") === (s.date || "") && x.num < s.num));
  let h = `<div class="stats"><div class="stat"><b>${s.duree ? dur(s.duree) : "—"}</b><span>durée</span></div><div class="stat"><b>${s.exercices.reduce((t, x) => t + workSets(x).length, 0)}</b><span>séries</span></div><div class="stat"><b>${fmt(seanceVolume(s), 0)}</b><span>kg soulevés</span></div></div>`;
  s.exercices.forEach((x) => {
    const e = exo(x.exo), d = DIFF.find((z) => z.v === num(x.difficulte));
    const before = bestOf(x.exo, others), now = bestOf(x.exo, [s]);
    const isPr = historyOf(x.exo, others).length && now.e1rm > before.e1rm + 0.01;
    let wn = 0;
    h += `<div class="card"><div class="row"><span class="bloc">${esc(x.bloc || "–")}</span><a class="grow" href="#exercice/${esc(x.exo)}"><h3>${esc(e.nom)}</h3></a>${isPr ? '<span class="pr">Record</span>' : ""}${d ? `<span class="pill" style="background:${d.c}" title="Difficulté ${d.v}">${d.v}</span>` : ""}</div>
      <div class="tbl-wrap"><table class="data"><tbody>${x.series.map((z) => `<tr><td>${z.t === "E" ? "Échauff." : "Série " + ++wn}</td><td class="n">${esc(kgLabel(z.kg, e))}</td><td class="n">× ${z.reps}</td><td class="n muted">1RM ≈ ${fmt(e1rm(z.kg, z.reps, e), 1)}</td></tr>`).join("")}</tbody></table></div>
      ${x.note ? `<div class="muted small">${esc(x.note)}</div>` : ""}</div>`;
  });
  h += `<button type="button" class="btn danger" data-act="del-seance" data-id="${esc(s.id)}">Supprimer cette séance</button>`;
  return h;
}

function viewExercices() {
  header("Progrès");
  const used = DB.exercices.slice().sort((a, b) => a.nom.localeCompare(b.nom, "fr"));
  let h = `<p class="muted small">1RM estimé = charge que tu pourrais soulever une fois (formule d'Epley). Pour les exercices au poids du corps, ton poids (${fmt(CFG.poidsCorps)} kg, modifiable dans Réglages) est ajouté.</p><div class="list">`;
  used.forEach((e) => {
    const hist = historyOf(e.id), b = bestOf(e.id);
    const last = hist.length ? hist[hist.length - 1] : null;
    const lastTop = last ? workSets(last.x).reduce((m, z) => (num(z.kg) > num(m.kg) ? z : m), workSets(last.x)[0]) : null;
    h += `<a class="item" href="#exercice/${esc(e.id)}"><div class="grow"><b>${esc(e.nom)}</b><div class="muted small">${last ? `Dernière fois : ${esc(kgLabel(lastTop.kg, e))} × ${lastTop.reps} (${dateShort(last.s.date)})` : "Pas encore fait"}</div></div><div class="r">${b.e1rm ? `1RM ≈ ${fmt(b.e1rm, 0)} kg` : ""}<br>${hist.length} séance${hist.length > 1 ? "s" : ""}</div></a>`;
  });
  h += `</div><button type="button" class="btn secondary" data-act="new-exo">Nouvel exercice</button>`;
  return h;
}

function lineChart(points, unit) {
  if (points.length < 2) return `<p class="muted small">Le graphique apparaît à partir de deux séances.</p>`;
  const W = 360, H = 190, L = 34, R = 8, Tp = 18, B = 22;
  const ys = points.map((p) => p.y), min = Math.min(...ys), max = Math.max(...ys);
  const pad = (max - min) * 0.15 || Math.max(1, max * 0.05), y0 = min - pad, y1 = max + pad;
  const X = (i) => L + (i * (W - L - R)) / (points.length - 1), Y = (v) => Tp + (1 - (v - y0) / (y1 - y0)) * (H - Tp - B);
  const ticks = [y0 + (y1 - y0) * 0.1, (y0 + y1) / 2, y1 - (y1 - y0) * 0.1];
  const path = points.map((p, i) => `${i ? "L" : "M"}${X(i).toFixed(1)},${Y(p.y).toFixed(1)}`).join(" ");
  const area = `${path} L${X(points.length - 1).toFixed(1)},${H - B} L${L},${H - B} Z`;
  const step = Math.ceil(points.length / 6);
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Évolution ${esc(unit)}">
    ${ticks.map((t) => `<line x1="${L}" x2="${W - R}" y1="${Y(t)}" y2="${Y(t)}" stroke="var(--line)" stroke-width="1"/><text x="${L - 6}" y="${Y(t) + 4}" text-anchor="end" font-size="11" fill="var(--muted)">${fmt(t, 0)}</text>`).join("")}
    <path d="${area}" fill="var(--accent)" opacity=".12"/><path d="${path}" fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-linejoin="round"/>
    ${points.map((p, i) => `<circle cx="${X(i)}" cy="${Y(p.y)}" r="${i === points.length - 1 ? 5 : 3}" fill="var(--accent)"/>`).join("")}
    ${points.map((p, i) => (i % step === 0 || i === points.length - 1) ? `<text x="${X(i)}" y="${H - 8}" text-anchor="middle" font-size="11" fill="var(--muted)">${esc(p.label)}</text>` : "").join("")}
    <text x="${X(points.length - 1) - 6}" y="${Y(points[points.length - 1].y) - 9}" text-anchor="end" font-size="12" font-weight="600" fill="var(--ink)">${fmt(points[points.length - 1].y, 1)} ${esc(unit)}</text>
  </svg>`;
}

function viewExercice(id) {
  const e = DB.exercices.find((x) => x.id === id);
  if (!e) { header("Exercice introuvable"); return `<p><a href="#exercices">Retour</a></p>`; }
  header(e.nom, esc(e.unite || ""));
  const hist = historyOf(id), b = bestOf(id);
  let h = `<div class="records">
    <div class="stat"><b>${b.e1rm ? fmt(b.e1rm, 1) : "—"}</b><span>1RM estimé (kg)${b.e1rmSet ? ` · ${esc(kgLabel(b.e1rmSet.kg, e))} × ${b.e1rmSet.reps}` : ""}</span></div>
    <div class="stat"><b>${b.maxKgSet ? esc(kgLabel(b.maxKg, e)) : "—"}</b><span>charge max${b.maxKgSet ? ` · × ${b.maxKgSet.reps} le ${dateShort(b.maxKgSet.date)}` : ""}</span></div>
    <div class="stat"><b>${b.maxReps || "—"}</b><span>reps max sur une série</span></div>
    <div class="stat"><b>${b.volSeance ? fmt(b.volSeance, 0) : "—"}</b><span>meilleur volume (kg)</span></div></div>`;
  h += `<div class="card"><h3>1RM estimé par séance</h3>${lineChart(hist.map(({ s, x }) => ({ y: Math.max(...workSets(x).map((z) => e1rm(z.kg, z.reps, e))), label: dateShort(s.date) })), "kg")}</div>`;
  h += `<div class="card"><h3>Historique</h3><div class="tbl-wrap"><table class="data"><thead><tr><th>Date</th><th>Séries</th><th>Diff.</th></tr></thead><tbody>${hist.slice().reverse().map(({ s, x }) => { const d = DIFF.find((z) => z.v === num(x.difficulte)); return `<tr><td><a href="#historique/${esc(s.id)}">${dateShort(s.date)}</a></td><td>${workSets(x).map((z) => `${esc(kgLabel(z.kg, e).replace(" kg", ""))}×${z.reps}`).join(", ")}${x.note ? `<div class="muted small">${esc(x.note)}</div>` : ""}</td><td class="n">${d ? `<span class="pill" style="background:${d.c}">${d.v}</span>` : "—"}</td></tr>`; }).join("") || '<tr><td colspan="3" class="muted">Pas encore fait.</td></tr>'}</tbody></table></div></div>`;
  h += `<div class="card"><h3>Réglages de l'exercice</h3>
    <div class="fgrid">
      <label class="field wide" for="e-nom"><span>Nom</span><input id="e-nom" value="${esc(e.nom)}"></label>
      <label class="field" for="e-mode"><span>Type de charge</span><select id="e-mode"><option value="charge"${e.mode !== "corps" ? " selected" : ""}>Charge (kg)</option><option value="corps"${e.mode === "corps" ? " selected" : ""}>Poids du corps ± lest</option></select></label>
      <label class="field" for="e-min"><span>Reps min</span><input id="e-min" inputmode="numeric" value="${e.min}"></label>
      <label class="field" for="e-max"><span>Reps max</span><input id="e-max" inputmode="numeric" value="${e.max}"></label>
      <label class="field" for="e-incr"><span>Palier (kg)</span><input id="e-incr" inputmode="decimal" value="${fmt(e.incr)}"></label>
      <label class="field" for="e-repos"><span>Repos (s)</span><input id="e-repos" inputmode="numeric" value="${e.repos}"></label>
      <label class="field wide" for="e-unite"><span>Précision</span><input id="e-unite" value="${esc(e.unite || "")}" placeholder="Par haltère, reps par jambe…"></label>
    </div><button type="button" class="btn" data-act="save-exo" data-id="${esc(e.id)}">Enregistrer</button></div>`;
  return h;
}

function viewProgramme(id) {
  if (!UI.progEdit || UI.progEdit.id !== id) {
    const p = DB.programmes.find((x) => x.id === id);
    if (!p) { header("Programme introuvable"); return `<p><a href="#accueil">Retour</a></p>`; }
    UI.progEdit = JSON.parse(JSON.stringify(p));
  }
  const p = UI.progEdit;
  header("Modifier le programme", esc(p.nom));
  let h = `<label class="field" for="p-nom"><span>Nom du programme</span><input id="p-nom" data-pbind="nom" value="${esc(p.nom)}"></label>
    <p class="muted small">Le bloc sert à enchaîner les exercices : A1 → A2 → A3, puis retour à A1. Le minuteur t'indique l'exercice suivant.</p><div class="list">`;
  p.items.forEach((it, i) => {
    h += `<div class="card"><div class="row"><b class="grow">${esc(exo(it.exo).nom)}</b>
      <button type="button" class="mini" data-act="p-up" data-i="${i}" aria-label="Monter" ${i ? "" : "disabled"}>↑</button><button type="button" class="mini" data-act="p-down" data-i="${i}" aria-label="Descendre" ${i < p.items.length - 1 ? "" : "disabled"}>↓</button><button type="button" class="mini" data-act="p-del" data-i="${i}" aria-label="Retirer">✕</button></div>
      <div class="fgrid"><label class="field" for="p-bloc-${i}"><span>Bloc</span><input id="p-bloc-${i}" data-pbind="bloc" data-i="${i}" value="${esc(it.bloc)}"></label><label class="field" for="p-ser-${i}"><span>Séries</span><input id="p-ser-${i}" inputmode="numeric" data-pbind="series" data-i="${i}" value="${it.series}"></label></div></div>`;
  });
  h += `</div><button type="button" class="btn secondary" data-act="p-add">Ajouter un exercice</button>
    <div class="row"><button type="button" class="btn danger" data-act="p-remove">Supprimer</button><a class="btn secondary" href="#accueil" data-act="p-cancel">Annuler</a><button type="button" class="btn grow" data-act="p-save">Enregistrer</button></div>`;
  return h;
}

function plateHtml(target, barre) {
  const per = (num(target) - num(barre)) / 2;
  if (per < 0) return `<p class="muted">La barre seule pèse déjà ${fmt(barre)} kg.</p>`;
  const disques = CFG.disques.map(num).filter((d) => d > 0).sort((a, b) => b - a);
  let rest = per; const used = [];
  disques.forEach((d) => { while (rest >= d - 1e-9) { used.push(d); rest = Math.round((rest - d) * 1000) / 1000; } });
  return `<p>De chaque côté (${fmt(per)} kg) :</p><div class="plates">${used.map((d) => `<span class="plate">${fmt(d)}</span>`).join("") || '<span class="muted">aucun disque</span>'}</div>${rest > 0.001 ? `<p class="muted small">Il manque ${fmt(rest)} kg par côté avec tes disques : ${fmt(num(target) - rest * 2)} kg au plus proche.</p>` : ""}`;
}
function viewOutils() {
  header("Outils");
  const target = UI.plateTarget ?? 52, bi = UI.plateBar ?? 0, barre = CFG.barres[bi] || CFG.barres[0] || { poids: 20 };
  const rmKg = UI.rmKg ?? 48, rmReps = UI.rmReps ?? 10;
  return `<div class="card"><h3>Calculateur de disques</h3>
    <div class="fgrid"><label class="field" for="pl-t"><span>Charge totale (kg)</span><input id="pl-t" inputmode="decimal" data-tool="plateTarget" value="${esc(fmt(target))}"></label>
    <label class="field" for="pl-b"><span>Barre</span><select id="pl-b" data-tool="plateBar">${CFG.barres.map((b, i) => `<option value="${i}"${i === bi ? " selected" : ""}>${esc(b.nom)} (${fmt(b.poids)} kg)</option>`).join("")}</select></label></div>
    <div id="plate-out">${plateHtml(target, barre.poids)}</div><p class="muted small">Barres et disques disponibles : dans Réglages.</p></div>
    <div class="card"><h3>1RM estimé et pourcentages</h3>
    <div class="fgrid"><label class="field" for="rm-kg"><span>Charge (kg)</span><input id="rm-kg" inputmode="decimal" data-tool="rmKg" value="${esc(fmt(rmKg))}"></label><label class="field" for="rm-r"><span>Reps</span><input id="rm-r" inputmode="numeric" data-tool="rmReps" value="${esc(rmReps)}"></label></div>
    <div id="rm-out">${rmHtml(rmKg, rmReps)}</div></div>`;
}
function rmHtml(kg, reps) {
  const rm = num(kg) * (1 + num(reps) / 30);
  return `<p><b>1RM ≈ ${fmt(rm, 1)} kg</b></p><div class="tbl-wrap"><table class="data"><tbody>${[95, 90, 85, 80, 75, 70, 65, 60].map((p) => `<tr><td>${p} %</td><td class="n">${fmt(rm * p / 100, 1)} kg</td><td class="n muted">≈ ${Math.max(1, Math.round(30 * (100 / p - 1)))} reps</td></tr>`).join("")}</tbody></table></div>`;
}

function viewReglages() {
  header("Réglages");
  const last = META.lastSync ? new Date(META.lastSync).toLocaleString("fr-FR") : "jamais";
  return `<div class="card"><h3>Sauvegarde GitHub</h3>
    <p class="muted small">Les séances sont enregistrées dans <code>seances.json</code> et les programmes dans <code>programmes.json</code> du dépôt privé. Le jeton reste sur ce téléphone.</p>
    <div class="fgrid"><label class="field" for="g-owner"><span>Compte</span><input id="g-owner" data-cfg="owner" value="${esc(CFG.owner)}" autocapitalize="off"></label>
    <label class="field" for="g-repo"><span>Dépôt</span><input id="g-repo" data-cfg="repo" value="${esc(CFG.repo)}" autocapitalize="off"></label>
    <label class="field" for="g-branch"><span>Branche</span><input id="g-branch" data-cfg="branch" value="${esc(CFG.branch)}" autocapitalize="off"></label>
    <label class="field wide" for="g-token"><span>Jeton (fine-grained, Contents : lecture et écriture)</span><input id="g-token" type="password" data-cfg="token" value="${esc(CFG.token)}" autocomplete="off" placeholder="github_pat_…"></label></div>
    <div class="row wrap"><button type="button" class="btn" data-act="gh-test">Tester et synchroniser</button><span class="muted small">Dernière synchro : ${esc(last)}${pendingCount() ? ` · ${pendingCount()} modification(s) en attente` : ""}</span></div>
    ${META.lastError ? `<div class="banner warn">${esc(META.lastError)}</div>` : ""}</div>
    <div class="card"><h3>Calculs</h3><div class="fgrid">
    <label class="field" for="c-pc"><span>Poids de corps (kg)</span><input id="c-pc" inputmode="decimal" data-cfg="poidsCorps" value="${esc(fmt(CFG.poidsCorps))}"></label>
    <label class="field wide" for="c-disq"><span>Disques disponibles (kg, séparés par des espaces)</span><input id="c-disq" data-cfg="disques" value="${esc(CFG.disques.map((d) => fmt(d)).join(" "))}"></label>
    <label class="field wide" for="c-barres"><span>Barres (nom = poids, une par ligne)</span><textarea id="c-barres" rows="3" data-cfg="barres">${esc(CFG.barres.map((b) => `${b.nom} = ${fmt(b.poids)}`).join("\n"))}</textarea></label>
    <label class="field" for="c-son"><span>Bip de fin de repos</span><select id="c-son" data-cfg="son"><option value="1"${CFG.son ? " selected" : ""}>Activé</option><option value="0"${CFG.son ? "" : " selected"}>Désactivé</option></select></label>
    </div></div>
    <div class="card"><h3>Données</h3>
    <div class="row wrap"><button type="button" class="btn secondary" data-act="export">Exporter (JSON)</button><button type="button" class="btn secondary" data-act="export-csv">Exporter (CSV)</button><label class="btn secondary" for="imp">Importer un JSON</label><input id="imp" type="file" accept="application/json,.json" hidden></div>
    <p class="muted small">Pour installer l'appli : menu ⋮ de Chrome → « Ajouter à l'écran d'accueil ». Pendant une séance, l'écran reste allumé pour que le bip de repos sonne. Version ${APP_VERSION}.</p></div>`;
}

// ============================================================ Rendu et navigation
function parseRoute() {
  const raw = (location.hash || "#accueil").slice(1);
  const [r, p] = raw.split("/");
  UI.route = r || "accueil"; UI.param = p ? decodeURIComponent(p) : null;
}
function render() {
  parseRoute();
  const navKey = { seance: "accueil", programme: "accueil", exercice: "exercices" }[UI.route] || UI.route;
  document.querySelectorAll("#nav a").forEach((a) => a.toggleAttribute("aria-current", false));
  const cur = document.querySelector(`#nav a[data-nav="${navKey}"]`); if (cur) cur.setAttribute("aria-current", "page");
  if (UI.route !== "programme") UI.progEdit = null;
  const views = {
    accueil: viewAccueil, seance: viewSeance, historique: () => (UI.param ? viewSeanceDetail(UI.param) : viewHistorique()),
    exercices: viewExercices, exercice: () => viewExercice(UI.param), programme: () => viewProgramme(UI.param), outils: viewOutils, reglages: viewReglages
  };
  const html = (views[UI.route] || viewAccueil)();
  $("#main").innerHTML = html;
}
window.addEventListener("hashchange", () => { render(); window.scrollTo(0, 0); });

// ============================================================ Actions
document.addEventListener("click", async (ev) => {
  const b = ev.target.closest("[data-act]"); if (!b) return;
  const act = b.dataset.act, xi = +b.dataset.x, si = +b.dataset.s;
  const X = DRAFT && DRAFT.exercices[xi];
  switch (act) {
    case "t-plus": return adjustTimer(15);
    case "t-minus": return adjustTimer(-15);
    case "t-stop": return stopTimer();
    case "start": audioCtx(); return startSeance(b.dataset.id);
    case "s-ok": {
      audioCtx(); wakeLock(true);
      const z = X.series[si]; z.ok = !z.ok; saveDraft(); render();
      if (z.ok) {
        const e = exo(X.exo), nx = nextAfter(xi);
        const label = nx ? `Ensuite : <b>${esc(nx.x.bloc ? nx.x.bloc + " · " : "")}${esc(exo(nx.x.exo).nom)}</b>, série ${nx.x.series.findIndex((q) => !q.ok) + 1}` : "Toutes les séries sont faites : note la difficulté puis termine la séance.";
        if (z.t === "E") startTimer(Math.min(60, num(e.repos) || 60), label); else startTimer(num(e.repos) || 90, label);
      }
      return;
    }
    case "s-type": { const z = X.series[si]; z.t = z.t === "E" ? "T" : "E"; saveDraft(); return render(); }
    case "s-prev": { const p = prevSetsOf(X.exo)[si]; if (p) { X.series[si].kg = p.kg; X.series[si].reps = p.reps; saveDraft(); render(); } return; }
    case "s-add": { const l = X.series[X.series.length - 1] || { kg: 0, reps: exo(X.exo).min }; X.series.push({ t: "T", kg: l.kg, reps: l.reps, ok: false }); saveDraft(); return render(); }
    case "s-del": { X.series.pop(); saveDraft(); return render(); }
    case "x-diff": { const v = +b.dataset.v; X.difficulte = X.difficulte === v ? null : v; saveDraft(); return render(); }
    case "x-skip": { X.saute = !X.saute; saveDraft(); return render(); }
    case "x-menu": {
      const r = await modal(exo(X.exo).nom, `<p class="muted small">Que veux-tu faire avec cet exercice ?</p>`, [
        { label: "Ajouter un échauffement", cls: "secondary", value: "warm" }, { label: X.saute ? "Reprendre" : "Pas fait aujourd'hui", cls: "secondary", value: "skip" },
        { label: "Remplacer", cls: "secondary", value: "swap" }, { label: "Retirer de la séance", cls: "danger", value: "remove" }]);
      if (r === "warm") { const f = X.series[0] || { kg: 0, reps: 8 }; X.series.unshift({ t: "E", kg: Math.round(num(f.kg) * 0.5), reps: Math.max(5, num(f.reps)), ok: false }); }
      if (r === "skip") X.saute = !X.saute;
      if (r === "remove") DRAFT.exercices.splice(xi, 1);
      if (r === "swap") { const id = await pickExercise("Remplacer par", DRAFT.exercices.map((q) => q.exo)); if (id) DRAFT.exercices[xi] = newDraftExo(id, X.bloc, X.series.filter((q) => q.t !== "E").length); }
      saveDraft(); return render();
    }
    case "x-add": { const id = await pickExercise("Ajouter un exercice", DRAFT.exercices.map((q) => q.exo)); if (id) { DRAFT.exercices.push(newDraftExo(id, "", 3)); saveDraft(); render(); } return; }
    case "finish": return finishSeance();
    case "abandon": {
      const ok = await modal("Abandonner la séance ?", "<p>Rien ne sera enregistré.</p>", [{ label: "Non", cls: "secondary", value: false }, { label: "Abandonner", cls: "danger", value: true }]);
      if (ok) { DRAFT = null; saveDraft(); stopTimer(); wakeLock(false); location.hash = "#accueil"; }
      return;
    }
    case "del-seance": {
      const s = DB.seances.find((q) => q.id === b.dataset.id);
      const ok = await modal("Supprimer la séance ?", `<p>La séance ${s.num} du ${esc(dateLong(s.date))} sera retirée du carnet et du dépôt.</p>`, [{ label: "Annuler", cls: "secondary", value: false }, { label: "Supprimer", cls: "danger", value: true }]);
      if (ok) { DB.seances = DB.seances.filter((q) => q.id !== s.id); saveDB(); markSeanceDeleted(s.id); location.hash = "#historique"; }
      return;
    }
    case "new-prog": {
      const p = { id: "prog-" + uid(), nom: "Nouveau programme", items: [] };
      DB.programmes.push(p); saveDB(); location.hash = "#programme/" + p.id; return;
    }
    case "p-up": case "p-down": { const i = +b.dataset.i, j = act === "p-up" ? i - 1 : i + 1; const it = UI.progEdit.items; [it[i], it[j]] = [it[j], it[i]]; return render(); }
    case "p-del": { UI.progEdit.items.splice(+b.dataset.i, 1); return render(); }
    case "p-add": { const id = await pickExercise("Ajouter au programme", UI.progEdit.items.map((q) => q.exo)); if (id) { UI.progEdit.items.push({ exo: id, bloc: "", series: exo(id).series || 3 }); render(); } return; }
    case "p-save": {
      const p = UI.progEdit; p.items.forEach((it) => { it.series = Math.max(1, Math.round(num(it.series))); });
      DB.programmes = DB.programmes.map((q) => (q.id === p.id ? p : q)); UI.progEdit = null; saveDB(); markProg(); toast("Programme enregistré."); location.hash = "#accueil"; return;
    }
    case "p-remove": {
      const ok = await modal("Supprimer ce programme ?", "<p>Les séances déjà faites restent dans l'historique.</p>", [{ label: "Annuler", cls: "secondary", value: false }, { label: "Supprimer", cls: "danger", value: true }]);
      if (ok) { DB.programmes = DB.programmes.filter((q) => q.id !== UI.progEdit.id); UI.progEdit = null; saveDB(); markProg(); location.hash = "#accueil"; }
      return;
    }
    case "new-exo": {
      let base = "nouvel-exercice", id = base, k = 2; while (DB.exercices.some((q) => q.id === id)) id = base + "-" + k++;
      DB.exercices.push({ id, nom: "Nouvel exercice", mode: "charge", min: 8, max: 12, incr: 2, repos: 90, unite: "" }); saveDB(); markProg();
      location.hash = "#exercice/" + id; return;
    }
    case "save-exo": {
      const e = DB.exercices.find((q) => q.id === b.dataset.id);
      e.nom = $("#e-nom").value.trim() || e.nom; e.mode = $("#e-mode").value; e.min = Math.max(1, Math.round(num($("#e-min").value))); e.max = Math.max(e.min, Math.round(num($("#e-max").value)));
      e.incr = Math.max(0, num($("#e-incr").value)); e.repos = Math.max(0, Math.round(num($("#e-repos").value))); e.unite = $("#e-unite").value.trim();
      saveDB(); markProg(); toast("Exercice enregistré."); return render();
    }
    case "gh-test": {
      if (!CFG.token) { toast("Colle d'abord ton jeton GitHub."); return; }
      b.disabled = true; setSyncText("Test de la connexion…");
      try { await ghTest(); toast("Connexion GitHub OK."); await sync(); } catch (e) { META.lastError = e.message; saveDB(); setSyncText(e.message, true); }
      return render();
    }
    case "export": return downloadFile("carnet-musculation.json", JSON.stringify({ version: 1, ...DB }, null, 1), "application/json");
    case "export-csv": {
      const rows = [["Séance", "Date", "Bloc", "Exercice", "Type", "Charge (kg)", "Reps", "Difficulté", "Remarque"]];
      sortedSeances().reverse().forEach((s) => s.exercices.forEach((x) => x.series.forEach((z) => rows.push([s.num, s.date, x.bloc, exo(x.exo).nom, z.t === "E" ? "Échauffement" : "Travail", fmt(z.kg), z.reps, x.difficulte ?? "", x.note || ""]))));
      return downloadFile("carnet-musculation.csv", "﻿" + rows.map((r) => r.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(";")).join("\r\n"), "text/csv");
    }
  }
});
function downloadFile(name, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a"); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

document.addEventListener("input", (ev) => {
  const t = ev.target;
  if (t.dataset.bind && DRAFT) {
    const k = t.dataset.bind;
    if (k === "date") DRAFT.date = t.value;
    else {
      const X = DRAFT.exercices[+t.dataset.x];
      if (k === "note") X.note = t.value;
      else X.series[+t.dataset.s][k] = k === "reps" ? Math.max(0, Math.round(num(t.value))) : num(t.value);
    }
    saveDraft();
  }
  if (t.dataset.pbind && UI.progEdit) {
    const k = t.dataset.pbind;
    if (k === "nom") UI.progEdit.nom = t.value; else UI.progEdit.items[+t.dataset.i][k] = t.value;
  }
  if (t.dataset.tool) {
    UI[t.dataset.tool] = t.dataset.tool === "plateBar" ? +t.value : t.value;
    const barre = CFG.barres[UI.plateBar ?? 0] || { poids: 20 };
    const out = $("#plate-out"); if (out) out.innerHTML = plateHtml(UI.plateTarget ?? 52, barre.poids);
    const ro = $("#rm-out"); if (ro && t.dataset.tool.startsWith("rm")) ro.innerHTML = rmHtml(UI.rmKg ?? 48, UI.rmReps ?? 10);
  }
  if (t.dataset.cfg) {
    const k = t.dataset.cfg;
    if (k === "disques") CFG.disques = t.value.split(/[\s;]+/).map(num).filter((d) => d > 0);
    else if (k === "barres") CFG.barres = t.value.split("\n").map((l) => { const [n, p] = l.split("="); return { nom: (n || "").trim(), poids: num(p) }; }).filter((b) => b.nom && b.poids > 0);
    else if (k === "poidsCorps") CFG.poidsCorps = num(t.value);
    else if (k === "son") CFG.son = t.value === "1";
    else CFG[k] = t.value.trim();
    saveCfg();
  }
});
document.addEventListener("change", async (ev) => {
  const t = ev.target;
  if (t.dataset.tool === "plateBar") { UI.plateBar = +t.value; render(); }
  if (t.id === "imp" && t.files && t.files[0]) {
    try {
      const j = JSON.parse(await t.files[0].text());
      if (!Array.isArray(j.seances) || !Array.isArray(j.exercices)) throw new Error("format");
      const ok = await modal("Importer ce fichier ?", `<p>${j.seances.length} séances et ${j.exercices.length} exercices remplaceront le carnet de ce téléphone, puis seront envoyés sur GitHub.</p>`, [{ label: "Annuler", cls: "secondary", value: false }, { label: "Importer", value: true }]);
      if (ok) { DB = { exercices: j.exercices, programmes: j.programmes || [], seances: j.seances }; META.modIds = DB.seances.map((s) => s.id); META.dirtyProg = true; saveDB(); scheduleSync(100); render(); toast("Carnet importé."); }
    } catch (e) { toast("Ce fichier n'est pas un export du carnet."); }
    t.value = "";
  }
});
window.addEventListener("online", () => scheduleSync(500));

// ============================================================ Démarrage
async function boot() {
  if ("serviceWorker" in navigator) { try { await navigator.serviceWorker.register("sw.js"); } catch (e) {} }
  // Premier lancement sans données : on récupère le carnet du dépôt si un jeton est déjà là,
  // sinon on démarre avec le programme d'exemple livré avec l'appli.
  if (!DB.exercices.length && !CFG.token) {
    try { const r = await fetch("demarrage.json", { cache: "no-store" }); if (r.ok) { const j = await r.json(); DB = { exercices: j.exercices, programmes: j.programmes, seances: j.seances || [] }; saveDB(); } } catch (e) {}
  }
  render();
  if (DRAFT) wakeLock(true);
  if (CFG.token) sync(); else setSyncText(pendingCount() ? "Non synchronisé" : "Sur ce téléphone seulement");
}
boot();
