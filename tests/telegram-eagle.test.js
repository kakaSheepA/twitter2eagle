import { expect, it, vi } from 'vitest';
import { createTelegramEagleController } from '../src/background/telegram-eagle.js';

it('routes a completed image download to Telegtam-Picture and marks it saved', async () => {
  const data = {}; const storage = { get: vi.fn(async (key) => ({ [key]: data[key] })), set: vi.fn(async (value) => Object.assign(data, value)) };
  const ensureFolder = vi.fn(async (name) => ({ id: name })); const importLocalItem = vi.fn(); const sendToTab = vi.fn();
  const controller = createTelegramEagleController({ storage, ensureFolder, importLocalItem, sendToTab, removeDownloadFile: vi.fn() });
  await controller.register({ requestId: 'r1', tabId: 4, record: { key: 'telegram:-1:7:image', kind: 'image' }, filename: 'TelegramEagle/r1-7.jpg' });
  await controller.onDownloadChanged({ state: { current: 'complete' } }, { id: 12, filename: 'C:\\Downloads\\TelegramEagle\\r1-7.jpg' });
  expect(ensureFolder).toHaveBeenCalledWith('Telegtam-Picture');
  expect(importLocalItem).toHaveBeenCalledWith(expect.objectContaining({ key: 'telegram:-1:7:image' }), 'C:\\Downloads\\TelegramEagle\\r1-7.jpg', 'Telegtam-Picture');
  expect(data['telegramEagle:saved']).toHaveProperty('telegram:-1:7:image');
});

it('keeps the complete UUID when matching a finished Telegram download', async () => {
  const data = {}; const storage = { get: vi.fn(async (key) => ({ [key]: data[key] })), set: vi.fn(async (value) => Object.assign(data, value)) };
  const importLocalItem = vi.fn(); const scheduleRemoveDownloadFile = vi.fn(); const controller = createTelegramEagleController({ storage, ensureFolder: vi.fn(async () => ({ id: 'folder' })), importLocalItem, sendToTab: vi.fn(), removeDownloadFile: vi.fn(), scheduleRemoveDownloadFile });
  const requestId = 'd7c2e6f1-48af-4b5d-91ef-123456789abc';
  await controller.register({ requestId, tabId: 4, record: { key: 'telegram:-1:7:video', kind: 'video' }, filename: `TelegramEagle_${requestId}_7.mp4` });
  await controller.onDownloadChanged({ state: { current: 'complete' } }, { id: 12, filename: `C:\\Downloads\\TelegramEagle_${requestId}_7.mp4` });
  expect(importLocalItem).toHaveBeenCalledOnce();
});

it('matches a completed download by its source URL when Chrome rewrites its filename', async () => {
  const data = {}; const storage = { get: vi.fn(async (key) => ({ [key]: data[key] })), set: vi.fn(async (value) => Object.assign(data, value)) };
  const importLocalItem = vi.fn(); const controller = createTelegramEagleController({ storage, ensureFolder: vi.fn(async () => ({ id: 'folder' })), importLocalItem, sendToTab: vi.fn(), removeDownloadFile: vi.fn() });
  await controller.register({ requestId: 'r-url', tabId: 4, record: { key: 'telegram:-1:8:image', kind: 'image', source: 'blob:https://web.telegram.org/image' }, filename: 'TelegramEagle_r-url_8.jpg' });
  await controller.onDownloadChanged({ state: { current: 'complete' } }, { id: 13, filename: 'C:\\Downloads\\renamed-file.jpg', url: 'blob:https://web.telegram.org/image' });
  expect(importLocalItem).toHaveBeenCalledOnce();
});

it('matches a normal direct download by the browser download ID when Telegram keeps its original filename', async () => {
  const data = {}; const storage = { get: vi.fn(async (key) => ({ [key]: data[key] })), set: vi.fn(async (value) => Object.assign(data, value)) };
  const importLocalItem = vi.fn(); const controller = createTelegramEagleController({ storage, ensureFolder: vi.fn(async () => ({ id: 'folder' })), importLocalItem, sendToTab: vi.fn(), removeDownloadFile: vi.fn() });
  await controller.register({ requestId: 'direct-1', tabId: 4, record: { key: 'telegram:-1:9:video', kind: 'video', source: 'https://web.telegram.org/k/stream/video' }, filename: 'TelegramEagle_direct-1_9.mp4' });
  await controller.assignDownloadId('direct-1', 27);
  await controller.onDownloadChanged({ state: { current: 'complete' } }, { id: 27, filename: 'C:\\Downloads\\Telegram original name.mp4', url: 'https://web.telegram.org/k/stream/video?range=0-99' });
  expect(importLocalItem).toHaveBeenCalledWith(expect.objectContaining({ key: 'telegram:-1:9:video' }), 'C:\\Downloads\\Telegram original name.mp4', 'folder');
});

it('routes a Telegram native player download to the pending Eagle save', async () => {
  const data = {}; const storage = { get: vi.fn(async (key) => ({ [key]: data[key] })), set: vi.fn(async (value) => Object.assign(data, value)) };
  const importLocalItem = vi.fn(); const scheduleRemoveDownloadFile = vi.fn(); const controller = createTelegramEagleController({ storage, ensureFolder: vi.fn(async () => ({ id: 'folder' })), importLocalItem, sendToTab: vi.fn(), removeDownloadFile: vi.fn(), scheduleRemoveDownloadFile });
  await controller.register({ requestId: 'native-1', tabId: 4, native: true, record: { key: 'telegram:viewer:1:video', kind: 'video' }, filename: null });
  await controller.onDownloadCreated({ id: 14 });
  await controller.onDownloadChanged({ state: { current: 'complete' } }, { id: 14, filename: 'C:\\Downloads\\telegram-video.mp4' });
  expect(importLocalItem).toHaveBeenCalledWith(expect.anything(), 'C:\\Downloads\\telegram-video.mp4', 'folder');
  expect(scheduleRemoveDownloadFile).toHaveBeenCalledWith(14);
});

it('releases a native save that never starts downloading', async () => {
  const data = {}; const storage = { get: vi.fn(async (key) => ({ [key]: data[key] })), set: vi.fn(async (value) => Object.assign(data, value)) };
  const sendToTab = vi.fn(); const controller = createTelegramEagleController({ storage, ensureFolder: vi.fn(), importLocalItem: vi.fn(), sendToTab, removeDownloadFile: vi.fn() });
  await controller.register({ requestId: 'protected-1', tabId: 4, native: true, record: { key: 'telegram:viewer:protected:video', kind: 'video' }, filename: null });
  await controller.expireNativeDownload('protected-1');
  expect(sendToTab).toHaveBeenCalledWith(4, expect.objectContaining({ type: 'TELEGRAM_SAVE_STATE', state: 'failed' }));
});
