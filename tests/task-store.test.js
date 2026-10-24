import { describe, expect, it } from 'vitest';
import { addMedia, appendLog, createTask, setEagleImport, setEagleItemStatus, setItemStatus, setTaskPhase, taskSummary } from '../src/shared/task-store.js';

describe('task store reducers', () => {
it('keeps only one copy of a media record', () => {
    const task = createTask('alice', { includeReplies: false, includeReposts: false });
    const record = { key: '1:0:https://pbs.twimg.com/a', tweetId: '1', mediaIndex: 0, kind: 'image' };
    expect(addMedia(addMedia(task, record), record).items).toHaveLength(1);
  });

  it('summarizes pending and failed records', () => {
    const task = addMedia(createTask('alice', {}), { key: 'a', tweetId: '1', mediaIndex: 0, kind: 'image' });
    const failed = setItemStatus(task, 'a', 'failed', 'network error');
    expect(taskSummary(failed)).toEqual({ total: 1, pending: 0, downloading: 0, completed: 0, failed: 1, unavailable: 0 });
    expect(failed.items[0].error).toBe('network error');
  });
});

it('replaces a DOM video placeholder when network parsing finds its MP4', () => {
  const task = addMedia(createTask('alice'), { key: '1:0:poster', tweetId: '1', mediaIndex: 0, kind: 'video', status: 'pending', needsResolve: true });
  const resolved = addMedia(task, { key: '1:0:high.mp4', tweetId: '1', mediaIndex: 0, kind: 'video', url: 'high.mp4', status: 'pending' });
  expect(resolved.items).toEqual([expect.objectContaining({ key: '1:0:high.mp4', url: 'high.mp4', status: 'pending' })]);
});

it('keeps one image when X reports the same resource with different media indexes', () => {
  const task = addMedia(createTask('alice'), { key: '1:2:https://pbs.twimg.com/media/a?name=orig', tweetId: '1', mediaIndex: 2, kind: 'image', url: 'https://pbs.twimg.com/media/a?name=orig' });
  const repeated = addMedia(task, { key: '1:3:https://pbs.twimg.com/media/a?name=orig', tweetId: '1', mediaIndex: 3, kind: 'image', url: 'https://pbs.twimg.com/media/a?name=orig' });
  expect(repeated.items).toHaveLength(1);
  expect(repeated.collectionStats.merged).toBe(1);
});

it('keeps the earliest tweet metadata when the same X media asset appears again', () => {
  const latest = addMedia(createTask('alice'), {
    key: 'new:0:https://pbs.twimg.com/media/shared?format=jpg&name=orig', tweetId: 'new', mediaIndex: 0, kind: 'image', url: 'https://pbs.twimg.com/media/shared?format=jpg&name=orig', createdAt: '2026-08-17T00:00:00Z', tweetText: '较晚的推文'
  });
  const earliest = addMedia(latest, {
    key: 'old:0:https://pbs.twimg.com/media/shared?format=jpg&name=orig', tweetId: 'old', mediaIndex: 0, kind: 'image', url: 'https://pbs.twimg.com/media/shared?format=jpg&name=orig', createdAt: '2026-08-16T00:00:00Z', tweetText: '最早的推文'
  });
  expect(earliest.items).toEqual([expect.objectContaining({ tweetId: 'old', createdAt: '2026-08-16T00:00:00Z', tweetText: '最早的推文' })]);
});

it('preserves the reason for an unavailable MP4 item', () => {
  const task = addMedia(createTask('alice'), { key: 'no-mp4', kind: 'video', status: 'unavailable', error: '该视频没有可下载的 MP4 版本' });
  expect(task.items[0].error).toBe('该视频没有可下载的 MP4 版本');
});

it('keeps the newest diagnostic log entries', () => {
  const task = appendLog(createTask('alice', {}), '内容脚本已收到扫描命令');
  expect(task.logs.at(-1)).toContain('内容脚本已收到扫描命令');
});

it('creates an automatic scanning task and changes phase without losing items', () => {
  const task = addMedia(createTask('alice', { scrollMode: 'auto' }), { key: 'a', kind: 'image' });
  expect(task).toMatchObject({ collecting: true, phase: 'scanning', scrollMode: 'auto', autoScrollPaused: false });
  expect(setTaskPhase(task, 'scan_complete')).toMatchObject({ collecting: false, phase: 'scan_complete', items: [{ key: 'a' }] });
});

it('stores a validated media type filter and defaults to all media', () => {
  expect(createTask('alice', { mediaType: 'image' }).options.mediaType).toBe('image');
  expect(createTask('alice', { mediaType: 'unknown' }).options.mediaType).toBe('all');
});

it('persists an Eagle import result separately from download status', () => {
  const task = addMedia(createTask('alice'), { key: 'a', kind: 'image', status: 'pending' });
  expect(setEagleItemStatus(task, 'a', 'imported')).toMatchObject({ items: [{ key: 'a', status: 'pending', eagleStatus: 'imported', eagleError: null }] });
});

it('stores Eagle submission and observed-folder progress independently from item download state', () => {
  const task = setEagleImport(createTask('alice'), { folderId: 'folder', baseline: 10, submitted: 50, observed: 14 });
  expect(task.eagleImport).toMatchObject({ folderId: 'folder', baseline: 10, submitted: 50, observed: 14 });
});
