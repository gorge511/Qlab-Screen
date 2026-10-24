const statusText = document.querySelector("#statusText");
const workspaceHero = document.querySelector("#workspaceHero");
const workspaceText = document.querySelector("#workspaceText");
const runningCount = document.querySelector("#runningCount");
const lastUpdate = document.querySelector("#lastUpdate");
const cueCount = document.querySelector("#cueCount");
const cueList = document.querySelector("#cueList");
const runningList = document.querySelector("#runningList");
const playheadCard = document.querySelector("#playheadCard");
const mobileStatus = document.querySelector("#mobileStatus");
const mobileLastUpdate = document.querySelector("#mobileLastUpdate");
const mobileGroup = document.querySelector("#mobileGroup");
const mobileCueNumber = document.querySelector("#mobileCueNumber");
const mobileCueName = document.querySelector("#mobileCueName");
const mobileProgress = document.querySelector("#mobileProgress");
const mobileElapsed = document.querySelector("#mobileElapsed");
const mobileRemaining = document.querySelector("#mobileRemaining");
const mobileRunningCount = document.querySelector("#mobileRunningCount");
const mobileWorkspace = document.querySelector("#mobileWorkspace");
const fullscreenButton = document.querySelector("#fullscreenButton");
const wakeLockButton = document.querySelector("#wakeLockButton");
const wakeStateBadge = document.querySelector("#wakeStateBadge");
const versionBadge = document.querySelector("#versionBadge");
const VIEWER_PAGE = "monitor";
const VIEWER_CLIENT_ID_KEY = "qlab-screen-client-id";

let currentState = null;
let serverOnline = false;
let eventsOnline = false;
let lastEventAt = 0;
let lastScrollTarget = "";
let userScrolledAt = 0;
let autoScrolling = false;
let wakeLock = null;
let wakeLockWanted = false;
let lastCueVersion = -1;
let lastRunningIdsKey = "";
let lastPlayheadId = "";
let fullStateRequest = null;
let lastFullStateFetchAt = 0;
const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const isStandalone = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
const viewerClientId = getViewerClientId();

const events = new EventSource(`/events?clientId=${encodeURIComponent(viewerClientId)}&page=${encodeURIComponent(VIEWER_PAGE)}`);

events.onopen = () => {
  eventsOnline = true;
  serverOnline = true;
  lastEventAt = Date.now();
  render(currentState);
};

events.addEventListener("snapshot", (event) => {
  eventsOnline = true;
  serverOnline = true;
  lastEventAt = Date.now();
  render(JSON.parse(event.data));
});

events.addEventListener("patch", (event) => {
  eventsOnline = true;
  serverOnline = true;
  lastEventAt = Date.now();
  render(mergeStatePatch(currentState, JSON.parse(event.data)));
});

events.addEventListener("heartbeat", (event) => {
  eventsOnline = true;
  serverOnline = true;
  lastEventAt = Date.now();
  render(mergeStatePatch(currentState, JSON.parse(event.data)));
});

events.onerror = () => {
  eventsOnline = false;
  render(currentState);
};

pollState();
setInterval(pollState, 2000);

cueList.addEventListener("scroll", () => {
  if (autoScrolling) return;
  userScrolledAt = Date.now();
}, { passive: true });

fitWorkspaceTitle();
window.addEventListener("resize", fitWorkspaceTitle);

fullscreenButton.addEventListener("click", toggleFullscreen);
wakeLockButton.addEventListener("click", toggleWakeLock);
document.addEventListener("fullscreenchange", syncViewControls);
document.addEventListener("visibilitychange", handleVisibilityChange);
document.addEventListener("pointerdown", ensureWakeLockOnFirstInteraction, { once: true, passive: true });
window.addEventListener("pagehide", () => sendPresence(false));
window.addEventListener("beforeunload", () => sendPresence(false));
syncViewControls();
sendPresence(document.visibilityState === "visible");
setInterval(() => {
  if (document.visibilityState !== "visible") return;
  sendPresence(document.visibilityState === "visible");
}, 30000);
ensureFullState();

function render(state) {
  currentState = state || {};
  const runningIds = new Set((currentState.running || []).map((cue) => cue.uniqueID));
  const runningIdsKey = Array.from(runningIds).sort().join("|");
  document.body.classList.toggle("server-offline", !serverOnline);
  document.body.classList.toggle("events-offline", serverOnline && !eventsOnline);
  document.body.classList.toggle("qlab-connected", Boolean(serverOnline && currentState.connected && !currentState.lastError));
  document.body.classList.toggle("qlab-error", Boolean(serverOnline && currentState.lastError));

  if (!serverOnline) {
    statusText.textContent = "Server disconnected";
  } else if (!eventsOnline) {
    statusText.textContent = "Reconnecting live view";
  } else {
    statusText.textContent = currentState.connected ? "Connected" : "Disconnected";
    if (currentState.lastError) statusText.textContent = currentState.lastError;
  }
  workspaceHero.textContent = currentState.workspaceName || "Waiting for workspace";
  fitWorkspaceTitle();
  versionBadge.textContent = `v${currentState.appVersion || "0.0.0"}`;
  const currentGroup = getCurrentGroup(currentState) || "-";
  workspaceText.textContent = currentGroup;
  runningCount.textContent = String((currentState.running || []).length);
  const updateTime = currentState.lastMessageAt ? formatClock(currentState.lastMessageAt) : "-";
  lastUpdate.textContent = updateTime;

  cueCount.textContent = `${(currentState.cues || []).length} cues`;
  renderCueList(runningIds, runningIdsKey, currentState.playheadId || "");

  runningList.classList.toggle("empty", !currentState.running?.length);
  runningList.innerHTML = currentState.running?.length
    ? currentState.running.map(renderRunningCue).join("")
    : "Nothing running.";
  renderPlayhead(currentState);

  if (currentState.connected && !currentState.cues?.length) {
    ensureFullState();
  }

  renderMobileGlance(currentState, currentGroup, updateTime);
  requestAnimationFrame(() => scrollToActiveCue(currentState));
}

function renderCueList(runningIds, runningIdsKey, playheadId) {
  const cues = currentState.cues || [];
  const cueVersion = Number(currentState.cuesVersion || 0);
  if (cueVersion === lastCueVersion && runningIdsKey === lastRunningIdsKey && playheadId === lastPlayheadId) return;

  cueList.classList.toggle("empty", cues.length === 0);
  cueList.innerHTML = cues.length
    ? cues.map((cue) => renderCue(cue, runningIds.has(cue.uniqueID), cue.uniqueID === playheadId)).join("")
    : "No cues loaded.";

  lastCueVersion = cueVersion;
  lastRunningIdsKey = runningIdsKey;
  lastPlayheadId = playheadId;
}

async function toggleFullscreen() {
  if (isIos) {
    if (!isStandalone) {
      window.alert("On iPhone/iPad, add this page to the Home Screen for the closest fullscreen experience.");
      return;
    }
    document.body.classList.toggle("focus-mode");
    syncViewControls();
    return;
  }

  try {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
    } else {
      await document.documentElement.requestFullscreen();
    }
  } catch {
    syncViewControls();
  }
}

async function toggleWakeLock() {
  if (wakeLock) {
    wakeLockWanted = false;
    await releaseWakeLock();
    return;
  }

  wakeLockWanted = true;
  await requestWakeLock();
}

async function ensureWakeLockOnFirstInteraction() {
  if (wakeLockWanted && wakeLock === null) {
    await requestWakeLock();
  }
}

async function requestWakeLock() {
  if (!("wakeLock" in navigator) || typeof navigator.wakeLock.request !== "function") {
    wakeLockButton.textContent = "Wake Lock Unsupported";
    wakeLockButton.disabled = true;
    return;
  }

  try {
    wakeLock = await navigator.wakeLock.request("screen");
    wakeLock.addEventListener("release", () => {
      wakeLock = null;
      syncViewControls();
    });
  } catch {
    wakeLock = null;
  }

  syncViewControls();
}

async function releaseWakeLock() {
  if (!wakeLock) {
    syncViewControls();
    return;
  }

  const activeLock = wakeLock;
  wakeLock = null;
  await activeLock.release().catch(() => {});
  syncViewControls();
}

async function handleVisibilityChange() {
  sendPresence(document.visibilityState === "visible");
  if (document.visibilityState !== "visible") return;
  if (wakeLockWanted && wakeLock === null) await requestWakeLock();
}

function syncViewControls() {
  if (isIos) {
    if (isStandalone) {
      fullscreenButton.textContent = document.body.classList.contains("focus-mode") ? "Exit Focus Mode" : "Focus Mode";
    } else {
      fullscreenButton.textContent = "Add to Home Screen";
    }
  } else {
    fullscreenButton.textContent = document.fullscreenElement ? "Exit Fullscreen" : "Fullscreen";
  }

  if (!("wakeLock" in navigator) || typeof navigator.wakeLock.request !== "function") {
    wakeLockButton.textContent = "Wake Lock Unsupported";
    wakeLockButton.disabled = true;
    wakeStateBadge.textContent = "Awake Unavailable";
    wakeStateBadge.dataset.state = "unsupported";
    return;
  }

  wakeLockButton.disabled = false;
  wakeLockButton.textContent = wakeLock ? "Allow Sleep" : "Keep Awake";
  wakeStateBadge.textContent = wakeLock ? "Awake On" : (wakeLockWanted ? "Awake Waiting" : "Awake Off");
  wakeStateBadge.dataset.state = wakeLock ? "on" : (wakeLockWanted ? "pending" : "off");
}

function renderMobileGlance(state, currentGroup, updateTime) {
  const cueMap = new Map((state.cues || []).map((cue) => [cue.uniqueID, cue]));
  const primary = pickPrimaryCue(state.running || [], cueMap);
  const fullCue = cueMap.get(primary?.uniqueID) || primary;
  const timing = state.time?.[primary?.uniqueID] || {};
  const elapsed = Number(timing.actionElapsed || 0);
  const duration = Number(timing.duration || 0);
  const remaining = duration > 0 ? Math.max(0, duration - elapsed) : null;
  const progress = duration > 0 ? Math.min(100, Math.max(0, (elapsed / duration) * 100)) : 0;

  mobileStatus.textContent = statusText.textContent;
  mobileLastUpdate.textContent = updateTime;
  mobileGroup.textContent = currentGroup;
  mobileCueNumber.textContent = fullCue?.number || "-";
  mobileCueName.textContent = fullCue ? getCueDisplayName(fullCue) : "No cue running";
  mobileProgress.style.width = `${progress}%`;
  mobileElapsed.textContent = `${formatTime(elapsed)} elapsed`;
  mobileRemaining.textContent = remaining == null ? "duration unavailable" : `${formatTime(remaining)} remaining`;
  mobileRunningCount.textContent = `${(state.running || []).length} running`;
  mobileWorkspace.textContent = state.workspaceName || "No workspace";
}

async function pollState() {
  if (eventsOnline && Date.now() - lastEventAt < 20000) return;
  try {
    const response = await fetch("/api/status", { cache: "no-store" });
    if (!response.ok) throw new Error("State request failed.");
    serverOnline = true;
    const nextState = mergeStatePatch(currentState, await response.json());
    render(nextState);
    if (nextState.connected && !nextState.cues?.length) ensureFullState();
  } catch {
    serverOnline = false;
    eventsOnline = false;
    render(currentState);
  }
}

async function ensureFullState() {
  if (fullStateRequest) return fullStateRequest;
  if (Date.now() - lastFullStateFetchAt < 3000) return null;

  lastFullStateFetchAt = Date.now();
  fullStateRequest = fetch("/api/state", { cache: "no-store" })
    .then((response) => {
      if (!response.ok) throw new Error("Full state request failed.");
      return response.json();
    })
    .then((fullState) => {
      serverOnline = true;
      render(fullState);
      return fullState;
    })
    .catch(() => null)
    .finally(() => {
      fullStateRequest = null;
    });

  return fullStateRequest;
}

function mergeStatePatch(previousState, patch) {
  return {
    ...(previousState || {}),
    ...patch,
    cues: patch.cues || previousState?.cues || []
  };
}

function fitWorkspaceTitle() {
  workspaceHero.style.fontSize = "";
  const available = workspaceHero.clientWidth;
  if (!available) return;

  const fitted = Math.floor(available / Math.max(workspaceHero.textContent.length, 1) * 1.7);
  const maxSize = Number.parseFloat(getComputedStyle(workspaceHero).fontSize);
  workspaceHero.style.fontSize = `${Math.max(24, Math.min(maxSize, fitted))}px`;
}

function renderPlayhead(state) {
  const cue = (state.cues || []).find((candidate) => candidate.uniqueID === state.playheadId);
  playheadCard.innerHTML = cue
    ? `<span>Playhead ${escapeHtml(cue.number || "-")}</span><strong>${cueTypeIcon(cue.type)} ${escapeHtml(getCueDisplayName(cue))}</strong>`
    : "No playhead.";
}

function renderCue(cue, isRunning, isPlayhead = false) {
  const isDisabled = Number(cue.armed) === 0;
  const isGroup = cue.type === "Group" || cue.type === "Cue List";
  const displayName = getCueDisplayName(cue);
  const detail = getCueDetail(cue);
  const timing = currentState.time?.[cue.uniqueID] || {};
  const elapsed = Number(timing.actionElapsed || 0);
  const duration = Number(timing.duration || 0);
  const remaining = duration > 0 ? Math.max(0, duration - elapsed) : null;
  const liveTiming = isRunning
    ? `<div class="cue-live-time">${escapeHtml(formatTime(elapsed))}${remaining != null ? ` / ${escapeHtml(formatTime(remaining))}` : ""}</div>`
    : "";
  return `
    <article class="cue-row ${isRunning ? "running" : ""} ${isPlayhead ? "playhead" : ""} ${isDisabled ? "disabled" : ""} ${isGroup ? "group-row" : ""}" data-cue-id="${escapeHtml(cue.uniqueID)}" data-parent-id="${escapeHtml(cue.parentId || "")}" style="--depth:${Number(cue.depth || 0)}">
      <div class="cue-number">${escapeHtml(cue.number || "-")}</div>
      <div class="cue-title cue-indent">
        ${renderCueSwatch(cue)}
        <div class="cue-copy">
          <div class="cue-name">${cueTypeIcon(cue.type)} ${escapeHtml(displayName)}</div>
          ${detail ? `<div class="cue-detail">${escapeHtml(detail)}</div>` : ""}
          ${liveTiming}
        </div>
      </div>
      <div class="type">${escapeHtml(formatCueType(cue.type || "cue"))}</div>
      <div class="badges">
        ${cue.flagged ? '<span class="badge warn">F</span>' : ""}
        ${isDisabled ? '<span class="badge danger">D</span>' : ""}
        ${isRunning ? '<span class="badge">RUN</span>' : ""}
        ${isPlayhead ? '<span class="badge warn">PH</span>' : ""}
      </div>
    </article>
  `;
}

function scrollToActiveCue(state) {
  if (!state?.cues?.length) return;
  if (Date.now() - userScrolledAt < 5000) return;

  const cueMap = new Map(state.cues.map((cue) => [cue.uniqueID, cue]));
  const primary = pickPrimaryCue(state.running || [], cueMap);
  const targetCue = primary
    ? cueMap.get(primary.uniqueID) || findParentInList(primary, cueMap)
    : cueMap.get(state.playheadId);
  if (!targetCue?.uniqueID || targetCue.uniqueID === lastScrollTarget) return;

  const row = cueList.querySelector(`[data-cue-id="${CSS.escape(targetCue.uniqueID)}"]`);
  if (!row) return;

  lastScrollTarget = targetCue.uniqueID;
  autoScrolling = true;
  row.scrollIntoView({ block: "center", behavior: "smooth" });
  setTimeout(() => {
    autoScrolling = false;
  }, 900);
}

function pickPrimaryCue(running, cueMap) {
  const playable = running
    .map((cue) => cueMap.get(cue.uniqueID) || cue)
    .filter((cue) => cue.type !== "Group" && cue.type !== "Cue List");
  return playable.find((cue) => Number(currentState.time?.[cue.uniqueID]?.actionElapsed) > 0) || playable[0] || null;
}

function findParentInList(cue, cueMap) {
  let current = cue;
  while (current?.parentId) {
    const parent = cueMap.get(current.parentId);
    if (!parent) break;
    current = parent;
  }
  return current;
}

function getCurrentGroup(state) {
  const cueMap = new Map((state.cues || []).map((cue) => [cue.uniqueID, cue]));
  const primary = pickPrimaryCue(state.running || [], cueMap);
  if (!primary) return "";

  let current = cueMap.get(primary.uniqueID) || primary;
  while (current?.parentId) {
    const parent = cueMap.get(current.parentId);
    if (!parent) break;
    if (parent.type === "Group") return parent.name || parent.number || "";
    current = parent;
  }

  return current.groupName || "";
}

function renderRunningCue(cue) {
  const timing = currentState.time?.[cue.uniqueID] || {};
  const elapsed = Number(timing.actionElapsed || 0);
  const duration = Number(timing.duration || 0);
  const progress = duration > 0 ? Math.min(100, Math.max(0, (elapsed / duration) * 100)) : 0;
  const remaining = duration > 0 ? Math.max(0, duration - elapsed) : null;
  const displayName = getCueDisplayName(cue);
  const detail = getCueDetail(cue);

  return `
    <article class="run-card">
      <div class="run-top">
        <strong class="cue-number">${escapeHtml(cue.number || "-")}</strong>
        <div class="run-main">
          <strong class="run-title">${cueTypeIcon(cue.type)} ${escapeHtml(displayName)}</strong>
          ${detail ? `<div class="run-detail">${escapeHtml(detail)}</div>` : ""}
        </div>
        <span class="timer">${formatTime(elapsed)}</span>
      </div>
      <div class="progress" aria-hidden="true"><span style="--progress:${progress}%"></span></div>
      <div class="meta">
        ${duration > 0 ? `${formatTime(remaining)} remaining of ${formatTime(duration)}` : "Duration unavailable"}
        ${timing.paused ? " / paused" : ""}
      </div>
    </article>
  `;
}

function formatClock(value) {
  return new Date(value).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
}

function formatTime(seconds) {
  if (seconds == null || Number.isNaN(Number(seconds))) return "--:--";
  const value = Math.max(0, Number(seconds));
  const minutes = Math.floor(value / 60);
  const secs = Math.floor(value % 60);
  return `${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function getCueDisplayName(cue) {
  if (!cue) return "";
  if (cue.type === "Timecode") return cue.listName || cue.name || cue.number || "Timecode";
  if (cue.type === "Memo") return cue.name || cue.listName || "";
  if (cue.type === "Cue List" || cue.type === "Group") return cue.name || cue.listName || cue.number || cue.type;
  return cue.name || cue.listName || cue.number || cue.type || "";
}

function getCueDetail(cue) {
  if (!cue) return "";
  if (cue.type === "Timecode") return cue.name && cue.name !== cue.listName ? cue.name : "";
  if (cue.type === "Memo") return "";
  if (!cue.name && cue.listName && cue.listName !== cue.number) return cue.listName;
  return "";
}

function cueTypeIcon(type) {
  const icons = {
    Audio: "🔊",
    Mic: "🎤",
    Video: "🎞",
    Camera: "📷",
    Text: "T",
    Group: "▣",
    "Cue List": "≡",
    Fade: "↘",
    Wait: "⏳",
    Memo: "✎"
  };
  const icon = icons[type];
  return icon ? `<span class="cue-type-icon" title="${escapeHtml(type)}">${icon}</span>` : "";
}

function formatCueType(type) {
  return type === "Cue List" ? "list" : String(type || "cue").toLowerCase();
}

function renderCueSwatch(cue) {
  const color = mapCueColor(cue.colorName);
  if (!color) return "";
  return `<span class="cue-swatch" style="--cue-swatch:${escapeHtml(color)}"></span>`;
}

function mapCueColor(colorName) {
  const value = String(colorName || "").toLowerCase();
  const map = {
    red: "#ef4444",
    orange: "#f97316",
    yellow: "#facc15",
    green: "#4ade80",
    blue: "#60a5fa",
    purple: "#c084fc",
    magenta: "#f472b6",
    gray: "#9ca3af"
  };
  return map[value] || "";
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[char]);
}

function getViewerClientId() {
  const existing = localStorage.getItem(VIEWER_CLIENT_ID_KEY);
  if (existing) return existing;
  const created = `viewer-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;
  localStorage.setItem(VIEWER_CLIENT_ID_KEY, created);
  return created;
}

function sendPresence(visible) {
  const payload = JSON.stringify({
    clientId: viewerClientId,
    page: VIEWER_PAGE,
    visible
  });

  if (navigator.sendBeacon) {
    const blob = new Blob([payload], { type: "application/json" });
    navigator.sendBeacon("/api/presence", blob);
    return;
  }

  fetch("/api/presence", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: payload,
    keepalive: true
  }).catch(() => {});
}
