const storageKey = (username) => `x-media-task:${username}`;

function xImageAssetKey(record) {
  if (record?.kind !== 'image' || !record.url) return null;
  try {
    const url = new URL(record.url);
    const mediaId = url.pathname.match(/\/media\/([^/]+)/)?.[1];
    return mediaId && /(^|\.)twimg\.com$/i.test(url.hostname) ? `x-image:${mediaId}` : null;
  } catch { return null; }
}

function isEarlierRecord(candidate, existing) {
  const candidateTime = Date.parse(candidate?.createdAt);
  const existingTime = Date.parse(existing?.createdAt);
  return Number.isFinite(candidateTime) && (!Number.isFinite(existingTime) || candidateTime < existingTime);
}

function noteMergedMedia(task) {
  return { ...task, updatedAt: new Date().toISOString(), collectionStats: { ...(task.collectionStats ?? {}), merged: (task.collectionStats?.merged ?? 0) + 1 } };
}

export function createTask(username, options = {}) {
  return {
    username,
    profileName: String(options.profileName ?? '').trim(),
    options: { includeReplies: Boolean(options.includeReplies), includeReposts: Boolean(options.includeReposts), mediaType: ['all', 'image', 'video'].includes(options.mediaType) ? options.mediaType : 'all' },
    collecting: true,
    phase: 'scanning',
    scrollMode: options.scrollMode === 'auto' ? 'auto' : 'manual',
    autoScrollPaused: false,
    items: [],
    logs: [],
    collectionStats: { merged: 0 },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

export function setTaskPhase(task, phase) {
  return { ...task, phase, collecting: phase === 'scanning', updatedAt: new Date().toISOString() };
}

export function appendLog(task, message) {
  const entry = `${new Date().toLocaleTimeString('zh-CN', { hour12: false })} ${message}`;
  return { ...task, updatedAt: new Date().toISOString(), logs: [...(task.logs ?? []), entry].slice(-40) };
}

export function addMedia(task, record) {
  const assetKey = xImageAssetKey(record);
  const sameAssetIndex = assetKey ? task.items.findIndex((item) => xImageAssetKey(item) === assetKey) : -1;
  if (sameAssetIndex >= 0) {
    const existing = task.items[sameAssetIndex];
    if (!isEarlierRecord(record, existing)) return noteMergedMedia(task);
    const items = [...task.items];
    items[sameAssetIndex] = {
      ...record,
      status: existing.status ?? record.status ?? 'pending',
      error: existing.error ?? record.error ?? null,
      ...(existing.eagleStatus ? { eagleStatus: existing.eagleStatus, eagleError: existing.eagleError ?? null } : {})
    };
    return noteMergedMedia({ ...task, items });
  }
  if (task.items.some((item) => item.key === record.key || (record.url && item.kind === record.kind && item.url === record.url))) return noteMergedMedia(task);
  const placeholderIndex = task.items.findIndex((item) => item.kind === 'video'
    && item.tweetId === record.tweetId
    && item.mediaIndex === record.mediaIndex
    && item.needsResolve
    && !item.url
    && record.url);
  if (placeholderIndex >= 0) {
    const items = [...task.items];
    items[placeholderIndex] = { ...record, status: record.status ?? 'pending', error: null };
    return { ...task, updatedAt: new Date().toISOString(), items };
  }
  return { ...task, updatedAt: new Date().toISOString(), items: [...task.items, { ...record, status: record.status ?? 'pending', error: record.error ?? null }] };
}

export function setItemStatus(task, key, status, error = null) {
  return {
    ...task,
    updatedAt: new Date().toISOString(),
    items: task.items.map((item) => item.key === key ? { ...item, status, error } : item)
  };
}

export function setEagleItemStatus(task, key, eagleStatus, eagleError = null) {
  return {
    ...task,
    updatedAt: new Date().toISOString(),
    items: task.items.map((item) => item.key === key ? { ...item, eagleStatus, eagleError } : item)
  };
}

export function setEagleImport(task, progress) {
  return { ...task, updatedAt: new Date().toISOString(), eagleImport: { ...(task.eagleImport ?? {}), ...progress } };
}

export function taskSummary(task) {
  const summary = { total: task.items.length, pending: 0, downloading: 0, completed: 0, failed: 0, unavailable: 0 };
  for (const item of task.items) summary[item.status] = (summary[item.status] ?? 0) + 1;
  return summary;
}

export async function loadTask(username, area = chrome.storage.local) {
  const result = await area.get(storageKey(username));
  return result[storageKey(username)] ?? null;
}

export async function saveTask(task, area = chrome.storage.local) {
  await area.set({ [storageKey(task.username)]: task });
  return task;
}
