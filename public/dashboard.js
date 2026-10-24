const tvConnection = document.querySelector("#tvConnection");
const tvWorkspace = document.querySelector("#tvWorkspace");
const tvClock = document.querySelector("#tvClock");
const tvCueLabel = document.querySelector("#tvCueLabel");
const tvGroup = document.querySelector("#tvGroup");
const tvCueNumber = document.querySelector("#tvCueNumber");
const tvCueName = document.querySelector("#tvCueName");
const tvProgress = document.querySelector("#tvProgress");
const tvElapsed = document.querySelector("#tvElapsed");
const tvRemaining = document.querySelector("#tvRemaining");
const tvNextCues = document.querySelector("#tvNextCues");
const tvFullscreenButton = document.querySelector("#tvFullscreenButton");
const tvWakeLockButton = document.querySelector("#tvWakeLockButton");
const tvWakeStateBadge = document.querySelector("#tvWakeStateBadge");
const tvVersionBadge = document.querySelector("#tvVersionBadge");
const VIEWER_PAGE = "dashboard";
const VIEWER_CLIENT_ID_KEY = "qlab-screen-client-id";

let currentState = {};
let serverOnline = false;
let eventsOnline = false;
let lastEventAt = 0;
let wakeLock = null;
let wakeLockWanted = false;
const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const isStandalone = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
const viewerClientId = getViewerClientId();

updateClock();
setInterval(() => {
  updateClock();
}, 1000);

const events = new EventSource(`/events?clientId=${encodeURIComponent(viewerClientId)}&page=${encodeURIComponent(VIEWER_PAGE)}`);

events.onopen = () => {
  eventsOnline = true;
  serverOnline = true;
  lastEventAt = Date.now();
  render();
};

events.addEventListener("snapshot", (event) => {
  eventsOnline = true;
  serverOnline = true;
  lastEventAt = Date.now();
  currentState = JSON.parse(event.data);
  render();
});

events.addEventListener("patch", (event) => {
  eventsOnline = true;
  serverOnline = true;
  lastEventAt = Date.now();
  currentState = mergeStatePatch(currentState, JSON.parse(event.data));
  render();
  if (currentState.connected && !currentState.cues?.length) ensureFullState();
});

events.addEventListener("heartbeat", (event) => {
  eventsOnline = true;
  serverOnline = true;
  lastEventAt = Date.now();
  currentState = mergeStatePatch(currentState, JSON.parse(event.data));
  render();
  if (currentState.connected && !currentState.cues?.length) ensureFullState();
});

events.onerror = () => {
  eventsOnline = false;
  render();
};

pollState();
setInterval(pollState, 5000);

tvFullscreenButton.addEventListener("click", toggleFullscreen);
tvWakeLockButton.addEventListener("click", toggleWakeLock);
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

function render() {
  document.body.classList.toggle("server-offline", !serverOnline);
  document.body.classList.toggle("events-offline", serverOnline && !eventsOnline);
  document.body.classList.toggle("qlab-connected", Boolean(serverOnline && currentState.connected && !currentState.lastError));
  document.body.classList.toggle("qlab-error", Boolean(serverOnline && currentState.lastError));

  const running = currentState.running || [];
  const cues = currentState.cues || [];
  const cueMap = new Map(cues.map((cue) => [cue.uniqueID, cue]));
  const primary = pickPrimaryCue(running, cueMap);
  const standby = !primary;
  const featured = primary || cueMap.get(currentState.playheadId) || null;
  const fullCue = cueMap.get(featured?.uniqueID) || featured;
  const playheadIsGroup = standby && (fullCue?.type === "Group" || fullCue?.type === "Cue List");
  const group = playheadIsGroup ? getCueDisplayName(fullCue) : findGroupName(fullCue, cueMap);
  const timing = currentState.time?.[primary?.uniqueID] || {};
  const elapsed = Number(timing.actionElapsed || 0);
  const duration = Number(timing.duration || 0);
  const remaining = duration > 0 ? Math.max(0, duration - elapsed) : null;
  const progress = duration > 0 ? Math.min(100, Math.max(0, (elapsed / duration) * 100)) : 0;

  if (!serverOnline) {
    tvConnection.textContent = "Server disconnected";
  } else if (!eventsOnline) {
    tvConnection.textContent = "Reconnecting live view";
  } else {
    tvConnection.textContent = currentState.connected ? "Connected" : currentState.lastError || "Disconnected";
  }
  document.body.classList.toggle("standby", standby);
  tvVersionBadge.textContent = `v${currentState.appVersion || "0.0.0"}`;
  tvWorkspace.textContent = currentState.workspaceName || currentState.workspaceId || "-";
  tvCueLabel.textContent = standby ? "Next up" : "Now running";
  tvGroup.textContent = group || (standby ? "Waiting for QLab" : "Ungrouped cue");
  tvCueNumber.textContent = fullCue?.number || "-";
  tvCueName.innerHTML = playheadIsGroup
    ? `${cueTypeIcon(fullCue.type)} ${escapeHtml(getCueDisplayName(fullCue))}`
    : (fullCue
      ? `${cueTypeIcon(fullCue.type)} ${escapeHtml(getCueDisplayName(fullCue))}`
      : (standby ? "No cue standing by" : "No cue running"));
  tvProgress.style.width = `${progress}%`;
  tvElapsed.textContent = `${formatTime(elapsed)} elapsed`;
  tvRemaining.textContent = remaining == null ? "duration unavailable" : `${formatTime(remaining)} remaining`;

  const upcoming = nextCuesAfter(cues, fullCue, 2);
  tvNextCues.innerHTML = upcoming.length
    ? upcoming.map((cue) => {
      const cueGroup = findGroupName(cue, cueMap);
      const groupLabel = cueGroup && cueGroup !== group ? `<small>${escapeHtml(cueGroup)}</small>` : "";
      return `<div class="tv-next-cue"><span>${escapeHtml(cue.number || "-")}</span><div>${cueTypeIcon(cue.type)} ${escapeHtml(getCueDisplayName(cue))}${groupLabel}</div></div>`;
    }).join("")
    : "Nothing next.";
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
    tvWakeLockButton.textContent = "Wake Lock Unsupported";
    tvWakeLockButton.disabled = true;
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
      tvFullscreenButton.textContent = document.body.classList.contains("focus-mode") ? "Exit Focus Mode" : "Focus Mode";
    } else {
      tvFullscreenButton.textContent = "Add to Home Screen";
    }
  } else {
    tvFullscreenButton.textContent = document.fullscreenElement ? "Exit Fullscreen" : "Fullscreen";
  }

  if (!("wakeLock" in navigator) || typeof navigator.wakeLock.request !== "function") {
    tvWakeLockButton.textContent = "Wake Lock Unsupported";
    tvWakeLockButton.disabled = true;
    tvWakeStateBadge.textContent = "Awake Unavailable";
    tvWakeStateBadge.dataset.state = "unsupported";
    return;
  }

  tvWakeLockButton.disabled = false;
  tvWakeLockButton.textContent = wakeLock ? "Allow Sleep" : "Keep Awake";
  tvWakeStateBadge.textContent = wakeLock ? "Awake On" : (wakeLockWanted ? "Awake Waiting" : "Awake Off");
  tvWakeStateBadge.dataset.state = wakeLock ? "on" : (wakeLockWanted ? "pending" : "off");
}

async function pollState() {
  if (eventsOnline && Date.now() - lastEventAt < 20000) return;
  try {
    const response = await fetch("/api/status", { cache: "no-store" });
    if (!response.ok) throw new Error("State request failed.");
    serverOnline = true;
    currentState = mergeStatePatch(currentState, await response.json());
    render();
  } catch {
    serverOnline = false;
    eventsOnline = false;
    render();
  }
}

function mergeStatePatch(previousState, patch) {
  return {
    ...(previousState || {}),
    ...patch,
    cues: patch.cues || previousState?.cues || []
  };
}

async function ensureFullState() {
  try {
    const response = await fetch("/api/state", { cache: "no-store" });
    if (!response.ok) return;
    currentState = await response.json();
    render();
  } catch {
    // The next live update retries the full cue list.
  }
}

function nextCuesAfter(cues, currentCue, count) {
  if (!currentCue?.uniqueID) return [];
  const isContainer = (cue) => cue.type === "Group" || cue.type === "Cue List";
  if (isContainer(currentCue)) {
    return cues.filter((cue) => cue.parentId === currentCue.uniqueID && !isContainer(cue)).slice(0, count);
  }

  const playable = cues.filter((cue) => !isContainer(cue));
  const index = playable.findIndex((cue) => cue.uniqueID === currentCue.uniqueID);
  if (index < 0) return [];
  return playable.slice(index + 1, index + 1 + count);
}

function pickPrimaryCue(running, cueMap) {
  const playable = running
    .map((cue) => cueMap.get(cue.uniqueID) || cue)
    .filter((cue) => cue.type !== "Group" && cue.type !== "Cue List");
  return playable.find((cue) => Number(currentState.time?.[cue.uniqueID]?.actionElapsed) > 0) || playable[0] || null;
}

function findGroupName(cue, cueMap) {
  if (!cue) return "";
  let current = cueMap.get(cue.uniqueID) || cue;
  while (current?.parentId) {
    const parent = cueMap.get(current.parentId);
    if (!parent) break;
    if (parent.type === "Group") return parent.name || parent.number || "";
    current = parent;
  }
  return cue.groupName || "";
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

function getCueDisplayName(cue) {
  if (!cue) return "";
  if (cue.type === "Timecode") return cue.listName || cue.name || cue.number || "Timecode";
  if (cue.type === "Memo") return cue.name || cue.listName || "";
  if (cue.type === "Cue List" || cue.type === "Group") return cue.name || cue.listName || cue.number || cue.type;
  return cue.name || cue.listName || cue.number || cue.type || "";
}

function formatTime(seconds) {
  if (seconds == null || Number.isNaN(Number(seconds))) return "--:--";
  const value = Math.max(0, Number(seconds));
  const minutes = Math.floor(value / 60);
  const secs = Math.floor(value % 60);
  return `${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
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

function updateClock() {
  tvClock.textContent = new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
}
