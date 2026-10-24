// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';
import { mountPopup } from '../src/popup/popup.js';

beforeEach(() => {
  document.body.innerHTML = '<input id="replies" type="checkbox"><input id="reposts" type="checkbox"><button id="start"></button><button id="stop"></button><button id="download"></button><button id="retry"></button><output id="status"></output>';
});

it('starts collection with selected filters', async () => {
  const sendMessage = vi.fn().mockResolvedValue({ total: 0, pending: 0 });
  mountPopup({ sendMessage, getProfile: async () => 'alice' });
  document.querySelector('#replies').checked = true;
  document.querySelector('#start').click();
  await Promise.resolve();
  expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'START_COLLECTION', username: 'alice', options: expect.objectContaining({ includeReplies: true }) }));
});
