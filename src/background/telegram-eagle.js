const SAVED_KEY = 'telegramEagle:saved';

function requestIdFromFilename(filename) {
  const name = String(filename ?? '').split(/[\\/]/).pop() ?? '';
  const current = /^TelegramEagle_(.+)_\d+\.(?:jpg|mp4)$/i.exec(name);
  if (current) return current[1];
  // Files started before the filename fix used a directory and hyphen separator.
  return /(?:^|[\\/])TelegramEagle[\\/](.+)-\d+\.(?:jpg|mp4)$/i.exec(String(filename ?? ''))?.[1] ?? null;
}

export function createTelegramEagleController({ storage, ensureFolder, importLocalItem, sendToTab, removeDownloadFile, scheduleRemoveDownloadFile = removeDownloadFile, scheduleNativeExpiry = () => {} }) {
  const pending = new Map();
  return {
    async register({ requestId, tabId, record, filename, native = false }) {
      const saved = (await storage.get(SAVED_KEY))[SAVED_KEY] ?? {};
      if (saved[record.key]) return { state: 'saved' };
      pending.set(requestId, { tabId, record, filename, native, createdAt: Date.now() });
      await storage.set({ 'telegramEagle:pending': Object.fromEntries(pending) });
      await sendToTab(tabId, { type: 'TELEGRAM_SAVE_STATE', key: record.key, state: 'saving' });
      if (native) scheduleNativeExpiry(requestId);
      return { state: 'saving' };
    },
    async expireNativeDownload(requestId) {
      const request = pending.get(requestId);
      if (!request?.native || request.downloadId) return;
      pending.delete(requestId);
      await sendToTab(request.tabId, { type: 'TELEGRAM_SAVE_STATE', key: request.record.key, state: 'failed', error: 'Telegram 未启动下载；该频道可能限制保存' });
    },
    async assignDownloadId(requestId, downloadId) {
      const request = pending.get(requestId);
      if (!request) return false;
      request.downloadId = downloadId;
      return true;
    },
    async onDownloadCreated(item) {
      const pendingRequests = [...pending.values()].filter((request) => !request.downloadId);
      const matchingRequest = pendingRequests.find((request) => !request.native && request.record.source === item.url)
        ?? pendingRequests.filter((request) => request.native).sort((left, right) => right.createdAt - left.createdAt)[0];
      if (matchingRequest) matchingRequest.downloadId = item.id;
    },
    async onDownloadChanged(delta, item) {
      if (delta.state?.current !== 'complete') return;
      const requestId = requestIdFromFilename(item.filename)
        ?? [...pending.entries()].find(([, pendingRequest]) => pendingRequest.downloadId === item.id || (pendingRequest.record.source && pendingRequest.record.source === item.url))?.[0];
      const request = pending.get(requestId);
      if (!request) return;
      try {
        const name = request.record.kind === 'video' ? 'Telegtam-Video' : 'Telegtam-Picture';
        const folder = await ensureFolder(name);
        const filename = String(item.filename ?? '').split(/[\\/]/).pop();
        await importLocalItem({ ...request.record, filename }, item.filename, folder.id);
        await scheduleRemoveDownloadFile(item.id);
        const saved = (await storage.get(SAVED_KEY))[SAVED_KEY] ?? {};
        await storage.set({ [SAVED_KEY]: { ...saved, [request.record.key]: { savedAt: new Date().toISOString() } } });
        await sendToTab(request.tabId, { type: 'TELEGRAM_SAVE_STATE', key: request.record.key, state: 'saved' });
      } catch (error) {
        await removeDownloadFile(item.id).catch(() => {});
        await sendToTab(request.tabId, { type: 'TELEGRAM_SAVE_STATE', key: request.record.key, state: 'failed', error: error.message });
      } finally { pending.delete(requestId); }
    }
  };
}
