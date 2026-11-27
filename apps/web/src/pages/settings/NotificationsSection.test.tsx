import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Notification, NotificationSettings } from '@whiteboard/core';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { describeNotification } from '../../lib/notificationText';
import { mockHost, OWNER, renderApp } from '../../test/render';
import { server } from '../../test/setup';

describe('notification settings', () => {
  it('shows every kind on, and saves a kind turned off and the daily summary turned on', async () => {
    mockHost({}, OWNER);
    let current: NotificationSettings = { muted: [], dailySummary: false };
    const sent: NotificationSettings[] = [];
    server.use(
      http.get('*/me/notification-settings', () => HttpResponse.json(current)),
      http.put('*/me/notification-settings', async ({ request }) => {
        current = (await request.json()) as NotificationSettings;
        sent.push(current);
        return HttpResponse.json(current);
      }),
    );
    const user = userEvent.setup();
    renderApp('/settings/notifications', 'tok');

    const comments = await screen.findByRole('checkbox', {
      name: 'Someone comments on my tasks',
    });
    expect(comments).toBeChecked();
    await user.click(comments);
    await waitFor(() => expect(comments).not.toBeChecked());
    expect(sent[0]).toEqual({ muted: ['commented'], dailySummary: false });

    const summary = screen.getByRole('checkbox', { name: /Each morning from 08:00/ });
    await user.click(summary);
    await waitFor(() => expect(summary).toBeChecked());
    expect(sent[1]).toEqual({ muted: ['commented'], dailySummary: true });
  });

  it('words the daily summary in the bell', () => {
    const n = {
      kind: 'daily_summary',
      projectName: 'Brand',
      detail: '2 overdue, 1 due today',
      taskTitle: null,
      actorName: null,
    } as Notification;
    expect(describeNotification(n)).toBe('Today in Brand: 2 overdue, 1 due today');
  });
});
