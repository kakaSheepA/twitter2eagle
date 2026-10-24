import { readFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';
import { activeTabId, addDiscoveredMedia, collectionStatus, createBrowserFileRunner, createDownloadRunner, createSerialExecutor, eagleAvailability, eagleFolderItemCount, eagleRecentFolders, emptyStatus, ensureContentScript, ensureEagleCreatorFolder, importEagleItems, isEaglePriorityMessage, matchPlaylistToVideoItem, nativeImportChunks, readXProfileIdentity, resolveStaleScanningTask, resolveTweetVideo, taskItemsPage } from '../src/background/service-worker.js';

it('injects the current X content script before reading a profile display name', async () => {
  const sequence = [];
  const identity = await readXProfileIdentity(42, {
    ensure: async (tabId) => { sequence.push(`ensure:${tabId}`); },
    send: async (tabId, message) => { sequence.push(`send:${tabId}:${message.type}`); return { profileName: 'Alice Example' }; }
  });
  expect(identity).toEqual({ profileName: 'Alice Example' });
  expect(sequence).toEqual(['ensure:42', 'send:42:GET_PROFILE_IDENTITY']);
});

it('downloads pending records and marks them completed', async () => {
  const download = vi.fn().mockResolvedValue(7);
  const runner = createDownloadRunner({ download, concurrency: 2 });
  const result = await runner.run([{ key: 'a', status: 'pending', url: 'a.jpg', filename: 'alice/a.jpg' }]);
  expect(download).toHaveBeenCalledWith({ url: 'a.jpg', filename: 'alice/a.jpg', conflictAction: 'uniquify', saveAs: false });
  expect(result[0].status).toBe('completed');
});

it('marks a rejected download as failed', async () => {
  const runner = createDownloadRunner({ download: vi.fn().mockRejectedValue(new Error('blocked')) });
  expect((await runner.run([{ key: 'a', status: 'pending', url: 'a.jpg', filename: 'alice/a.jpg' }]))[0]).toMatchObject({ status: 'failed', error: 'blocked' });
});

it('uses Chrome downloads and returns the resulting local paths for a local Eagle import', async () => {
  const download = vi.fn().mockResolvedValue(7);
  const search = vi.fn().mockResolvedValue([{ state: 'complete', filename: 'C:\\Users\\gg\\Downloads\\XMediaEagle\\task-1\\one.jpg' }]);
  const runner = createBrowserFileRunner({ download, search, wait: async () => {} });
  await expect(runner.run([{ key: 'one', url: 'https://pbs.twimg.com/one.jpg', filename: 'alice/one.jpg' }], 'task-1'))
    .resolves.toMatchObject({ complete: [{ key: 'one', localPath: 'C:\\Users\\gg\\Downloads\\XMediaEagle\\task-1\\one.jpg' }], failures: [] });
  expect(download).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://pbs.twimg.com/one.jpg', filename: 'XMediaEagle/task-1/00001-one.jpg', saveAs: false }));
});

it('uses the active tab when a popup message has no sender tab', async () => {
  await expect(activeTabId(undefined, { query: vi.fn().mockResolvedValue([{ id: 42 }]) })).resolves.toBe(42);
});

it('does not reload the X page when collection starts', () => {
  expect(readFileSync('src/background/service-worker.js', 'utf8')).not.toContain('chrome.tabs.reload');
});

it('injects the content script into an already-open X tab', async () => {
  const executeScript = vi.fn().mockResolvedValue();
  await ensureContentScript(42, { executeScript });
  expect(executeScript).toHaveBeenNthCalledWith(1, { target: { tabId: 42 }, files: ['src/content/page-bridge.js'], world: 'MAIN' });
  expect(executeScript).toHaveBeenNthCalledWith(2, { target: { tabId: 42 }, files: ['src/content/content-script.js'], world: 'ISOLATED' });
});

it('keeps automatic scan state in the public task status', () => {
  expect(collectionStatus({ username: 'alice', collecting: true, phase: 'scanning', scrollMode: 'auto', autoScrollPaused: true, items: [] }))
    .toMatchObject({ username: 'alice', collecting: true, phase: 'scanning', scrollMode: 'auto', autoScrollPaused: true, total: 0 });
});

it('keeps a persisted scan active after the MV3 worker loses its in-memory state', () => {
  expect(resolveStaleScanningTask({ username: 'alice', collecting: true, phase: 'scanning', items: [] }, null))
    .toMatchObject({ collecting: true, phase: 'scanning' });
});

it('resolves the highest MP4 from X syndication media details', async () => {
  const response = { ok: true, json: vi.fn().mockResolvedValue({ mediaDetails: [{ type: 'video', video_info: { variants: [
    { content_type: 'video/mp4', bitrate: 256000, url: 'low.mp4' },
    { content_type: 'video/mp4', bitrate: 2176000, url: 'high.mp4' }
  ] } }] }) };
  await expect(resolveTweetVideo('123', 0, vi.fn().mockResolvedValue(response)))
    .resolves.toEqual({ url: 'high.mp4', bitrate: 2176000 });
});

it('creates an empty idle status for a newly opened panel session', () => {
  expect(emptyStatus()).toMatchObject({ total: 0, phase: 'idle', collecting: false, logs: [] });
});

it('serializes overlapping media updates so no earlier item is overwritten', async () => {
  const run = createSerialExecutor();
  let items = [];
  await Promise.all([
    run(async () => { const snapshot = [...items]; await Promise.resolve(); items = [...snapshot, 'first']; }),
    run(async () => { const snapshot = [...items]; items = [...snapshot, 'second']; })
  ]);
  expect(items).toEqual(['first', 'second']);
});

it('adds a batch of discovered records with one deduplicated task update', () => {
  const task = { items: [] };
  const next = addDiscoveredMedia(task, [
    { key: 'first', kind: 'image', url: 'first.jpg' },
    { key: 'first', kind: 'image', url: 'first.jpg' },
    { key: 'second', kind: 'image', url: 'second.jpg' }
  ]);
  expect(next.items.map((item) => item.key)).toEqual(['first', 'second']);
});

it('splits local native-import messages before they reach Chrome message-size limits', () => {
  expect(nativeImportChunks(Array.from({ length: 101 }, (_, index) => index), 50).map((chunk) => chunk.length)).toEqual([50, 50, 1]);
});

it('returns only one requested page of media while retaining total tab counts', () => {
  const task = {
    username: 'alice',
    items: [
      { key: 'image-1', kind: 'image', url: '1.jpg', status: 'pending', createdAt: '2026-08-16T00:00:00Z' },
      { key: 'image-2', kind: 'image', url: '2.jpg', status: 'pending', createdAt: '2026-08-16T01:00:00Z' },
      { key: 'video', kind: 'video', url: '3.mp4', status: 'completed', createdAt: '2026-08-16T02:00:00Z' },
      { key: 'missing', kind: 'video', status: 'unavailable', createdAt: '2026-08-16T03:00:00Z' }
    ]
  };
  expect(taskItemsPage(task, { tab: 'downloadable', mediaType: 'image', offset: 1, limit: 1 }))
    .toMatchObject({ items: [{ key: 'image-2' }], total: 2, counts: { downloadable: 3, unavailable: 1 } });
});

it('matches an X HLS playlist request to its unresolved video by shared media asset id', () => {
  const item = { key: 'tweet:0:poster', tweetId: 'tweet', mediaIndex: 0, kind: 'video', needsResolve: true, status: 'pending', poster: 'https://pbs.twimg.com/amplify_video_thumb/2088849412172939264/img/cover.jpg' };
  expect(matchPlaylistToVideoItem([item], 'https://video.twimg.com/amplify_video/2088849412172939264/pl/avc1/master.m3u8'))
    .toBe(item);
});

it('submits Eagle URL imports in continuous batches of 50', async () => {
  const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: vi.fn().mockResolvedValue({ status: 'success' }) });
  const items = Array.from({ length: 51 }, (_, index) => ({ key: String(index), kind: 'image', url: `https://pbs.twimg.com/${index}.jpg`, tweetId: String(index), filename: `alice/${index}.jpg` }));
  const onBatch = vi.fn();
  const result = await importEagleItems(items, 'alice', 'folder-1', fetchImpl, false, { onBatch });
  expect(fetchImpl).toHaveBeenCalledTimes(2);
  expect(result).toEqual(items.map((item) => ({ key: item.key, ok: true })));
  expect(JSON.parse(fetchImpl.mock.calls[0][1].body).items).toHaveLength(50);
  expect(JSON.parse(fetchImpl.mock.calls[1][1].body).items).toHaveLength(1);
  expect(onBatch).toHaveBeenCalledTimes(2);
  expect(onBatch).toHaveBeenLastCalledWith({ completed: 51, total: 51 });
});

it('submits every import directly to Eagle without reading its library or hashing image content', async () => {
  const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: vi.fn().mockResolvedValue({ status: 'success' }) });
  const result = await importEagleItems([{ key: 'image', kind: 'image', url: 'https://pbs.twimg.com/a.jpg', tweetId: '1', filename: 'alice/a.jpg' }], 'alice', 'folder-1', fetchImpl, true);
  expect(result).toEqual([{ key: 'image', ok: true }]);
  expect(fetchImpl).toHaveBeenCalledTimes(1);
  expect(fetchImpl.mock.calls[0][0]).toContain('/api/item/addFromURLs');
});

it('treats an Eagle API error payload as an import failure even with HTTP 200', async () => {
  const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: vi.fn().mockResolvedValue({ status: 'error', message: 'URL 不可用' }) });
  const result = await importEagleItems([{ key: 'a', kind: 'image', url: 'https://pbs.twimg.com/a.jpg', tweetId: '1', filename: 'alice/a.jpg' }], 'alice', 'folder-1', fetchImpl, false, { hashImage: vi.fn().mockResolvedValue('image') });
  expect(result).toEqual([{ key: 'a', ok: false, error: 'Eagle 拒绝导入：URL 不可用' }]);
});

it('normalizes Eagle recent folders and treats the local API as available', async () => {
  const folders = await eagleRecentFolders(vi.fn().mockResolvedValue({ ok: true, json: vi.fn().mockResolvedValue({ data: [{ id: 'recent', name: '最近收藏' }] }) }));
  expect(folders).toEqual([{ id: 'recent', name: '最近收藏' }]);
});

it('counts only the current Eagle creator folder for import progress', async () => {
  const fetchImpl = vi.fn(async (url) => {
    const offset = Number(new URL(url).searchParams.get('offset'));
    return { ok: true, json: async () => ({ data: offset < 320 ? [{ id: String(offset) }] : [] }) };
  });
  await expect(eagleFolderItemCount('creator', fetchImpl)).resolves.toBe(320);
  expect(fetchImpl.mock.calls.every(([url]) => new URL(url).searchParams.get('folders') === 'creator')).toBe(true);
});

it('reports Eagle availability without depending on the scanning task queue', async () => {
  await expect(eagleAvailability(vi.fn().mockResolvedValue({ ok: true, json: vi.fn().mockResolvedValue({ data: [] }) })))
    .resolves.toEqual({ available: true, folders: [] });
});

it('prioritizes both Eagle detection and imports ahead of queued scan work', () => {
  expect(isEaglePriorityMessage('GET_EAGLE_FOLDERS')).toBe(true);
  expect(isEaglePriorityMessage('IMPORT_EAGLE_ITEMS')).toBe(true);
  expect(isEaglePriorityMessage('IMPORT_EAGLE_LOCAL_ITEMS')).toBe(true);
  expect(isEaglePriorityMessage('MEDIA_DISCOVERED_BATCH')).toBe(false);
});

it('reuses the existing root folder named after the X username', async () => {
  const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: vi.fn().mockResolvedValue({ data: [{ id: 'creator', name: '@alice' }] }) });
  await expect(ensureEagleCreatorFolder('alice', fetchImpl)).resolves.toEqual({ id: 'creator', name: '@alice', created: false });
  expect(fetchImpl).toHaveBeenCalledTimes(1);
});

it('creates a creator folder from the X username', async () => {
  const fetchImpl = vi.fn()
    .mockResolvedValueOnce({ ok: true, json: vi.fn().mockResolvedValue({ data: [] }) })
    .mockResolvedValueOnce({ ok: true, json: vi.fn().mockResolvedValue({ data: { id: 'new-folder', name: '@alice' } }) });
  await expect(ensureEagleCreatorFolder('alice', fetchImpl)).resolves.toEqual({ id: 'new-folder', name: '@alice', created: true });
  expect(JSON.parse(fetchImpl.mock.calls[1][1].body)).toEqual({ folderName: '@alice' });
});

it('uses the X display name and ID for a creator folder when available', async () => {
  const fetchImpl = vi.fn(async (url) => {
    if (url.endsWith('/api/folder/list')) return { ok: true, json: async () => ({ data: [] }) };
    return { ok: true, json: async () => ({ status: 'success', data: { id: 'new-folder' } }) };
  });
  await expect(ensureEagleCreatorFolder('alice', 'Alice Example', fetchImpl)).resolves.toEqual({ id: 'new-folder', name: 'Alice Example @alice', created: true });
});

it('renames a legacy ID-only creator folder before importing', async () => {
  const fetchImpl = vi.fn(async (url) => {
    if (url.endsWith('/api/folder/list')) return { ok: true, json: async () => ({ data: [{ id: 'legacy', name: '@alice' }] }) };
    return { ok: true, json: async () => ({ status: 'success', data: { id: 'legacy', name: 'Alice Example @alice' } }) };
  });
  await expect(ensureEagleCreatorFolder('alice', 'Alice Example', fetchImpl)).resolves.toEqual({ id: 'legacy', name: 'Alice Example @alice', created: false, renamed: true });
  expect(fetchImpl).toHaveBeenCalledWith('http://localhost:41595/api/folder/rename', expect.objectContaining({ method: 'POST', body: JSON.stringify({ folderId: 'legacy', newName: 'Alice Example @alice' }) }));
});
