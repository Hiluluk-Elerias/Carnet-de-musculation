/* Carnet de musculation — application web hors ligne, données synchronisées dans un dépôt GitHub privé. */
"use strict";

// ============================================================ Constantes
const APP_VERSION = "1.6.0";
/** Vrai quand la page tourne dans l'appli Android (coque Capacitor). */
const NATIVE = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
const LS_KEYS = { db: "cm.db", meta: "cm.meta", cfg: "cm.cfg", draft: "cm.draft", poids: "cm.poids" };
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
  son: true,
  poidsAuto: true,
  nutriRepo: "Carnet-nutrition-data"
};
/** Reps en réserve → difficulté (1 = très facile … 5 = max). */
const RIR_DIFF = [5, 4, 3, 2, 1];

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
let POIDS = Object.assign({ list: [], maj: 0, err: "" }, lsGet(LS_KEYS.poids, {}));
const UI = { route: "accueil", param: null, progEdit: null, syncing: false, syncAgain: false, syncText: "" };

function saveDB() { lsSet(LS_KEYS.db, DB); lsSet(LS_KEYS.meta, META); }
function saveCfg() { lsSet(LS_KEYS.cfg, CFG); }
function saveDraft() { lsSet(LS_KEYS.draft, DRAFT); if (typeof updateOngoing === "function") updateOngoing(); }
const exo = (id) => DB.exercices.find((e) => e.id === id) || { id, nom: id, mode: "charge", min: 8, max: 12, incr: 2, repos: 90, unite: "" };
const sortedSeances = () => DB.seances.slice().sort((a, b) => (b.date || "").localeCompare(a.date || "") || (b.num || 0) - (a.num || 0));
const nextNum = () => DB.seances.reduce((m, s) => Math.max(m, s.num || 0), 0) + 1;

// ============================================================ Calculs (charges, records, progression)
// Modes : "charge" (kg), "corps" (poids du corps ± lest), "temps" (secondes tenues), "intervalles" (suspensions, ex. poutre 7 s / 3 s).
const isTemps = (e) => e.mode === "temps";
const isInter = (e) => e.mode === "intervalles";
const isCorps = (e) => e.mode === "corps" || isTemps(e) || isInter(e);
const hasE1rm = (e) => e.mode === "charge" || e.mode === "corps" || !e.mode;
/** Champ de la série qui porte la performance : secondes pour un exercice au temps, sinon reps (ou suspensions). */
const vKey = (e) => (isTemps(e) ? "sec" : "reps");
const vOf = (z, e) => num(z[vKey(e)]);
const vUnit = (e) => (isTemps(e) ? "s" : isInter(e) ? "susp." : "reps");
const vLabel = (v, e) => (isTemps(e) ? `${v} s` : isInter(e) ? `${v} susp.` : `${v} reps`);
const fourchette = (e) => `${e.min}–${e.max} ${vUnit(e)}`;
/** Charge affichée : pour le poids du corps, 0 = PdC, positif = lest, négatif = assistance. */
function kgLabel(kg, e) {
  if (kg === null || kg === undefined || kg === "") return "—";
  const k = num(kg);
  if (isCorps(e)) return k === 0 ? "PdC" : k > 0 ? `PdC +${fmt(k)}` : `PdC −${fmt(-k)}`;
  return `${fmt(k)} kg`;
}
/** Poids de corps utilisé dans les calculs : moyenne des 7 derniers jours du carnet nutrition, sinon la valeur saisie. */
function poidsActuel() {
  if (CFG.poidsAuto && POIDS.list.length) {
    const last = POIDS.list[POIDS.list.length - 1][0];
    const from = new Date(new Date(last + "T12:00:00").getTime() - 6 * 864e5).toISOString().slice(0, 10);
    const w = POIDS.list.filter(([d]) => d >= from).map(([, k]) => k);
    if (w.length) return Math.round((w.reduce((a, b) => a + b, 0) / w.length) * 10) / 10;
  }
  return num(CFG.poidsCorps) || 70;
}
const effLoad = (kg, e, pc) => (isCorps(e) ? (pc || poidsActuel()) + num(kg) : num(kg));
const e1rm = (kg, reps, e, pc) => { if (!hasE1rm(e)) return 0; const L = effLoad(kg, e, pc); const r = num(reps); return r > 0 && L > 0 ? L * (1 + r / 30) : 0; };
const workSets = (x) => (x.series || []).filter((s) => s.t !== "E");
/** Score d'une série pour comparer les séances : 1RM estimé, ou secondes, ou lest pour les intervalles. */
function setScore(z, e, pc) { return isTemps(e) ? effLoad(z.kg, e, pc) * num(z.sec) / 100 : isInter(e) ? effLoad(z.kg, e, pc) * num(z.reps) / 10 : e1rm(z.kg, z.reps, e, pc); }
function exoVolume(x, e, pc) { return hasE1rm(e) ? workSets(x).reduce((t, z) => t + effLoad(z.kg, e, pc) * num(z.reps), 0) : 0; }
function seanceVolume(s) { return (s.exercices || []).reduce((t, x) => t + exoVolume(x, exo(x.exo), s.pc), 0); }
/** Difficulté d'un exercice : celle notée, sinon déduite des reps en réserve de la série la plus dure. */
function diffOf(x) {
  if (x.difficulte) return num(x.difficulte);
  const r = workSets(x).filter((z) => z.rir !== undefined && z.rir !== null && z.rir !== "").map((z) => num(z.rir));
  return r.length ? RIR_DIFF[Math.min(4, Math.min(...r))] : null;
}

/** Historique d'un exercice, du plus ancien au plus récent. */
function historyOf(exoId, seances = DB.seances) {
  return seances.filter((s) => (s.exercices || []).some((x) => x.exo === exoId && workSets(x).length))
    .sort((a, b) => (a.date || "").localeCompare(b.date || "") || (a.num || 0) - (b.num || 0))
    .map((s) => ({ s, x: s.exercices.find((x) => x.exo === exoId && workSets(x).length) }));
}
function bestOf(exoId, seances = DB.seances) {
  const e = exo(exoId);
  const r = { e1rm: 0, e1rmSet: null, maxKg: -Infinity, maxKgSet: null, volSeance: 0, maxReps: 0, score: 0 };
  for (const { s, x } of historyOf(exoId, seances)) {
    for (const st of workSets(x)) {
      const v = e1rm(st.kg, st.reps, e, s.pc);
      if (v > r.e1rm) { r.e1rm = v; r.e1rmSet = { ...st, date: s.date }; }
      if (num(st.kg) > r.maxKg || (num(st.kg) === r.maxKg && vOf(st, e) > vOf(r.maxKgSet || {}, e))) { r.maxKg = num(st.kg); r.maxKgSet = { ...st, date: s.date }; }
      r.maxReps = Math.max(r.maxReps, vOf(st, e));
      r.score = Math.max(r.score, setScore(st, e, s.pc));
    }
    r.volSeance = Math.max(r.volSeance, exoVolume(x, e, s.pc));
  }
  return r;
}
/** Stagnation : aucun progrès sur les 3 dernières séances (depuis la dernière décharge). */
function stagnation(exoId) {
  const e = exo(exoId);
  let h = historyOf(exoId);
  const lastDl = h.map((o) => !!o.s.decharge).lastIndexOf(true);
  if (lastDl >= 0) h = h.slice(lastDl + 1);
  h = h.filter((o) => !o.s.decharge);
  if (h.length < 4) return false;
  const sc = h.map(({ s, x }) => Math.max(...workSets(x).map((z) => setScore(z, e, s.pc))));
  const before = Math.max(...sc.slice(0, -3)), recent = Math.max(...sc.slice(-3));
  // Pas de progrès alors que c'était dur : sans difficulté (moyenne < 3), c'est plutôt une charge trop légère.
  const dMoy = h.slice(-3).reduce((t, o) => t + (diffOf(o.x) || 3), 0) / 3;
  return recent <= before * 1.005 && dMoy >= 3;
}
const pas = (e) => (e.incr >= 4 ? 2 : e.incr > 0 ? Math.min(1, e.incr) : 1);

/** Double progression : difficulté ≤ 3 → on monte la perf jusqu'au haut de la fourchette puis la charge ; 4 → on consolide ; 5 → on allège. */
function suggest(exoId, defaultSets, opts = {}) {
  const e = exo(exoId), k = vKey(e);
  const h = historyOf(exoId);
  const last = h.length ? h[h.length - 1] : null;
  if (!last) return { kg: 0, reps: e.min, n: defaultSets || 3, consigne: "Première fois : choisis une charge que tu tiens proprement.", last: null, stagne: false };
  const ws = workSets(last.x);
  const kg = Math.max(...ws.map((z) => num(z.kg)));
  const atKg = ws.filter((z) => num(z.kg) === kg);
  const val = Math.min(...atKg.map((z) => num(z[k])));
  const d = diffOf(last.x) || 3;
  let n = defaultSets || ws.length;
  let out;
  if (d >= 5) out = { kg: kg - e.incr, reps: e.min, consigne: "Trop dur la dernière fois : on allège." };
  else if (d === 4) out = { kg, reps: val, consigne: "On consolide : même charge, même performance." };
  else if (val >= e.max) {
    if (e.incr > 0) out = { kg: kg + e.incr, reps: e.min, consigne: `Haut de fourchette atteint : +${fmt(e.incr)} kg et retour à ${vLabel(e.min, e)}.` };
    else if (isTemps(e)) out = { kg, reps: val + 5, consigne: "Haut de fourchette atteint : 5 s de plus." };
    else out = { kg, reps: val, consigne: "Haut de fourchette atteint : ajoute une série ou ralentis la descente." };
  } else out = { kg, reps: Math.min(e.max, val + (isTemps(e) ? (d <= 2 ? 10 : 5) : d <= 2 ? 2 : 1)), consigne: `Même charge, ${isTemps(e) ? "on tient plus longtemps" : "on ajoute des " + vUnit(e)}.` };
  const stagne = stagnation(exoId);
  if (opts.decharge) {
    if (hasE1rm(e) && !isCorps(e)) out.kg = Math.max(0, Math.round((out.kg * 0.9) / pas(e)) * pas(e));
    else if (isCorps(e) && e.incr > 0) out.kg = out.kg - e.incr;
    if (isTemps(e)) out.reps = Math.max(e.min, Math.round(out.reps * 0.7));
    n = Math.max(1, n - 1);
    out.consigne = "Séance de décharge : charge allégée et une série de moins, sans aller à l'échec.";
  } else if (stagne) out.consigne += " Pas de progrès depuis 3 séances : une séance de décharge peut relancer la progression.";
  out.kg = Math.round(out.kg * 100) / 100;
  return { ...out, n, last, stagne };
}

// ============================================================ Illustrations et muscles
// Dessins : Everkinetic (CC BY-SA 4.0). Photos : Free Exercise DB (domaine public).
// Cartes musculaires : projet wger, d'après Wikimedia Commons.
const IMG_DEFAUT = { tractions: "ek:0087", dips: "ek:0054", rdl: "ek:0118", "curl-inverse": "ek:0257", "split-squat": "ek:0129", "dev-militaire": "ekpng:dumbbell-shoulder-press", "face-pull": "_carte", pallof: "_carte", "releves-jambes": "_carte" };
const DESSINS_LOCAUX = new Set(["0087", "0054", "0118", "0257", "0129"]);
const PHOTOS_LOCALES = new Set(["Pullups", "Face_Pull", "Pallof_Press", "Split_Squat_with_Dumbbells", "Standing_Dumbbell_Press", "Romanian_Deadlift", "Dips_-_Triceps_Version", "Reverse_Barbell_Curl", "Hanging_Leg_Raise"]);
/** Zones de la carte musculaire : [n° de calque, face (f) ou dos (b), nom]. */
const ZONES = {
  pectoraux: [4, "f", "Pectoraux"], "deltoides-ant": [2, "f", "Deltoïdes antérieurs"], "deltoides-post": [2, "b", "Deltoïdes postérieurs"],
  biceps: [1, "f", "Biceps"], brachial: [13, "f", "Brachial"], triceps: [5, "b", "Triceps"], abdos: [6, "f", "Abdominaux"], obliques: [14, "f", "Obliques"],
  dentele: [3, "f", "Dentelé"], quadriceps: [10, "f", "Quadriceps"], ischios: [11, "b", "Ischio-jambiers"], fessiers: [8, "b", "Fessiers"],
  mollets: [7, "b", "Mollets"], trapezes: [9, "b", "Trapèzes"], dorsaux: [12, "b", "Grands dorsaux"], lombaires: [16, "b", "Lombaires"]
};
const MUSCLES_DEFAUT = {
  tractions: { p: ["dorsaux", "biceps"], s: ["brachial", "trapezes"] }, "face-pull": { p: ["deltoides-post", "trapezes"], s: [] },
  pallof: { p: ["obliques", "abdos"], s: [] }, "split-squat": { p: ["quadriceps", "fessiers"], s: ["ischios"] },
  "dev-militaire": { p: ["deltoides-ant"], s: ["triceps", "trapezes"] }, rdl: { p: ["ischios", "fessiers"], s: ["lombaires"] },
  dips: { p: ["triceps", "pectoraux"], s: ["deltoides-ant"] }, "curl-inverse": { p: ["brachial"], s: ["biceps"] }, "releves-jambes": { p: ["abdos"], s: ["obliques"] }
};
/** Correspondance des noms de muscles des bibliothèques vers les zones de la carte. */
const VERS_ZONE = {
  chest: "pectoraux", "pectoralis major": "pectoraux", shoulders: "deltoides-ant", deltoid: "deltoides-ant", biceps: "biceps", "biceps brachii": "biceps",
  triceps: "triceps", "triceps brachii": "triceps", abdominals: "abdos", obliques: "obliques", quadriceps: "quadriceps", hamstrings: "ischios",
  "ischiocrural muscles": "ischios", glutes: "fessiers", "glutaeus maximus": "fessiers", calves: "mollets", gastrocnemius: "mollets", soleus: "mollets",
  traps: "trapezes", trapezius: "trapezes", "middle back": "trapezes", lats: "dorsaux", "latissimus dorsi": "dorsaux", "lower back": "lombaires", "erector spinae": "lombaires", forearms: "brachial"
};
const zoneName = (m) => (ZONES[VERS_ZONE[m]] || [0, "", m])[2].toLowerCase();
const musclesOf = (e) => (e && (e.muscles || MUSCLES_DEFAUT[e.id])) || { p: [], s: [] };
function musclesText(e) {
  const m = musclesOf(e), n = (k) => (ZONES[k] ? ZONES[k][2] : k);
  return [m.p.length ? `<b>Principaux :</b> ${m.p.map(n).join(", ")}` : "", m.s.length ? `<b>Secondaires :</b> ${m.s.map(n).join(", ")}` : ""].filter(Boolean).join(" · ");
}
/** Silhouettes de face et de dos, muscles principaux en rouge et secondaires en orange. */
function bodyMap(e, size = "md") {
  const m = musclesOf(e);
  const side = (sd) => {
    let lay = "";
    m.s.forEach((k) => { const z = ZONES[k]; if (z && z[1] === sd) lay += `<img src="img/muscles/secondary/muscle-${z[0]}.svg" alt="">`; });
    m.p.forEach((k) => { const z = ZONES[k]; if (z && z[1] === sd) lay += `<img src="img/muscles/main/muscle-${z[0]}.svg" alt="">`; });
    return `<span class="body"><img src="img/muscles/${sd === "f" ? "front" : "back"}.webp" alt="">${lay}</span>`;
  };
  const label = [...m.p, ...m.s].map((k) => (ZONES[k] ? ZONES[k][2] : k)).join(", ");
  return `<span class="bodymap ${size}" role="img" aria-label="Muscles travaillés : ${esc(label || "non renseignés")}">${side("f")}${side("b")}</span>`;
}
const imgId = (e) => { if (!e || e.image === "_aucune") return ""; return e.image || IMG_DEFAUT[e.id] || "_carte"; };
const isDessin = (id) => id.startsWith("ek");
function imgUrl(id, f) {
  if (id.startsWith("ek:")) { const n = id.slice(3); return DESSINS_LOCAUX.has(n) ? `img/dessins/${n}-${f}.svg` : `https://raw.githubusercontent.com/everkinetic/data/main/dist/svg/${n}-${f ? "tension" : "relaxation"}.svg`; }
  if (id.startsWith("ekpng:")) return `img/dessins/${id.slice(6)}-${f}.png`;
  return PHOTOS_LOCALES.has(id) ? `img/exos/${id}-${f}.jpg` : `https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises/${encodeURIComponent(id)}/${f}.jpg`;
}
/** Vignette : dessin ou photo animés (début et fin du mouvement), ou carte des muscles. */
function thumb(e, size = "sm", clickable = true) {
  const id = imgId(e);
  let inner, cls = "";
  if (id === "_carte") { inner = bodyMap(e, "fill"); cls = " carte"; }
  else if (id) { inner = `<img src="${imgUrl(id, 0)}" alt="" loading="lazy" decoding="async"><img class="f2" src="${imgUrl(id, 1)}" alt="" loading="lazy" decoding="async">`; cls = isDessin(id) ? " dessin" : ""; }
  else inner = `<span class="ph">${esc((e.nom || "?").slice(0, 2))}</span>`;
  return clickable ? `<button type="button" class="thumb ${size}${cls}" data-act="img-show" data-exo="${esc(e.id)}" aria-label="Voir l'exécution et les muscles : ${esc(e.nom)}">${inner}</button>` : `<span class="thumb ${size}${cls}" aria-hidden="true">${inner}</span>`;
}
let CATALOGUE = null;
async function catalogue() {
  if (!CATALOGUE) {
    const get = async (f, type) => { try { return (await (await fetch(f)).json()).map((c) => ({ ...c, type })); } catch (e) { return []; } };
    CATALOGUE = [...(await get("catalogue-dessins.json", "Dessin")), ...(await get("catalogue.json", "Photo"))];
  }
  return CATALOGUE;
}
function showExoImage(e) {
  const id = imgId(e);
  modal(e.nom, `${id && id !== "_carte" ? thumb(e, "lg", false) : ""}<div class="map-modal">${bodyMap(e, "lg")}<p class="small">${musclesText(e) || "Muscles non renseignés (à régler dans Progrès)."}</p></div>
    <p class="muted small">${e.min}–${e.max} reps · repos ${restLabel(e.repos)}${e.unite ? " · " + esc(e.unite) : ""}</p>`, [{ label: "Fermer", value: null }]);
}
async function pickImage(e) {
  const cat = await catalogue();
  const list = (q) => { const t = q.trim().toLowerCase(); return cat.filter((c) => !t || c.n.toLowerCase().includes(t) || c.m.some((m) => zoneName(m).includes(t) || m.includes(t))).slice(0, 50); };
  const row = (c) => `<button type="button" class="item" data-img="${esc(c.id)}">${thumb({ id: "_", nom: c.n, image: c.id }, "sm", false)}<span class="grow" style="text-align:left">${esc(c.n)}<span class="muted small" style="display:block">${c.type} · ${esc(c.m.map(zoneName).join(", "))}</span></span></button>`;
  const cur = cat.find((c) => c.id === imgId(e));
  const p = modal("Choisir une illustration", `<label class="field" for="img-q"><span>Rechercher (nom anglais ou muscle)</span><input id="img-q" value="${esc(cur ? cur.n : "")}" autocomplete="off" placeholder="squat, curl, pectoraux…"></label><div class="list" id="img-res" style="margin-top:10px"></div>`,
    [{ label: "Carte des muscles", cls: "secondary", value: "_carte" }, { label: "Sans image", cls: "secondary", value: "_aucune" }, { label: "Annuler", cls: "secondary", value: null }]);
  const root = $("#modal-root"), res = $("#img-res", root), q = $("#img-q", root);
  const draw = () => { res.innerHTML = list(q.value).map(row).join("") || '<p class="muted">Aucun résultat.</p>'; };
  q.addEventListener("input", draw); draw();
  return new Promise((resolve) => {
    p.then(resolve);
    res.addEventListener("click", (ev) => { const b = ev.target.closest("[data-img]"); if (b) { root.innerHTML = ""; resolve(b.dataset.img); } });
  });
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
/** Poids de corps : lu dans le dépôt du carnet nutrition (jours/AAAA-MM.json → days[date].weight), lecture seule. */
async function fetchPoids() {
  if (!CFG.token || !CFG.poidsAuto || !CFG.nutriRepo) return;
  const months = [0, 1].map((k) => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - k); return d.toISOString().slice(0, 7); });
  try {
    const found = {};
    for (const m of months) {
      const r = await fetch(`https://api.github.com/repos/${encodeURIComponent(CFG.owner)}/${encodeURIComponent(CFG.nutriRepo)}/contents/jours/${m}.json?t=${Date.now()}`, { headers: ghHeaders(), cache: "no-store" });
      if (r.status === 404 && m === months[1]) continue;
      if (r.status === 404) { const t = await fetch(`https://api.github.com/repos/${encodeURIComponent(CFG.owner)}/${encodeURIComponent(CFG.nutriRepo)}`, { headers: ghHeaders(), cache: "no-store" }); if (!t.ok) throw new GhError(404, "Le jeton n'a pas accès au carnet nutrition : ajoute ce dépôt au jeton (lecture)."); continue; }
      if (!r.ok) throw new GhError(r.status, r.status === 403 ? "Le jeton n'a pas accès au carnet nutrition : ajoute ce dépôt au jeton (lecture)." : ghMessage(r.status));
      const j = JSON.parse(b64decode((await r.json()).content || ""));
      Object.entries((j && j.days) || {}).forEach(([d, v]) => { if (v && num(v.weight) > 0) found[d] = num(v.weight); });
    }
    const merged = Object.fromEntries(POIDS.list); Object.assign(merged, found);
    POIDS.list = Object.entries(merged).sort((a, b) => a[0].localeCompare(b[0])).slice(-120);
    POIDS.maj = Date.now(); POIDS.err = "";
  } catch (e) { POIDS.err = e.message || "Carnet nutrition injoignable."; }
  lsSet(LS_KEYS.poids, POIDS);
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
    if (Date.now() - (POIDS.maj || 0) > 3 * 3600e3) await fetchPoids();
    if (!CFG.exemples15) ajouterExemples();
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
// ---- Appli Android : notification programmée par Android, qui sonne et vibre même écran verrouillé.
function nativeLN() {
  if (!NATIVE) return null;
  try { return (window.Capacitor.Plugins && window.Capacitor.Plugins.LocalNotifications) || window.Capacitor.registerPlugin("LocalNotifications"); } catch (e) { return null; }
}
const NAT = { ready: false, exact: null, perm: "?", pending: null, error: "" };
async function nativeSetup() {
  const ln = nativeLN(); if (!ln || NAT.ready) return;
  try {
    await ln.createChannel({ id: "repos", name: "Fin du repos", description: "Sonne et vibre à la fin du temps de repos", importance: 5, visibility: 1, vibration: true });
    await ln.createChannel({ id: "seance", name: "Séance en cours", description: "Exercice et série en cours, avec le bouton Série faite", importance: 2, visibility: 1, vibration: false });
    if (ln.registerActionTypes) await ln.registerActionTypes({ types: [{ id: "SEANCE", actions: [{ id: "fait", title: "Série faite" }] }] });
    if (!NAT.listener && ln.addListener) {
      NAT.listener = true;
      ln.addListener("localNotificationActionPerformed", (ev) => { if (ev.actionId === "fait") markNextSet(); else if (DRAFT) location.hash = "#seance"; });
    }
    let p = await ln.checkPermissions(); if (p.display !== "granted") p = await ln.requestPermissions();
    NAT.perm = p.display;
    if (ln.checkExactNotificationSetting) { const ex = await ln.checkExactNotificationSetting(); NAT.exact = ex.exact_alarm === "granted"; }
    NAT.ready = true; NAT.error = "";
  } catch (e) { NAT.error = (e && e.message) || String(e); }
}
async function nativeSchedule(sec) {
  const ln = nativeLN(); if (!ln) return;
  try {
    await ln.cancel({ notifications: [{ id: 1 }] });
    if (sec <= 0) return;
    await ln.schedule({ notifications: [{ id: 1, title: "Repos terminé", body: T.label.replace(/<[^>]+>/g, "") || "C'est reparti", channelId: "repos", schedule: { at: new Date(Date.now() + sec * 1000), allowWhileIdle: true } }] });
    const pend = await ln.getPending(); NAT.pending = pend && pend.notifications ? pend.notifications.length : null; NAT.error = "";
  } catch (e) { NAT.error = (e && e.message) || String(e); }
}
async function nativeCancel() { const ln = nativeLN(); if (!ln) return; try { await ln.cancel({ notifications: [{ id: 1 }] }); if (ln.removeAllDeliveredNotifications) await ln.removeAllDeliveredNotifications(); } catch (e) {} }
/** Notification permanente de la séance (appli Android) : exercice et série en cours, bouton « Série faite ». */
let ongoingTimer = null;
function updateOngoing() {
  if (!NATIVE) return;
  clearTimeout(ongoingTimer);
  ongoingTimer = setTimeout(async () => {
    const ln = nativeLN(); if (!ln) return;
    try {
      if (!DRAFT) { await ln.cancel({ notifications: [{ id: 2 }] }); return; }
      const cur = currentSet(), st = draftStats();
      let title = `Séance ${DRAFT.num} · ${st.sets} séries faites`, body = "Toutes les séries sont faites : termine la séance.";
      if (cur) {
        const X = DRAFT.exercices[cur.xi], e = exo(X.exo), z = X.series[cur.si];
        title = `${X.bloc ? X.bloc + " · " : ""}${e.nom}`;
        body = `Série ${cur.si + 1}/${X.series.length} · ${vLabel(num(z[vKey(e)]), e)} · ${kgLabel(z.kg, e)}`;
        if (T.running && T.end > Date.now()) body += ` · repos jusqu'à ${new Date(T.end).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`;
      }
      await ln.schedule({ notifications: [{ id: 2, title, body, channelId: "seance", ongoing: true, autoCancel: false, actionTypeId: "SEANCE" }] });
    } catch (e) { NAT.error = (e && e.message) || String(e); }
  }, 300);
}
// Dans l'appli Android, le bip de la page sert aussi de secours tant que l'appli est à l'écran.
function scheduleAlert(sec) { scheduleBeeps(sec); if (NATIVE) nativeSchedule(sec); else scheduleNotif(sec); }
function cancelAlert() { cancelBeeps(); if (NATIVE) nativeCancel(); else clearTimeout(T.notifTimer); }

// ---- Effort chronométré (gainage) ou intervalles (poutre) : phases enchaînées, bip à chaque changement.
const SEQ = { on: false, phases: [], start: 0, total: 0, onDone: null, idx: -1 };
function beepAt(t0, freq, len) {
  const ctx = T.ctx; if (!ctx || !CFG.son || t0 < ctx.currentTime - 0.01) return;
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = "square"; o.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.22, t0 + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + len);
  o.connect(g).connect(ctx.destination); o.start(t0); o.stop(t0 + len + 0.05); T.oscs.push(o);
}
function phasesFor(e, z) {
  const ph = [{ sec: 3, label: "Prépare-toi…", work: false }];
  if (isTemps(e)) ph.push({ sec: Math.max(1, num(z.sec)), label: `Tiens bon : ${num(z.sec)} s`, work: true });
  else { const n = Math.max(1, num(z.reps)); for (let i = 0; i < n; i++) { ph.push({ sec: Math.max(1, num(e.travail) || 7), label: `Suspension ${i + 1}/${n}`, work: true }); if (i < n - 1) ph.push({ sec: Math.max(1, num(e.pause) || 3), label: "Pause", work: false }); } }
  return ph;
}
function startSequence(phases, onDone) {
  stopTimer(); cancelBeeps(); const ctx = audioCtx();
  Object.assign(SEQ, { on: true, phases, start: Date.now(), onDone, idx: -1, total: phases.reduce((t, p) => t + p.sec, 0) });
  if (ctx) { let t = ctx.currentTime + 0.05; phases.forEach((p) => { beepAt(t, p.work ? 1320 : 660, 0.15); t += p.sec; }); beepAt(t, 1320, 0.6); }
  $("#timer").hidden = false; $("#timer").classList.add("seq"); document.body.classList.add("timing");
  $("[data-act=t-minus]").textContent = "Annuler"; $("[data-act=t-plus]").hidden = true;
  tickTimer();
}
function endSequence(validate) {
  SEQ.on = false; cancelBeeps(); $("#timer").classList.remove("seq", "work");
  $("[data-act=t-minus]").textContent = "−15"; $("[data-act=t-plus]").hidden = false;
  const cb = SEQ.onDone; SEQ.onDone = null;
  if (validate && cb) cb(); else { $("#timer").hidden = true; document.body.classList.remove("timing"); }
}
function tickSequence() {
  const el = (Date.now() - SEQ.start) / 1000;
  if (el >= SEQ.total) { try { navigator.vibrate && navigator.vibrate(500); } catch (e) {} return endSequence(true); }
  let acc = 0, i = 0; while (i < SEQ.phases.length - 1 && acc + SEQ.phases[i].sec <= el) { acc += SEQ.phases[i].sec; i++; }
  const ph = SEQ.phases[i], left = Math.ceil(acc + ph.sec - el);
  if (i !== SEQ.idx) { SEQ.idx = i; try { navigator.vibrate && navigator.vibrate(ph.work ? 120 : 60); } catch (e) {} }
  $("#t-time").textContent = "0:" + String(left).padStart(2, "0");
  $("#t-bar").style.width = Math.max(0, Math.min(100, ((acc + ph.sec - el) / ph.sec) * 100)) + "%";
  $("#t-next").innerHTML = `<b>${esc(ph.label)}</b> · OK pour arrêter et valider la série`;
  $("#timer").classList.toggle("work", !!ph.work);
}

function startTimer(sec, label) {
  T.total = sec; T.end = Date.now() + sec * 1000; T.running = true; T.buzzed = false; T.label = label;
  scheduleAlert(sec);
  $("#timer").hidden = false; $("#timer").classList.remove("over"); document.body.classList.add("timing");
  $("#t-next").innerHTML = label;
  tickTimer(); updateOngoing();
}
function adjustTimer(delta) {
  if (!T.running) return;
  T.end += delta * 1000; T.total = Math.max(1, T.total + delta);
  const left = (T.end - Date.now()) / 1000;
  if (left > 0) { T.buzzed = false; $("#timer").classList.remove("over"); scheduleAlert(left); } else cancelAlert();
  tickTimer();
}
function stopTimer() { const was = T.running; T.running = false; cancelAlert(); $("#timer").hidden = true; document.body.classList.remove("timing"); if (was) updateOngoing(); }
function tickTimer() {
  if (SEQ.on) return tickSequence();
  if (!T.running) return;
  const left = Math.round((T.end - Date.now()) / 1000), a = Math.abs(left);
  $("#t-time").textContent = (left < 0 ? "+" : "") + Math.floor(a / 60) + ":" + String(a % 60).padStart(2, "0");
  $("#t-bar").style.width = Math.max(0, Math.min(100, (left / T.total) * 100)) + "%";
  if (left <= 0 && !T.buzzed) { T.buzzed = true; $("#timer").classList.add("over"); try { navigator.vibrate && navigator.vibrate([300, 150, 300, 150, 500]); } catch (e) {} }
}
setInterval(() => { tickTimer(); tickChrono(); }, 250);
document.addEventListener("visibilitychange", () => { if (!document.hidden && DRAFT) wakeLock(true); });

// ============================================================ Séance en cours
function newDraftExo(exoId, bloc, n, decharge) {
  const s = suggest(exoId, n, { decharge }), e = exo(exoId);
  return { exo: exoId, bloc: bloc || "", difficulte: null, note: "", saute: false, series: Array.from({ length: s.n }, () => ({ t: "T", kg: s.kg, [vKey(e)]: s.reps, ok: false })) };
}
function startSeance(progId, decharge = false) {
  const p = DB.programmes.find((x) => x.id === progId);
  if (!p) return;
  DRAFT = { id: uid(), num: nextNum(), programme: p.id, nomProgramme: p.nom, date: todayISO(), debut: Date.now(), decharge: !!decharge, exercices: p.items.map((it) => newDraftExo(it.exo, it.bloc, it.series, decharge)) };
  saveDraft(); askNotifications(); wakeLock(true);
  location.hash = "#seance";
}
/** Prochaine série à faire : celle qu'indique le minuteur, sinon la première non cochée. */
function currentSet() {
  if (!DRAFT) return null;
  const xs = DRAFT.exercices, free = (i) => xs[i] && !xs[i].saute && xs[i].series.some((z) => !z.ok);
  let xi = DRAFT.nextXi;
  if (!free(xi)) xi = xs.findIndex((x, i) => free(i));
  if (xi < 0 || xi === undefined || xi === null) return null;
  return { xi, si: xs[xi].series.findIndex((z) => !z.ok) };
}
function validateSet(xi, si) {
  if (!DRAFT || !DRAFT.exercices[xi]) return;
  const X = DRAFT.exercices[xi], z = X.series[si], e = exo(X.exo);
  z.ok = true;
  const nx = nextAfter(xi);
  DRAFT.nextXi = nx ? nx.i : null;
  saveDraft(); render();
  const label = nx ? `Ensuite : <b>${esc(nx.x.bloc ? nx.x.bloc + " · " : "")}${esc(exo(nx.x.exo).nom)}</b>, série ${nx.x.series.findIndex((q) => !q.ok) + 1}` : "Toutes les séries sont faites : termine la séance.";
  startTimer(z.t === "E" ? Math.min(60, num(e.repos) || 60) : num(e.repos) || 90, label);
}
function markNextSet() { const c = currentSet(); if (c) { audioCtx(); validateSet(c.xi, c.si); } }
function askNotifications() { if (NATIVE) { nativeSetup(); return; } try { if ("Notification" in window && Notification.permission === "default") Notification.requestPermission(); } catch (e) {} }
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
  DRAFT.exercices.forEach((x) => { const e = exo(x.exo); x.series.forEach((s) => { if (s.ok) { sets++; if (s.t !== "E" && hasE1rm(e)) vol += effLoad(s.kg, e) * num(s.reps); } }); });
  return { sets, vol };
}
function tickChrono() { const el = $("#chrono"); if (el && DRAFT) el.textContent = dur((Date.now() - DRAFT.debut) / 1000); }

function finishPreview() {
  const done = DRAFT.exercices.filter((x) => !x.saute).map((x) => {
    const e = exo(x.exo), k = vKey(e);
    return { exo: x.exo, bloc: x.bloc, difficulte: x.difficulte, note: x.note || "", series: x.series.filter((z) => z.ok).map((z) => { const o = { t: z.t, kg: num(z.kg), [k]: num(z[k]) }; if (z.rir !== undefined && z.rir !== null) o.rir = num(z.rir); return o; }) };
  }).filter((x) => x.series.length);
  const seance = { id: DRAFT.id, num: DRAFT.num, date: DRAFT.date, programme: DRAFT.programme, debut: new Date(DRAFT.debut).toISOString(), duree: Math.round((Date.now() - DRAFT.debut) / 1000), pc: poidsActuel(), exercices: done };
  if (DRAFT.decharge) seance.decharge = true;
  const others = DB.seances.filter((s) => s.id !== seance.id);
  const records = [];
  done.forEach((x) => {
    const e = exo(x.exo), before = bestOf(x.exo, others);
    if (!historyOf(x.exo, others).length) return;
    const now = bestOf(x.exo, [seance]);
    if (hasE1rm(e) && now.e1rm > before.e1rm + 0.01) records.push(`${e.nom} : 1RM estimé ${fmt(now.e1rm, 1)} kg`);
    else if (now.maxKg > before.maxKg) records.push(`${e.nom} : charge max ${kgLabel(now.maxKg, e)}`);
    else if (!hasE1rm(e) && now.score > before.score + 0.01) records.push(`${e.nom} : meilleure performance`);
  });
  return { seance, records, missing: DRAFT.exercices.filter((x) => !x.saute && x.series.some((s) => s.ok) && !diffOf(x)).map((x) => exo(x.exo).nom) };
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
  if (SEQ.on) endSequence(false);
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
  const body = `<div class="list">${opts.map((e) => `<button type="button" class="item" data-pick="${esc(e.id)}"><span class="grow" style="text-align:left">${esc(e.nom)}</span><span class="r">${esc(fourchette(e))}</span></button>`).join("") || '<p class="muted">Tous les exercices sont déjà là. Crée-en un dans Progrès.</p>'}</div>`;
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
  h += `<p class="muted small">Poids de corps utilisé : <b>${fmt(poidsActuel(), 1)} kg</b>${CFG.poidsAuto && POIDS.list.length ? " (moyenne 7 jours du carnet nutrition)" : ""}.</p>`;
  h += `<h2>Programmes</h2>`;
  DB.programmes.forEach((p) => {
    const lastP = all.find((s) => s.programme === p.id);
    const stag = p.items.filter((it) => stagnation(it.exo)).map((it) => exo(it.exo).nom);
    if (stag.length && !DRAFT) h += `<div class="banner warn"><b>Décharge conseillée</b> pour ${esc(p.nom)} : pas de progrès depuis 3 séances sur ${stag.map(esc).join(", ")}. Une séance plus légère (−10 %, une série de moins) aide à repartir.<div class="row" style="margin-top:8px"><button type="button" class="btn secondary" data-act="start-dl" data-id="${esc(p.id)}">Séance de décharge</button></div></div>`;
    h += `<div class="card"><a class="row link" href="#apercu/${esc(p.id)}"><div class="grow"><h3>${esc(p.nom)}</h3><div class="muted small">${p.items.length} exercices · ${lastP ? "dernière fois le " + dateLong(lastP.date) : "jamais fait"}</div></div><span class="muted" aria-hidden="true">›</span></a>
      ${progTable(p, false, true)}
      <div class="row"><button type="button" class="btn grow" data-act="start" data-id="${esc(p.id)}" ${DRAFT ? "disabled" : ""}>Commencer</button><a class="btn secondary" href="#apercu/${esc(p.id)}">Détail</a><a class="btn secondary" href="#programme/${esc(p.id)}">Modifier</a></div></div>`;
  });
  h += `<button type="button" class="btn secondary" data-act="new-prog">Nouveau programme</button>`;
  return h;
}

/** Détail d'un programme : tableau comme dans le carnet Word (bloc, exercice, séries × reps, charge, enchaînement). */
function viewApercu(id) {
  const p = DB.programmes.find((x) => x.id === id);
  if (!p) { header("Programme introuvable"); return `<p><a href="#accueil">Retour</a></p>`; }
  const dl = UI.apercuDl === id;
  header(p.nom, `Séance ${nextNum()} · ${dateLong(todayISO())}${dl ? " · décharge" : ""}`);
  let h = `<div class="seg" role="group" aria-label="Type de séance"><button type="button" data-act="ap-mode" data-id="${esc(p.id)}" data-v="0" aria-pressed="${!dl}">Séance normale</button><button type="button" data-act="ap-mode" data-id="${esc(p.id)}" data-v="1" aria-pressed="${dl}">Séance de décharge</button></div>`;
  h += `<div class="card">${progTable(p, dl, false)}</div>`;
  const notes = p.items.map((it) => { const s = suggest(it.exo, it.series, { decharge: dl }); return s.last ? `<li><b>${esc(it.bloc ? it.bloc + " · " : "")}${esc(exo(it.exo).nom)}</b>${s.stagne && !dl ? ' <span class="pr">Stagnation</span>' : ""} — ${esc(s.consigne)}</li>` : ""; }).join("");
  if (notes) h += `<div class="card"><h3>Pourquoi ces charges</h3><ul class="notes">${notes}</ul></div>`;
  h += `<div class="row"><a class="btn secondary" href="#programme/${esc(p.id)}">Modifier</a><button type="button" class="btn grow" data-act="${dl ? "start-dl" : "start"}" data-id="${esc(p.id)}" ${DRAFT ? "disabled" : ""}>${DRAFT ? "Une séance est déjà en cours" : dl ? "Commencer la décharge" : "Commencer la séance"}</button></div>`;
  return h;
}
/** Charge écrite comme dans le carnet : « Poids du corps », « 2 × 12 kg » pour les haltères. */
function chargeTxt(kg, e) {
  const k = num(kg);
  if (isCorps(e)) return k === 0 ? "PdC" : k > 0 ? `PdC + ${fmt(k)} kg` : `PdC − ${fmt(-k)} kg`;
  return /halt[eè]re/i.test(e.unite || "") ? `2 × ${fmt(k)} kg` : `${fmt(k)} kg`;
}
function seriesTxt(n, v, e) {
  const suf = /par c[oô]t[eé]/i.test(e.unite || "") ? " / côté" : /par jambe/i.test(e.unite || "") ? " / jambe" : "";
  return isTemps(e) ? `${n} × ${v} s` : isInter(e) ? `${n} × ${v} susp.` : `${n} × ${v}${suf}`;
}
/** Tableau du programme. compact : sans le repos et l'enchaînement sous chaque exercice (accueil). */
function progTable(p, dl, compact) {
  let rows = "";
  groupBlocs(p.items).forEach((g) => {
    g.items.forEach(({ it }, k) => {
      const e = exo(it.exo), s = suggest(it.exo, it.series, { decharge: dl });
      let ens = restLabel(e.repos);
      if (g.ss) ens += k < g.items.length - 1 ? `, puis ${g.items[k + 1].it.bloc}` : `, puis retour ${g.items[0].it.bloc}`;
      const sous = [isInter(e) ? `${num(e.travail) || 7} s / ${num(e.pause) || 3} s` : "", compact ? "" : `Repos ${ens}`].filter(Boolean).join(" · ");
      rows += `<tr class="${k === 0 ? "grp" : ""}"><td class="b">${esc(it.bloc || "")}</td><td>${esc(e.nom)}${sous ? `<div class="muted small">${esc(sous)}</div>` : ""}</td><td class="n nw">${esc(seriesTxt(s.n, s.reps, e))}</td><td class="nw">${esc(chargeTxt(s.kg, e))}</td></tr>`;
    });
  });
  return `<div class="tbl-wrap"><table class="data prog${compact ? " compact" : ""}"><thead><tr><th>Bloc</th><th>Exercice</th><th class="n">Séries × reps</th><th>Charge</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}
/** Regroupe les exercices d'un même bloc (A1, A2, A3…) en superset. */
function groupBlocs(items) {
  const out = [];
  items.forEach((it, i) => {
    const m = /^([A-Za-z])\d/.exec(it.bloc || ""), l = m ? m[1].toUpperCase() : null, last = out[out.length - 1];
    if (l && last && last.lettre === l) last.items.push({ it, i }); else out.push({ lettre: l, items: [{ it, i }] });
  });
  out.forEach((g) => { g.ss = !!g.lettre && g.items.length > 1; });
  return out;
}
/** Objectif de l'exercice : séries, reps (ou durée) et charge l'une sous l'autre. */
function goalHtml(s, e) {
  return `<dl class="goal"><div><dt>Séries</dt><dd>${s.n}</dd></div><div><dt>${isTemps(e) ? "Durée" : isInter(e) ? "Suspensions" : "Reps"}</dt><dd>${isTemps(e) ? s.reps + " s" : s.reps}</dd></div><div><dt>${isCorps(e) ? "Lest" : "Charge"}</dt><dd>${esc(kgLabel(s.kg, e))}</dd></div></dl>`;
}

function viewSeance() {
  if (!DRAFT) { location.hash = "#accueil"; return ""; }
  header(`Séance ${DRAFT.num}`, esc(DRAFT.nomProgramme) + (DRAFT.decharge ? " · décharge" : ""), `<span class="chrono" id="chrono">${dur((Date.now() - DRAFT.debut) / 1000)}</span>`);
  const st = draftStats();
  let h = `<div class="row wrap"><label class="field grow" for="d-date"><span>Date</span><input type="date" id="d-date" data-bind="date" value="${esc(DRAFT.date)}"></label>
    <div class="stat" style="flex:0 0 auto"><b>${st.sets}</b><span>séries</span></div><div class="stat" style="flex:0 0 auto"><b>${fmt(st.vol, 0)}</b><span>kg soulevés</span></div></div>`;
  groupBlocs(DRAFT.exercices.map((x) => ({ bloc: x.bloc, x }))).forEach((g) => {
    if (g.ss) h += `<div class="superset"><div class="ss-head">Superset ${esc(g.lettre)} · enchaîne ${g.items.map(({ it }) => esc(it.bloc)).join(" → ")}, puis recommence</div>`;
    g.items.forEach(({ i }) => { h += exoCard(DRAFT.exercices[i], i); });
    if (g.ss) h += `</div>`;
  });
  h += `<button type="button" class="btn secondary" data-act="x-add">Ajouter un exercice</button>
    <div class="row"><button type="button" class="btn danger" data-act="abandon">Abandonner</button><button type="button" class="btn grow" data-act="finish">Terminer la séance</button></div>`;
  return h;
}
function exoCard(x, xi) {
  const e = exo(x.exo), k = vKey(e), s = suggest(x.exo, x.series.filter((z) => z.t !== "E").length, { decharge: DRAFT.decharge }), prev = prevSetsOf(x.exo);
  const dAuto = !x.difficulte ? diffOf(x) : null;
  const complete = x.series.length && x.series.every((z) => z.ok) && diffOf(x);
  const chrono = isTemps(e) || isInter(e);
  let h = `<section class="ex${x.saute ? " skipped" : ""}${complete ? " complete" : ""}" aria-labelledby="x-${xi}">
    <div class="ex-head"><div class="grow"><div class="row" style="gap:8px">${x.bloc ? `<span class="bloc">${esc(x.bloc)}</span>` : ""}<h3 id="x-${xi}">${esc(e.nom)}</h3></div>
    <div class="ex-meta">${fourchette(e)} · repos ${restLabel(e.repos)}${isInter(e) ? ` · ${num(e.travail) || 7} s / ${num(e.pause) || 3} s` : ""}${e.unite ? " · " + esc(e.unite) : ""}</div></div>
    <button type="button" class="mini" data-act="x-menu" data-x="${xi}" aria-label="Options de l'exercice">•••</button></div>`;
  if (x.saute) return h + `<button type="button" class="btn secondary" data-act="x-skip" data-x="${xi}">Reprendre cet exercice</button></section>`;
  h += `<div class="hint-row"><div class="goal-row">${goalHtml(s, e)}</div><p class="muted small">${s.stagne && !DRAFT.decharge ? '<span class="pr">Stagnation</span> ' : ""}${esc(s.consigne)}</p></div>
    <table class="sets"><thead><tr><th scope="col">Série</th><th scope="col">Précédent</th><th scope="col">${isCorps(e) ? "± kg" : "kg"}</th><th scope="col">${isTemps(e) ? "Sec." : isInter(e) ? "Susp." : "Reps"}</th><th scope="col"><span class="sr">Fait</span>${chrono ? "▶" : "✓"}</th></tr></thead><tbody>`;
  let wn = 0;
  x.series.forEach((z, si) => {
    const label = z.t === "E" ? "É" : String(++wn);
    const p = prev[si];
    h += `<tr class="${z.ok ? "ok" : ""}"><td><button type="button" class="set-n${z.t === "E" ? " warm" : ""}" data-act="s-type" data-x="${xi}" data-s="${si}" aria-label="Série ${label}, toucher pour passer en ${z.t === "E" ? "série de travail" : "échauffement"}">${label}</button></td>
      <td>${p ? `<button type="button" class="prev" data-act="s-prev" data-x="${xi}" data-s="${si}" aria-label="Reprendre la série précédente">${esc(kgLabel(p.kg, e).replace(" kg", ""))} × ${num(p[k])}${isTemps(e) ? " s" : ""}</button>` : '<span class="muted">—</span>'}</td>
      <td><input id="kg-${xi}-${si}" inputmode="decimal" data-bind="kg" data-x="${xi}" data-s="${si}" value="${esc(fmt(z.kg))}" aria-label="Charge série ${label}"></td>
      <td><input id="v-${xi}-${si}" inputmode="numeric" data-bind="${k}" data-x="${xi}" data-s="${si}" value="${esc(num(z[k]))}" aria-label="${isTemps(e) ? "Secondes" : isInter(e) ? "Suspensions" : "Reps"} série ${label}"></td>
      <td><button type="button" class="check${chrono && !z.ok ? " go" : ""}" data-act="s-ok" data-x="${xi}" data-s="${si}" aria-pressed="${!!z.ok}" aria-label="${chrono && !z.ok ? "Lancer le chrono de la série " : "Série faite "}${label}">${chrono && !z.ok ? "▶" : "✓"}</button></td></tr>`;
    if (z.ok && z.t !== "E" && !chrono) {
      h += `<tr class="rir-row"><td colspan="5"><span class="muted small">En réserve :</span>${[0, 1, 2, 3, 4].map((r) => `<button type="button" class="rir" data-act="s-rir" data-x="${xi}" data-s="${si}" data-v="${r}" aria-pressed="${z.rir === r}" aria-label="${r === 4 ? "4 reps ou plus" : r + " rep"} en réserve">${r === 4 ? "4+" : r}</button>`).join("")}</td></tr>`;
    }
  });
  h += `</tbody></table>
    <div class="row"><button type="button" class="btn ghost" data-act="s-add" data-x="${xi}">+ Série</button><button type="button" class="btn ghost" data-act="s-del" data-x="${xi}" ${x.series.length ? "" : "disabled"}>− Série</button></div>
    <div><div class="ex-meta" style="margin-bottom:6px">Difficulté ressentie${dAuto ? ` · déduite des reps en réserve : <b>${dAuto}</b>` : !chrono ? " (ou note les reps en réserve sur chaque série)" : ""}</div><div class="diff">${DIFF.map((d) => `<button type="button" style="--d:${d.c}" data-act="x-diff" data-x="${xi}" data-v="${d.v}" aria-pressed="${x.difficulte === d.v}" class="${dAuto === d.v ? "auto" : ""}"><b>${d.v}</b><small>${d.t}</small></button>`).join("")}</div></div>
    <input class="note" id="note-${xi}" data-bind="note" data-x="${xi}" placeholder="Remarque (montage, sensation…)" value="${esc(x.note)}" aria-label="Remarque">
  </section>`;
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
  header(`Séance ${s.num}`, esc(dateLong(s.date)) + (s.decharge ? " · décharge" : "") + (s.pc ? ` · ${fmt(s.pc, 1)} kg` : ""));
  const others = DB.seances.filter((x) => (x.date || "") < (s.date || "") || ((x.date || "") === (s.date || "") && x.num < s.num));
  let h = `<div class="stats"><div class="stat"><b>${s.duree ? dur(s.duree) : "—"}</b><span>durée</span></div><div class="stat"><b>${s.exercices.reduce((t, x) => t + workSets(x).length, 0)}</b><span>séries</span></div><div class="stat"><b>${fmt(seanceVolume(s), 0)}</b><span>kg soulevés</span></div></div>`;
  s.exercices.forEach((x) => {
    const e = exo(x.exo), d = DIFF.find((z) => z.v === diffOf(x));
    const before = bestOf(x.exo, others), now = bestOf(x.exo, [s]);
    const isPr = historyOf(x.exo, others).length && now.score > before.score + 0.01;
    let wn = 0;
    h += `<div class="card"><div class="row">${x.bloc ? `<span class="bloc">${esc(x.bloc)}</span>` : ""}<a class="grow" href="#exercice/${esc(x.exo)}"><h3>${esc(e.nom)}</h3></a>${isPr ? '<span class="pr">Record</span>' : ""}${d ? `<span class="pill" style="background:${d.c}" title="Difficulté ${d.v}">${d.v}</span>` : ""}</div>
      <div class="tbl-wrap"><table class="data"><tbody>${x.series.map((z) => `<tr><td>${z.t === "E" ? "Échauff." : "Série " + ++wn}</td><td class="n">${esc(kgLabel(z.kg, e))}</td><td class="n">× ${esc(vLabel(vOf(z, e), e))}</td><td class="n muted">${hasE1rm(e) ? `1RM ≈ ${fmt(e1rm(z.kg, z.reps, e, s.pc), 1)}` : ""}${z.rir !== undefined ? ` · RIR ${z.rir >= 4 ? "4+" : z.rir}` : ""}</td></tr>`).join("")}</tbody></table></div>
      ${x.note ? `<div class="muted small">${esc(x.note)}</div>` : ""}</div>`;
  });
  h += `<button type="button" class="btn danger" data-act="del-seance" data-id="${esc(s.id)}">Supprimer cette séance</button>`;
  return h;
}

const lundi = (d) => { const x = new Date(d); x.setHours(12, 0, 0, 0); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; };
const isoDay = (d) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
/** Séries de travail par muscle sur une semaine (lundi → dimanche) : principal = 1, secondaire = 0,5. */
function volumeSemaine(offset) {
  const deb = lundi(new Date()); deb.setDate(deb.getDate() + 7 * offset);
  const fin = new Date(deb); fin.setDate(fin.getDate() + 6);
  const a = isoDay(deb), b = isoDay(fin), out = {};
  let nb = 0;
  DB.seances.filter((s) => s.date >= a && s.date <= b).forEach((s) => {
    nb++;
    s.exercices.forEach((x) => { const m = musclesOf(exo(x.exo)), n = workSets(x).length; m.p.forEach((z) => { out[z] = (out[z] || 0) + n; }); m.s.forEach((z) => { out[z] = (out[z] || 0) + n / 2; }); });
  });
  return { out, deb, fin, nb };
}
/** Carte du corps colorée selon le nombre de séries de la semaine. */
function bodyMapHeat(vol, size = "lg") {
  const max = Math.max(8, ...Object.values(vol));
  const side = (sd) => `<span class="body"><img src="img/muscles/${sd === "f" ? "front" : "back"}.webp" alt="">${Object.entries(vol).filter(([k]) => ZONES[k] && ZONES[k][1] === sd).map(([k, v]) => `<img src="img/muscles/main/muscle-${ZONES[k][0]}.svg" alt="" style="opacity:${(0.25 + 0.75 * Math.min(1, v / max)).toFixed(2)}">`).join("")}</span>`;
  return `<span class="bodymap ${size}" role="img" aria-label="Volume de la semaine par muscle">${side("f")}${side("b")}</span>`;
}
function viewExercices() {
  header("Progrès");
  const off = UI.semaine || 0, v = volumeSemaine(off);
  const weeks = [-3, -2, -1, 0].map((k) => volumeSemaine(off + k).out);
  const rows = Object.keys(ZONES).map((k) => [k, v.out[k] || 0]).filter(([k]) => weeks.some((w) => w[k])).sort((a, b) => b[1] - a[1]);
  const maxV = Math.max(10, ...rows.map((r) => r[1]));
  const fmtD = (d) => d.toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
  let h = `<div class="card"><div class="row"><button type="button" class="mini" data-act="sem" data-v="-1" aria-label="Semaine précédente">‹</button><h3 class="grow" style="text-align:center">${off === 0 ? "Cette semaine" : off === -1 ? "Semaine dernière" : "Semaine du " + fmtD(v.deb)}<span class="muted small" style="display:block;font-weight:400">${fmtD(v.deb)} – ${fmtD(v.fin)} · ${v.nb} séance${v.nb > 1 ? "s" : ""}</span></h3><button type="button" class="mini" data-act="sem" data-v="1" aria-label="Semaine suivante" ${off >= 0 ? "disabled" : ""}>›</button></div>
    <div class="map-modal">${bodyMapHeat(v.out)}</div>
    ${rows.length ? `<div class="tbl-wrap"><table class="data vol"><thead><tr><th>Muscle</th><th class="n">S-3</th><th class="n">S-2</th><th class="n">S-1</th><th class="n">Séries</th></tr></thead><tbody>${rows.map(([k, n]) => `<tr><td>${esc(ZONES[k][2])}<div class="vbar"><i style="width:${(100 * n / maxV).toFixed(0)}%"></i></div></td>${weeks.slice(0, 3).map((w) => `<td class="n muted">${w[k] ? fmt(w[k], 1) : "·"}</td>`).join("")}<td class="n"><b>${fmt(n, 1)}</b></td></tr>`).join("")}</tbody></table></div>` : '<p class="muted small">Aucune séance cette semaine.</p>'}
    <p class="muted small">Séries de travail : muscle principal = 1, secondaire = ½. L'escalade n'est pas comptée : elle charge déjà fortement dorsaux, biceps et avant-bras.</p></div>`;
  const pts = POIDS.list.slice(-30).map(([d, k]) => ({ y: k, label: dateShort(d) }));
  h += `<div class="card"><h3>Poids de corps</h3><p class="small">Valeur utilisée : <b>${fmt(poidsActuel(), 1)} kg</b>${CFG.poidsAuto && POIDS.list.length ? ` (moyenne 7 j, carnet nutrition, dernière pesée ${dateShort(POIDS.list[POIDS.list.length - 1][0])})` : " (saisie dans Réglages)"}</p>${pts.length > 1 ? lineChart(pts, "kg") : ""}${POIDS.err ? `<div class="banner warn">${esc(POIDS.err)}</div>` : ""}</div>`;
  const used = DB.exercices.slice().sort((a, b) => a.nom.localeCompare(b.nom, "fr"));
  h += `<h2>Exercices</h2><p class="muted small">1RM estimé = charge que tu pourrais soulever une fois (formule d'Epley). Pour les exercices au poids du corps, ton poids est ajouté.</p><div class="list">`;
  used.forEach((e) => {
    const hist = historyOf(e.id), b = bestOf(e.id);
    const last = hist.length ? hist[hist.length - 1] : null;
    const lastTop = last ? workSets(last.x).reduce((m, z) => (num(z.kg) > num(m.kg) ? z : m), workSets(last.x)[0]) : null;
    h += `<a class="item" href="#exercice/${esc(e.id)}"><div class="grow"><b>${esc(e.nom)}</b>${stagnation(e.id) ? ' <span class="pr">Stagnation</span>' : ""}<div class="muted small">${last ? `Dernière fois : ${esc(kgLabel(lastTop.kg, e))} × ${esc(vLabel(vOf(lastTop, e), e))} (${dateShort(last.s.date)})` : "Pas encore fait"}</div></div><div class="r">${hasE1rm(e) && b.e1rm ? `1RM ≈ ${fmt(b.e1rm, 0)} kg` : b.maxReps ? `max ${esc(vLabel(b.maxReps, e))}` : ""}<br>${hist.length} séance${hist.length > 1 ? "s" : ""}</div></a>`;
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
  const id0 = imgId(e);
  let h = `<p class="small">${musclesText(e) || "Muscles non renseignés : choisis-les dans les réglages ci-dessous (ils servent au volume par muscle)."}</p><div class="records">
    ${hasE1rm(e) ? `<div class="stat"><b>${b.e1rm ? fmt(b.e1rm, 1) : "—"}</b><span>1RM estimé (kg)${b.e1rmSet ? ` · ${esc(kgLabel(b.e1rmSet.kg, e))} × ${b.e1rmSet.reps}` : ""}</span></div>` : ""}
    <div class="stat"><b>${b.maxKgSet ? esc(kgLabel(b.maxKg, e)) : "—"}</b><span>charge max${b.maxKgSet ? ` · × ${esc(vLabel(vOf(b.maxKgSet, e), e))} le ${dateShort(b.maxKgSet.date)}` : ""}</span></div>
    <div class="stat"><b>${b.maxReps ? esc(vLabel(b.maxReps, e)) : "—"}</b><span>max sur une série</span></div>
    <div class="stat"><b>${b.volSeance ? fmt(b.volSeance, 0) : "—"}</b><span>meilleur volume (kg)</span></div></div>`;
  h += hasE1rm(e)
    ? `<div class="card"><h3>1RM estimé par séance</h3>${lineChart(hist.map(({ s, x }) => ({ y: Math.max(...workSets(x).map((z) => e1rm(z.kg, z.reps, e, s.pc))), label: dateShort(s.date) })), "kg")}</div>`
    : `<div class="card"><h3>${isTemps(e) ? "Durée max par séance" : "Lest max par séance"}</h3>${lineChart(hist.map(({ s, x }) => ({ y: Math.max(...workSets(x).map((z) => (isTemps(e) ? num(z.sec) : num(z.kg)))), label: dateShort(s.date) })), isTemps(e) ? "s" : "kg")}</div>`;
  h += `<div class="card"><h3>Historique</h3><div class="tbl-wrap"><table class="data"><thead><tr><th>Date</th><th>Séries</th><th>Diff.</th></tr></thead><tbody>${hist.slice().reverse().map(({ s, x }) => { const d = DIFF.find((z) => z.v === diffOf(x)); return `<tr><td><a href="#historique/${esc(s.id)}">${dateShort(s.date)}</a>${s.decharge ? '<div class="muted small">décharge</div>' : ""}</td><td>${workSets(x).map((z) => `${esc(kgLabel(z.kg, e).replace(" kg", ""))}×${vOf(z, e)}${isTemps(e) ? "s" : ""}`).join(", ")}${x.note ? `<div class="muted small">${esc(x.note)}</div>` : ""}</td><td class="n">${d ? `<span class="pill" style="background:${d.c}">${d.v}</span>` : "—"}</td></tr>`; }).join("") || '<tr><td colspan="3" class="muted">Pas encore fait.</td></tr>'}</tbody></table></div></div>`;
  h += `<div class="card"><h3>Réglages de l'exercice</h3>
    <div class="fgrid">
      <label class="field wide" for="e-nom"><span>Nom</span><input id="e-nom" value="${esc(e.nom)}"></label>
      <label class="field wide" for="e-mode"><span>Type d'exercice</span><select id="e-mode">${[["charge", "Charge (kg) et reps"], ["corps", "Poids du corps ± lest, reps"], ["temps", "Au temps (gainage, planche…)"], ["intervalles", "Intervalles (poutre, repeaters…)"]].map(([v, t]) => `<option value="${v}"${(e.mode || "charge") === v ? " selected" : ""}>${t}</option>`).join("")}</select></label>
      <label class="field" for="e-min"><span>${isTemps(e) ? "Durée min (s)" : isInter(e) ? "Suspensions min" : "Reps min"}</span><input id="e-min" inputmode="numeric" value="${e.min}"></label>
      <label class="field" for="e-max"><span>${isTemps(e) ? "Durée max (s)" : isInter(e) ? "Suspensions max" : "Reps max"}</span><input id="e-max" inputmode="numeric" value="${e.max}"></label>
      ${isInter(e) ? `<label class="field" for="e-trav"><span>Suspension (s)</span><input id="e-trav" inputmode="numeric" value="${num(e.travail) || 7}"></label><label class="field" for="e-pause"><span>Pause (s)</span><input id="e-pause" inputmode="numeric" value="${num(e.pause) || 3}"></label>` : ""}
      <label class="field" for="e-incr"><span>Palier (kg)</span><input id="e-incr" inputmode="decimal" value="${fmt(e.incr)}"></label>
      <label class="field" for="e-repos"><span>Repos (s)</span><input id="e-repos" inputmode="numeric" value="${e.repos}"></label>
      <label class="field wide" for="e-unite"><span>Précision</span><input id="e-unite" value="${esc(e.unite || "")}" placeholder="Par haltère, reps par jambe…"></label>
      <div class="field wide"><span>Muscles travaillés (toucher : principal → secondaire → aucun)</span><div class="chips">${Object.entries(ZONES).map(([k, z]) => { const m = musclesOf(e), st = m.p.includes(k) ? "p" : m.s.includes(k) ? "s" : ""; return `<button type="button" class="chip ${st}" data-act="mz" data-id="${esc(e.id)}" data-k="${k}" aria-pressed="${!!st}">${esc(z[2])}${st === "p" ? " · principal" : st === "s" ? " · secondaire" : ""}</button>`; }).join("")}</div></div>
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
    <div class="card"><h3>Poids de corps</h3>
    <p class="small">Utilisé pour les tractions, dips et suspensions : <b>${fmt(poidsActuel(), 1)} kg</b>${CFG.poidsAuto && POIDS.list.length ? ` · moyenne 7 jours du carnet nutrition (mis à jour ${new Date(POIDS.maj).toLocaleString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })})` : ""}</p>
    <div class="fgrid"><label class="field" for="c-pa"><span>Source</span><select id="c-pa" data-cfg="poidsAuto"><option value="1"${CFG.poidsAuto ? " selected" : ""}>Carnet nutrition</option><option value="0"${CFG.poidsAuto ? "" : " selected"}>Saisie manuelle</option></select></label>
    <label class="field" for="c-nr"><span>Dépôt nutrition</span><input id="c-nr" data-cfg="nutriRepo" value="${esc(CFG.nutriRepo)}" autocapitalize="off"></label>
    <label class="field" for="c-pc"><span>${CFG.poidsAuto ? "Si indisponible (kg)" : "Poids (kg)"}</span><input id="c-pc" inputmode="decimal" data-cfg="poidsCorps" value="${esc(fmt(CFG.poidsCorps))}"></label></div>
    ${CFG.poidsAuto ? `<p class="muted small">Le jeton GitHub doit aussi avoir accès en lecture au dépôt <code>${esc(CFG.nutriRepo)}</code>.</p><div class="row"><button type="button" class="btn secondary" data-act="poids-maj">Mettre à jour le poids</button></div>` : ""}
    ${POIDS.err && CFG.poidsAuto ? `<div class="banner warn">${esc(POIDS.err)}</div>` : ""}</div>
    <div class="card"><h3>Calculs</h3><div class="fgrid">
    <label class="field wide" for="c-disq"><span>Disques disponibles (kg, séparés par des espaces)</span><input id="c-disq" data-cfg="disques" value="${esc(CFG.disques.map((d) => fmt(d)).join(" "))}"></label>
    <label class="field wide" for="c-barres"><span>Barres (nom = poids, une par ligne)</span><textarea id="c-barres" rows="3" data-cfg="barres">${esc(CFG.barres.map((b) => `${b.nom} = ${fmt(b.poids)}`).join("\n"))}</textarea></label>
    <label class="field" for="c-son"><span>Bip de fin de repos</span><select id="c-son" data-cfg="son"><option value="1"${CFG.son ? " selected" : ""}>Activé</option><option value="0"${CFG.son ? "" : " selected"}>Désactivé</option></select></label>
    </div></div>
    ${!NATIVE && /; wv\)/.test(navigator.userAgent) ? `<div class="banner warn">L'appli Android n'arrive pas à joindre ses fonctions natives : le minuteur fonctionne comme sur le web.</div>` : ""}
    ${NATIVE ? `<div class="card"><h3>Minuteur de l'appli Android</h3>
    <p class="muted small">La fin du repos est une notification Android : elle sonne et vibre même écran verrouillé.</p>
    <table class="data"><tbody>
      <tr><td>Notifications</td><td class="n">${NAT.perm === "granted" ? "autorisées" : NAT.perm === "?" ? "non vérifié" : "<b>refusées</b>"}</td></tr>
      <tr><td>Alarmes exactes</td><td class="n">${NAT.exact === true ? "autorisées" : NAT.exact === false ? "<b>refusées : notification retardée</b>" : "non vérifié"}</td></tr>
      <tr><td>Notification programmée</td><td class="n">${NAT.pending === null ? "—" : NAT.pending ? "oui" : "non"}</td></tr>
      ${NAT.error ? `<tr><td>Erreur</td><td class="n">${esc(NAT.error)}</td></tr>` : ""}
    </tbody></table>
    <div class="row wrap"><button type="button" class="btn secondary" data-act="nat-perm">Autoriser les notifications</button><button type="button" class="btn secondary" data-act="nat-exact">Autoriser les alarmes exactes</button><button type="button" class="btn secondary" data-act="nat-test">Tester (5 s)</button></div></div>` : ""}
    <div class="card"><h3>Données</h3>
    <div class="row wrap"><button type="button" class="btn secondary" data-act="export">Exporter (JSON)</button><button type="button" class="btn secondary" data-act="export-csv">Exporter (CSV)</button><label class="btn secondary" for="imp">Importer un JSON</label><input id="imp" type="file" accept="application/json,.json" hidden></div>
    <p class="muted small">Illustrations : dessins <a href="https://github.com/everkinetic/data">Everkinetic</a> (CC BY-SA 4.0), photos <a href="https://github.com/yuhonas/free-exercise-db">Free Exercise DB</a> (domaine public), cartes musculaires du projet <a href="https://github.com/wger-project/wger">wger</a> d'après Wikimedia Commons.</p>
    <p class="muted small">${NATIVE ? "Dans l'appli Android, les exports se font plutôt depuis la version web, sur ordinateur." : "Appli Android : à télécharger dans les Releases du dépôt. Sinon, menu ⋮ de Chrome → « Ajouter à l'écran d'accueil » ; pendant une séance l'écran reste allumé pour que le bip sonne."} Version ${APP_VERSION}${NATIVE ? " (Android)" : ""}.</p></div>`;
}

// ============================================================ Rendu et navigation
function parseRoute() {
  const raw = (location.hash || "#accueil").slice(1);
  const [r, p] = raw.split("/");
  UI.route = r || "accueil"; UI.param = p ? decodeURIComponent(p) : null;
}
function render() {
  parseRoute();
  const navKey = { seance: "accueil", programme: "accueil", apercu: "accueil", exercice: "exercices" }[UI.route] || UI.route;
  document.querySelectorAll("#nav a").forEach((a) => a.toggleAttribute("aria-current", false));
  const cur = document.querySelector(`#nav a[data-nav="${navKey}"]`); if (cur) cur.setAttribute("aria-current", "page");
  if (UI.route !== "programme") UI.progEdit = null;
  const views = {
    accueil: viewAccueil, seance: viewSeance, apercu: () => viewApercu(UI.param), historique: () => (UI.param ? viewSeanceDetail(UI.param) : viewHistorique()),
    exercices: viewExercices, exercice: () => viewExercice(UI.param), programme: () => viewProgramme(UI.param), outils: viewOutils, reglages: viewReglages
  };
  const html = (views[UI.route] || viewAccueil)();
  $("#main").innerHTML = html;
}
window.addEventListener("hashchange", () => { $("#modal-root").innerHTML = ""; render(); window.scrollTo(0, 0); });

// ============================================================ Actions
document.addEventListener("click", async (ev) => {
  const b = ev.target.closest("[data-act]"); if (!b) return;
  const act = b.dataset.act, xi = +b.dataset.x, si = +b.dataset.s;
  const X = DRAFT && DRAFT.exercices[xi];
  switch (act) {
    case "t-plus": return SEQ.on ? null : adjustTimer(15);
    case "t-minus": return SEQ.on ? endSequence(false) : adjustTimer(-15);
    case "t-stop": return SEQ.on ? endSequence(true) : stopTimer();
    case "start": audioCtx(); return startSeance(b.dataset.id);
    case "start-dl": audioCtx(); return startSeance(b.dataset.id, true);
    case "ap-mode": UI.apercuDl = b.dataset.v === "1" ? b.dataset.id : null; return render();
    case "sem": UI.semaine = Math.min(0, (UI.semaine || 0) + num(b.dataset.v)); return render();
    case "poids-maj": POIDS.maj = 0; b.disabled = true; await fetchPoids(); toast(POIDS.err ? POIDS.err : `Poids mis à jour : ${fmt(poidsActuel(), 1)} kg`); return render();
    case "s-ok": {
      audioCtx(); wakeLock(true);
      const z = X.series[si], e = exo(X.exo);
      if (z.ok) { z.ok = false; saveDraft(); return render(); }
      if ((isTemps(e) || isInter(e)) && z.t !== "E") return startSequence(phasesFor(e, z), () => validateSet(xi, si));
      return validateSet(xi, si);
    }
    case "s-rir": { const z = X.series[si], v = +b.dataset.v; z.rir = z.rir === v ? undefined : v; saveDraft(); const sc = window.scrollY; render(); window.scrollTo(0, sc); return; }
    case "s-type": { const z = X.series[si]; z.t = z.t === "E" ? "T" : "E"; saveDraft(); return render(); }
    case "s-prev": { const p = prevSetsOf(X.exo)[si], k = vKey(exo(X.exo)); if (p) { X.series[si].kg = p.kg; X.series[si][k] = p[k]; saveDraft(); render(); } return; }
    case "s-add": { const e = exo(X.exo), k = vKey(e), l = X.series[X.series.length - 1] || { kg: 0, [k]: e.min }; X.series.push({ t: "T", kg: l.kg, [k]: l[k], ok: false }); saveDraft(); return render(); }
    case "s-del": { X.series.pop(); saveDraft(); return render(); }
    case "x-diff": { const v = +b.dataset.v; X.difficulte = X.difficulte === v ? null : v; saveDraft(); return render(); }
    case "x-skip": { X.saute = !X.saute; saveDraft(); return render(); }
    case "x-menu": {
      const r = await modal(exo(X.exo).nom, `<p class="muted small">Que veux-tu faire avec cet exercice ?</p>`, [
        { label: "Ajouter un échauffement", cls: "secondary", value: "warm" }, { label: X.saute ? "Reprendre" : "Pas fait aujourd'hui", cls: "secondary", value: "skip" },
        { label: "Remplacer", cls: "secondary", value: "swap" }, { label: "Retirer de la séance", cls: "danger", value: "remove" }]);
      if (r === "warm") { const e = exo(X.exo), k = vKey(e), f = X.series[0] || { kg: 0, [k]: 8 }; X.series.unshift({ t: "E", kg: isCorps(e) ? num(f.kg) : Math.round(num(f.kg) * 0.5), [k]: Math.max(5, num(f[k])), ok: false }); }
      if (r === "skip") X.saute = !X.saute;
      if (r === "remove") DRAFT.exercices.splice(xi, 1);
      if (r === "swap") { const id = await pickExercise("Remplacer par", DRAFT.exercices.map((q) => q.exo)); if (id) DRAFT.exercices[xi] = newDraftExo(id, X.bloc, X.series.filter((q) => q.t !== "E").length, DRAFT.decharge); }
      saveDraft(); return render();
    }
    case "x-add": { const id = await pickExercise("Ajouter un exercice", DRAFT.exercices.map((q) => q.exo)); if (id) { DRAFT.exercices.push(newDraftExo(id, "", 3, DRAFT.decharge)); saveDraft(); render(); } return; }
    case "finish": return finishSeance();
    case "abandon": {
      const ok = await modal("Abandonner la séance ?", "<p>Rien ne sera enregistré.</p>", [{ label: "Non", cls: "secondary", value: false }, { label: "Abandonner", cls: "danger", value: true }]);
      if (ok) { if (SEQ.on) endSequence(false); DRAFT = null; saveDraft(); stopTimer(); wakeLock(false); location.hash = "#accueil"; }
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
      if ($("#e-trav")) { e.travail = Math.max(1, Math.round(num($("#e-trav").value))); e.pause = Math.max(1, Math.round(num($("#e-pause").value))); }
      saveDB(); markProg(); toast("Exercice enregistré."); return render();
    }
    case "img-show": return showExoImage(exo(b.dataset.exo));
    case "mz": {
      const e = DB.exercices.find((q) => q.id === b.dataset.id), k = b.dataset.k, m = JSON.parse(JSON.stringify(musclesOf(e)));
      if (m.p.includes(k)) { m.p = m.p.filter((x) => x !== k); m.s.push(k); } else if (m.s.includes(k)) m.s = m.s.filter((x) => x !== k); else m.p.push(k);
      e.muscles = m; saveDB(); markProg(); const sc = window.scrollY; render(); window.scrollTo(0, sc); return;
    }
    case "pick-img": {
      const e = DB.exercices.find((q) => q.id === b.dataset.id); const id = await pickImage(e);
      if (id === null || id === undefined) return;
      e.image = id;
      if (!e.muscles && !MUSCLES_DEFAUT[e.id]) { const c = (await catalogue()).find((x) => x.id === id); if (c) { const zs = [...new Set(c.m.map((m) => VERS_ZONE[m]).filter(Boolean))]; e.muscles = { p: zs, s: [] }; } }
      saveDB(); markProg(); return render();
    }
    case "nat-perm": NAT.ready = false; await nativeSetup(); toast("Notifications : vérifié."); return render();
    case "nat-exact": { const ln = nativeLN(); try { if (ln && ln.changeExactNotificationSetting) await ln.changeExactNotificationSetting(); } catch (e) {} NAT.ready = false; await nativeSetup(); return render(); }
    case "nat-test": { NAT.ready = false; await nativeSetup(); T.label = "Test du minuteur"; await nativeSchedule(5); render(); toast(NAT.error ? "Échec : " + NAT.error : "Notification dans 5 secondes : tu peux verrouiller l'écran."); return; }
    case "gh-test": {
      if (!CFG.token) { toast("Colle d'abord ton jeton GitHub."); return; }
      b.disabled = true; setSyncText("Test de la connexion…");
      try { await ghTest(); toast("Connexion GitHub OK."); await sync(); } catch (e) { META.lastError = e.message; saveDB(); setSyncText(e.message, true); }
      return render();
    }
    case "export": return downloadFile("carnet-musculation.json", JSON.stringify({ version: 1, ...DB }, null, 1), "application/json");
    case "export-csv": {
      const rows = [["Séance", "Date", "Bloc", "Exercice", "Type", "Charge (kg)", "Reps", "Secondes", "Reps en réserve", "Difficulté", "Remarque"]];
      sortedSeances().reverse().forEach((s) => s.exercices.forEach((x) => x.series.forEach((z) => rows.push([s.num, s.date, x.bloc, exo(x.exo).nom, z.t === "E" ? "Échauffement" : "Travail", fmt(z.kg), z.reps ?? "", z.sec ?? "", z.rir ?? "", diffOf(x) ?? "", x.note || ""]))));
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
      else X.series[+t.dataset.s][k] = k === "reps" || k === "sec" ? Math.max(0, Math.round(num(t.value))) : num(t.value);
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
    else if (k === "poidsAuto") { CFG.poidsAuto = t.value === "1"; saveCfg(); render(); return; }
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
/** Ajoute une fois deux exercices d'exemple (gainage au temps, poutre en intervalles) à la bibliothèque. */
function ajouterExemples() {
  if (!DB.exercices.length || CFG.exemples15) return;
  const ex = [
    { id: "gainage-planche", nom: "Gainage planche", mode: "temps", min: 30, max: 60, incr: 0, repos: 60, unite: "Sur les avant-bras, corps aligné", muscles: { p: ["abdos"], s: ["obliques", "deltoides-ant"] } },
    { id: "poutre-repeaters", nom: "Suspensions à la poutre (repeaters)", mode: "intervalles", min: 6, max: 6, incr: 2, repos: 180, travail: 7, pause: 3, unite: "Préhension semi-arquée, 20 mm ; lest + ou assistance −", image: "_carte", muscles: { p: ["brachial"], s: ["dorsaux"] } }
  ].filter((e) => !DB.exercices.some((q) => q.id === e.id));
  if (ex.length) { DB.exercices.push(...ex); saveDB(); markProg(); }
  CFG.exemples15 = true; saveCfg();
}
async function boot() {
  if ("serviceWorker" in navigator) { try { await navigator.serviceWorker.register("sw.js"); } catch (e) {} }
  // Premier lancement sans données : on récupère le carnet du dépôt si un jeton est déjà là,
  // sinon on démarre avec le programme d'exemple livré avec l'appli.
  if (!DB.exercices.length && !CFG.token) {
    try { const r = await fetch("demarrage.json", { cache: "no-store" }); if (r.ok) { const j = await r.json(); DB = { exercices: j.exercices, programmes: j.programmes, seances: j.seances || [] }; saveDB(); } } catch (e) {}
  }
  if (!CFG.token) ajouterExemples();
  render();
  if (DRAFT) wakeLock(true);
  if (NATIVE) {
    nativeSetup();
    try {
      const App = (window.Capacitor.Plugins && window.Capacitor.Plugins.App) || window.Capacitor.registerPlugin("App");
      App.addListener("backButton", () => { if ($("#modal-root").innerHTML) { $("#modal-root").innerHTML = ""; return; } if (location.hash && location.hash !== "#accueil") history.back(); else App.minimizeApp ? App.minimizeApp() : App.exitApp(); });
    } catch (e) {}
  }
  if (CFG.token) sync(); else setSyncText(pendingCount() ? "Non synchronisé" : "Sur ce téléphone seulement");
}
boot();
