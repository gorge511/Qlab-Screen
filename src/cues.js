export function flattenCues(cues, depth = 0, parentId = "") {
  return cues.flatMap((cue, index) => {
    const current = {
      uniqueID: cue.uniqueID || "",
      number: cue.number || "",
      name: cue.name || "",
      listName: cue.listName || "",
      type: cue.type || "",
      colorName: cue.colorName || "none",
      flagged: Number(cue.flagged || 0),
      armed: Number(cue.armed ?? 1),
      depth,
      parentId,
      groupName: "",
      order: index
    };
    const children = Array.isArray(cue.cues) ? flattenCues(cue.cues, depth + 1, current.uniqueID) : [];
    if (current.type === "Group") {
      const groupName = current.name || current.number || "";
      for (const child of children) child.groupName = groupName;
    }
    return [current, ...children];
  });
}

export function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value == null || value === "") return [];
  return [value];
}

export function isContainerCue(cue) {
  return cue?.type === "Group" || cue?.type === "Cue List";
}

// QLab reports a running Group and every child, then repeats the active child.
// Keep each playable cue once. Playback position is the standby cue, not the
// cue that is currently playing, so it must not be used as a running filter.
export function activeRunningCues(running, cues) {
  const cueMap = new Map((cues || []).map((cue) => [cue.uniqueID, cue]));
  const listed = new Map();

  for (const cue of running || []) {
    const fullCue = { ...(cueMap.get(cue.uniqueID) || {}), ...cue };
    if (!fullCue.uniqueID || listed.has(fullCue.uniqueID) || isContainerCue(fullCue)) continue;
    listed.set(fullCue.uniqueID, fullCue);
  }

  return [...listed.values()];
}

export function nextCueAfter(cues, currentCue) {
  if (!currentCue) return null;
  const playable = (cues || []).filter((cue) => !isContainerCue(cue));
  const index = playable.findIndex((cue) => cue.uniqueID === currentCue.uniqueID);
  return index >= 0 ? playable[index + 1] || null : null;
}
