import { expect, it } from 'vitest';
import { telegramDownloadFilename, telegramEagleItem, telegramMediaKey } from '../src/shared/telegram-media.js';

it('uses Telegram peer, message and type for a stable per-media saved key', () => {
  expect(telegramMediaKey({ peerId: '-10042', messageId: '77', kind: 'image' }))
    .toBe('telegram:-10042:77:image');
});

it('uses an unambiguous temporary browser filename', () => {
  expect(telegramDownloadFilename({ messageId: '77', extension: 'mp4' }, 'request-1'))
    .toBe('TelegramEagle_request-1_77.mp4');
});

it('adds Telegram metadata without an X tag or tweet URL', () => {
  expect(telegramEagleItem({ peerId: '-10042', messageId: '77', kind: 'video', filename: '77.mp4', chatName: 'Example' }, 'C:\\Downloads\\77.mp4'))
    .toMatchObject({ tags: ['Telegram', '视频', 'Example'], annotation: 'Telegram 消息 ID：77' });
});
