"use strict";

const PETS_KEY = "radarpet_pets";
const FOLLOWS_KEY = "radarpet_follows";
const GUEST_SESSION_KEY = "radarpet_guest_session";
const PETS_API_LIST_URL = "/.netlify/functions/list-pets";
const PETS_API_CREATE_URL = "/.netlify/functions/create-pet";
const PETS_API_CONTACT_URL = "/.netlify/functions/get-pet-contact";
const PETS_REFRESH_INTERVAL_MS = 15000;
const CLOUDINARY_URL = "https://api.cloudinary.com/v1_1/daw3up5vu/image/upload";
const CLOUDINARY_PRESET = "radarpet";
const AUTH_CONFIG = window.RADARPET_AUTH_CONFIG || {};
const CODESPACES_HOST_SUFFIXES = [".app.github.dev", ".github.dev"];
const PLACEHOLDER_IMAGE =
  "data:image/svg+xml;charset=UTF-8," +
  encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 220">
      <defs>
        <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#FFF0E0"/>
          <stop offset="100%" stop-color="#FFD4B5"/>
        </linearGradient>
      </defs>
      <rect width="320" height="220" rx="24" fill="url(#bg)"/>
      <circle cx="160" cy="88" r="44" fill="#FFF8F4" stroke="#FFB17A" stroke-width="6"/>
      <circle cx="132" cy="70" r="12" fill="#FFB17A"/>
      <circle cx="188" cy="70" r="12" fill="#FFB17A"/>
      <path d="M116 150c14-18 33-27 44-27s30 9 44 27" fill="none" stroke="#FF7A2F" stroke-width="10" stroke-linecap="round"/>
      <text x="160" y="198" text-anchor="middle" fill="#FF7A2F" font-family="Nunito, Arial, sans-serif" font-size="20" font-weight="800">RadarPet</text>
    </svg>
  `);

const state = {
  pets: [],
  ongs: [],
  query: "",
  mapFilter: "all",
  lostFilter: "all",
  followed: new Set(),
  upload: {
    status: "idle",
    photoUrl: "",
    previewUrl: "",
  },
  sync: {
    intervalId: null,
    isLoading: false,
  },
  auth: {
    firebaseAuth: null,
    isConfigured: false,
    user: null,
    guestUser: readGuestSession(),
    enabledProviders: getEnabledProviders(),
  },
};

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[char]);
}

function readArray(key) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function writeArray(key, values) {
  localStorage.setItem(key, JSON.stringify(values));
}

function readGuestSession() {
  try {
    const value = JSON.parse(localStorage.getItem(GUEST_SESSION_KEY) || "null");
    if (!value || typeof value !== "object") {
      return null;
    }

    return {
      id: String(value.id || "guest"),
      name: String(value.name || "Visitante RadarPet"),
      email: "",
      avatar: "",
      provider: "Modo visitante",
      isGuest: true,
    };
  } catch {
    return null;
  }
}

function persistGuestSession(user) {
  if (!user || !user.isGuest) {
    localStorage.removeItem(GUEST_SESSION_KEY);
    return;
  }

  localStorage.setItem(
    GUEST_SESSION_KEY,
    JSON.stringify({
      id: user.id,
      name: user.name,
    })
  );
}

function getFirebaseConfig() {
  if (!AUTH_CONFIG || typeof AUTH_CONFIG !== "object") {
    return null;
  }

  const config = AUTH_CONFIG.firebase || AUTH_CONFIG;
  const requiredFields = ["apiKey", "authDomain", "projectId", "appId"];
  const isValid = requiredFields.every((field) => {
    const value = String(config?.[field] || "").trim();
    return value && !value.includes("YOUR_");
  });

  return isValid ? config : null;
}

function getEnabledProviders() {
  const providers = AUTH_CONFIG.providers || {};
  return {
    google: providers.google !== false,
    facebook: providers.facebook !== false,
    github: providers.github !== false,
  };
}

function getProviderLabel(providerId) {
  const providerLabels = {
    "google.com": "Google",
    "facebook.com": "Facebook",
    "github.com": "GitHub",
  };

  return providerLabels[providerId] || "Conta social";
}

function isCodespacesHost() {
  const host = String(window.location.hostname || "").toLowerCase();
  return CODESPACES_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix));
}

function getCurrentUser() {
  return state.auth.user || state.auth.guestUser;
}

function canCreateListings() {
  return Boolean(getCurrentUser());
}

function getUserInitials(name) {
  const cleanName = String(name || "").trim();
  if (!cleanName) {
    return "RP";
  }

  return cleanName
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
}

function normalizeAuthUser(user) {
  if (!user) {
    return null;
  }

  const provider = Array.isArray(user.providerData) ? user.providerData.find(Boolean) : null;

  return {
    id: String(user.uid),
    name: String(user.displayName || user.email || "RadarPet"),
    email: String(user.email || ""),
    avatar: String(user.photoURL || ""),
    provider: getProviderLabel(provider?.providerId),
    isGuest: false,
  };
}

function renderSessionUI() {
  const currentUser = getCurrentUser();
  const sessionName = document.getElementById("session-user-name");
  const sessionProvider = document.getElementById("session-user-provider");
  const sessionAvatar = document.getElementById("session-avatar");
  const sessionLabel = document.getElementById("status-session-label");
  const logoutButton = document.getElementById("logout-button");

  if (!sessionName || !sessionProvider || !sessionAvatar || !sessionLabel || !logoutButton) {
    return;
  }

  if (!currentUser) {
    sessionName.textContent = "Aguardando login";
    sessionProvider.textContent = "Entre para publicar pets";
    sessionAvatar.textContent = "RP";
    sessionLabel.textContent = "Login necessário";
    logoutButton.textContent = "Voltar";
    return;
  }

  sessionName.textContent = currentUser.name;
  sessionProvider.textContent = currentUser.isGuest
    ? "Explorando sem login"
    : `${currentUser.provider}${currentUser.email ? ` • ${currentUser.email}` : ""}`;
  sessionLabel.textContent = currentUser.isGuest ? "Modo visitante" : "Sessão conectada";
  logoutButton.textContent = currentUser.isGuest ? "Encerrar visita" : "Sair";

  if (currentUser.avatar) {
    sessionAvatar.innerHTML = `<img src="${escapeHtml(currentUser.avatar)}" alt="Avatar de ${escapeHtml(currentUser.name)}">`;
  } else {
    sessionAvatar.textContent = getUserInitials(currentUser.name);
  }
}

function syncAuthShell() {
  const authScreen = document.getElementById("auth-screen");
  const appShell = document.getElementById("app-shell");
  const help = document.getElementById("auth-help");
  const isReady = Boolean(getCurrentUser());

  if (authScreen) {
    authScreen.hidden = isReady;
  }

  if (appShell) {
    appShell.hidden = !isReady;
  }

  document.querySelectorAll("[data-auth-provider]").forEach((button) => {
    const provider = button.dataset.authProvider;
    const enabled = Boolean(state.auth.enabledProviders[provider]);
    button.disabled = !state.auth.isConfigured || !enabled;
  });

  if (help) {
    if (state.auth.isConfigured) {
      help.textContent = "Entre com sua conta para publicar pets e manter seu perfil conectado.";
    } else {
      help.innerHTML = "Preencha o arquivo <code>auth-config.js</code> para ativar Google, Facebook e GitHub com Firebase Auth.";
    }
  }

  renderSessionUI();
}

function showScreen(screenName) {
  const tabOrder = ["feed", "mapa", "achados", "match", "ongs"];

  document.querySelectorAll(".screen").forEach((screen) => screen.classList.remove("active"));
  document.querySelectorAll(".tab").forEach((tab) => tab.classList.remove("active"));
  document.querySelectorAll(".bnav-item").forEach((item) => item.classList.remove("active"));

  document.getElementById(`screen-${screenName}`)?.classList.add("active");
  document.querySelectorAll(".tab")[tabOrder.indexOf(screenName)]?.classList.add("active");
  document.getElementById(`bnav-${screenName}`)?.classList.add("active");
}

function loadPets() {
  return readArray(PETS_KEY);
}

function savePets(pets) {
  writeArray(PETS_KEY, pets);
}

function normalizePet(record) {
  return {
    id: String(record.id || record._id || `pet-${Date.now()}`),
    nome: String(record.nome || "").trim(),
    nomeTutor: String(record.nomeTutor || "").trim(),
    especie: String(record.especie || "").trim(),
    raca: String(record.raca || "").trim(),
    sexo: String(record.sexo || "").trim(),
    cor: String(record.cor || "").trim(),
    cidade: String(record.cidade || "").trim(),
    telefone: String(record.telefone || "").trim(),
    telefoneMascara: String(record.telefoneMascara || "").trim(),
    status: String(record.status || "").trim(),
    fotoUrl: String(record.fotoUrl || "").trim(),
  };
}

async function fetchPetsFromApi() {
  const response = await fetch(PETS_API_LIST_URL, {
    headers: {
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error("Falha ao carregar pets.");
  }

  const data = await response.json();
  if (!Array.isArray(data.pets)) {
    throw new Error("Resposta inválida ao listar pets.");
  }

  return data.pets.map(normalizePet);
}

async function createPetInApi(pet) {
  const response = await fetch(PETS_API_CREATE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(pet),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.pet) {
    throw new Error(data.error || "Erro ao salvar cadastro.");
  }

  return normalizePet(data.pet);
}

async function fetchPetContact(petId) {
  const response = await fetch(PETS_API_CONTACT_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ id: petId }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.telefone) {
    throw new Error(data.error || "Não foi possível carregar o contato.");
  }

  return String(data.telefone).trim();
}

function maskPhone(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (digits.length < 4) {
    return "Contato protegido";
  }

  const visiblePrefix = digits.slice(0, Math.min(2, digits.length));
  const visibleSuffix = digits.slice(-2);
  const hiddenSize = Math.max(digits.length - (visiblePrefix.length + visibleSuffix.length), 2);
  return `${visiblePrefix}${"*".repeat(hiddenSize)}${visibleSuffix}`;
}

function getDisplayPhone(pet) {
  if (pet.telefoneMascara) {
    return pet.telefoneMascara;
  }

  if (pet.telefone) {
    return maskPhone(pet.telefone);
  }

  return "Contato protegido";
}

function formatPhoneForWhatsApp(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (!digits) {
    return "";
  }

  if (digits.length === 10 || digits.length === 11) {
    return `55${digits}`;
  }

  return digits;
}

function buildWhatsAppUrl(phone, petName) {
  const message = encodeURIComponent(`Olá! Vi o cadastro do pet ${petName} no RadarPet.`);
  return `https://wa.me/${phone}?text=${message}`;
}

function getPetsSignature(pets) {
  return JSON.stringify(
    pets.map((pet) => [
      pet.id,
      pet.nome,
      pet.especie,
      pet.raca,
      pet.sexo,
      pet.cor,
      pet.cidade,
      pet.telefoneMascara || pet.telefone,
      pet.status,
      pet.fotoUrl,
    ])
  );
}

async function syncPets(options = {}) {
  const {
    announceUpdates = false,
    announceOfflineFallback = false,
    announceLoadError = false,
  } = options;

  if (state.sync.isLoading) {
    return;
  }

  state.sync.isLoading = true;

  try {
    const previousSignature = getPetsSignature(state.pets);
    const petsFromApi = await fetchPetsFromApi();
    const nextSignature = getPetsSignature(petsFromApi);
    const hadPetsBefore = state.pets.length > 0;

    state.pets = petsFromApi;
    savePets(state.pets);

    if (nextSignature !== previousSignature) {
      renderAll();
      if (announceUpdates && hadPetsBefore) {
        showToast("A lista de pets foi atualizada.");
      }
    }
  } catch (error) {
    console.error(error);

    if (!state.pets.length) {
      state.pets = loadPets();
      renderAll();
      if (announceOfflineFallback && state.pets.length) {
        showToast("Modo offline: exibindo pets salvos neste navegador.");
      }
    }

    if (announceLoadError && !state.pets.length) {
      showToast("Não foi possível carregar os pets agora.");
    }
  } finally {
    state.sync.isLoading = false;
  }
}

async function readJson(path, fallback) {
  try {
    const response = await fetch(path);
    if (!response.ok) {
      throw new Error(path);
    }
    return await response.json();
  } catch {
    return fallback;
  }
}

function slugFromStatus(status) {
  if (status === "Perdido") return "lost";
  if (status === "Encontrado") return "found";
  return "available";
}

function badgeClassFromStatus(status) {
  if (status === "Perdido") return "badge-lost";
  if (status === "Encontrado") return "badge-found";
  return "badge-adopt";
}

function emojiFromSpecies(species) {
  if (species === "Cachorro") return "🐕";
  if (species === "Gato") return "🐱";
  return "🐾";
}

function matchesQuery(...values) {
  if (!state.query) return true;
  return values.join(" ").toLowerCase().includes(state.query);
}

function setChipActive(selector, value, datasetKey) {
  document.querySelectorAll(selector).forEach((chip) => {
    chip.classList.toggle("on", chip.dataset[datasetKey] === value);
  });
}

function openInfoModal(title, subtitle, body) {
  document.getElementById("info-modal-title").textContent = title;
  document.getElementById("info-modal-subtitle").textContent = subtitle;
  document.getElementById("info-modal-body").textContent = body;
  document.getElementById("info-modal")?.classList.add("open");
  document.getElementById("info-modal")?.setAttribute("aria-hidden", "false");
}

function closeInfoModal() {
  document.getElementById("info-modal")?.classList.remove("open");
  document.getElementById("info-modal")?.setAttribute("aria-hidden", "true");
}

function showToast(message) {
  const toast = document.getElementById("toast");
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add("show");
  window.setTimeout(() => toast.classList.remove("show"), 2600);
}

function getEmptyState(message) {
  return `
    <div class="empty-state empty-state-strong">
      <div class="empty-state-icon">🐾</div>
      <div class="empty-state-title">${escapeHtml(message)}</div>
      <button class="report-btn empty-state-btn" type="button" data-action="open-report">Cadastrar Pet</button>
    </div>
  `;
}

function buildPetCard(pet) {
  const badgeClass = badgeClassFromStatus(pet.status);
  const tutorLabel = pet.nomeTutor ? `Tutor: ${pet.nomeTutor}` : "Tutor não informado";
  return `
    <article class="card" data-pet-id="${escapeHtml(pet.id)}">
      <div class="card-header">
        <div class="avatar">${escapeHtml(emojiFromSpecies(pet.especie))}</div>
        <div class="card-user">
          <div class="card-user-name">${escapeHtml(pet.nome)}</div>
          <div class="card-user-sub">${escapeHtml(pet.cidade)} • ${escapeHtml(getDisplayPhone(pet))}</div>
        </div>
        <span class="badge ${badgeClass}">${escapeHtml(pet.status)}</span>
      </div>
      <div class="card-img" data-action="pet-detail" data-pet-id="${escapeHtml(pet.id)}">
        <img src="${escapeHtml(pet.fotoUrl || PLACEHOLDER_IMAGE)}" alt="Foto de ${escapeHtml(pet.nome)}" loading="lazy" onerror="this.onerror=null;this.src='${PLACEHOLDER_IMAGE}'">
      </div>
      <div class="card-body">
        <div class="card-title">${escapeHtml(pet.nome)}</div>
        <div class="card-desc">${escapeHtml(pet.especie)} • ${escapeHtml(pet.raca)} • ${escapeHtml(pet.sexo)}</div>
        <div class="card-desc">${escapeHtml(tutorLabel)}</div>
        <div class="card-meta-grid">
          <span class="card-meta-pill">${escapeHtml(pet.cor)}</span>
          <span class="card-meta-pill">${escapeHtml(pet.cidade)}</span>
        </div>
        <div class="card-location">Cidade: ${escapeHtml(pet.cidade)}</div>
      </div>
      <div class="card-actions card-actions-stack">
        <button class="action-btn primary full-width" type="button" data-action="contact" data-pet-id="${escapeHtml(pet.id)}">Entrar em contato</button>
      </div>
    </article>
  `;
}

function renderFeed() {
  const target = document.getElementById("feed-list");
  if (!target) return;

  const pets = state.pets.filter((pet) =>
    matchesQuery(pet.nome, pet.nomeTutor, pet.especie, pet.raca, pet.sexo, pet.cor, pet.cidade, pet.status)
  );

  target.innerHTML = pets.length
    ? pets.map(buildPetCard).join("")
    : getEmptyState("Nenhum pet cadastrado ainda.");
}

function renderLostFound() {
  const target = document.getElementById("lost-found-list");
  if (!target) return;

  const pets = state.pets.filter((pet) => {
    const statusSlug = slugFromStatus(pet.status);
    return (state.lostFilter === "all" || state.lostFilter === statusSlug) &&
      matchesQuery(pet.nome, pet.nomeTutor, pet.especie, pet.raca, pet.cidade, pet.status);
  });

  target.innerHTML = pets.length
    ? pets.map((pet) => `
        <button class="lf-card clickable-card photo-list-card" type="button" data-action="pet-detail" data-pet-id="${escapeHtml(pet.id)}">
          <div class="lf-pet-img photo-thumb">
            <img src="${escapeHtml(pet.fotoUrl || PLACEHOLDER_IMAGE)}" alt="Foto de ${escapeHtml(pet.nome)}" loading="lazy" onerror="this.onerror=null;this.src='${PLACEHOLDER_IMAGE}'">
          </div>
          <div class="lf-info">
            <div class="lf-name">${escapeHtml(pet.nome)}</div>
            <div class="lf-detail">${escapeHtml(pet.especie)} • ${escapeHtml(pet.raca)} • ${escapeHtml(pet.cidade)}</div>
            <div class="lf-detail">Tutor: ${escapeHtml(pet.nomeTutor || "Não informado")}</div>
            <div class="lf-detail">${escapeHtml(pet.sexo)} • ${escapeHtml(pet.cor)}</div>
            <div class="lf-status ${escapeHtml(pet.status === "Perdido" ? "status-lost" : pet.status === "Encontrado" ? "status-found" : "status-available")}">• ${escapeHtml(pet.status)}</div>
          </div>
        </button>
      `).join("")
    : getEmptyState("Nenhum pet cadastrado ainda.");
}

function renderMapNearby() {
  const target = document.getElementById("map-nearby-list");
  if (!target) return;

  const pets = state.pets.filter((pet) => {
    const statusSlug = slugFromStatus(pet.status);
    return (state.mapFilter === "all" || state.mapFilter === statusSlug) &&
      matchesQuery(pet.nome, pet.nomeTutor, pet.especie, pet.raca, pet.cidade, pet.status);
  });

  target.innerHTML = pets.length
    ? pets.map((pet) => `
        <button class="lf-card clickable-card photo-list-card" type="button" data-action="pet-detail" data-pet-id="${escapeHtml(pet.id)}">
          <div class="lf-pet-img photo-thumb">
            <img src="${escapeHtml(pet.fotoUrl || PLACEHOLDER_IMAGE)}" alt="Foto de ${escapeHtml(pet.nome)}" loading="lazy" onerror="this.onerror=null;this.src='${PLACEHOLDER_IMAGE}'">
          </div>
          <div class="lf-info">
            <div class="lf-name">${escapeHtml(pet.nome)}</div>
            <div class="lf-detail">${escapeHtml(pet.cidade)} • ${escapeHtml(pet.status)}</div>
            <div class="lf-detail">Tutor: ${escapeHtml(pet.nomeTutor || "Não informado")}</div>
            <div class="lf-detail">${escapeHtml(pet.especie)} • ${escapeHtml(pet.raca)} • ${escapeHtml(pet.cor)}</div>
          </div>
          <span class="badge ${escapeHtml(badgeClassFromStatus(pet.status))}">${escapeHtml(pet.status)}</span>
        </button>
      `).join("")
    : getEmptyState("Nenhum pet cadastrado ainda.");
}

function renderMatches() {
  const target = document.getElementById("match-list");
  if (!target) return;

  const pets = state.pets.filter((pet) =>
    pet.status === "Disponivel" &&
    matchesQuery(pet.nome, pet.nomeTutor, pet.especie, pet.raca, pet.sexo, pet.cor, pet.cidade)
  );

  const breedGroups = new Map();
  pets.forEach((pet) => {
    const breedKey = (pet.raca || "").trim().toLowerCase();
    if (!breedKey || breedKey === "srd") return;
    if (!breedGroups.has(breedKey)) breedGroups.set(breedKey, []);
    breedGroups.get(breedKey).push(pet);
  });

  const eligibleGroups = Array.from(breedGroups.values()).filter((group) => group.length > 1);

  target.innerHTML = eligibleGroups.length
    ? eligibleGroups.map((group) => `
        <div class="section-label">${escapeHtml(group[0].raca)} • ${group.length} cadastrados</div>
        ${group.map(buildPetCard).join("")}
      `).join("")
    : getEmptyState("Ainda não há pets da mesma raça disponíveis para sugerir um match. Cadastre mais pets para ativar essa função.");
}

function renderOngs() {
  const target = document.getElementById("ong-list");
  if (!target) return;

  const ongs = state.ongs.filter((ong) => matchesQuery(ong.name, ong.meta, ong.cta));
  target.innerHTML = ongs.map((ong) => {
    const followed = state.followed.has(ong.id);
    return `
      <div class="ong-card" data-ong-id="${escapeHtml(ong.id)}">
        <div class="ong-header">
          <div class="ong-avatar" data-action="ong-detail" data-ong-id="${escapeHtml(ong.id)}">${escapeHtml(ong.icon)}</div>
          <div>
            <div class="ong-name">${escapeHtml(ong.name)}</div>
            <div class="ong-city">${escapeHtml(ong.meta)}</div>
          </div>
          <button class="ong-btn ${followed ? "following" : ""}" type="button" data-action="follow" data-ong-id="${escapeHtml(ong.id)}">${followed ? "Seguindo" : escapeHtml(ong.cta)}</button>
        </div>
        <div class="ong-stats">
          <button class="ong-stat" type="button" data-action="ong-detail" data-ong-id="${escapeHtml(ong.id)}"><strong>Ativa</strong>rede local</button>
          <button class="ong-stat" type="button" data-action="ong-detail" data-ong-id="${escapeHtml(ong.id)}"><strong>Apoio</strong>comunidade</button>
          <button class="ong-stat" type="button" data-action="ong-detail" data-ong-id="${escapeHtml(ong.id)}"><strong>Contato</strong>aberto</button>
        </div>
      </div>
    `;
  }).join("") || `<div class="empty-state">Nenhuma ONG encontrada.</div>`;
}

function renderAll() {
  renderFeed();
  renderLostFound();
  renderMapNearby();
  renderMatches();
  renderOngs();
}

function openReportModal(presetStatus) {
  if (!canCreateListings()) {
    openInfoModal("Login necessário", "Publique com segurança", "Entre com uma conta social ou use o modo visitante para continuar navegando antes de publicar um pet.");
    return;
  }

  document.getElementById("report-modal")?.classList.add("open");
  document.getElementById("report-modal")?.setAttribute("aria-hidden", "false");

  if (presetStatus) {
    const statusField = document.querySelector('#report-form select[name="status"]');
    if (statusField) statusField.value = presetStatus;
  }
}

function closeReportModal() {
  document.getElementById("report-modal")?.classList.remove("open");
  document.getElementById("report-modal")?.setAttribute("aria-hidden", "true");
}

function resetUploadState() {
  state.upload = {
    status: "idle",
    photoUrl: "",
    previewUrl: "",
  };
}

function updateUploadPreview(imageSrc) {
  const preview = document.getElementById("upload-preview");
  if (!preview) return;

  preview.innerHTML = imageSrc
    ? `<img src="${escapeHtml(imageSrc)}" alt="Pre-visualizacao da foto do pet">`
    : "<span>Pre-visualizacao da foto</span>";
}

function setUploadFeedback(message, type = "default") {
  const feedback = document.getElementById("upload-feedback");
  if (!feedback) return;
  feedback.textContent = message;
  feedback.className = `upload-feedback ${type}`;
}

function setSubmitState(isBusy, label = "Salvar pet") {
  const button = document.getElementById("report-submit-button");
  if (!button) return;
  button.disabled = isBusy;
  button.textContent = label;
}

async function uploadImageToCloudinary(file) {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("upload_preset", CLOUDINARY_PRESET);

  const response = await fetch(CLOUDINARY_URL, {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    throw new Error("Falha ao enviar imagem.");
  }

  const data = await response.json();
  if (!data.secure_url) {
    throw new Error("Falha ao obter URL da imagem.");
  }

  return data.secure_url;
}

function buildPetPayload(formData) {
  const currentUser = getCurrentUser();
  return {
    id: `pet-${Date.now()}`,
    nome: String(formData.get("name") || "").trim(),
    nomeTutor: String(formData.get("ownerName") || currentUser?.name || "").trim(),
    especie: String(formData.get("species") || "").trim(),
    raca: String(formData.get("breed") || "").trim(),
    sexo: String(formData.get("sex") || "").trim(),
    cor: String(formData.get("color") || "").trim(),
    cidade: String(formData.get("city") || "").trim(),
    telefone: String(formData.get("phone") || "").trim(),
    status: String(formData.get("status") || "").trim(),
    website: String(formData.get("website") || "").trim(),
    fotoUrl: state.upload.photoUrl || "",
    authUserId: String(currentUser?.id || ""),
    authProvider: String(currentUser?.provider || ""),
    authUserEmail: String(currentUser?.email || ""),
  };
}

function isPetValid(pet) {
  return Boolean(
    pet.nome &&
    pet.nomeTutor &&
    pet.especie &&
    pet.raca &&
    pet.sexo &&
    pet.cor &&
    pet.cidade &&
    pet.telefone &&
    pet.status &&
    pet.fotoUrl
  );
}

function setupPhotoUpload() {
  const input = document.getElementById("pet-photo-input");
  if (!input) return;

  input.addEventListener("change", async (event) => {
    const file = event.target.files?.[0];

    resetUploadState();
    updateUploadPreview("");

    if (!file) {
      setUploadFeedback("Selecione uma imagem para enviar ao Cloudinary.");
      return;
    }

    state.upload.previewUrl = URL.createObjectURL(file);
    updateUploadPreview(state.upload.previewUrl);
    state.upload.status = "uploading";
    setUploadFeedback("Upload em andamento...", "loading");
    setSubmitState(true, "Enviando foto...");

    try {
      const photoUrl = await uploadImageToCloudinary(file);
      state.upload.photoUrl = photoUrl;
      state.upload.status = "done";
      updateUploadPreview(photoUrl);
      setUploadFeedback("Upload concluído com sucesso.", "success");
      showToast("Upload concluído.");
    } catch (error) {
      console.error(error);
      state.upload.status = "error";
      state.upload.photoUrl = "";
      setUploadFeedback("Falha ao enviar imagem.", "error");
      showToast("Falha ao enviar imagem.");
    } finally {
      setSubmitState(false, "Salvar pet");
    }
  });
}

function setupReportForm() {
  const form = document.getElementById("report-form");
  if (!form) return;

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const consent = document.getElementById("legal-consent");

    if (!canCreateListings()) {
      showToast("Entre antes de publicar um pet.");
      return;
    }

    if (state.upload.status === "uploading") {
      showToast("Aguarde o término do upload da imagem.");
      return;
    }

    if (state.upload.status !== "done" || !state.upload.photoUrl) {
      showToast("Formulário incompleto.");
      setUploadFeedback("Envie uma foto válida antes de salvar o cadastro.", "error");
      return;
    }

    const pet = buildPetPayload(new FormData(form));
    if (!isPetValid(pet)) {
      showToast("Formulário incompleto.");
      return;
    }

    if (!consent?.checked) {
      showToast("Você precisa aceitar os Termos de Uso e a Política de Privacidade.");
      return;
    }

    setSubmitState(true, "Salvando pet...");

    try {
      const savedPet = await createPetInApi(pet);
      state.pets = [savedPet, ...state.pets.filter((item) => item.id !== savedPet.id)];
      savePets(state.pets);
      form.reset();
      resetUploadState();
      updateUploadPreview("");
      setUploadFeedback("Selecione uma imagem para enviar ao Cloudinary.");
      closeReportModal();
      renderAll();
      showScreen("feed");
      showToast("Pet cadastrado com sucesso.");
    } catch (error) {
      console.error(error);
      showToast("Erro ao salvar cadastro.");
      setUploadFeedback("Não foi possível salvar no servidor agora.", "error");
    } finally {
      setSubmitState(false, "Salvar pet");
    }
  });
}

function findPet(id) {
  return state.pets.find((pet) => pet.id === id);
}

function getReadableAuthError(error) {
  const code = String(error?.code || "");
  if (code.includes("popup-closed-by-user")) {
    return "O popup de login foi fechado antes da autenticação.";
  }
  if (code.includes("popup-blocked")) {
    return "Seu navegador bloqueou o popup de login. Libere popups e tente de novo.";
  }
  if (code.includes("operation-not-allowed")) {
    return "Esse provedor ainda não foi ativado no Firebase.";
  }
  if (code.includes("unauthorized-domain")) {
    return "Adicione este domínio na lista autorizada do Firebase Authentication.";
  }
  return "Não foi possível concluir o login agora.";
}

async function signInWithProvider(providerName) {
  if (!state.auth.isConfigured || !state.auth.firebaseAuth || !window.firebase?.auth) {
    showToast("Preencha o auth-config.js para ativar o login social.");
    return;
  }

  const providerFactories = {
    google: () => new window.firebase.auth.GoogleAuthProvider(),
    facebook: () => new window.firebase.auth.FacebookAuthProvider(),
    github: () => new window.firebase.auth.GithubAuthProvider(),
  };

  const providerFactory = providerFactories[providerName];
  if (!providerFactory) {
    showToast("Provedor não suportado.");
    return;
  }

  try {
    const provider = providerFactory();
    if (providerName === "google") {
      provider.setCustomParameters({ prompt: "select_account" });
    }

    if (isCodespacesHost()) {
      sessionStorage.setItem("radarpet_auth_provider", providerName);
      await state.auth.firebaseAuth.signInWithRedirect(provider);
      return;
    }

    await state.auth.firebaseAuth.signInWithPopup(provider);
    state.auth.guestUser = null;
    persistGuestSession(null);
    showToast("Login realizado com sucesso.");
  } catch (error) {
    console.error(error);
    showToast(getReadableAuthError(error));
  }
}

function continueAsGuest() {
  state.auth.guestUser = {
    id: `guest-${Date.now()}`,
    name: "Visitante RadarPet",
    email: "",
    avatar: "",
    provider: "Modo visitante",
    isGuest: true,
  };
  persistGuestSession(state.auth.guestUser);
  syncAuthShell();
  showToast("Você entrou no modo visitante.");
}

async function handleLogout() {
  try {
    if (state.auth.firebaseAuth && state.auth.user) {
      await state.auth.firebaseAuth.signOut();
    }
  } catch (error) {
    console.error(error);
  } finally {
    state.auth.user = null;
    state.auth.guestUser = null;
    persistGuestSession(null);
    closeReportModal();
    syncAuthShell();
    showToast("Sessão encerrada.");
  }
}

function setupInteractions() {
  const search = document.getElementById("app-search");

  search?.addEventListener("input", (event) => {
    state.query = event.target.value.trim().toLowerCase();
    renderAll();
  });

  document.getElementById("logout-button")?.addEventListener("click", handleLogout);
  document.getElementById("guest-access-button")?.addEventListener("click", continueAsGuest);

  document.querySelectorAll("[data-auth-provider]").forEach((button) => {
    button.addEventListener("click", () => signInWithProvider(button.dataset.authProvider));
  });

  document.addEventListener("click", async (event) => {
    const target = event.target.closest("[data-action], [data-map-filter], [data-lost-filter]");
    if (!target) return;

    if (target.dataset.mapFilter) {
      state.mapFilter = target.dataset.mapFilter;
      setChipActive("[data-map-filter]", state.mapFilter, "mapFilter");
      renderMapNearby();
      showScreen("mapa");
      return;
    }

    if (target.dataset.lostFilter) {
      state.lostFilter = target.dataset.lostFilter;
      setChipActive("[data-lost-filter]", state.lostFilter, "lostFilter");
      renderLostFound();
      return;
    }

    const action = target.dataset.action;

    if (action === "close-info") {
      closeInfoModal();
      return;
    }

    if (action === "show-screen") {
      showScreen(target.dataset.targetScreen);
      return;
    }

    if (action === "focus-search") {
      search?.focus();
      return;
    }

    if (action === "open-report") {
      openReportModal();
      return;
    }

    if (action === "open-report-lost") {
      openReportModal("Perdido");
      return;
    }

    if (action === "map") {
      openInfoModal("Mapa RadarPet", "Pets por cidade", "No MVP, o mapa funciona como painel visual e a lista abaixo mostra os pets cadastrados.");
      return;
    }

    if (action === "pet-detail") {
      const pet = findPet(target.dataset.petId);
      if (pet) {
        openInfoModal(
          pet.nome,
          `${pet.status} • ${pet.cidade}`,
          `${pet.especie} • ${pet.raca} • ${pet.sexo} • ${pet.cor}. Tutor: ${pet.nomeTutor || "Não informado"}. Use o botão Entrar em contato para abrir o WhatsApp.`
        );
      }
      return;
    }

    if (action === "contact") {
      const pet = findPet(target.dataset.petId);
      if (!pet) return;
      try {
        const phone = pet.telefone || await fetchPetContact(pet.id);
        pet.telefone = phone;
        const whatsappPhone = formatPhoneForWhatsApp(phone);
        if (!whatsappPhone) {
          throw new Error("Telefone inválido para WhatsApp.");
        }
        window.open(buildWhatsAppUrl(whatsappPhone, pet.nome), "_blank", "noopener,noreferrer");
        showToast("Abrindo conversa no WhatsApp.");
      } catch (error) {
        console.error(error);
        showToast("Não foi possível abrir o WhatsApp agora.");
      }
      return;
    }

    if (action === "follow") {
      const id = target.dataset.ongId;
      state.followed.has(id) ? state.followed.delete(id) : state.followed.add(id);
      writeArray(FOLLOWS_KEY, [...state.followed]);
      renderOngs();
      showToast(state.followed.has(id) ? "ONG seguida." : "ONG removida.");
      return;
    }

    if (action === "ong-detail") {
      const ong = state.ongs.find((entry) => entry.id === target.dataset.ongId);
      if (ong) {
        openInfoModal(ong.name, "ONG parceira", ong.meta);
      }
    }
  });
}

function setupAutoRefresh() {
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      syncPets({ announceUpdates: true });
    }
  });

  window.addEventListener("online", () => {
    syncPets({ announceUpdates: true });
  });

  state.sync.intervalId = window.setInterval(() => {
    if (!document.hidden) {
      syncPets({ announceUpdates: true });
    }
  }, PETS_REFRESH_INTERVAL_MS);
}

function initFirebaseAuth() {
  const firebaseConfig = getFirebaseConfig();
  state.auth.isConfigured = Boolean(firebaseConfig);

  if (!firebaseConfig || !window.firebase) {
    syncAuthShell();
    return;
  }

  try {
    if (!window.firebase.apps.length) {
      window.firebase.initializeApp(firebaseConfig);
    }

    state.auth.firebaseAuth = window.firebase.auth();
    state.auth.firebaseAuth.setPersistence(window.firebase.auth.Auth.Persistence.LOCAL).catch(() => {});
    state.auth.firebaseAuth.getRedirectResult().catch((error) => {
      console.error(error);
      if (sessionStorage.getItem("radarpet_auth_provider")) {
        sessionStorage.removeItem("radarpet_auth_provider");
        showToast(getReadableAuthError(error));
      }
    });
    state.auth.firebaseAuth.onAuthStateChanged((user) => {
      state.auth.user = normalizeAuthUser(user);
      if (state.auth.user) {
        state.auth.guestUser = null;
        persistGuestSession(null);
        if (sessionStorage.getItem("radarpet_auth_provider")) {
          sessionStorage.removeItem("radarpet_auth_provider");
          showToast("Login realizado com sucesso.");
        }
      }
      syncAuthShell();
    });
  } catch (error) {
    console.error(error);
    state.auth.isConfigured = false;
    syncAuthShell();
  }
}

async function boot() {
  state.ongs = await readJson("data/ongs.json", []);
  state.followed = new Set(readArray(FOLLOWS_KEY));

  initFirebaseAuth();
  setupPhotoUpload();
  setupReportForm();
  setupInteractions();
  setupAutoRefresh();

  try {
    await syncPets({
      announceOfflineFallback: true,
      announceLoadError: true,
    });
    savePets(state.pets);
  } catch (error) {
    console.error(error);
    state.pets = loadPets();
    if (state.pets.length) {
      showToast("Modo offline: exibindo pets salvos neste navegador.");
    } else {
      showToast("Não foi possível carregar os pets agora.");
    }
  }

  renderAll();
  syncAuthShell();

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
}

document.addEventListener("DOMContentLoaded", boot);
window.showScreen = showScreen;
window.openReportModal = openReportModal;
window.closeReportModal = closeReportModal;
