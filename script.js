// script.js (versión Spark: Firebase + Firestore, sin dependencia de Storage + IA ligera + IA local avanzada + IA profunda)

// ----- IMPORTS DE FIREBASE DESDE CDN -----
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.6.0/firebase-app.js";
import {
  getFirestore,
  collection,
  addDoc,
  getDocs,
  query,
  where,
  doc,
  getDoc,
  getDocFromServer,
  getDocsFromServer,
  setDoc,
  updateDoc,
  deleteDoc
} from "https://www.gstatic.com/firebasejs/12.6.0/firebase-firestore.js";

// ----- CONFIGURACIÓN DE TU PROYECTO FIREBASE -----
const firebaseConfig = {
  apiKey: "AIzaSyAZdspFCOgzOPKPQ63b2MTs4ZjZz8QoBtg",
  authDomain: "creatividad-digital.firebaseapp.com",
  projectId: "creatividad-digital",
  storageBucket: "creatividad-digital.firebasestorage.app",
  messagingSenderId: "152517888172",
  appId: "1:152517888172:web:c81a4ff025f68925453709"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// Colecciones en Firestore
const photosCol = collection(db, "photos");
const ratingsCol = collection(db, "ratings");
const participantsCol = collection(db, "participants");
const sessionsCol = collection(db, "sessions");
const configDocRef = doc(db, "config", "general");

// ----- MODO SPARK: imágenes comprimidas en Firestore -----
// Firestore tiene un límite de 1 MiB por documento. Dejamos margen para metadatos,
// respuestas y campos auxiliares, por eso no agotamos el límite teórico.
const SPARK_IMAGE_MAX_DATAURL_CHARS = 720000;
const SPARK_IMAGE_START_MAX_SIDE = 1100;
const SPARK_IMAGE_MIN_MAX_SIDE = 650;
const SPARK_IMAGE_START_QUALITY = 0.58;
const SPARK_IMAGE_MIN_QUALITY = 0.34;

// Ítems de valoración por defecto (expertos)
const DEFAULT_RATING_ITEMS = [
  { id: "item1", label: "Originalidad y novedad" },
  { id: "item2", label: "Expresión creativa y emocional" },
  { id: "item3", label: "Uso creativo de recursos visuales básicos" },
  { id: "item4", label: "Composición visual y técnica" },
  { id: "item5", label: "Interacción con el contexto" }
];

const EXPECTED_EXPERT_RATINGS = 3;
const DEFAULT_EXPERT_CODES = []; // Si se configura en Admin, limita la valoración a esos códigos normalizados.

function normalizeRatingItemLabel(label) {
  const raw = String(label || "").trim();
  const normalized = raw.toLocaleLowerCase("es-ES");
  if (normalized === "uso innovador de técnicas digitales") {
    return "Uso creativo de recursos visuales básicos";
  }
  if (normalized === "interacción y cocreación") {
    return "Interacción con el contexto";
  }
  return raw;
}

function normalizeExpertId(raw) {
  return String(raw || "")
    .normalize("NFKC")
    .replace(/\u00A0/g, " ")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "_");
}


// CBQD (cuestionario) por defecto
const DEFAULT_CBQD_ENABLED = true;
// Por defecto no incluimos ítems: deben configurarse en el panel de investigación con la versión validada que uses.
const DEFAULT_CBQD_ITEMS = [];

// Configuración IA ligera por defecto
const DEFAULT_AI_CONFIG = {
  enabled: false,
  features: {
    brightness: { enabled: true, weight: 25 },
    contrast: { enabled: true, weight: 25 },
    colorfulness: { enabled: true, weight: 25 },
    edgeDensity: { enabled: true, weight: 25 }
  }
};

// Configuración por defecto de claves
const DEFAULT_AUTH_CONFIG = {
  uploaderPassword: "obf:Ii4kKVxfAAZxdw==",
  expertPassword: "obf:JjohIUBEXQRzcGQ=",
  adminPassword: "obf:IiY8LVwCAgR2"
};

// Caché local de contraseñas (ayuda en iOS/Safari si Firestore falla puntualmente)
const LS_AUTH_CACHE_KEY = "authConfigCache_v1";

function normalizePwd(s) {
  return (s ?? "")
    .toString()
    .normalize("NFKC")
    .replace(/\u00A0/g, " ") // NBSP
    .trim();
}
// Ofuscación ligera (NO es criptografía). Evita que las claves queden en claro en el código.
// Ojo: un atacante con DevTools puede revertirlo; su objetivo aquí es reducir exposición “obvia”.
const OBF_KEY = "CBQD2026";

function obfuscate(plain) {
  const s = String(plain ?? "");
  let out = "";
  for (let i = 0; i < s.length; i++) {
    out += String.fromCharCode(s.charCodeAt(i) ^ OBF_KEY.charCodeAt(i % OBF_KEY.length));
  }
  return btoa(out);
}

function deobfuscate(obf) {
  const raw = atob(String(obf ?? ""));
  let out = "";
  for (let i = 0; i < raw.length; i++) {
    out += String.fromCharCode(raw.charCodeAt(i) ^ OBF_KEY.charCodeAt(i % OBF_KEY.length));
  }
  return out;
}

function getAuthSecret(stored) {
  const s = String(stored ?? "");
  return s.startsWith("obf:") ? deobfuscate(s.slice(4)) : s;
}


function loadAuthCache() {
  try {
    const raw = localStorage.getItem(LS_AUTH_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function saveAuthCache(authConfig) {
  try {
    localStorage.setItem(LS_AUTH_CACHE_KEY, JSON.stringify(authConfig));
  } catch {
    // Silencioso: si el navegador bloquea storage, no hacemos nada
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}


// NUEVO: configuración por defecto de IA profunda (microservicio externo)
const DEEP_AI_CONFIG = {
  enabled: true, // pon false si quieres desactivarla temporalmente
  endpoint: "https://TU-ENDPOINT-DEEP-AI.com/analyze", // ← CAMBIA ESTA URL
  timeoutMs: 20000
};

// Configuración global simple
let globalConfig = {
  askCenter: false,
  centers: [],
  ratingItems: DEFAULT_RATING_ITEMS,
  expertCodes: DEFAULT_EXPERT_CODES,
  aiConfig: DEFAULT_AI_CONFIG,
  authConfig: DEFAULT_AUTH_CONFIG,
  deepAI: DEEP_AI_CONFIG,

  // CBQD
  cbqdEnabled: DEFAULT_CBQD_ENABLED,
  cbqdItems: DEFAULT_CBQD_ITEMS
};

// Estado de carga de configuración (evita que el alumnado entre antes de tener CBQD/contraseñas/ajustes actualizados)
let _configLoaded = false;
let _configOk = false;
let _configLoadPromise = null;

async function ensureConfigLoaded() {
  if (_configLoaded) return _configOk;
  if (_configLoadPromise) return _configLoadPromise;

  _configLoadPromise = (async () => {
    _configOk = await loadGlobalConfig(true);
    _configLoaded = true;
    return _configOk;
  })();

  return _configLoadPromise;
}

// ----- GESTIÓN DE SECCIONES -----
const loginSection = document.getElementById("login-section");
const uploadSection = document.getElementById("upload-section");
const expertSection = document.getElementById("expert-section");
const adminSection = document.getElementById("admin-section");

// Elementos de configuración visual
const centerWrapper = document.getElementById("center-wrapper");
const centerSelect = document.getElementById("center");
const centerNote = document.getElementById("center-note");
const askCenterToggle = document.getElementById("ask-center-toggle");
const centersTextarea = document.getElementById("centers-textarea");
const saveCentersButton = document.getElementById("save-centers-button");
const ratingItemsTextarea = document.getElementById("rating-items-textarea");
const expertCodesTextarea = document.getElementById("expert-codes-textarea");
const saveExpertCodesButton = document.getElementById("save-expert-codes-button");
const saveRatingItemsButton = document.getElementById("save-rating-items-button");
const resetRatingsButton = document.getElementById("reset-ratings-button");
const resetStudyButton = document.getElementById("reset-study-button");
const studiesSelect = document.getElementById("studies");
const bachWrapper = document.getElementById("bach-wrapper");
const esoWrapper = document.getElementById("eso-wrapper");
const ageChart = document.getElementById("age-chart");
const ageChartNote = document.getElementById("age-chart-note");
const loadPhotosButton = document.getElementById("load-photos-button");
const photosList = document.getElementById("photos-list");

// IA ligera: controles en Admin
const aiEnabledToggle = document.getElementById("ai-enabled-toggle");
const aiBrightnessEnabled = document.getElementById("ai-brightness-enabled");
const aiBrightnessWeight = document.getElementById("ai-brightness-weight");
const aiContrastEnabled = document.getElementById("ai-contrast-enabled");
const aiContrastWeight = document.getElementById("ai-contrast-weight");
const aiColorfulnessEnabled = document.getElementById("ai-colorfulness-enabled");
const aiColorfulnessWeight = document.getElementById("ai-colorfulness-weight");
const aiEdgeDensityEnabled = document.getElementById("ai-edgedensity-enabled");
const aiEdgeDensityWeight = document.getElementById("ai-edgedensity-weight");
const saveAiConfigButton = document.getElementById("save-ai-config-button");
// CBQD: controles en Admin
const cbqdEnabledToggle = document.getElementById("cbqd-enabled-toggle");
const cbqdItemsTextarea = document.getElementById("cbqd-items-textarea");
const saveCbqdItemsButton = document.getElementById("save-cbqd-items-button");


// Gestión de claves desde Admin
const uploaderPasswordInput = document.getElementById("uploader-password-input");
const expertPasswordInput = document.getElementById("expert-password-input");
const adminPasswordInput = document.getElementById("admin-password-input");
const savePasswordsButton = document.getElementById("save-passwords-button");

// Rating dinámico (expertos)
const ratingItemsContainer = document.getElementById("rating-items-container");
// Rúbrica (panel desplegable en la valoración de expertos)
const toggleRubricButton = document.getElementById("toggle-rubric-button");
const rubricPanel = document.getElementById("rubric-panel");
if (toggleRubricButton && rubricPanel) {
  toggleRubricButton.addEventListener("click", () => {
    const willShow = rubricPanel.classList.contains("hidden");
    rubricPanel.classList.toggle("hidden");
    toggleRubricButton.textContent = willShow ? "Ocultar rúbrica de valoración" : "Ver rúbrica de valoración";
  });
}

const puntfSpan = document.getElementById("puntf-value");
let ratingControls = [];

// Botones "Volver al inicio"
const backButtons = document.querySelectorAll(".back-button");
backButtons.forEach(btn => {
  btn.addEventListener("click", () => {
    uploadSection.classList.add("hidden");
    expertSection.classList.add("hidden");
    adminSection.classList.add("hidden");
    loginSection.classList.remove("hidden");

    const roleSelect = document.getElementById("role-select");
    const accessPassword = document.getElementById("access-password");
    if (roleSelect) roleSelect.value = "";
    if (accessPassword) accessPassword.value = "";

    // Asegura que, al volver y acceder de nuevo, no queden datos del alumno anterior
    resetUploaderState({ newParticipant: true });
  });


// Al cargar la página, limpia posibles restos de una participación previa en este dispositivo
window.addEventListener("load", () => {
  try {
    resetUploaderState({ newParticipant: true });
  } catch (err) {
    console.error(err);
  }
});
});

// ---- APLICAR CONFIGURACIÓN ----
function applyCentersToSelect() {
  if (!centerSelect) return;

  centerSelect.innerHTML = "";

  const defaultOption = document.createElement("option");
  if (globalConfig.centers && globalConfig.centers.length > 0) {
    defaultOption.value = "";
    defaultOption.textContent = "Selecciona tu centro";
  } else {
    defaultOption.value = "";
    defaultOption.textContent = "No hay centros configurados";
  }
  centerSelect.appendChild(defaultOption);

  if (Array.isArray(globalConfig.centers)) {
    globalConfig.centers.forEach(name => {
      const trimmed = (name || "").trim();
      if (!trimmed) return;
      const opt = document.createElement("option");
      opt.value = trimmed;
      opt.textContent = trimmed;
      centerSelect.appendChild(opt);
    });
  }

  if (centerNote) {
    if (!globalConfig.centers || globalConfig.centers.length === 0) {
      centerNote.textContent = "Pregunta a tu profesor/a si no aparece tu centro.";
    } else {
      centerNote.textContent = "";
    }
  }
}

function applyConfigToUpload() {
  if (!centerWrapper) return;
  applyCentersToSelect();
  centerWrapper.style.display = globalConfig.askCenter ? "block" : "none";
}

function applyAiConfigToAdmin() {
  const ai = globalConfig.aiConfig || DEFAULT_AI_CONFIG;

  if (aiEnabledToggle) {
    aiEnabledToggle.checked = !!ai.enabled;
  }

  const feats = ai.features || DEFAULT_AI_CONFIG.features;

  if (aiBrightnessEnabled && feats.brightness) {
    aiBrightnessEnabled.checked = !!feats.brightness.enabled;
    aiBrightnessWeight.value = feats.brightness.weight ?? 25;
  }

  if (aiContrastEnabled && feats.contrast) {
    aiContrastEnabled.checked = !!feats.contrast.enabled;
    aiContrastWeight.value = feats.contrast.weight ?? 25;
  }

  if (aiColorfulnessEnabled && feats.colorfulness) {
    aiColorfulnessEnabled.checked = !!feats.colorfulness.enabled;
    aiColorfulnessWeight.value = feats.colorfulness.weight ?? 25;
  }

  if (aiEdgeDensityEnabled && feats.edgeDensity) {
    aiEdgeDensityEnabled.checked = !!feats.edgeDensity.enabled;
    aiEdgeDensityWeight.value = feats.edgeDensity.weight ?? 25;
  }
}

function applyConfigToAdmin() {
  if (askCenterToggle) {
    askCenterToggle.checked = !!globalConfig.askCenter;
  }
  if (centersTextarea) {
    centersTextarea.value = (globalConfig.centers || []).join("\n");
  }
  if (ratingItemsTextarea) {
    ratingItemsTextarea.value = (globalConfig.ratingItems || []).map(i => normalizeRatingItemLabel(i.label)).join("\n");
  }
  if (expertCodesTextarea) {
    expertCodesTextarea.value = (globalConfig.expertCodes || []).map(normalizeExpertId).filter(Boolean).join("\n");
  }

  // Claves de acceso
  const auth = globalConfig.authConfig || DEFAULT_AUTH_CONFIG;
  if (uploaderPasswordInput) {
    uploaderPasswordInput.value = getAuthSecret(auth.uploaderPassword || "");
  }
  if (expertPasswordInput) {
    expertPasswordInput.value = getAuthSecret(auth.expertPassword || "");
  }
  if (adminPasswordInput) {
    adminPasswordInput.value = getAuthSecret(auth.adminPassword || "");
  }


  // CBQD
  if (cbqdEnabledToggle) {
    cbqdEnabledToggle.checked = !!globalConfig.cbqdEnabled;
  }
  if (cbqdItemsTextarea) {
    cbqdItemsTextarea.value = (globalConfig.cbqdItems || []).map(it => `${it.domain || "GENERAL"}|${it.text || ""}`.trim()).join("\n");
  }

  applyAiConfigToAdmin();
}

function buildRatingControls() {
  if (!ratingItemsContainer) return;

  ratingItemsContainer.innerHTML = "";
  ratingControls = [];

  const items = globalConfig.ratingItems && globalConfig.ratingItems.length
    ? globalConfig.ratingItems
    : DEFAULT_RATING_ITEMS;

  items.forEach((item, index) => {
    const wrapper = document.createElement("div");
    wrapper.className = "rating-item";

    const labelEl = document.createElement("label");
    const inputId = `rating-item-${item.id}`;
    labelEl.setAttribute("for", inputId);
    labelEl.textContent = `${index + 1}. ${item.label}`;

    const input = document.createElement("input");
    input.type = "range";
    input.min = "1";
    input.max = "10";
    input.value = "5";
    input.id = inputId;

    const valueSpan = document.createElement("span");
    valueSpan.textContent = "5";

    wrapper.appendChild(labelEl);
    wrapper.appendChild(input);
    wrapper.appendChild(valueSpan);

    input.addEventListener("input", () => {
      valueSpan.textContent = input.value;
      updatePuntf();
    });

    ratingItemsContainer.appendChild(wrapper);

    ratingControls.push({
      config: item,
      input,
      valueSpan
    });
  });

  updatePuntf();
}

function updatePuntf() {
  if (!ratingControls.length) {
    if (puntfSpan) puntfSpan.textContent = "0.0";
    return;
  }
  const sum = ratingControls.reduce(
    (acc, rc) => acc + Number(rc.input.value || 0),
    0
  );
  const avg = sum / ratingControls.length;
  if (puntfSpan) {
    puntfSpan.textContent = avg.toFixed(1);
  }
}

// Merge IA config con defaults
function mergeAiConfig(dataAi) {
  const base = JSON.parse(JSON.stringify(DEFAULT_AI_CONFIG));
  if (!dataAi) return base;

  base.enabled = !!dataAi.enabled;

  const srcFeat = dataAi.features || {};
  for (const key of Object.keys(base.features)) {
    if (srcFeat[key]) {
      base.features[key].enabled = !!srcFeat[key].enabled;
      const w = Number(srcFeat[key].weight);
      base.features[key].weight = Number.isFinite(w) ? w : base.features[key].weight;
    }
  }
  return base;
}

// Merge Auth config con defaults
function mergeAuthConfig(dataAuth) {
  const base = { ...DEFAULT_AUTH_CONFIG };
  if (!dataAuth) return base;

  if (typeof dataAuth.uploaderPassword === "string") {
    base.uploaderPassword = dataAuth.uploaderPassword;
  }
  if (typeof dataAuth.expertPassword === "string") {
    base.expertPassword = dataAuth.expertPassword;
  }
  if (typeof dataAuth.adminPassword === "string") {
    base.adminPassword = dataAuth.adminPassword;
  }
  return base;
}

// Merge DeepAI config con defaults
function mergeDeepAIConfig(dataDeep) {
  const base = { ...DEEP_AI_CONFIG };
  if (!dataDeep) return base;
  if (typeof dataDeep.enabled === "boolean") base.enabled = dataDeep.enabled;
  if (typeof dataDeep.endpoint === "string") base.endpoint = dataDeep.endpoint;
  const t = Number(dataDeep.timeoutMs);
  if (Number.isFinite(t) && t > 0) base.timeoutMs = t;
  return base;
}

// Carga configuración desde Firestore.
// Si forceServer=true, intentará evitar valores obsoletos usando lectura desde servidor.
async function loadGlobalConfig(forceServer = false) {
  try {
    let snap;
    if (forceServer) {
      try {
        snap = await getDocFromServer(configDocRef);
      } catch (e) {
        // Si no hay red / el SDK no puede ir al servidor, cae a lectura normal.
        snap = await getDoc(configDocRef);
      }
    } else {
      snap = await getDoc(configDocRef);
    }
    if (snap.exists()) {
      const data = snap.data();
      globalConfig.askCenter = !!data.askCenter;
      globalConfig.centers = Array.isArray(data.centers) ? data.centers : [];
      globalConfig.expertCodes = Array.isArray(data.expertCodes) ? data.expertCodes.map(normalizeExpertId).filter(Boolean) : DEFAULT_EXPERT_CODES;
      if (Array.isArray(data.ratingItems) && data.ratingItems.length > 0) {
        globalConfig.ratingItems = data.ratingItems.map((it, idx) => ({
          id: it.id || `item${idx + 1}`,
          label: normalizeRatingItemLabel(it.label || `Ítem ${idx + 1}`)
        }));
      } else {
        globalConfig.ratingItems = DEFAULT_RATING_ITEMS;
      }
      globalConfig.aiConfig = mergeAiConfig(data.aiConfig);
      globalConfig.authConfig = mergeAuthConfig(data.authConfig);
      globalConfig.deepAI = mergeDeepAIConfig(data.deepAI);
      globalConfig.cbqdEnabled = (data.cbqdEnabled !== undefined) ? !!data.cbqdEnabled : DEFAULT_CBQD_ENABLED;
      globalConfig.cbqdItems = Array.isArray(data.cbqdItems) ? data.cbqdItems : DEFAULT_CBQD_ITEMS;

      // Guarda una copia utilizable de contraseñas para iOS/Safari (si más tarde Firestore falla)
      saveAuthCache(globalConfig.authConfig);
    } else {
      globalConfig.askCenter = false;
      globalConfig.centers = [];
      globalConfig.expertCodes = DEFAULT_EXPERT_CODES;
      globalConfig.ratingItems = DEFAULT_RATING_ITEMS;
      globalConfig.aiConfig = DEFAULT_AI_CONFIG;
      globalConfig.authConfig = DEFAULT_AUTH_CONFIG;
      globalConfig.deepAI = DEEP_AI_CONFIG;
      globalConfig.cbqdEnabled = DEFAULT_CBQD_ENABLED;
      globalConfig.cbqdItems = DEFAULT_CBQD_ITEMS;

      saveAuthCache(globalConfig.authConfig);
    }
  } catch (err) {
    console.error("Error cargando configuración global:", err);

    globalConfig.askCenter = false;
    globalConfig.centers = [];
    globalConfig.expertCodes = DEFAULT_EXPERT_CODES;
    globalConfig.ratingItems = DEFAULT_RATING_ITEMS;
    globalConfig.aiConfig = DEFAULT_AI_CONFIG;
    globalConfig.deepAI = DEEP_AI_CONFIG;
    globalConfig.cbqdEnabled = DEFAULT_CBQD_ENABLED;
    globalConfig.cbqdItems = DEFAULT_CBQD_ITEMS;

    // En iOS/Safari puede fallar puntualmente Firestore: intenta usar la última config válida
    const cached = loadAuthCache();
    if (cached) {
      globalConfig.authConfig = mergeAuthConfig(cached);
      applyConfigToUpload();
      applyConfigToAdmin();
      buildRatingControls();
      return false;
    }

    globalConfig.authConfig = DEFAULT_AUTH_CONFIG;
    applyConfigToUpload();
    applyConfigToAdmin();
    buildRatingControls();
    return false;
  }

  applyConfigToUpload();
  applyConfigToAdmin();
  buildRatingControls();
  return true;
}

// Cargar configuración al inicio (y garantizar que esté lista antes de usar contraseñas/CBQD)
ensureConfigLoaded();

function updateStudiesConditionalFields() {
  const selectedStudies = studiesSelect?.value || "";
  const bachTypeSelect = document.getElementById("bach-type");
  const esoCourseSelect = document.getElementById("eso-course");

  if (bachWrapper) {
    bachWrapper.style.display = selectedStudies === "Bachillerato" ? "block" : "none";
  }
  if (bachTypeSelect && selectedStudies !== "Bachillerato") {
    bachTypeSelect.value = "";
  }

  if (esoWrapper) {
    esoWrapper.style.display = selectedStudies === "ESO" ? "block" : "none";
  }
  if (esoCourseSelect) {
    const isEso = selectedStudies === "ESO";
    esoCourseSelect.required = isEso;
    if (!isEso) esoCourseSelect.value = "";
  }
}

// Listener para mostrar/ocultar campos dependientes de Estudios actuales
if (studiesSelect) {
  studiesSelect.addEventListener("change", updateStudiesConditionalFields);
  updateStudiesConditionalFields();
}

// Listener del checkbox en el panel de admin para pedir centro educativo
if (askCenterToggle) {
  askCenterToggle.addEventListener("change", async () => {
    const newValue = askCenterToggle.checked;
    globalConfig.askCenter = newValue;
    applyConfigToUpload();

    try {
      const snap = await getDoc(configDocRef);
      const payload = { askCenter: newValue };
      if (!snap.exists()) {
        payload.centers = globalConfig.centers || [];
        payload.expertCodes = globalConfig.expertCodes || DEFAULT_EXPERT_CODES;
        payload.ratingItems = globalConfig.ratingItems || DEFAULT_RATING_ITEMS;
        payload.aiConfig = globalConfig.aiConfig || DEFAULT_AI_CONFIG;
        payload.authConfig = globalConfig.authConfig || DEFAULT_AUTH_CONFIG;
        payload.deepAI = globalConfig.deepAI || DEEP_AI_CONFIG;
        await setDoc(configDocRef, payload);
      } else {
        await updateDoc(configDocRef, payload);
      }
    } catch (err) {
      console.error("Error actualizando configuración:", err);
      alert("No se ha podido guardar la configuración de centro educativo.");
    }
  });
}

// Guardar lista de centros desde el panel admin
if (saveCentersButton) {
  saveCentersButton.addEventListener("click", async () => {
    if (!centersTextarea) return;
    const rawLines = centersTextarea.value.split("\n");
    const centersList = rawLines
      .map(line => line.trim())
      .filter(line => line.length > 0);

    globalConfig.centers = centersList;
    applyConfigToUpload();

    try {
      const snap = await getDoc(configDocRef);
      const payload = { centers: centersList };
      if (!snap.exists()) {
        payload.askCenter = globalConfig.askCenter;
        payload.ratingItems = globalConfig.ratingItems || DEFAULT_RATING_ITEMS;
        payload.aiConfig = globalConfig.aiConfig || DEFAULT_AI_CONFIG;
        payload.authConfig = globalConfig.authConfig || DEFAULT_AUTH_CONFIG;
        payload.deepAI = globalConfig.deepAI || DEEP_AI_CONFIG;
        await setDoc(configDocRef, payload);
      } else {
        await updateDoc(configDocRef, payload);
      }
      alert("Lista de centros actualizada.");
    } catch (err) {
      console.error("Error guardando centros:", err);
      alert("No se ha podido guardar la lista de centros.");
    }
  });
}

// Guardar ítems de valoración desde el panel admin
if (saveRatingItemsButton) {
  saveRatingItemsButton.addEventListener("click", async () => {
    if (!ratingItemsTextarea) return;
    const rawLines = ratingItemsTextarea.value.split("\n");
    const labels = rawLines
      .map(line => normalizeRatingItemLabel(line))
      .filter(line => line.length > 0);

    if (!labels.length) {
      alert("Debes introducir al menos un ítem de valoración.");
      return;
    }

    const ratingItems = labels.map((label, idx) => ({
      id: `item${idx + 1}`,
      label
    }));

    globalConfig.ratingItems = ratingItems;
    buildRatingControls();

    try {
      const snap = await getDoc(configDocRef);
      const payload = { ratingItems };
      if (!snap.exists()) {
        payload.askCenter = globalConfig.askCenter;
        payload.centers = globalConfig.centers || [];
        payload.aiConfig = globalConfig.aiConfig || DEFAULT_AI_CONFIG;
        payload.authConfig = globalConfig.authConfig || DEFAULT_AUTH_CONFIG;
        payload.deepAI = globalConfig.deepAI || DEEP_AI_CONFIG;
        await setDoc(configDocRef, payload);
      } else {
        await updateDoc(configDocRef, payload);
      }
      alert("Ítems de valoración actualizados.");
    } catch (err) {
      console.error("Error guardando ítems de valoración:", err);
      alert("No se ha podido guardar los ítems de valoración.");
    }
  });
}


// Guardar códigos cerrados de expertos/as desde el panel admin
if (saveExpertCodesButton) {
  saveExpertCodesButton.addEventListener("click", async () => {
    if (!expertCodesTextarea) return;
    const expertCodes = expertCodesTextarea.value
      .split("\n")
      .map(normalizeExpertId)
      .filter(Boolean);

    globalConfig.expertCodes = Array.from(new Set(expertCodes));

    try {
      const snap = await getDoc(configDocRef);
      const payload = { expertCodes: globalConfig.expertCodes };
      if (!snap.exists()) {
        payload.askCenter = globalConfig.askCenter;
        payload.centers = globalConfig.centers || [];
        payload.ratingItems = globalConfig.ratingItems || DEFAULT_RATING_ITEMS;
        payload.aiConfig = globalConfig.aiConfig || DEFAULT_AI_CONFIG;
        payload.authConfig = globalConfig.authConfig || DEFAULT_AUTH_CONFIG;
        payload.deepAI = globalConfig.deepAI || DEEP_AI_CONFIG;
        await setDoc(configDocRef, payload);
      } else {
        await updateDoc(configDocRef, payload);
      }
      alert(globalConfig.expertCodes.length
        ? "Códigos de expertos/as actualizados. Solo esos códigos podrán valorar."
        : "Lista de códigos vacía. Cualquier código de experto/a será aceptado.");
    } catch (err) {
      console.error("Error guardando códigos de expertos/as:", err);
      alert("No se han podido guardar los códigos de expertos/as.");
    }
  });
}

// Guardar configuración IA ligera
if (saveAiConfigButton) {
  saveAiConfigButton.addEventListener("click", async () => {
    const ai = {
      enabled: aiEnabledToggle ? aiEnabledToggle.checked : false,
      features: {
        brightness: {
          enabled: aiBrightnessEnabled ? aiBrightnessEnabled.checked : true,
          weight: Number(aiBrightnessWeight?.value || 0)
        },
        contrast: {
          enabled: aiContrastEnabled ? aiContrastEnabled.checked : true,
          weight: Number(aiContrastWeight?.value || 0)
        },
        colorfulness: {
          enabled: aiColorfulnessEnabled ? aiColorfulnessEnabled.checked : true,
          weight: Number(aiColorfulnessWeight?.value || 0)
        },
        edgeDensity: {
          enabled: aiEdgeDensityEnabled ? aiEdgeDensityEnabled.checked : true,
          weight: Number(aiEdgeDensityWeight?.value || 0)
        }
      }
    };

    globalConfig.aiConfig = ai;

    try {
      const snap = await getDoc(configDocRef);
      const payload = { aiConfig: ai };
      if (!snap.exists()) {
        payload.askCenter = globalConfig.askCenter;
        payload.centers = globalConfig.centers || [];
        payload.expertCodes = globalConfig.expertCodes || DEFAULT_EXPERT_CODES;
        payload.ratingItems = globalConfig.ratingItems || DEFAULT_RATING_ITEMS;
        payload.authConfig = globalConfig.authConfig || DEFAULT_AUTH_CONFIG;
        payload.deepAI = globalConfig.deepAI || DEEP_AI_CONFIG;
        await setDoc(configDocRef, payload);
      } else {
        await updateDoc(configDocRef, payload);
      }
      alert("Configuración de IA actualizada.");
    } catch (err) {
      console.error("Error guardando configuración IA:", err);
      alert("No se ha podido guardar la configuración de IA.");
    }
  });
}

// Guardar claves de acceso
if (savePasswordsButton) {
  savePasswordsButton.addEventListener("click", async () => {
    const current = mergeAuthConfig(globalConfig.authConfig);

    const uploaderRaw = uploaderPasswordInput?.value.trim();
    const expertRaw = expertPasswordInput?.value.trim();
    const adminRaw = adminPasswordInput?.value.trim();

    const newAuthConfig = {
      uploaderPassword: uploaderRaw
        ? `obf:${obfuscate(uploaderRaw)}`
        : current.uploaderPassword,
      expertPassword: expertRaw
        ? `obf:${obfuscate(expertRaw)}`
        : current.expertPassword,
      adminPassword: adminRaw
        ? `obf:${obfuscate(adminRaw)}`
        : current.adminPassword
    };

    globalConfig.authConfig = newAuthConfig;

    try {
      const snap = await getDoc(configDocRef);
      const payload = { authConfig: newAuthConfig };
      if (!snap.exists()) {
        payload.askCenter = globalConfig.askCenter;
        payload.centers = globalConfig.centers || [];
        payload.expertCodes = globalConfig.expertCodes || DEFAULT_EXPERT_CODES;
        payload.ratingItems = globalConfig.ratingItems || DEFAULT_RATING_ITEMS;
        payload.aiConfig = globalConfig.aiConfig || DEFAULT_AI_CONFIG;
        payload.deepAI = globalConfig.deepAI || DEEP_AI_CONFIG;
        await setDoc(configDocRef, payload);
      } else {
        await updateDoc(configDocRef, payload);
      }
      saveAuthCache(newAuthConfig);
      alert("Claves de acceso actualizadas. A partir de ahora se usarán las nuevas claves.");
    } catch (err) {
      console.error("Error guardando claves de acceso:", err);
      alert("No se han podido guardar las nuevas claves de acceso.");
    }
  });
}

async function getCollectionSnapshotFresh(colRef) {
  try {
    return await getDocsFromServer(colRef);
  } catch (err) {
    return await getDocs(colRef);
  }
}

async function deleteCollectionDocs(colRef, batchSize = 200) {
  let deleted = 0;

  while (true) {
    const snap = await getCollectionSnapshotFresh(colRef);
    if (snap.empty) break;

    const chunk = snap.docs.slice(0, batchSize);
    await Promise.all(chunk.map(docSnap => deleteDoc(docSnap.ref)));
    deleted += chunk.length;

    if (snap.size <= batchSize) {
      const verifySnap = await getCollectionSnapshotFresh(colRef);
      if (verifySnap.empty) break;
    }
  }

  return deleted;
}

async function refreshAdminAfterReset() {
  if (photosList) photosList.innerHTML = "";
  await updateAdminSummary();
}

// Reinicialización: valoraciones (solo ratings)
if (resetRatingsButton) {
  resetRatingsButton.addEventListener("click", async () => {
    const ok = confirm(
      "Esta acción borrará únicamente las VALORACIONES de expertos/as (colección 'ratings').\n\n" +
      "Se conservarán sesiones, datos del alumnado, fotografías y análisis automáticos (IA).\n\n" +
      "¿Quieres continuar?"
    );
    if (!ok) return;

    try {
      await deleteCollectionDocs(ratingsCol);
      alert("Valoraciones reinicializadas. Se han borrado todas las valoraciones de expertos/as.");
      await refreshAdminAfterReset();
    } catch (err) {
      console.error("Error al reinicializar valoraciones:", err);
      alert("Ha ocurrido un error al reinicializar las valoraciones.");
    }
  });
}

// Reinicialización: estudio completo (sessions + participants + photos + ratings)
if (resetStudyButton) {
  resetStudyButton.addEventListener("click", async () => {
    const ok1 = confirm(
      "ATENCIÓN: esta acción borrará TODO el estudio (colecciones 'sessions', 'participants', 'photos' y 'ratings').\n\n" +
      "La configuración (centros, ítems, IA, claves, etc.) se mantendrá.\n\n" +
      "¿Seguro que quieres continuar?"
    );
    if (!ok1) return;

    const ok2 = confirm(
      "Confirmación final: esta operación es irreversible.\n\n" +
      "Escribe mentalmente 'BORRAR TODO' y pulsa Aceptar solo si estás completamente seguro/a."
    );
    if (!ok2) return;

    try {
      await Promise.all([
        deleteCollectionDocs(sessionsCol),
        deleteCollectionDocs(participantsCol),
        deleteCollectionDocs(photosCol),
        deleteCollectionDocs(ratingsCol)
      ]);

      alert("Estudio reinicializado. Se han borrado participantes, sesiones, fotografías y valoraciones.");
      await refreshAdminAfterReset();
    } catch (err) {
      console.error("Error al reinicializar el estudio:", err);
      alert("Ha ocurrido un error al reinicializar el estudio.");
    }
  });
}

// ================================================

// Redimensionar y comprimir la imagen (adaptado a móvil)
// ================================================
function estimateDataUrlBytes(dataUrl) {
  // Aproximación suficiente para controlar el tamaño antes de guardar en Firestore.
  const comma = String(dataUrl || "").indexOf(",");
  const b64 = comma >= 0 ? String(dataUrl).slice(comma + 1) : String(dataUrl || "");
  return Math.ceil((b64.length * 3) / 4);
}

// Redimensionar y comprimir la imagen (modo Spark, sin Storage)
// Devuelve siempre un JPEG suficientemente pequeño para guardarlo en Firestore con margen.
function resizeImage(file, maxWidth = SPARK_IMAGE_START_MAX_SIDE, maxHeight = SPARK_IMAGE_START_MAX_SIDE, quality = SPARK_IMAGE_START_QUALITY) {
  return new Promise((resolve, reject) => {
    if (!file.type || !file.type.startsWith("image/")) {
      reject(new Error("El archivo seleccionado no es una imagen."));
      return;
    }

    const url = URL.createObjectURL(file);
    const img = new Image();

    img.onload = () => {
      try {
        const originalWidth = img.width;
        const originalHeight = img.height;

        // Aunque alguna llamada antigua solicite 1600/1920 px, en modo Spark limitamos el lado mayor.
        const requestedMaxSide = Math.min(
          Number(maxWidth) || SPARK_IMAGE_START_MAX_SIDE,
          Number(maxHeight) || SPARK_IMAGE_START_MAX_SIDE,
          SPARK_IMAGE_START_MAX_SIDE
        );
        const initialQuality = Math.min(Number(quality) || SPARK_IMAGE_START_QUALITY, SPARK_IMAGE_START_QUALITY);

        const attempts = [];
        for (let side = requestedMaxSide; side >= SPARK_IMAGE_MIN_MAX_SIDE; side -= 100) {
          for (let q = initialQuality; q >= SPARK_IMAGE_MIN_QUALITY; q -= 0.06) {
            attempts.push({ side, quality: Math.max(SPARK_IMAGE_MIN_QUALITY, +q.toFixed(2)) });
          }
        }

        let bestDataUrl = "";
        let bestLen = Infinity;

        for (const attempt of attempts) {
          const scale = Math.min(attempt.side / originalWidth, attempt.side / originalHeight, 1);
          const width = Math.max(1, Math.round(originalWidth * scale));
          const height = Math.max(1, Math.round(originalHeight * scale));

          const canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext("2d", { alpha: false });
          ctx.drawImage(img, 0, 0, width, height);

          const dataUrl = canvas.toDataURL("image/jpeg", attempt.quality);
          if (dataUrl.length < bestLen) {
            bestDataUrl = dataUrl;
            bestLen = dataUrl.length;
          }
          if (dataUrl.length <= SPARK_IMAGE_MAX_DATAURL_CHARS) {
            URL.revokeObjectURL(url);
            resolve(dataUrl);
            return;
          }
        }

        URL.revokeObjectURL(url);
        reject(new Error(
          "La imagen sigue siendo demasiado grande incluso tras comprimirla. " +
          "Prueba con una fotografía JPG más sencilla o tomada a menor resolución."
        ));
      } catch (err) {
        URL.revokeObjectURL(url);
        reject(err);
      }
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("No se ha podido leer la imagen. El formato puede no ser compatible con este navegador."));
    };

    img.src = url;
  });
}

// ================================================
// IA ligera: análisis simple de la imagen en el cliente
// ================================================
function clamp01(x) {
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

function computeAiFeaturesFromDataUrl(dataUrl, aiConfig) {
  return new Promise((resolve) => {
    if (!aiConfig || !aiConfig.enabled) {
      resolve({ features: null, score: null });
      return;
    }

    const img = new Image();
    img.onload = () => {
      try {
        // Reducimos la imagen a algo manejable, por ejemplo 256 px de lado mayor
        const maxSide = 256;
        let w = img.width;
        let h = img.height;
        const scale = Math.min(maxSide / w, maxSide / h, 1);
        w = Math.max(1, Math.round(w * scale));
        h = Math.max(1, Math.round(h * scale));

        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, w, h);

        const imgData = ctx.getImageData(0, 0, w, h);
        const data = imgData.data;
        const n = w * h;

        let sumLum = 0;
        let sumLum2 = 0;
        let sumColorDiff = 0;

        const lumArr = new Float32Array(n);

        // 1) Luminancia y colorfulness básica
        for (let i = 0; i < n; i++) {
          const r = data[i * 4] / 255;
          const g = data[i * 4 + 1] / 255;
          const b = data[i * 4 + 2] / 255;

          const lum = 0.299 * r + 0.587 * g + 0.114 * b;
          lumArr[i] = lum;
          sumLum += lum;
          sumLum2 += lum * lum;

          const cd = (Math.abs(r - g) + Math.abs(r - b) + Math.abs(g - b)) / 3;
          sumColorDiff += cd;
        }

        const meanLum = sumLum / n;
        const varLum = sumLum2 / n - meanLum * meanLum;
        const stdLum = Math.sqrt(Math.max(varLum, 0));

        const brightnessRaw = meanLum;            // 0–1
        const contrastRaw = stdLum;               // ~0–0.4
        const colorfulnessRaw = sumColorDiff / n; // 0–1 aprox

        // 2) Edge density (muy simple, usando gradiente sobre luminancia)
        let edgeSum = 0;
        let edgeCount = 0;
        for (let y = 1; y < h - 1; y++) {
          for (let x = 1; x < w - 1; x++) {
            const idx = y * w + x;
            const idxL = y * w + (x - 1);
            const idxR = y * w + (x + 1);
            const idxU = (y - 1) * w + x;
            const idxD = (y + 1) * w + x;

            const dx = lumArr[idxR] - lumArr[idxL];
            const dy = lumArr[idxD] - lumArr[idxU];
            const mag = Math.sqrt(dx * dx + dy * dy);
            edgeSum += mag;
            edgeCount++;
          }
        }
        const edgeDensityRaw = edgeCount > 0 ? edgeSum / edgeCount : 0; // 0–~0.7

        const features = {
          brightness: brightnessRaw,
          contrast: contrastRaw,
          colorfulness: colorfulnessRaw,
          edgeDensity: edgeDensityRaw
        };

        // Normalización heurística (0–1) por parámetro
        function normalizeFeature(name, value) {
          switch (name) {
            case "brightness": {
              // Queremos evitar fotos demasiado oscuras o quemadas:
              // pico alrededor de 0.55, caída progresiva hacia 0 y 1
              const val = value;
              const tri = 1 - Math.abs(val - 0.55) / 0.55; // ~1 en 0.55, ~0 en 0 o 1
              return clamp01(tri);
            }
            case "contrast": {
              // Contraste interesante suele estar en torno a 0.25–0.35
              const norm = value / 0.30;
              return clamp01(norm);
            }
            case "colorfulness": {
              // Colores ricos alrededor de 0.3–0.5
              const norm = value / 0.35;
              return clamp01(norm);
            }
            case "edgeDensity": {
              // Complejidad estructural: útil hasta ~0.3
              const norm = value / 0.25;
              return clamp01(norm);
            }
            default:
              return clamp01(value);
          }
        }

        const normFeatures = {};
        for (const key of Object.keys(features)) {
          normFeatures[key] = normalizeFeature(key, features[key]);
        }

        const weights = aiConfig.features || {};
        let num = 0;
        let den = 0;

        for (const key of Object.keys(features)) {
          const fConf = weights[key];
          if (!fConf || !fConf.enabled) continue;
          const wgt = Number(fConf.weight) || 0;
          if (wgt <= 0) continue;
          num += normFeatures[key] * wgt;
          den += wgt;
        }

        let score = null;
        if (den > 0) {
          const avg01 = num / den;

          // Término de “sinergia”: combinación de contraste, color y bordes
          const c = normFeatures.contrast ?? avg01;
          const col = normFeatures.colorfulness ?? avg01;
          const edge = normFeatures.edgeDensity ?? avg01;
          const synergy = clamp01((c * col + col * edge + c * edge) / 3);

          // Mezclamos media y sinergia para aumentar la variabilidad
          const final01 = clamp01(0.7 * avg01 + 0.3 * synergy);

          // Escala 0–10 con dos decimales
          score = +(final01 * 10).toFixed(2);
        }

        resolve({ features, score });
      } catch (err) {
        console.error("Error calculando IA ligera:", err);
        resolve({ features: null, score: null });
      }
    };

    img.onerror = () => {
      console.error("No se ha podido cargar la imagen para IA ligera.");
      resolve({ features: null, score: null });
    };

    img.src = dataUrl;
  });
}

// ================================================
// IA local avanzada: análisis compositivo (tercios, horizonte, φ…)
// ================================================
async function computeLocalAdvancedAnalysis(dataUrl) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const W = img.width;
        const H = img.height;

        const canvas = document.createElement("canvas");
        canvas.width = W;
        canvas.height = H;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0);

        const pix = ctx.getImageData(0, 0, W, H).data;

        // ---- 1. Centro visual aproximado (contraste local) ----
        let cx = 0, cy = 0, totalWeight = 0;
        for (let y = 1; y < H - 1; y += 4) {
          for (let x = 1; x < W - 1; x += 4) {
            const idx = (y * W + x) * 4;
            const r = pix[idx], g = pix[idx + 1], b = pix[idx + 2];
            const lum = 0.299 * r + 0.587 * g + 0.114 * b;

            const idxR = (y * W + (x + 1)) * 4;
            const r2 = pix[idxR], g2 = pix[idxR + 1], b2 = pix[idxR + 2];
            const lum2 = 0.299 * r2 + 0.587 * g2 + 0.114 * b2;

            const diff = Math.abs(lum - lum2);

            cx += x * diff;
            cy += y * diff;
            totalWeight += diff;
          }
        }

        let centerX = W / 2;
        let centerY = H / 2;
        if (totalWeight > 0) {
          centerX = cx / totalWeight;
          centerY = cy / totalWeight;
        }

        // ---- 2. Regla de los tercios ----
        const tX1 = W / 3, tX2 = (2 * W) / 3;
        const tY1 = H / 3, tY2 = (2 * H) / 3;
        const maxDiag = Math.sqrt(W * W + H * H);

        function dist(x1, y1, x2, y2) {
          return Math.sqrt((x1 - x2) ** 2 + (y1 - y2) ** 2);
        }

        const d1 = dist(centerX, centerY, tX1, tY1);
        const d2 = dist(centerX, centerY, tX2, tY1);
        const d3 = dist(centerX, centerY, tX1, tY2);
        const d4 = dist(centerX, centerY, tX2, tY2);
        const minD = Math.min(d1, d2, d3, d4);
        const thirdsScore01 = 1 - clamp01((minD / maxDiag) * 2.5);

        // ---- 3. Horizonte (borde horizontal fuerte) ----
        let bestY = 0;
        let bestStrength = 0;

        for (let y = 1; y < H - 1; y += 2) {
          let rowDiff = 0;
          for (let x = 1; x < W - 1; x += 4) {
            const idx = (y * W + x) * 4;
            const lum = 0.299 * pix[idx] + 0.587 * pix[idx + 1] + 0.114 * pix[idx + 2];

            const idxD = ((y + 1) * W + x) * 4;
            const lumD = 0.299 * pix[idxD] + 0.587 * pix[idxD + 1] + 0.114 * pix[idxD + 2];

            rowDiff += Math.abs(lum - lumD);
          }
          if (rowDiff > bestStrength) {
            bestStrength = rowDiff;
            bestY = y;
          }
        }

        const idealH1 = H / 3;
        const idealH2 = (2 * H) / 3;
        const dH = Math.min(Math.abs(bestY - idealH1), Math.abs(bestY - idealH2));
        const horizonScore01 = 1 - clamp01((dH / H) * 1.8);

        // ---- 4. Proporción áurea (φ) ----
        const phi = 0.618;
        const gx = W * phi;
        const gy = H * phi;
        const dG = dist(centerX, centerY, gx, gy);
        const goldenScore01 = 1 - clamp01((dG / maxDiag) * 3.2);

        // ---- 5. Saliencia básica por gradiente ----
        let salSum = 0;
        let salCount = 0;
        for (let y = 1; y < H - 1; y += 3) {
          for (let x = 1; x < W - 1; x += 3) {
            const idx = (y * W + x) * 4;
            const lumC = 0.299 * pix[idx] + 0.587 * pix[idx + 1] + 0.114 * pix[idx + 2];

            const idxR = (y * W + (x + 1)) * 4;
            const idxD = ((y + 1) * W + x) * 4;
            const lumR = 0.299 * pix[idxR] + 0.587 * pix[idxR + 1] + 0.114 * pix[idxR + 2];
            const lumD = 0.299 * pix[idxD] + 0.587 * pix[idxD + 1] + 0.114 * pix[idxD + 2];

            const grad = Math.abs(lumC - lumR) + Math.abs(lumC - lumD);
            salSum += grad;
            salCount++;
          }
        }
        const salRaw = salCount > 0 ? salSum / salCount : 0;
        const salienceScore01 = clamp01(salRaw / 50);

        const final01 =
          0.35 * thirdsScore01 +
          0.25 * horizonScore01 +
          0.20 * goldenScore01 +
          0.20 * salienceScore01;

        const localAdvancedScore = +(clamp01(final01) * 10).toFixed(2);

        resolve({
          thirdsScore: +(thirdsScore01 * 10).toFixed(2),
          horizonScore: +(horizonScore01 * 10).toFixed(2),
          goldenScore: +(goldenScore01 * 10).toFixed(2),
          salienceScore: +(salienceScore01 * 10).toFixed(2),
          localAdvancedScore
        });
      } catch (err) {
        console.error("Error IA local avanzada:", err);
        resolve({
          thirdsScore: null,
          horizonScore: null,
          goldenScore: null,
          salienceScore: null,
          localAdvancedScore: null
        });
      }
    };

    img.onerror = () => {
      console.error("Error cargando imagen para IA avanzada.");
      resolve({
        thirdsScore: null,
        horizonScore: null,
        goldenScore: null,
        salienceScore: null,
        localAdvancedScore: null
      });
    };

    img.src = dataUrl;
  });
}

// ================================================
// IA profunda — microservicio externo
// ================================================
async function computeDeepAI(dataUrl) {
  const cfg = globalConfig.deepAI || DEEP_AI_CONFIG;
  if (!cfg.enabled || !cfg.endpoint) {
    return { deepScore: null, deepExplanation: null };
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), cfg.timeoutMs || 20000);

    const res = await fetch(cfg.endpoint, {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/json" },
      // Adapta la clave "imageBase64" al contrato real de tu microservicio
      body: JSON.stringify({ imageBase64: dataUrl })
    });

    clearTimeout(timeoutId);

    if (!res.ok) {
      console.warn("Deep AI: respuesta HTTP no OK:", res.status);
      return { deepScore: null, deepExplanation: null };
    }

    const json = await res.json();
    return {
      deepScore: json.score ?? null,
      deepExplanation: json.explanation ?? null
    };
  } catch (err) {
    console.error("Error llamando a Deep AI:", err);
    return { deepScore: null, deepExplanation: null };
  }
}

// --------------------------------------------------------------
// GESTIÓN DE SECCIONES Y LOGIN
// --------------------------------------------------------------
function showSection(sectionId) {
  [uploadSection, expertSection, adminSection].forEach(sec => sec.classList.add("hidden"));
  if (sectionId === "upload") uploadSection.classList.remove("hidden");
  if (sectionId === "expert") expertSection.classList.remove("hidden");
  if (sectionId === "admin") {
    adminSection.classList.remove("hidden");
    applyConfigToAdmin();
    updateAdminSummary();
  }
}

// ----- LOGIN / ACCESO POR ROL -----
document.getElementById("login-button").addEventListener("click", async () => {
  // 1) Asegura que existe configuración mínima (y cache de auth si Firestore falla)
  const ok = await ensureConfigLoaded();
  // 2) Intenta SIEMPRE refrescar la configuración real desde Firestore.
  //    Esto es clave para que cambios recientes (p. ej., cbqdEnabled) se reflejen al entrar como alumnado.
  try {
    await loadGlobalConfig(true);
  } catch (err) {
    // Reintento silencioso: en iOS/Safari Firestore puede fallar de forma intermitente
    if (!ok) {
      try { await sleep(200); await loadGlobalConfig(true); } catch (_) {}
    }
  }
  const role = document.getElementById("role-select").value;
  const password = normalizePwd(document.getElementById("access-password").value);

  if (!role) {
    alert("Selecciona un tipo de acceso.");
    return;
  }

  const auth = globalConfig.authConfig || DEFAULT_AUTH_CONFIG;
  let expected = "";
  if (role === "uploader") expected = getAuthSecret(auth.uploaderPassword);
  else if (role === "expert") expected = getAuthSecret(auth.expertPassword);
  else if (role === "admin") expected = getAuthSecret(auth.adminPassword);

  expected = normalizePwd(expected);

  if (password !== expected) {
    alert("Clave incorrecta.");
    return;
  }

  loginSection.classList.add("hidden");

  if (role === "uploader") {
    // Vuelve a refrescar por si el panel admin ha cambiado algo justo ahora (CBQD, centros, etc.)
    try { await loadGlobalConfig(true); } catch (_) {}
    applyConfigToUpload();
    resetUploaderState({ newParticipant: true });
    showSection("upload");
  } else if (role === "expert") {
    showSection("expert");
  } else if (role === "admin") {
    showSection("admin");
  }
});


// ----- CBQD (ADMIN): activar/desactivar + configurar ítems -----
if (cbqdEnabledToggle) {
  cbqdEnabledToggle.addEventListener("change", async () => {
    const prev = !!globalConfig.cbqdEnabled;
    globalConfig.cbqdEnabled = !!cbqdEnabledToggle.checked;
    try {
      const snap = await getDoc(configDocRef);
      const payload = { cbqdEnabled: globalConfig.cbqdEnabled };
      if (!snap.exists()) {
        // crear doc completo con defaults mínimos
        await setDoc(configDocRef, {
          askCenter: globalConfig.askCenter,
          centers: globalConfig.centers || [],
          ratingItems: globalConfig.ratingItems || DEFAULT_RATING_ITEMS,
          aiConfig: globalConfig.aiConfig || DEFAULT_AI_CONFIG,
          authConfig: globalConfig.authConfig || DEFAULT_AUTH_CONFIG,
          deepAI: globalConfig.deepAI || DEEP_AI_CONFIG,
          cbqdEnabled: globalConfig.cbqdEnabled,
          cbqdItems: globalConfig.cbqdItems || DEFAULT_CBQD_ITEMS
        });
      } else {
        await updateDoc(configDocRef, payload);
      }

      // Verificación inmediata (evita la sensación de "lo marco pero no hace nada")
      await loadGlobalConfig(true);
      applyConfigToAdmin();
    } catch (err) {
      console.error("Error guardando cbqdEnabled:", err);
      alert("No se ha podido guardar el estado del CBQD.");
      // revertir estado y visualmente
      globalConfig.cbqdEnabled = prev;
      cbqdEnabledToggle.checked = prev;
    }
  });
}

if (saveCbqdItemsButton) {
  saveCbqdItemsButton.addEventListener("click", async () => {
    const raw = (cbqdItemsTextarea?.value || "")
      .split("\n")
      .map(l => l.trim())
      .filter(Boolean);

    const cbqdItems = raw.map((line, idx) => {
      const [domainRaw, ...rest] = line.split("|");
      const domain = (domainRaw || "").trim() || "GENERAL";
      const text = rest.join("|").trim() || `Ítem ${idx + 1}`;
      return { id: `cbqd_${idx + 1}`, domain, text };
    });

    globalConfig.cbqdItems = cbqdItems;
    applyConfigToAdmin();

    try {
      const snap = await getDoc(configDocRef);
      const payload = { cbqdItems };
      if (!snap.exists()) {
        await setDoc(configDocRef, {
          askCenter: globalConfig.askCenter,
          centers: globalConfig.centers || [],
          ratingItems: globalConfig.ratingItems || DEFAULT_RATING_ITEMS,
          aiConfig: globalConfig.aiConfig || DEFAULT_AI_CONFIG,
          authConfig: globalConfig.authConfig || DEFAULT_AUTH_CONFIG,
          deepAI: globalConfig.deepAI || DEEP_AI_CONFIG,
          cbqdEnabled: globalConfig.cbqdEnabled,
          cbqdItems
        });
      } else {
        await updateDoc(configDocRef, payload);
      }

      await loadGlobalConfig(true);
      applyConfigToAdmin();

      alert("CBQD actualizado.");
    } catch (err) {
      console.error("Error guardando CBQD:", err);
      alert("No se ha podido guardar el CBQD.");
    }
  });
}


// ----- WIZARD DE PARTICIPACIÓN (CBQD + 3 microtareas) -----
const wizardSteps = Array.from(document.querySelectorAll(".wizard-step"));
const wizardProgressBar = document.getElementById("wizard-progress-bar");

// Botones del wizard
const wizardNext = document.getElementById("wizard-next");
const wizardNext2 = document.getElementById("wizard-next-2");
const wizardNext3 = document.getElementById("wizard-next-3");
const wizardNext4 = document.getElementById("wizard-next-4");
const wizardBack = document.getElementById("wizard-back");
const wizardBack3 = document.getElementById("wizard-back-3");
const wizardBack4 = document.getElementById("wizard-back-4");
const wizardBack5 = document.getElementById("wizard-back-5");
const submitAllBtn = document.getElementById("submit-all");
// Texto por defecto del botón de envío (para restaurarlo entre alumnos)
const SUBMIT_ALL_DEFAULT_LABEL = submitAllBtn?.textContent || "Enviar todo";

const cbqdDisabledBox = document.getElementById("cbqd-disabled");
const cbqdWarningBox = document.getElementById("cbqd-warning");
const cbqdItemsHost = document.getElementById("cbqd-items");
const cbqdScoreBox = document.getElementById("cbqd-scorebox");

// Paso 2 (CBQD) en el wizard: lo mostramos/ocultamos según configuración.
// El wizard controla la visibilidad real; esto evita que el paso quede “anclado”
// por estados previos o por cambios en caliente desde el panel admin.
const cbqdStepEl = document.querySelector('.wizard-step[data-step="2"]');

function syncCbqdStepVisibility() {
  // El paso 2 existe siempre. Su contenido informa si el CBQD está desactivado.
  if (!cbqdStepEl) return;
  cbqdStepEl.classList.remove("hidden");
}

function computeWizardOrder() {
  // Mantén el paso 2 (CBQD) siempre en el flujo del alumnado.
  // Si está desactivado o no hay ítems, se mostrará un aviso en el propio paso.
  return [1, 2, 3, 4, 5];
}

let wizardOrder = computeWizardOrder();
let wizardIdx = 0;

function showWizardStepByIndex(idx) {
  // Asegura que el DOM refleja el estado del CBQD antes de computar el orden.
  syncCbqdStepVisibility();

  wizardOrder = computeWizardOrder();
  wizardIdx = Math.min(Math.max(idx, 0), wizardOrder.length - 1);

  const stepNumber = wizardOrder[wizardIdx];

  wizardSteps.forEach(s => s.classList.add("hidden"));
  const current = wizardSteps.find(s => Number(s.dataset.step) === stepNumber);
  if (current) current.classList.remove("hidden");

  const pct = (wizardIdx / (wizardOrder.length - 1)) * 100;
  if (wizardProgressBar) wizardProgressBar.style.width = `${isFinite(pct) ? pct : 0}%`;

  // estado CBQD (informativo)
  if (stepNumber === 2) {
    const items = globalConfig.cbqdItems || [];
    if (!globalConfig.cbqdEnabled) {
      cbqdDisabledBox?.classList.remove("hidden");
      cbqdWarningBox?.classList.add("hidden");
      cbqdScoreBox?.classList.add("hidden");
      if (cbqdItemsHost) cbqdItemsHost.innerHTML = "";
    } else if (!items.length) {
      cbqdDisabledBox?.classList.add("hidden");
      cbqdWarningBox?.classList.remove("hidden");
      cbqdScoreBox?.classList.add("hidden");
      if (cbqdItemsHost) cbqdItemsHost.innerHTML = "";
    } else {
      cbqdDisabledBox?.classList.add("hidden");
      cbqdWarningBox?.classList.add("hidden");
      cbqdScoreBox?.classList.remove("hidden");
      renderCbqd();
    }
  }
}

function ensureParticipantId() {
  const key = "cbqd_participant_id";
  let id = localStorage.getItem(key);
  if (!id) {
    id = `P_${Math.random().toString(16).slice(2)}_${Date.now()}`;
    localStorage.setItem(key, id);
  }
  return id;
}

function clearParticipantId() {
  try {
    localStorage.removeItem("cbqd_participant_id");
  } catch (_) {}
}

// Reinicia el estado del alumnado para evitar que aparezcan datos del participante anterior
function resetUploaderState({ newParticipant = true } = {}) {
  // Formularios del wizard
  const forms = ["step1-form", "task1-form", "task2-form", "task3-form"];
  forms.forEach(id => {
    const f = document.getElementById(id);
    if (f && typeof f.reset === "function") f.reset();
  });

  // Ocultar bloques condicionales
  if (typeof bachWrapper !== "undefined" && bachWrapper) bachWrapper.style.display = "none";
  if (typeof esoWrapper !== "undefined" && esoWrapper) esoWrapper.style.display = "none";
  const esoCourseSelect = document.getElementById("eso-course");
  if (esoCourseSelect) {
    esoCourseSelect.required = false;
    esoCourseSelect.value = "";
  }
  if (typeof centerWrapper !== "undefined" && centerWrapper) centerWrapper.style.display = globalConfig.askCenter ? "block" : "none";

  // Limpiar radios CBQD explícitamente
  document.querySelectorAll('input[type="radio"][name^="cbqd_"]').forEach(r => { r.checked = false; });

  // Limpiar previews y análisis de microtareas
  const previewIds = [
    "task1-preview", "task2-preview", "task3-preview",
    "task1-ai-analysis", "task2-ai-analysis", "task3-ai-analysis"
  ];
  previewIds.forEach(id => document.getElementById(id)?.classList?.add("hidden"));

  const metaIds = ["task1-preview-meta","task2-preview-meta","task3-preview-meta"];
  metaIds.forEach(id => { const el = document.getElementById(id); if (el) el.textContent = ""; });

  const imgIds = ["task1-preview-image","task2-preview-image","task3-preview-image"];
  imgIds.forEach(id => { const el = document.getElementById(id); if (el) el.src = ""; });

  const scoreIds = [
    "task1-ai-light","task1-ai-local","task1-ai-deep","task1-ai-deep-expl",
    "task2-ai-light","task2-ai-local","task2-ai-deep","task2-ai-deep-expl",
    "task3-ai-light","task3-ai-local","task3-ai-deep","task3-ai-deep-expl",
    "cbqd-total","cbqd-subscales"
  ];
  scoreIds.forEach(id => { const el = document.getElementById(id); if (el) el.textContent = ""; });

  // Cache de IA
  if (typeof microtaskAiCache !== "undefined" && microtaskAiCache) {
    microtaskAiCache.MT1_AUTOEXP = null;
    microtaskAiCache.MT2_ESCOLAR = null;
    microtaskAiCache.MT3_TRANSFORM = null;
  }

  // Vuelve al paso 1 del wizard
  if (typeof showWizardStepByIndex === "function") {
    showWizardStepByIndex(0);
  }

  // Rehabilita el botón de envío para el siguiente alumno
  if (submitAllBtn) {
    submitAllBtn.disabled = false;
    submitAllBtn.removeAttribute("aria-busy");
    submitAllBtn.textContent = SUBMIT_ALL_DEFAULT_LABEL;
  }

  // Rehabilita navegación (p. ej. \"Atrás\") para el siguiente alumno
  setWizardNavDisabled(false);

  // Nuevo participante (evita arrastrar identificación entre alumnos)
  if (newParticipant) clearParticipantId();


  // Limpia el cache de sesión actual (para que el siguiente alumno empiece limpio)
  clearCurrentSessionCache();
}



// ----- Idempotencia de envíos (evita duplicados en Firestore) -----
// Si el envío falla a mitad (corte de red, refresh, etc.), reutilizamos el mismo sessionId
// y sobreescribimos los documentos de fotos por tarea en vez de crear nuevos.
const LS_CURRENT_SESSION_ID_KEY = "cbqd_current_session_id";
const LS_CURRENT_SUBMITTED_AT_KEY = "cbqd_current_submitted_at";

function getOrCreateCurrentSessionId() {
  try {
    const existing = localStorage.getItem(LS_CURRENT_SESSION_ID_KEY);
    if (existing) return existing;
  } catch (_) {}
  const id = newSessionId();
  try { localStorage.setItem(LS_CURRENT_SESSION_ID_KEY, id); } catch (_) {}
  return id;
}

function getOrCreateCurrentSubmittedAt() {
  try {
    const existing = localStorage.getItem(LS_CURRENT_SUBMITTED_AT_KEY);
    if (existing) return existing;
  } catch (_) {}
  const ts = nowIso();
  try { localStorage.setItem(LS_CURRENT_SUBMITTED_AT_KEY, ts); } catch (_) {}
  return ts;
}

function clearCurrentSessionCache() {
  try { localStorage.removeItem(LS_CURRENT_SESSION_ID_KEY); } catch (_) {}
  try { localStorage.removeItem(LS_CURRENT_SUBMITTED_AT_KEY); } catch (_) {}
}

// Deshabilitar/habilitar navegación del wizard (para evitar reenvíos tras un envío correcto)
function setWizardNavDisabled(disabled) {
  [wizardBack, wizardBack3, wizardBack4, wizardBack5, wizardNext, wizardNext2, wizardNext3, wizardNext4].forEach(btn => {
    if (!btn) return;
    btn.disabled = !!disabled;
  });
}

function newSessionId() {
  return `S_${Math.random().toString(16).slice(2)}_${Date.now()}`;
}

function nowIso() {
  return new Date().toISOString();
}

// Hash simple (no criptográfico) para versionado reproducible en exportaciones.
function simpleHash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  // a unsigned + base36 para hacerlo corto
  return (h >>> 0).toString(36);
}

function computeCbqdInstrumentVersion(cbqdItems) {
  const items = Array.isArray(cbqdItems) ? cbqdItems : [];
  const payload = items.map(it => `${it.id}|${it.domain || "GENERAL"}|${it.text || ""}`).join("\n");
  return `CBQD_${items.length}_${simpleHash(payload)}`;
}

function computeCbqdScores(cbqdResponses) {
  const valid = (cbqdResponses || []).filter(r => Number.isFinite(r.value));
  const total = valid.reduce((a, r) => a + r.value, 0);
  const subscales = {};
  valid.forEach(r => {
    const k = (r.domain || "GENERAL").trim() || "GENERAL";
    subscales[k] = (subscales[k] || 0) + r.value;
  });
  return { total, subscales, answered: valid.length, missing: (cbqdResponses || []).length - valid.length };
}

function renderCbqd() {
  if (!cbqdItemsHost) return;

  const items = globalConfig.cbqdItems || [];
  cbqdItemsHost.innerHTML = "";

  if (!items.length) {
    return;
  }

  function addCbqdSectionTitle(text) {
    const div = document.createElement("div");
    div.className = "cbqd-section-title";
    div.innerHTML = `<p><strong>${text}</strong></p>`;
    cbqdItemsHost.appendChild(div);
  }

  items.forEach((it, idx) => {
    // Indicaciones por bloques (según el número de pregunta mostrado al alumnado)
    const qn = idx + 1;
    if (qn === 1) {
      addCbqdSectionTitle("¿CUÁNTAS VECES EN LOS ÚLTIMOS TRES MESES ...");
    } else if (qn === 8) {
      addCbqdSectionTitle("¿CUÁNTAS VECES EN EL ÚLTIMO AÑO ...");
    } else if (qn === 19) {
      addCbqdSectionTitle("¿CUÁNTAS VECES EN TU VIDA (ALGUNA VEZ) ...");
    }

    const box = document.createElement("div");
    box.className = "cbqd-item";
    box.dataset.cbqdId = String(it.id);

    const p = document.createElement("p");
    p.innerHTML = `<strong>${idx + 1}.</strong> ${it.text}`;
    box.appendChild(p);

    const scale = document.createElement("div");
    scale.className = "cbqd-scale";

    for (let v = 1; v <= 5; v++) {
      const lab = document.createElement("label");
      const input = document.createElement("input");
      input.type = "radio";
      input.name = `cbqd_${it.id}`;
      input.value = String(v);
      input.required = true;
      input.addEventListener("change", () => {
        // Si el alumno responde, quitamos cualquier marca de "pendiente".
        box.classList.remove("cbqd-missing");
        updateCbqdScores();
      });

      lab.appendChild(input);
      lab.appendChild(document.createTextNode(String(v)));
      scale.appendChild(lab);
    }

    box.appendChild(scale);
    cbqdItemsHost.appendChild(box);
  });

  updateCbqdScores();
}

// Inyecta un estilo mínimo para indicar ítems CBQD pendientes sin tocar tu CSS.
function ensureCbqdMissingStyle() {
  if (document.getElementById("cbqd-missing-style")) return;
  const style = document.createElement("style");
  style.id = "cbqd-missing-style";
  style.textContent = `
    .cbqd-item.cbqd-missing{outline:2px solid #b00020; outline-offset:6px; border-radius:10px;}
    .cbqd-item.cbqd-missing p{color:#b00020;}
  `;
  document.head.appendChild(style);
}

function showWizardMessage(text) {
  const msg = document.getElementById("wizard-message");
  if (!msg) {
    alert(text);
    return;
  }
  msg.textContent = text;
  msg.className = "message error";
}

function clearWizardMessage() {
  const msg = document.getElementById("wizard-message");
  if (!msg) return;
  msg.textContent = "";
  msg.className = "message";
}

// Valida que el CBQD esté completo (si está activado). Si falta algo, avisa, marca y centra el primer ítem pendiente.
function validateCbqdComplete({ focusFirstMissing = true } = {}) {
  const items = globalConfig.cbqdItems || [];
  const cbqdEnabledNow = !!globalConfig.cbqdEnabled && items.length > 0;
  if (!cbqdEnabledNow) return true;

  const responses = getCbqdResponses();
  const missingIds = responses.filter(r => r.value === null).map(r => String(r.id));

  // Limpia marcas previas
  document.querySelectorAll(".cbqd-item.cbqd-missing").forEach(el => el.classList.remove("cbqd-missing"));

  if (!missingIds.length) return true;

  ensureCbqdMissingStyle();

  // Marca los ítems pendientes
  missingIds.forEach(id => {
    const el = cbqdItemsHost?.querySelector(`.cbqd-item[data-cbqd-id="${CSS.escape(id)}"]`);
    if (el) el.classList.add("cbqd-missing");
  });

  showWizardMessage(`Te falta por responder ${missingIds.length} ítem(s) del CBQD. Complétalos para continuar.`);

  // Lleva al alumno al paso del CBQD si no está ya
  const currentStep = wizardOrder[wizardIdx];
  if (currentStep !== 2) {
    // Busca el índice del paso 2 en el orden actual
    const targetIdx = wizardOrder.indexOf(2);
    if (targetIdx >= 0) showWizardStepByIndex(targetIdx);
  }

  if (focusFirstMissing) {
    const firstId = missingIds[0];
    const firstEl = cbqdItemsHost?.querySelector(`.cbqd-item[data-cbqd-id="${CSS.escape(firstId)}"]`);
    if (firstEl && typeof firstEl.scrollIntoView === "function") {
      firstEl.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }
  return false;
}

function getCbqdResponses() {
  const items = globalConfig.cbqdItems || [];
  return items.map(it => {
    const sel = document.querySelector(`input[name="cbqd_${it.id}"]:checked`);
    return {
      id: it.id,
      domain: it.domain || "GENERAL",
      value: sel ? Number(sel.value) : null
    };
  });
}

function updateCbqdScores() {
  // Si el alumno va completando, limpia el aviso general cuando ya no falte nada.
  const items = globalConfig.cbqdItems || [];
  if (!!globalConfig.cbqdEnabled && items.length) {
    const stillMissing = getCbqdResponses().some(r => r.value === null);
    if (!stillMissing) {
      clearWizardMessage();
      document.querySelectorAll(".cbqd-item.cbqd-missing").forEach(el => el.classList.remove("cbqd-missing"));
    }
  }
  const totalEl = document.getElementById("cbqd-total");
  const subEl = document.getElementById("cbqd-subscales");

  const resp = getCbqdResponses().filter(r => Number.isFinite(r.value));
  if (!resp.length) {
    if (totalEl) totalEl.textContent = "—";
    if (subEl) subEl.innerHTML = "";
    return;
  }

  const total = resp.reduce((a, r) => a + r.value, 0);
  if (totalEl) totalEl.textContent = String(total);

  const byDom = new Map();
  resp.forEach(r => {
    const k = r.domain || "GENERAL";
    byDom.set(k, (byDom.get(k) || 0) + r.value);
  });

  if (subEl) {
    subEl.innerHTML = "";
    for (const [dom, sum] of byDom.entries()) {
      const p = document.createElement("p");
      p.innerHTML = `<strong>${dom}:</strong> ${sum}`;
      subEl.appendChild(p);
    }
  }
}

// contador microtarea 2
const task2TextArea = document.getElementById("task2-text");
task2TextArea?.addEventListener("input", () => {
  const c = document.getElementById("task2-count");
  if (c) c.textContent = String(task2TextArea.value.length);
});

// ==================================================
// Análisis automático (IA) para microtareas (preview)
// ==================================================
// Cache en memoria para no recalcular continuamente.
// Se recalcula de nuevo en el envío final por robustez.
let microtaskAiCache = {
  MT1_AUTOEXP: null,
  MT2_ESCOLAR: null,
  MT3_TRANSFORM: null
};

async function analyzeDataUrlForUi(dataUrl) {
  // IA ligera
  let aiFeatures = null;
  let aiScore = null;
  try {
    const aiResult = await computeAiFeaturesFromDataUrl(dataUrl, globalConfig.aiConfig);
    aiFeatures = aiResult.features;
    aiScore = aiResult.score;
  } catch (err) {
    console.error("Error IA ligera:", err);
  }

  // IA local avanzada
  let localAdvanced = null;
  try {
    localAdvanced = await computeLocalAdvancedAnalysis(dataUrl);
  } catch (err) {
    console.error("Error IA local avanzada:", err);
    localAdvanced = {
      thirdsScore: null,
      horizonScore: null,
      goldenScore: null,
      salienceScore: null,
      localAdvancedScore: null
    };
  }

  // IA profunda (microservicio)
  let deepAI = null;
  try {
    deepAI = await computeDeepAI(dataUrl);
  } catch (err) {
    console.error("Error IA profunda:", err);
    deepAI = {
      deepScore: null,
      deepExplanation: null
    };
  }

  return { aiFeatures, aiScore, localAdvanced, deepAI };
}

async function analyzeMicrotaskFileAndRender(taskId, file, els) {
  if (!file) return;
  if (!file.type?.includes("jpeg") && !file.name?.toLowerCase?.().endsWith(".jpg") && !file.name?.toLowerCase?.().endsWith(".jpeg")) {
    // No forzamos error aquí: el navegador ya limita por accept; evitamos falsos positivos.
  }

  const { previewBox, previewImg, previewMeta, aiBox, aiLight, aiLocal, aiDeep, aiDeepExpl } = els;

  // Mostrar placeholders
  previewBox?.classList.remove("hidden");
  aiBox?.classList.remove("hidden");
  if (aiLight) aiLight.textContent = "…";
  if (aiLocal) aiLocal.textContent = "…";
  if (aiDeep) aiDeep.textContent = "…";
  if (aiDeepExpl) aiDeepExpl.textContent = "";
  if (previewMeta) previewMeta.textContent = "Procesando y analizando la imagen…";

  // 1) Redimensionar
  const dataUrl = await resizeImage(file, 1100, 1100, 0.58);
  if (previewImg) previewImg.src = dataUrl;

  // 2) Analizar
  const analysis = await analyzeDataUrlForUi(dataUrl);

  // 3) Pintar resultados
  const l = analysis.aiScore;
  const loc = analysis.localAdvanced?.localAdvancedScore;
  const d = analysis.deepAI?.deepScore;

  if (aiLight) aiLight.textContent = l != null ? Number(l).toFixed(2) : "–";
  if (aiLocal) aiLocal.textContent = loc != null ? Number(loc).toFixed(2) : "–";
  if (aiDeep) aiDeep.textContent = d != null ? Number(d).toFixed(2) : "–";
  if (aiDeepExpl) aiDeepExpl.textContent = analysis.deepAI?.deepExplanation || "";

  if (previewMeta) {
    const sizeKb = Math.round((dataUrl.length * 0.75) / 1024);
    previewMeta.textContent = `Tamaño aproximado: ${sizeKb} KB`;
  }

  microtaskAiCache[taskId] = {
    dataUrl,
    ...analysis
  };
}

function wireMicrotaskAi(taskId, inputId, prefix) {
  const input = document.getElementById(inputId);
  if (!input) return;

  const els = {
    previewBox: document.getElementById(`${prefix}-preview`),
    previewImg: document.getElementById(`${prefix}-preview-image`),
    previewMeta: document.getElementById(`${prefix}-preview-meta`),
    aiBox: document.getElementById(`${prefix}-ai-analysis`),
    aiLight: document.getElementById(`${prefix}-ai-light`),
    aiLocal: document.getElementById(`${prefix}-ai-local`),
    aiDeep: document.getElementById(`${prefix}-ai-deep`),
    aiDeepExpl: document.getElementById(`${prefix}-ai-deep-expl`)
  };

  input.addEventListener("change", async () => {
    try {
      const file = input.files?.[0];
      if (!file) return;
      await analyzeMicrotaskFileAndRender(taskId, file, els);
    } catch (err) {
      console.error(err);
      els.previewBox?.classList.remove("hidden");
      els.aiBox?.classList.remove("hidden");
      if (els.previewMeta) els.previewMeta.textContent = "No se ha podido analizar esta imagen.";
      if (els.aiLight) els.aiLight.textContent = "–";
      if (els.aiLocal) els.aiLocal.textContent = "–";
      if (els.aiDeep) els.aiDeep.textContent = "–";
      if (els.aiDeepExpl) els.aiDeepExpl.textContent = "";
    }
  });
}

wireMicrotaskAi("MT1_AUTOEXP", "task1-photo", "task1");
wireMicrotaskAi("MT2_ESCOLAR", "task2-photo", "task2");
wireMicrotaskAi("MT3_TRANSFORM", "task3-output", "task3");

// Navegación (validando por pasos)
wizardNext?.addEventListener("click", async () => {
  const step1Form = document.getElementById("step1-form");
  if (step1Form && !step1Form.reportValidity()) return;

  // Refresca la config justo antes de calcular el siguiente paso.
  // Así, si el CBQD se activa/desactiva en admin, el alumnado ve el paso 2 al instante.
  try { await loadGlobalConfig(true); } catch (_) {}

  showWizardStepByIndex(wizardIdx + 1);
});

wizardBack?.addEventListener("click", () => showWizardStepByIndex(wizardIdx - 1));
wizardBack3?.addEventListener("click", () => showWizardStepByIndex(wizardIdx - 1));
wizardBack4?.addEventListener("click", () => showWizardStepByIndex(wizardIdx - 1));
wizardBack5?.addEventListener("click", () => showWizardStepByIndex(wizardIdx - 1));

wizardNext2?.addEventListener("click", () => {
  // Si CBQD está activo, no se puede avanzar hasta completarlo.
  if (!validateCbqdComplete({ focusFirstMissing: true })) return;
  showWizardStepByIndex(wizardIdx + 1);
});

wizardNext3?.addEventListener("click", () => {
  const t1 = document.getElementById("task1-form");
  if (t1 && !t1.reportValidity()) return;
  showWizardStepByIndex(wizardIdx + 1);
});

wizardNext4?.addEventListener("click", () => {
  const t2 = document.getElementById("task2-form");
  if (t2 && !t2.reportValidity()) return;
  showWizardStepByIndex(wizardIdx + 1);
});

submitAllBtn?.addEventListener("click", async () => {
  const msg = document.getElementById("wizard-message");
  if (msg) {
    msg.textContent = "";
    msg.className = "message";
  }

  // Evita envíos repetidos (doble click o reintentos tras envío correcto)
  if (submitAllBtn?.disabled) return;

  try {
    await ensureConfigLoaded();
    const step1Form = document.getElementById("step1-form");
    const t1 = document.getElementById("task1-form");
    const t2 = document.getElementById("task2-form");
    const t3 = document.getElementById("task3-form");

    if (step1Form && !step1Form.reportValidity()) return;
    if (t1 && !t1.reportValidity()) return;
    if (t2 && !t2.reportValidity()) return;
    if (t3 && !t3.reportValidity()) return;

    // CBQD (si procede)
    // Si CBQD está activo, bloquea el envío hasta completarlo.
    if (!validateCbqdComplete({ focusFirstMissing: true })) return;

    // A partir de aquí ya intentamos enviar: bloquea el botón para evitar dobles envíos.
    if (submitAllBtn) {
      submitAllBtn.disabled = true;
      submitAllBtn.setAttribute("aria-busy", "true");
      submitAllBtn.textContent = "Enviando…";
    }

    const participantId = ensureParticipantId();
    const sessionId = getOrCreateCurrentSessionId();
    const submittedAt = getOrCreateCurrentSubmittedAt();

    // Demografía (campos ya existentes)
    const ageValue = Number(document.getElementById("age")?.value || 0);
    const gender = document.getElementById("gender")?.value || "";
    const studies = document.getElementById("studies")?.value || "";
    const bachType = document.getElementById("bach-type")?.value || "";
    const esoCourse = document.getElementById("eso-course")?.value || "";
    const vocation = document.getElementById("vocation")?.value?.trim?.() || "";
    const studiesFather = document.getElementById("studies-father")?.value || "";
    const studiesMother = document.getElementById("studies-mother")?.value || "";
    const avgGrade = Number(document.getElementById("avg-grade")?.value || NaN);
    const digitalCreativity = {
      dc1: Number(document.getElementById("dc1")?.value || NaN),
      dc2: Number(document.getElementById("dc2")?.value || NaN),
      dc3: Number(document.getElementById("dc3")?.value || NaN),
      dc4: Number(document.getElementById("dc4")?.value || NaN),
      dc5: Number(document.getElementById("dc5")?.value || NaN),
      dc6: Number(document.getElementById("dc6")?.value || NaN)
    };
    const center = document.getElementById("center")?.value || "";

    const privacyOk = document.getElementById("privacy-ok")?.checked;
    if (!privacyOk) throw new Error("Debes aceptar la política de privacidad.");

    const cbqdItemsNow = globalConfig.cbqdItems || [];
    const cbqdEnabledNow = !!globalConfig.cbqdEnabled && cbqdItemsNow.length > 0;
    const cbqdResponses = cbqdEnabledNow ? getCbqdResponses() : [];
    const cbqdInstrumentVersion = cbqdEnabledNow ? computeCbqdInstrumentVersion(cbqdItemsNow) : "";
    const cbqdScores = cbqdEnabledNow ? computeCbqdScores(cbqdResponses) : { total: null, subscales: {}, answered: 0, missing: 0 };

    // Archivos microtareas
    const f1 = document.getElementById("task1-photo")?.files?.[0];
    const f2 = document.getElementById("task2-photo")?.files?.[0];
    const f3 = document.getElementById("task3-output")?.files?.[0];
    // Nota: en versiones anteriores la microtarea 2 incluía un campo de texto (≤ 280 caracteres).
    // Actualmente NO es obligatorio y puede incluso no existir en el HTML.
    const task2Text = (document.getElementById("task2-text")?.value || "").trim();

    if (!f1 || !f2 || !f3) throw new Error("Faltan archivos de alguna microtarea.");

    // Microtarea 2: el texto es opcional (si existe), pero si se usa debe respetar el límite.
    if (task2Text.length > 280) {
      throw new Error("El texto de la microtarea 2 no puede superar los 280 caracteres.");
    }

    // --- Preparar imágenes y análisis IA (por microtarea) ---
    // Reutiliza el cache si ya se analizó en la vista previa, pero vuelve a calcular si falta.
    async function getOrAnalyze(taskId, file) {
      const cached = microtaskAiCache?.[taskId];
      if (cached?.dataUrl) return cached;

      const dataUrl = await resizeImage(file, 1100, 1100, 0.58);
      const analysis = await analyzeDataUrlForUi(dataUrl);
      const full = { dataUrl, ...analysis };
      microtaskAiCache[taskId] = full;
      return full;
    }

    const [mt1, mt2, mt3] = await Promise.all([
      getOrAnalyze("MT1_AUTOEXP", f1),
      getOrAnalyze("MT2_ESCOLAR", f2),
      getOrAnalyze("MT3_TRANSFORM", f3)
    ]);

    // Guardar PARTICIPANT (identificador persistente) + SESIÓN (una participación concreta).
    // - participants: mínimo para poder unir y auditar.
    // - sessions: snapshot completo (demografía + CBQD) para análisis científico.
    const participantRef = doc(db, "participants", participantId);
    const pSnap = await getDoc(participantRef);
    const firstSeenAt = (pSnap.exists() && pSnap.data()?.firstSeenAt) ? pSnap.data().firstSeenAt : submittedAt;
    await setDoc(participantRef, {
      participantId,
      firstSeenAt,
      lastSeenAt: submittedAt
    }, { merge: true });

    const demographics = {
      age: ageValue,
      gender,
      studies,
      bachType,
      esoCourse,
      vocation,
      studiesFather,
      studiesMother,
      avgGrade: Number.isFinite(avgGrade) ? avgGrade : null,
      digitalCreativity: {
        dc1: Number.isFinite(digitalCreativity.dc1) ? digitalCreativity.dc1 : null,
        dc2: Number.isFinite(digitalCreativity.dc2) ? digitalCreativity.dc2 : null,
        dc3: Number.isFinite(digitalCreativity.dc3) ? digitalCreativity.dc3 : null,
        dc4: Number.isFinite(digitalCreativity.dc4) ? digitalCreativity.dc4 : null,
        dc5: Number.isFinite(digitalCreativity.dc5) ? digitalCreativity.dc5 : null,
        dc6: Number.isFinite(digitalCreativity.dc6) ? digitalCreativity.dc6 : null
      },
      center: globalConfig.askCenter ? center : ""
    };

    const sessionRef = doc(db, "sessions", sessionId);
    await setDoc(sessionRef, {
      sessionId,
      participantId,
      submittedAt,
      createdAt: submittedAt,
      demographics,
      cbqd: {
        enabled: cbqdEnabledNow,
        instrumentVersion: cbqdInstrumentVersion,
        itemsUsed: cbqdItemsNow.map(it => ({ id: it.id, domain: it.domain || "GENERAL", text: it.text || "" })),
        responses: cbqdResponses,
        scores: {
          total: cbqdScores.total,
          subscales: cbqdScores.subscales,
          answered: cbqdScores.answered,
          missing: cbqdScores.missing
        }
      }
    });

    // Guardar artefactos como "photos" para integrarlos con valoración por expertos
    const commonMeta = {
      participantId,
      sessionId,
      submittedAt,
      taskSource: "wizard",

      // Snapshot mínimo en la foto para no romper la interfaz de expertos ni gráficas rápidas.
      // El 'canon' para análisis está en sessions.demographics.
      age: ageValue,
      gender,
      studies,
      bachType,
      esoCourse,
      vocation,
      studiesFather,
      studiesMother,
      avgGrade: Number.isFinite(avgGrade) ? avgGrade : null,
      digitalCreativity: {
        dc1: Number.isFinite(digitalCreativity.dc1) ? digitalCreativity.dc1 : null,
        dc2: Number.isFinite(digitalCreativity.dc2) ? digitalCreativity.dc2 : null,
        dc3: Number.isFinite(digitalCreativity.dc3) ? digitalCreativity.dc3 : null,
        dc4: Number.isFinite(digitalCreativity.dc4) ? digitalCreativity.dc4 : null,
        dc5: Number.isFinite(digitalCreativity.dc5) ? digitalCreativity.dc5 : null,
        dc6: Number.isFinite(digitalCreativity.dc6) ? digitalCreativity.dc6 : null
      },
      center: globalConfig.askCenter ? center : "",

      cbqdEnabled: cbqdEnabledNow,
      cbqdVersion: cbqdInstrumentVersion,
      cbqdTotal: cbqdScores.total,
      cbqdSubscales: cbqdScores.subscales,
      cbqdResponses: cbqdResponses
    };

    const [mt1Storage, mt2Storage, mt3Storage] = await Promise.all([
      buildPhotoStorageFields(sessionId, "MT1_AUTOEXP", mt1.dataUrl),
      buildPhotoStorageFields(sessionId, "MT2_ESCOLAR", mt2.dataUrl),
      buildPhotoStorageFields(sessionId, "MT3_TRANSFORM", mt3.dataUrl)
    ]);

    await setDoc(doc(db, "photos", `${sessionId}_MT1_AUTOEXP`), {
      ...commonMeta,
      taskId: "MT1_AUTOEXP",
      taskOrder: 1,
      createdAt: submittedAt,
      ...mt1Storage,
      aiFeatures: mt1.aiFeatures,
      aiScore: mt1.aiScore,
      localAdvanced: mt1.localAdvanced,
      deepAI: mt1.deepAI
    });

    await setDoc(doc(db, "photos", `${sessionId}_MT2_ESCOLAR`), {
      ...commonMeta,
      taskId: "MT2_ESCOLAR",
      taskOrder: 2,
      createdAt: submittedAt,
      ...mt2Storage,
      // Guardamos el texto si existe y se ha rellenado; si no, dejamos null para evitar basura en exportaciones.
      text280: task2Text ? task2Text : null,
      aiFeatures: mt2.aiFeatures,
      aiScore: mt2.aiScore,
      localAdvanced: mt2.localAdvanced,
      deepAI: mt2.deepAI
    });

    await setDoc(doc(db, "photos", `${sessionId}_MT3_TRANSFORM`), {
      ...commonMeta,
      taskId: "MT3_TRANSFORM",
      taskOrder: 3,
      createdAt: submittedAt,
      ...mt3Storage,
      aiFeatures: mt3.aiFeatures,
      aiScore: mt3.aiScore,
      localAdvanced: mt3.localAdvanced,
      deepAI: mt3.deepAI
    });

    if (msg) {
      msg.className = "message success";
      msg.textContent = "¡Enviado! Muchas gracias por participar.";
    }

    // Deja el botón bloqueado para este alumno (ya ha enviado)
    if (submitAllBtn) {
      submitAllBtn.disabled = true;
      submitAllBtn.removeAttribute("aria-busy");
      submitAllBtn.textContent = "Enviado ✓";
    }

    // También bloquea \"Atrás\" en el último paso para evitar reenvíos accidentales
    if (wizardBack5) wizardBack5.disabled = true;

    // Preparar el dispositivo para un nuevo alumno (sin arrastrar identificación ni respuestas)
    clearParticipantId();
    clearCurrentSessionCache();
    microtaskAiCache = {};

  } catch (err) {
    console.error(err);
    if (msg) {
      msg.className = "message error";
      msg.textContent = err?.message || "Ha ocurrido un error al enviar.";
    }

    // Si ha fallado el envío, vuelve a habilitar el botón para reintentar
    if (submitAllBtn) {
      submitAllBtn.disabled = false;
      submitAllBtn.removeAttribute("aria-busy");
      submitAllBtn.textContent = SUBMIT_ALL_DEFAULT_LABEL;
    }
  }
});


// ----- SUBIDA DE FOTOGRAFÍA (FIRESTORE + IA) -----
const uploadForm = document.getElementById("upload-form");
const uploadMessage = document.getElementById("upload-message");
const uploadPreview = document.getElementById("upload-preview");
const previewImage = document.getElementById("preview-image");
const previewMeta = document.getElementById("preview-meta");

// NUEVO: bloques de análisis automático en la vista de subida
const uploadAiAnalysis = document.getElementById("upload-ai-analysis");
const aiLightScoreSpan = document.getElementById("ai-light-score");
const aiLocalScoreSpan = document.getElementById("ai-local-score");
const aiDeepScoreSpan = document.getElementById("ai-deep-score");
const aiDeepExplanationP = document.getElementById("ai-deep-explanation");

if (uploadForm) uploadForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  uploadMessage.textContent = "";
  uploadMessage.className = "message";

  if (!uploadForm.reportValidity()) {
    return;
  }

  const fileInput = document.getElementById("photo-file");
  const ageValue = Number(document.getElementById("age").value);
  const gender = document.getElementById("gender").value;
  const studies = document.getElementById("studies").value;
  const bachType = document.getElementById("bach-type").value || "";
  const esoCourse = document.getElementById("eso-course")?.value || "";
  const vocation = document.getElementById("vocation").value.trim();
  const studiesFather = document.getElementById("studies-father").value;
  const studiesMother = document.getElementById("studies-mother").value;

  const avgGrade = Number(document.getElementById("avg-grade")?.value || NaN);
  const digitalCreativity = {
    dc1: Number(document.getElementById("dc1")?.value || NaN),
    dc2: Number(document.getElementById("dc2")?.value || NaN),
    dc3: Number(document.getElementById("dc3")?.value || NaN),
    dc4: Number(document.getElementById("dc4")?.value || NaN),
    dc5: Number(document.getElementById("dc5")?.value || NaN),
    dc6: Number(document.getElementById("dc6")?.value || NaN)
  };
  const center = centerSelect ? centerSelect.value.trim() : "";

  const privacyOk = document.getElementById("privacy-ok");

  if (!Number.isFinite(ageValue) || ageValue < 10 || ageValue > 100) {
    uploadMessage.textContent = "Introduce una edad válida entre 10 y 100 años.";
    uploadMessage.classList.add("error");
    return;
  }

  if (!privacyOk || !privacyOk.checked) {
    uploadMessage.textContent = "Debes aceptar la política de privacidad.";
    uploadMessage.classList.add("error");
    return;
  }

  if (!fileInput.files || !fileInput.files[0]) {
    uploadMessage.textContent = "Debes seleccionar una fotografía.";
    uploadMessage.classList.add("error");
    return;
  }

  const file = fileInput.files[0];

  uploadMessage.textContent = "Procesando fotografía...";
  uploadMessage.className = "message";

  try {
    const dataUrl = await resizeImage(file, 1100, 1100, 0.58);

    if (dataUrl.length > 950000) {
      uploadMessage.textContent =
        "La fotografía sigue siendo demasiado pesada incluso tras comprimirla. Prueba con una imagen más pequeña.";
      uploadMessage.classList.add("error");
      return;
    }

    // IA ligera
    let aiFeatures = null;
    let aiScore = null;
    try {
      const aiResult = await computeAiFeaturesFromDataUrl(dataUrl, globalConfig.aiConfig);
      aiFeatures = aiResult.features;
      aiScore = aiResult.score;
    } catch (err) {
      console.error("Error IA ligera:", err);
    }

    // IA local avanzada
    let localAdvanced = null;
    try {
      localAdvanced = await computeLocalAdvancedAnalysis(dataUrl);
    } catch (err) {
      console.error("Error IA local avanzada:", err);
      localAdvanced = {
        thirdsScore: null,
        horizonScore: null,
        goldenScore: null,
        salienceScore: null,
        localAdvancedScore: null
      };
    }

    // IA profunda (microservicio)
    let deepAI = null;
    try {
      deepAI = await computeDeepAI(dataUrl);
    } catch (err) {
      console.error("Error IA profunda:", err);
      deepAI = {
        deepScore: null,
        deepExplanation: null
      };
    }

    const docRef = await addDoc(photosCol, {
      dataUrl: dataUrl,
      age: ageValue,
      gender: gender,
      studies: studies,
      bachType: bachType,
      esoCourse: esoCourse,
      vocation: vocation,
      studiesFather: studiesFather,
      studiesMother: studiesMother,
      avgGrade: Number.isFinite(avgGrade) ? avgGrade : null,
      digitalCreativity: {
        dc1: Number.isFinite(digitalCreativity.dc1) ? digitalCreativity.dc1 : null,
        dc2: Number.isFinite(digitalCreativity.dc2) ? digitalCreativity.dc2 : null,
        dc3: Number.isFinite(digitalCreativity.dc3) ? digitalCreativity.dc3 : null,
        dc4: Number.isFinite(digitalCreativity.dc4) ? digitalCreativity.dc4 : null,
        dc5: Number.isFinite(digitalCreativity.dc5) ? digitalCreativity.dc5 : null,
        dc6: Number.isFinite(digitalCreativity.dc6) ? digitalCreativity.dc6 : null
      },
      center: globalConfig.askCenter ? center : "",

      aiFeatures: aiFeatures,
      aiScore: aiScore,

      localAdvanced: localAdvanced,
      deepAI: deepAI,

      createdAt: new Date().toISOString()
    });

    const photoId = docRef.id;

    uploadMessage.textContent = "Fotografía guardada correctamente en la base de datos. ¡Gracias por tu participación!";
    uploadMessage.className = "message success";

    uploadPreview.classList.remove("hidden");
    previewImage.src = dataUrl;

    const aiText = aiScore != null ? ` | AI_PUNTF: ${aiScore}` : "";
    const localText = localAdvanced?.localAdvancedScore != null ? ` | IA_local: ${localAdvanced.localAdvancedScore}` : "";
    const deepText = deepAI?.deepScore != null ? ` | IA_profunda: ${deepAI.deepScore}` : "";

    previewMeta.textContent =
      "ID: " + photoId +
      " | Edad: " + ageValue +
      " | Sexo: " + gender +
      " | Estudios: " + studies +
      " | Bachillerato: " + (bachType || "N/A") +
      " | ESO: " + (esoCourse || "N/A") +
      aiText + localText + deepText;

    if (uploadAiAnalysis) {
      uploadAiAnalysis.classList.remove("hidden");
      if (aiLightScoreSpan) {
        aiLightScoreSpan.textContent = aiScore != null ? aiScore.toFixed(2) : "–";
      }
      if (aiLocalScoreSpan) {
        aiLocalScoreSpan.textContent =
          localAdvanced?.localAdvancedScore != null
            ? localAdvanced.localAdvancedScore.toFixed(2)
            : "–";
      }
      if (aiDeepScoreSpan) {
        aiDeepScoreSpan.textContent =
          deepAI?.deepScore != null ? deepAI.deepScore.toFixed(2) : "–";
      }
      if (aiDeepExplanationP) {
        aiDeepExplanationP.textContent = deepAI?.deepExplanation || "";
      }
    }

    uploadForm.reset();
    if (bachWrapper) bachWrapper.style.display = "none";
    if (esoWrapper) esoWrapper.style.display = "none";
    const esoCourseSelect = document.getElementById("eso-course");
    if (esoCourseSelect) esoCourseSelect.required = false;
    applyConfigToUpload(); // reconstruir select de centros tras reset
  } catch (err) {
    console.error("Error al procesar o guardar la fotografía:", err);
    uploadMessage.textContent =
      "Ha ocurrido un problema al procesar la fotografía. Es posible que el formato de la imagen no sea compatible en este dispositivo.";
    uploadMessage.classList.add("error");
  }
});


function buildPhotoStorageFields(sessionId, taskId, dataUrl) {
  const len = String(dataUrl || "").length;
  if (!dataUrl || len > SPARK_IMAGE_MAX_DATAURL_CHARS) {
    throw new Error(
      `La imagen de ${taskId} supera el tamaño seguro para Firestore tras la compresión. ` +
      "El alumnado debe subir una fotografía JPG más ligera."
    );
  }

  return {
    dataUrl,
    imageUrl: "",
    storagePath: "",
    imageStorageMode: "firestore_data_url_spark",
    imageDataUrlLength: len,
    imageEstimatedBytes: estimateDataUrlBytes(dataUrl),
    imageCompressionMode: "spark_strong_client_compression",
    imageMaxDataUrlChars: SPARK_IMAGE_MAX_DATAURL_CHARS
  };
}

function getPhotoSrc(photo) {
  return photo?.imageUrl || photo?.dataUrl || photo?.imageDataUrl || "";
}

function getTaskBriefForExperts(taskId) {
  switch (taskId) {
    case "MT1_AUTOEXP":
      return "Valora únicamente la imagen como fotografía autoexpresiva. No uses datos del alumnado para interpretar la puntuación.";
    case "MT2_ESCOLAR":
      return "Valora cómo transforma visualmente un objeto, espacio o situación cotidiana de su contexto habitual. No debe necesitar texto ni edición compleja.";
    case "MT3_TRANSFORM":
      return "Valora la composición final como transformación digital básica, sin exigir técnicas avanzadas.";
    default:
      return "Valora únicamente la imagen con la rúbrica indicada.";
  }
}


function isExpertCodeAllowed(expertId) {
  const allowed = (globalConfig.expertCodes || []).map(normalizeExpertId).filter(Boolean);
  return allowed.length === 0 || allowed.includes(normalizeExpertId(expertId));
}

function countRatingsByPhoto(ratingsSnap) {
  const map = {};
  ratingsSnap.docs.forEach(docSnap => {
    const r = docSnap.data();
    if (!r?.photoId) return;
    (map[r.photoId] ||= new Set()).add(normalizeExpertId(r.expertId));
  });
  return map;
}

// ----- VALORACIÓN POR EXPERTOS -----
const ratingArea = document.getElementById("rating-area");
const noPhotosMessage = document.getElementById("no-photos-message");
const photoRatingCard = document.getElementById("photo-rating-card");
const ratingPhoto = document.getElementById("rating-photo");
const ratingPhotoInfo = document.getElementById("rating-photo-info");
const ratingMessage = document.getElementById("rating-message");

let currentPhotoForExpert = null;

document.getElementById("start-rating-button").addEventListener("click", () => {
  const expertInput = document.getElementById("expert-id");
  const expertId = normalizeExpertId(expertInput.value);
  if (!expertId) {
    alert("Introduce tu código de experto/a.");
    return;
  }
  expertInput.value = expertId;
  if (!isExpertCodeAllowed(expertId)) {
    alert("Este código de experto/a no está autorizado para valorar en este estudio.");
    return;
  }

  ratingArea.classList.remove("hidden");
  loadNextPhotoForExpert();
});


function formatTaskId(taskId) {
  switch (taskId) {
    case "MT1_AUTOEXP": return "Microtarea 1 (autoexpresiva)";
    case "MT2_ESCOLAR": return "Microtarea 2 (contexto habitual)";
    case "MT3_TRANSFORM": return "Microtarea 3 (transformación)";
    default: return taskId || "—";
  }
}

async function loadNextPhotoForExpert() {
  const expertId = normalizeExpertId(document.getElementById("expert-id").value);
  if (!expertId) return;

  try {
    const photosSnap = await getDocs(photosCol);
    const photos = photosSnap.docs.map(docSnap => ({
      id: docSnap.id,
      ...docSnap.data()
    }));

    // Cargamos todas las valoraciones y normalizamos el código para evitar duplicados
    // por diferencias de mayúsculas, espacios o variantes como EXP01 / exp01.
    const ratingsSnap = await getDocs(ratingsCol);

    const ratedPhotoIds = new Set(
      ratingsSnap.docs
        .map(d => d.data())
        .filter(r => normalizeExpertId(r.expertId) === expertId)
        .map(r => r.photoId)
    );

    const pending = photos.filter(p => !ratedPhotoIds.has(p.id));

    if (pending.length === 0) {
      currentPhotoForExpert = null;
      photoRatingCard.classList.add("hidden");
      noPhotosMessage.classList.remove("hidden");
      ratingMessage.textContent = "";
      return;
    }

    noPhotosMessage.classList.add("hidden");
    photoRatingCard.classList.remove("hidden");

    const randomIndex = Math.floor(Math.random() * pending.length);
    const photo = pending[randomIndex];
    currentPhotoForExpert = photo;

    ratingPhoto.src = getPhotoSrc(photo);

    const photoCode = makePhotoCode(photo.id);
    ratingPhotoInfo.textContent =
      `Código de imagen: ${photoCode} | Tarea: ${formatTaskId(photo.taskId)}. ` +
      getTaskBriefForExperts(photo.taskId);

    ratingControls.forEach(rc => {
      rc.input.value = 5;
      rc.valueSpan.textContent = "5";
    });
    updatePuntf();
    ratingMessage.textContent = "";
  } catch (err) {
    console.error(err);
    noPhotosMessage.textContent = "Error cargando fotografías.";
    noPhotosMessage.classList.remove("hidden");
    photoRatingCard.classList.add("hidden");
  }
}

// Guardar valoración de experto
document.getElementById("save-rating-button").addEventListener("click", async () => {
  if (!currentPhotoForExpert) return;

  const expertInput = document.getElementById("expert-id");
  const expertId = normalizeExpertId(expertInput.value);
  if (!expertId) {
    alert("Introduce tu código de experto/a.");
    return;
  }
  expertInput.value = expertId;
  if (!isExpertCodeAllowed(expertId)) {
    alert("Este código de experto/a no está autorizado para valorar en este estudio.");
    return;
  }

  if (!ratingControls.length) {
    alert("No hay ítems de valoración configurados.");
    return;
  }

  const ratingsMap = {};
  let sum = 0;
  ratingControls.forEach(rc => {
    const v = Number(rc.input.value);
    sum += v;
    ratingsMap[rc.config.id] = v;
  });
  const puntf = sum / ratingControls.length;

  try {
    await addDoc(ratingsCol, {
      photoId: currentPhotoForExpert.id,
      photoCode: makePhotoCode(currentPhotoForExpert.id),
      participantId: currentPhotoForExpert.participantId || "",
      sessionId: currentPhotoForExpert.sessionId || "",
      taskId: currentPhotoForExpert.taskId || "",
      taskOrder: currentPhotoForExpert.taskOrder || "",
      expertId,
      ratings: ratingsMap,
      ratingItemsSnapshot: ratingControls.map(rc => ({ id: rc.config.id, label: normalizeRatingItemLabel(rc.config.label) })),
      puntf,
      createdAt: new Date().toISOString()
    });

    ratingMessage.textContent = "Valoración guardada.";
    ratingMessage.className = "message success";

    loadNextPhotoForExpert();
  } catch (err) {
    console.error(err);
    ratingMessage.textContent = "Error al guardar la valoración.";
    ratingMessage.className = "message error";
  }
});

// Omitir foto
document.getElementById("skip-photo-button").addEventListener("click", () => {
  loadNextPhotoForExpert();
});

// ----- PANEL ADMIN / RESUMEN + EXPORTAR CSV + VISUALIZACIÓN -----
async function updateAdminSummary() {
  try {
    const [photosSnap, ratingsSnap] = await Promise.all([
      getCollectionSnapshotFresh(photosCol),
      getCollectionSnapshotFresh(ratingsCol)
    ]);

    const summaryList = document.getElementById("admin-summary-list");
    summaryList.innerHTML = "";

    const li1 = document.createElement("li");
    li1.textContent = `Número de fotografías almacenadas: ${photosSnap.size}`;
    summaryList.appendChild(li1);

    const li2 = document.createElement("li");
    li2.textContent = `Número total de valoraciones registradas: ${ratingsSnap.size}`;
    summaryList.appendChild(li2);

    const expertIds = Array.from(
      new Set(ratingsSnap.docs.map(d => d.data().expertId))
    );
    const li3 = document.createElement("li");
    li3.textContent = `Número de expertos/as activos: ${expertIds.length}`;
    summaryList.appendChild(li3);

    const ratingsByPhoto = countRatingsByPhoto(ratingsSnap);
    const counts = photosSnap.docs.map(d => ratingsByPhoto[d.id]?.size || 0);
    const complete = counts.filter(n => n >= EXPECTED_EXPERT_RATINGS).length;
    const incomplete = counts.filter(n => n > 0 && n < EXPECTED_EXPERT_RATINGS).length;
    const unrated = counts.filter(n => n === 0).length;

    const li4 = document.createElement("li");
    li4.textContent = `Fotografías con ${EXPECTED_EXPERT_RATINGS}/${EXPECTED_EXPERT_RATINGS} valoraciones: ${complete}`;
    summaryList.appendChild(li4);

    const li5 = document.createElement("li");
    li5.textContent = `Fotografías incompletas: ${incomplete} | Sin valorar: ${unrated}`;
    summaryList.appendChild(li5);

    renderAgeChart(photosSnap);
  } catch (err) {
    console.error(err);
  }
}

function renderAgeChart(photosSnap) {
  if (!ageChart) return;

  const ageCounts = {};
  photosSnap.docs.forEach(docSnap => {
    const p = docSnap.data();
    if (typeof p.age === "number") {
      ageCounts[p.age] = (ageCounts[p.age] || 0) + 1;
    }
  });

  ageChart.innerHTML = "";
  if (ageChartNote) ageChartNote.textContent = "";

  const ages = Object.keys(ageCounts).map(a => Number(a)).sort((a, b) => a - b);
  if (ages.length === 0) {
    if (ageChartNote) {
      ageChartNote.textContent = "Todavía no hay datos suficientes para mostrar la distribución por edad.";
    }
    return;
  }

  const maxCount = Math.max(...ages.map(a => ageCounts[a]));
  ages.forEach(age => {
    const row = document.createElement("div");
    row.className = "chart-row";

    const label = document.createElement("span");
    label.className = "chart-label";
    label.textContent = `${age} años`;

    const outer = document.createElement("div");
    outer.className = "chart-bar-outer";

    const inner = document.createElement("div");
    inner.className = "chart-bar-inner";
    const widthPercent = (ageCounts[age] / maxCount) * 100;
    inner.style.width = `${widthPercent}%`;

    outer.appendChild(inner);
    row.appendChild(label);
    row.appendChild(outer);
    ageChart.appendChild(row);
  });

  if (ageChartNote) {
    ageChartNote.textContent = "Cada barra representa el número relativo de fotografías por edad.";
  }
}

// Listado de todas las fotografías y valoraciones
async function loadAllPhotosWithRatings() {
  if (!photosList) return;
  photosList.textContent = "Cargando fotografías y valoraciones...";

  try {
    const [photosSnap, ratingsSnap] = await Promise.all([
      getCollectionSnapshotFresh(photosCol),
      getCollectionSnapshotFresh(ratingsCol)
    ]);

    if (photosSnap.empty) {
      photosList.textContent = "No hay fotografías almacenadas.";
      return;
    }

    const ratingsByPhoto = {};
    ratingsSnap.docs.forEach(docSnap => {
      const r = docSnap.data();
      const photoId = r.photoId;
      if (!photoId) return;
      if (!ratingsByPhoto[photoId]) ratingsByPhoto[photoId] = [];
      ratingsByPhoto[photoId].push({
        id: docSnap.id,
        ...r
      });
    });

    const items = globalConfig.ratingItems && globalConfig.ratingItems.length
      ? globalConfig.ratingItems
      : DEFAULT_RATING_ITEMS;

    photosList.innerHTML = "";
    photosSnap.docs.forEach(docSnap => {
      const p = docSnap.data();
      const photoId = docSnap.id;

      const card = document.createElement("div");
      card.className = "photo-card";

      const img = document.createElement("img");
      img.src = getPhotoSrc(p);
      img.alt = "Fotografía " + photoId;

      const ai1 = p.aiScore != null ? `AI_PUNTF: ${p.aiScore}` : "";
      const ai2 = p.localAdvanced?.localAdvancedScore != null
        ? `IA_local: ${p.localAdvanced.localAdvancedScore}`
        : "";
      const ai3 = p.deepAI?.deepScore != null
        ? `IA_profunda: ${p.deepAI.deepScore}`
        : "";

      const meta = document.createElement("p");
      meta.innerHTML = `
        <strong>ID:</strong> ${photoId}<br>
        Edad: ${p.age ?? ""} | Sexo: ${p.gender || ""}<br>
        Estudios: ${p.studies || ""} | Bachillerato: ${p.bachType || ""} | ESO: ${p.esoCourse || ""}<br>
        Vocación: ${p.vocation || ""}<br>
        Centro: ${p.center || ""}<br>
        ${ai1} ${ai2} ${ai3}
      `;

      card.appendChild(img);
      card.appendChild(meta);

      const rList = ratingsByPhoto[photoId] || [];
      const ratingsInfo = document.createElement("div");
      ratingsInfo.className = "photo-ratings";

      if (rList.length === 0) {
        ratingsInfo.textContent = "Sin valoraciones aún.";
      } else {
        const avg = rList.reduce(
          (sum, r) => sum + (typeof r.puntf === "number" ? r.puntf : 0),
          0
        ) / rList.length;

        const resumen = document.createElement("p");
        resumen.textContent = `Valoraciones: ${new Set(rList.map(r => normalizeExpertId(r.expertId))).size}/${EXPECTED_EXPERT_RATINGS} | PUNTF media: ${avg.toFixed(2)}`;
        ratingsInfo.appendChild(resumen);

        const table = document.createElement("table");
        const thead = document.createElement("thead");

        let headerHtml = "<tr><th>Experto/a</th>";
        items.forEach(item => {
          headerHtml += `<th>${item.label}</th>`;
        });
        headerHtml += "<th>PUNTF</th></tr>";
        thead.innerHTML = headerHtml;
        table.appendChild(thead);

        const tbody = document.createElement("tbody");
        rList.forEach(r => {
          const tr = document.createElement("tr");

          const ratingsMap = r.ratings || {};
          let rowHtml = `<td>${r.expertId || ""}</td>`;
          items.forEach((item, idx) => {
            let val = ratingsMap[item.id];
            // Compatibilidad con datos antiguos tipo sub1, sub2...
            if (val === undefined && r[`sub${idx + 1}`] !== undefined) {
              val = r[`sub${idx + 1}`];
            }
            rowHtml += `<td>${val ?? ""}</td>`;
          });
          rowHtml += `<td>${typeof r.puntf === "number" ? r.puntf.toFixed(2) : ""}</td>`;

          tr.innerHTML = rowHtml;
          tbody.appendChild(tr);
        });

        table.appendChild(tbody);
        ratingsInfo.appendChild(table);
      }

      card.appendChild(ratingsInfo);
      photosList.appendChild(card);
    });
  } catch (err) {
    console.error(err);
    photosList.textContent = "Error cargando fotografías y valoraciones.";
  }
}

if (loadPhotosButton) {
  loadPhotosButton.addEventListener("click", loadAllPhotosWithRatings);
}

// Exportar CSV (formato largo): 1 fila por (foto × experto), incluyendo CBQD + demografía vinculada.
function buildCsvContent(rows, delimiter = ";") {
  // CSV compatible con Excel (España): separador ';' y BOM UTF-8 para caracteres como "Sí".
  const lines = rows.map(row =>
    row
      .map(value => {
        const str = String(value ?? "");
        if (str.includes(delimiter) || str.includes('"') || str.includes("\n") || str.includes("\r")) {
          return `"${str.replace(/"/g, '""')}"`;
        }
        return str;
      })
      .join(delimiter)
  );

  // CRLF para que Excel no "rompa" filas en Windows.
  return "\ufeff" + lines.join("\r\n");
}


// Códigos cortos y estables para identificadores en CSV (evita IDs largos de Firestore).
// Determinista: mismo id -> mismo code.
function makeIdCode(id, length = 8) {
  const s = String(id ?? "");
  if (!s) return "";
  // FNV-1a 32-bit (rápido y suficiente para códigos cortos)
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  // Base36 y padding para longitud fija
  const code = h.toString(36).toUpperCase();
  return code.padStart(length, "0").slice(-length);
}

// Alias semánticos (por claridad en CSV)
function makeStudentCode(participantId, length = 8) {
  return makeIdCode(participantId, length);
}
function makeSessionCode(sessionId, length = 8) {
  return makeIdCode(sessionId, length);
}
function makePhotoCode(photoId, length = 8) {
  return makeIdCode(photoId, length);
}

function triggerCsvDownload(csvContent, filenameBase) {
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const now = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  const a = document.createElement("a");
  a.href = url;
  a.download = `${filenameBase}_${now}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

document.getElementById("export-csv-button").addEventListener("click", async () => {
  try {
    const [photosSnap, ratingsSnap, sessionsSnap] = await Promise.all([
      getDocs(photosCol),
      getDocs(ratingsCol),
      getDocs(sessionsCol)
    ]);

    if (photosSnap.empty) {
      alert("No hay fotografías almacenadas.");
      return;
    }

    // Indexación en memoria
    const photos = {};
    photosSnap.docs.forEach(d => { photos[d.id] = d.data(); });

    const sessions = {};
    sessionsSnap.docs.forEach(d => { sessions[d.id] = d.data(); });

    const ratingItems = (globalConfig.ratingItems && globalConfig.ratingItems.length)
      ? globalConfig.ratingItems
      : DEFAULT_RATING_ITEMS;

    // Detectar universo de ítems CBQD y dominios (para exportaciones robustas aunque cambie la config)
    const cbqdItemIds = new Set();
    const cbqdDomains = new Set();

    Object.values(sessions).forEach(s => {
      const c = s.cbqd || {};
      const items = c.itemsUsed || c.items || [];
      items.forEach(it => {
        if (it?.id) cbqdItemIds.add(it.id);
        const dom = (it?.domain || "GENERAL").trim() || "GENERAL";
        cbqdDomains.add(dom);
      });
      (c.responses || []).forEach(r => {
        if (r?.id) cbqdItemIds.add(r.id);
        const dom = (r?.domain || "GENERAL").trim() || "GENERAL";
        cbqdDomains.add(dom);
      });
    });

    // Si todavía no hay sesiones (datos antiguos), usa la config actual como fallback.
    if (cbqdItemIds.size === 0) {
      (globalConfig.cbqdItems || []).forEach(it => {
        if (it?.id) cbqdItemIds.add(it.id);
        const dom = (it?.domain || "GENERAL").trim() || "GENERAL";
        cbqdDomains.add(dom);
      });
    }

    const cbqdItemList = Array.from(cbqdItemIds).sort();
    const cbqdDomainList = Array.from(cbqdDomains).sort();

    const header = [
      // Identificación y estructura
      "photo_code",
      "session_code",
      "student_code",
      "taskId",
      "taskOrder",
      "submittedAt",
      "createdAt",
      "text280",
      "imageStorageMode",
      "storagePath",      // Demografía
      "sexo",
      "edad",
      "estudios",
      "tipoBach",
      "cursoESO",
      "vocacion",
      "estudios_padre",
      "estudios_madre",
      "nota_media_curso_pasado",
      "dc1",
      "dc2",
      "dc3",
      "dc4",
      "dc5",
      "dc6",
      "centro_educativo",

      // CBQD
      "cbqd_on",
      "cbqd_ver",
      "cbqd_total",
      "cbqd_answered",
      "cbqd_missing"
    ];

    cbqdDomainList.forEach(dom => header.push(`cbqd_dom_${dom}`));
    cbqdItemList.forEach(id => header.push(`cbqd_item_${id}`));

    // IA
    header.push(
      "ai_brightness",
      "ai_contrast",
      "ai_colorfulness",
      "ai_edgeDensity",
      "ai_score",
      "local_thirds",
      "local_horizon",
      "local_golden",
      "local_salience",
      "local_score",
      "deep_score",
      "deep_explanation",

      // Valoración
      "expertoId"
    );

    ratingItems.forEach(item => header.push(item.label));
    header.push("puntf");

    const rows = [header];

    const ratingsArr = ratingsSnap.docs.map(d => ({ id: d.id, ...d.data() }));

    function pickDemographics(p, s) {
      // Preferimos el snapshot de sesión; si no existe, usamos lo que haya en la foto.
      const d = (s && s.demographics) ? s.demographics : (p || {});
      return {
        age: d.age ?? p?.age ?? "",
        gender: d.gender || p?.gender || "",
        studies: d.studies || p?.studies || "",
        bachType: d.bachType || p?.bachType || "",
        esoCourse: d.esoCourse || p?.esoCourse || "",
        vocation: d.vocation || p?.vocation || "",
        studiesFather: d.studiesFather || p?.studiesFather || "",
        studiesMother: d.studiesMother || p?.studiesMother || "",
        avgGrade: (d.avgGrade ?? p?.avgGrade ?? ""),
        digitalCreativity: (d.digitalCreativity || p?.digitalCreativity || {}),
        center: d.center || p?.center || ""
      };
    }

    function pickCbqd(p, s) {
      const c = (s && s.cbqd) ? s.cbqd : null;
      if (c && typeof c === "object") {
        const enabled = !!(c.enabled);
        const version = c.instrumentVersion || "";

        // Compatibilidad: algunos datos guardan scores en c.scores
        let total = null;
        let subscales = {};
        let answered = 0;
        let missing = 0;
        let responses = c.responses || [];
        if (c.scores && typeof c.scores === "object") {
          total = c.scores.total ?? null;
          subscales = c.scores.subscales || {};
          answered = c.scores.answered ?? 0;
          missing = c.scores.missing ?? 0;
        } else {
          // si no hay scores, recomputamos
          const sc = computeCbqdScores(responses);
          total = sc.total;
          subscales = sc.subscales;
          answered = sc.answered;
          missing = sc.missing;
        }

        const map = {};
        responses.forEach(r => {
          if (r?.id) map[r.id] = Number.isFinite(r.value) ? r.value : "";
        });
        return { enabled, version, total, subscales, answered, missing, map };
      }

      // Fallback (fotos antiguas)
      const enabled = !!p?.cbqdEnabled;
      const version = p?.cbqdVersion || "";
      const total = (p?.cbqdTotal ?? "");
      const subscales = p?.cbqdSubscales || {};
      const map = {};
      const resp = Array.isArray(p?.cbqdResponses) ? p.cbqdResponses : [];
      resp.forEach(r => {
        if (r?.id) map[r.id] = Number.isFinite(r.value) ? r.value : "";
      });
      const sc = resp.length ? computeCbqdScores(resp) : { answered: 0, missing: 0 };
      return { enabled, version, total, subscales, answered: sc.answered, missing: sc.missing, map };
    }

    function photoRowBase(photoId, p, s, rOrNull) {
      const f = p.aiFeatures || {};
      const adv = p.localAdvanced || {};
      const deep = p.deepAI || {};
      const dem = pickDemographics(p, s);
      const cbqd = pickCbqd(p, s);

      const base = [
        makePhotoCode(photoId),
        makeSessionCode(p.sessionId || ""),
        makeStudentCode(p.participantId || s?.participantId || ""),
        p.taskId || "",
        p.taskOrder || "",
        p.submittedAt || s?.submittedAt || "",
        p.createdAt || "",
        p.text280 || "",
        p.imageStorageMode || (p.dataUrl ? "firestore_data_url_spark" : (p.imageUrl ? "firebase_storage" : "")),
        p.storagePath || "",

        dem.gender,
        dem.age,
        dem.studies,
        dem.bachType,
        dem.esoCourse,
        dem.vocation,
        dem.studiesFather,
        dem.studiesMother,
        dem.avgGrade ?? "",
        dem.digitalCreativity?.dc1 ?? "",
        dem.digitalCreativity?.dc2 ?? "",
        dem.digitalCreativity?.dc3 ?? "",
        dem.digitalCreativity?.dc4 ?? "",
        dem.digitalCreativity?.dc5 ?? "",
        dem.digitalCreativity?.dc6 ?? "",
        dem.center,

        cbqd.enabled ? "1" : "0",
        cbqd.version,
        cbqd.total ?? "",
        cbqd.answered ?? "",
        cbqd.missing ?? ""
      ];

      // Subescalas fijas por dominio
      cbqdDomainList.forEach(dom => base.push(cbqd.subscales?.[dom] ?? ""));
      // Ítems
      cbqdItemList.forEach(id => base.push(cbqd.map?.[id] ?? ""));

      base.push(
        f.brightness ?? "",
        f.contrast ?? "",
        f.colorfulness ?? "",
        f.edgeDensity ?? "",
        p.aiScore ?? "",
        adv.thirdsScore ?? "",
        adv.horizonScore ?? "",
        adv.goldenScore ?? "",
        adv.salienceScore ?? "",
        adv.localAdvancedScore ?? "",
        deep.deepScore ?? "",
        deep.deepExplanation ?? "",
        rOrNull?.expertId || ""
      );

      // Ratings
      const ratingsMap = rOrNull?.ratings || {};
      ratingItems.forEach((item, idx) => {
        let val = ratingsMap[item.id];
        if (val === undefined && rOrNull && rOrNull[`sub${idx + 1}`] !== undefined) {
          val = rOrNull[`sub${idx + 1}`];
        }
        base.push(val ?? "");
      });

      base.push(rOrNull && typeof rOrNull.puntf === "number" ? rOrNull.puntf.toFixed(2) : "");
      return base;
    }

    if (ratingsArr.length === 0) {
      // Sin valoraciones: una fila por foto
      Object.entries(photos).forEach(([photoId, p]) => {
        const s = p.sessionId ? sessions[p.sessionId] : null;
        rows.push(photoRowBase(photoId, p, s, null));
      });
    } else {
      // Con valoraciones: una fila por valoración
      ratingsArr.forEach(r => {
        const p = photos[r.photoId];
        if (!p) return;
        const s = p.sessionId ? sessions[p.sessionId] : null;
        rows.push(photoRowBase(r.photoId, p, s, r));
      });
    }

    const csvContent = buildCsvContent(rows, ";");
    triggerCsvDownload(csvContent, "creatividad_digital_full");

    alert("CSV generado y descargado.");
  } catch (err) {
    console.error(err);
    alert("Ha ocurrido un error al generar el CSV.");
  }
});


// Exportación específica para fiabilidad interevaluador / ICC: 1 fila por fotografía y columnas por experto.
document.getElementById("export-icc-csv-button")?.addEventListener("click", async () => {
  try {
    const [photosSnap, ratingsSnap] = await Promise.all([
      getDocs(photosCol),
      getDocs(ratingsCol)
    ]);

    if (photosSnap.empty) {
      alert("No hay fotografías almacenadas.");
      return;
    }

    const photos = {};
    photosSnap.docs.forEach(d => { photos[d.id] = d.data(); });

    const ratings = ratingsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const expertIds = Array.from(new Set(ratings.map(r => normalizeExpertId(r.expertId)).filter(Boolean))).sort();

    if (expertIds.length === 0) {
      alert("Todavía no hay valoraciones de expertos/as para exportar la matriz ICC.");
      return;
    }

    const ratingItems = (globalConfig.ratingItems && globalConfig.ratingItems.length)
      ? globalConfig.ratingItems
      : DEFAULT_RATING_ITEMS;

    const ratingsByPhotoExpert = {};
    ratings.forEach(r => {
      const expertId = normalizeExpertId(r.expertId);
      if (!r.photoId || !expertId) return;
      ratingsByPhotoExpert[r.photoId] ||= {};
      // Si por error hubiese duplicados del mismo experto, conservamos la valoración más reciente.
      const prev = ratingsByPhotoExpert[r.photoId][expertId];
      if (!prev || String(r.createdAt || "") > String(prev.createdAt || "")) {
        ratingsByPhotoExpert[r.photoId][expertId] = r;
      }
    });

    const header = [
      "photo_code",
      "session_code",
      "student_code",
      "taskId",
      "taskOrder",
      "n_expertos",
      "completa_3_expertos"
    ];

    expertIds.forEach(ex => header.push(`puntf_${ex}`));
    expertIds.forEach(ex => header.push(`fecha_${ex}`));
    ratingItems.forEach(item => {
      expertIds.forEach(ex => header.push(`${item.id}_${ex}`));
    });
    header.push("puntf_media", "puntf_sd", "puntf_rango");

    function mean(nums) {
      const xs = nums.filter(v => typeof v === "number" && Number.isFinite(v));
      return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
    }
    function sd(nums) {
      const xs = nums.filter(v => typeof v === "number" && Number.isFinite(v));
      if (xs.length < 2) return null;
      const m = mean(xs);
      return Math.sqrt(xs.reduce((acc, x) => acc + (x - m) ** 2, 0) / (xs.length - 1));
    }

    const rows = [header];
    Object.entries(photos).forEach(([photoId, p]) => {
      const byExpert = ratingsByPhotoExpert[photoId] || {};
      const puntfs = expertIds.map(ex => {
        const v = byExpert[ex]?.puntf;
        return typeof v === "number" && Number.isFinite(v) ? v : null;
      });
      const validPuntfs = puntfs.filter(v => typeof v === "number" && Number.isFinite(v));
      const m = mean(validPuntfs);
      const sdev = sd(validPuntfs);
      const range = validPuntfs.length ? Math.max(...validPuntfs) - Math.min(...validPuntfs) : null;

      const row = [
        makePhotoCode(photoId),
        makeSessionCode(p.sessionId || ""),
        makeStudentCode(p.participantId || ""),
        p.taskId || "",
        p.taskOrder || "",
        validPuntfs.length,
        validPuntfs.length >= EXPECTED_EXPERT_RATINGS ? "1" : "0"
      ];

      expertIds.forEach((ex, idx) => row.push(puntfs[idx] == null ? "" : puntfs[idx].toFixed(2)));
      expertIds.forEach(ex => row.push(byExpert[ex]?.createdAt || ""));
      ratingItems.forEach((item, itemIdx) => {
        expertIds.forEach(ex => {
          const r = byExpert[ex];
          let val = r?.ratings?.[item.id];
          if (val === undefined && r && r[`sub${itemIdx + 1}`] !== undefined) val = r[`sub${itemIdx + 1}`];
          row.push(val ?? "");
        });
      });
      row.push(
        m == null ? "" : m.toFixed(2),
        sdev == null ? "" : sdev.toFixed(2),
        range == null ? "" : range.toFixed(2)
      );
      rows.push(row);
    });

    const csvContent = buildCsvContent(rows, ";");
    triggerCsvDownload(csvContent, "creatividad_digital_icc_matrix");
    alert("CSV para ICC generado y descargado.");
  } catch (err) {
    console.error(err);
    alert("Ha ocurrido un error al generar la matriz ICC.\n\n" + (err?.message || ""));
  }
});

// Exportación "por alumno": 1 fila por participante (sesión) con agregados por tarea.
document.getElementById("export-csv-students-button")?.addEventListener("click", async () => {
  try {
    // Cargamos datos
    const sessionsSnap = await getDocs(collection(db, "sessions"));
    const photosSnap = await getDocs(collection(db, "photos"));
    const ratingsSnap = await getDocs(collection(db, "ratings"));

    const sessions = {};
    sessionsSnap.forEach(doc => (sessions[doc.id] = doc.data()));

    const photos = {};
    photosSnap.forEach(doc => (photos[doc.id] = doc.data()));

    const ratingsArr = [];
    ratingsSnap.forEach(doc => ratingsArr.push({ id: doc.id, ...doc.data() }));

    // Índices
    const photosBySession = {};
    Object.entries(photos).forEach(([photoId, p]) => {
      if (!p?.sessionId) return;
      (photosBySession[p.sessionId] ||= []).push({ photoId, ...p });
    });

    const ratingsByPhoto = {};
    ratingsArr.forEach(r => {
      if (!r?.photoId) return;
      (ratingsByPhoto[r.photoId] ||= []).push(r);
    });

    function mean(arr) {
      const nums = arr.filter(v => typeof v === "number" && Number.isFinite(v));
      if (nums.length === 0) return null;
      return nums.reduce((a, b) => a + b, 0) / nums.length;
    }

    function sd(arr) {
      const nums = arr.filter(v => typeof v === "number" && Number.isFinite(v));
      if (nums.length < 2) return null;
      const m = mean(nums);
      const v = nums.reduce((acc, x) => acc + Math.pow(x - m, 2), 0) / (nums.length - 1);
      return Math.sqrt(v);
    }

    // Cabecera
    const header = [
      "session_code",
      "student_code",
      "submittedAt",      "gender",
      "age",
      "studies",
      "bachType",
      "esoCourse",
      "vocation",
      "studiesFather",
      "studiesMother",
      "avgGrade",
      "dc1",
      "dc2",
      "dc3",
      "dc4",
      "dc5",
      "dc6",
      "center",
      "cbqd_enabled",
      "cbqd_version",
      "cbqd_total",
      "cbqd_answered",
      "cbqd_missing",
      // agregados por tarea
      "task1_photo_code",      "task1_aiScore",
      "task1_localAdvancedScore",
      "task1_deepScore",
      "task1_puntf_mean",
      "task1_puntf_sd",
      "task1_puntf_n",
      "task2_photo_code",      "task2_aiScore",
      "task2_localAdvancedScore",
      "task2_deepScore",
      "task2_puntf_mean",
      "task2_puntf_sd",
      "task2_puntf_n",
      "task3_photo_code",      "task3_aiScore",
      "task3_localAdvancedScore",
      "task3_deepScore",
      "task3_puntf_mean",
      "task3_puntf_sd",
      "task3_puntf_n",
      // global
      "puntf_mean_overall",
      "puntf_n_overall"
    ];

    const rows = [header];

    Object.entries(sessions).forEach(([sessionId, s]) => {
      const dem = s?.demographics || {};
      const cbqd = s?.cbqd || {};
      const demDc = dem?.digitalCreativity || {};

      // Fotos por tarea (si hubiese más de una, elegimos la más reciente por createdAt)
      const sessionPhotos = (photosBySession[sessionId] || []).slice();
      sessionPhotos.sort((a, b) => {
        const ta = a.createdAt?.seconds ? a.createdAt.seconds : (a.createdAt || 0);
        const tb = b.createdAt?.seconds ? b.createdAt.seconds : (b.createdAt || 0);
        return tb - ta;
      });

      const byTask = { 1: null, 2: null, 3: null };

      function taskKeyFromPhoto(p) {
        const raw = (p?.taskId ?? "").toString();
        if (raw === "1" || raw === "2" || raw === "3") return Number(raw);
        if (raw === "MT1_AUTOEXP") return 1;
        if (raw === "MT2_ESCOLAR") return 2;
        if (raw === "MT3_TRANSFORM") return 3;
        return null;
      }

      sessionPhotos.forEach(p => {
        const t = taskKeyFromPhoto(p);
        if (![1, 2, 3].includes(t || 0)) return;
        if (!byTask[t]) byTask[t] = p;
      });

      const taskAgg = (t) => {
        const p = byTask[t];
        if (!p) return { photoCode: "", photoIdForLookup: "", aiScore: "", localAdvancedScore: "", deepScore: "", puntfMean: "", puntfSd: "", puntfN: "" };
        const rs = ratingsByPhoto[p.photoId] || [];
        const puntfs = rs.map(r => (typeof r.puntf === "number" ? r.puntf : null));
        const m = mean(puntfs);
        const sdev = sd(puntfs);
        const n = puntfs.filter(v => typeof v === "number" && Number.isFinite(v)).length;
        return {
          photoCode: makePhotoCode(p.photoId),
          photoIdForLookup: p.photoId,
          aiScore: p.aiScore ?? "",
          localAdvancedScore: p.localAdvanced?.localAdvancedScore ?? "",
          deepScore: p.deepAI?.deepScore ?? "",
          puntfMean: m === null ? "" : m.toFixed(2),
          puntfSd: sdev === null ? "" : sdev.toFixed(2),
          puntfN: n || ""
        };
      };

      const t1 = taskAgg(1);
      const t2 = taskAgg(2);
      const t3 = taskAgg(3);

      const overallNums = [t1, t2, t3]
        .flatMap(t => {
          const p = t.photoIdForLookup ? (ratingsByPhoto[t.photoIdForLookup] || []) : [];
          return p.map(r => (typeof r.puntf === "number" ? r.puntf : null));
        })
        .filter(v => typeof v === "number" && Number.isFinite(v));

      const overallMean = overallNums.length ? (overallNums.reduce((a, b) => a + b, 0) / overallNums.length) : null;

      rows.push([
        makeSessionCode(sessionId),
        makeStudentCode(s?.participantId || sessionId),
        s?.submittedAt || "",
        dem.gender ?? "",
        dem.age ?? "",
        dem.studies ?? "",
        dem.bachType ?? "",
        dem.esoCourse ?? "",
        dem.vocation ?? "",
        dem.studiesFather ?? "",
        dem.studiesMother ?? "",
        dem.avgGrade ?? "",
        demDc.dc1 ?? "",
        demDc.dc2 ?? "",
        demDc.dc3 ?? "",
        demDc.dc4 ?? "",
        demDc.dc5 ?? "",
        demDc.dc6 ?? "",
        dem.center ?? "",

        cbqd.enabled ? "1" : "0",
        cbqd.instrumentVersion ?? cbqd.version ?? "",
        cbqd.total ?? "",
        cbqd.answered ?? "",
        cbqd.missing ?? "",

        t1.photoCode,        t1.aiScore,
        t1.localAdvancedScore,
        t1.deepScore,
        t1.puntfMean,
        t1.puntfSd,
        t1.puntfN,

        t2.photoCode,        t2.aiScore,
        t2.localAdvancedScore,
        t2.deepScore,
        t2.puntfMean,
        t2.puntfSd,
        t2.puntfN,

        t3.photoCode,        t3.aiScore,
        t3.localAdvancedScore,
        t3.deepScore,
        t3.puntfMean,
        t3.puntfSd,
        t3.puntfN,

        overallMean === null ? "" : overallMean.toFixed(2),
        overallNums.length || ""
      ]);
    });

    const csvContent = buildCsvContent(rows, ";");
    triggerCsvDownload(csvContent, "creatividad_digital_por_alumno");
    alert("CSV (por alumno) generado y descargado.");
  } catch (err) {
    console.error(err);
    alert("Ha ocurrido un error al generar el CSV (por alumno).\n\n" + (err?.message || ""));
  }
});



// Depuración no destructiva de duplicados exactos de valoración: conserva la más reciente por foto × experto.
document.getElementById("dedupe-db-button")?.addEventListener("click", async () => {
  const msg = document.getElementById("dedupe-db-message");
  if (msg) msg.textContent = "Revisando duplicados de valoraciones...";
  try {
    const snap = await getCollectionSnapshotFresh(ratingsCol);
    const groups = {};
    snap.docs.forEach(docSnap => {
      const r = docSnap.data();
      const key = `${r.photoId || ""}__${normalizeExpertId(r.expertId)}`;
      if (!r.photoId || !normalizeExpertId(r.expertId)) return;
      (groups[key] ||= []).push({ id: docSnap.id, ref: docSnap.ref, ...r });
    });

    let deleted = 0;
    for (const arr of Object.values(groups)) {
      if (arr.length <= 1) continue;
      arr.sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
      const toDelete = arr.slice(1);
      for (const r of toDelete) {
        await deleteDoc(r.ref);
        deleted++;
      }
    }

    if (msg) msg.textContent = deleted ? `Duplicados eliminados: ${deleted}.` : "No se han encontrado duplicados por foto × experto.";
    await updateAdminSummary();
  } catch (err) {
    console.error(err);
    if (msg) msg.textContent = "Error al depurar duplicados: " + (err?.message || "");
  }
});
