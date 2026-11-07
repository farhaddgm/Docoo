import type { LiveScreenInstruction } from '@docoo/contracts';
import { describe, expect, it, vi } from 'vitest';

import { createScreenBus, formPath, planScreen, screenOfResult, screenPath } from './screen';
import { filledFields } from './screen-forms';

const ID = '11111111-1111-4111-8111-111111111111';

function bus(pathname = '/fa/costs') {
  const pushed: string[] = [];
  const highlighted: unknown[] = [];
  const instance = createScreenBus({
    push: (href) => pushed.push(href),
    pathname: () => pathname,
    locale: () => 'fa',
    highlight: (target) => highlighted.push(target),
  });
  return { instance, pushed, highlighted };
}

describe('where a named page is', () => {
  it('maps each page name to a route of the application, in the owner’s language', () => {
    expect(screenPath('fa', { type: 'open', page: 'costs' })).toBe('/fa/costs');
    expect(screenPath('en', { type: 'open', page: 'new_project' })).toBe('/en/projects/new');
    expect(screenPath('fa', { type: 'open', page: 'project', projectId: ID })).toBe(
      `/fa/projects/${ID}`,
    );
    expect(
      screenPath('fa', { type: 'open', page: 'project', projectId: ID, tab: 'workflow' }),
    ).toBe(`/fa/projects/${ID}?tab=workflow`);
    expect(formPath('en')).toBe('/en/projects/new');
  });
});

describe('what a finished call carries for the screen', () => {
  it('takes a valid instruction and nothing else', () => {
    expect(screenOfResult({ screen: { type: 'open', page: 'costs' }, shown: 'x' })).toEqual({
      type: 'open',
      page: 'costs',
    });
    for (const bad of [
      null,
      'x',
      {},
      { screen: null },
      { screen: { type: 'open', page: '/admin/users' } },
      { screen: { type: 'open', page: 'https://evil.example' } },
      { screen: { type: 'fill', form: 'settings', values: { title: 'x' } } },
      { screen: { type: 'fill', form: 'new_project', values: { connectionId: ID } } },
    ]) {
      expect(screenOfResult(bad), JSON.stringify(bad)).toBeNull();
    }
  });
});

describe('the order things are shown in', () => {
  const fill: LiveScreenInstruction = { type: 'fill', form: 'new_project', values: { title: 'a' } };
  const open: LiveScreenInstruction = { type: 'open', page: 'costs' };

  it('keeps a draft in front of the owner: a page opened after it is dropped', () => {
    expect(planScreen([open, fill, open])).toEqual([open, fill]);
    expect(planScreen([fill, open, open])).toEqual([fill]);
  });

  it('leaves a list with no draft as it is', () => {
    expect(planScreen([open, open])).toEqual([open, open]);
    expect(planScreen([])).toEqual([]);
  });
});

describe('opening and filling', () => {
  it('opens a page through the router and marks where the owner landed', () => {
    const { instance, pushed, highlighted } = bus();
    instance.apply([{ type: 'open', page: 'knowledge' }]);
    expect(pushed).toEqual(['/fa/knowledge']);
    expect(highlighted).toEqual([{ main: true }]);
  });

  it('puts a draft straight into a form that is on the screen, without moving', () => {
    const { instance, pushed } = bus('/fa/projects/new');
    const handler = vi.fn();
    instance.registerForm('new_project', handler);
    instance.apply([{ type: 'fill', form: 'new_project', values: { title: 'Spring plan' } }]);
    expect(handler).toHaveBeenCalledWith({ title: 'Spring plan' });
    expect(pushed).toEqual([]);
  });

  it('goes to the form first when it is not on the screen, and hands the draft over when it appears', () => {
    const { instance, pushed } = bus('/fa/costs');
    instance.apply([{ type: 'fill', form: 'new_project', values: { title: 'Spring plan' } }]);
    expect(pushed).toEqual(['/fa/projects/new']);
    expect(instance.waiting('new_project')).toEqual({ title: 'Spring plan' });
    const handler = vi.fn();
    instance.registerForm('new_project', handler);
    expect(handler).toHaveBeenCalledWith({ title: 'Spring plan' });
    expect(instance.waiting('new_project')).toBeUndefined();
  });

  it('merges two drafts that wait for the same form, the later value winning', () => {
    const { instance } = bus('/fa/costs');
    instance.apply([{ type: 'fill', form: 'new_project', values: { title: 'A', code: 'one' } }]);
    instance.apply([{ type: 'fill', form: 'new_project', values: { title: 'B' } }]);
    expect(instance.waiting('new_project')).toEqual({ title: 'B', code: 'one' });
  });

  it('does not go to the form again if it is already on its page but not ready yet', () => {
    const { instance, pushed } = bus('/fa/projects/new');
    instance.apply([{ type: 'fill', form: 'new_project', values: { title: 'A' } }]);
    expect(pushed).toEqual([]);
    const handler = vi.fn();
    instance.registerForm('new_project', handler);
    expect(handler).toHaveBeenCalledWith({ title: 'A' });
  });

  it('stops handing drafts to a form that has left the screen', () => {
    const { instance, pushed } = bus('/fa/costs');
    const handler = vi.fn();
    const leave = instance.registerForm('new_project', handler);
    leave();
    instance.apply([{ type: 'fill', form: 'new_project', values: { title: 'A' } }]);
    expect(handler).not.toHaveBeenCalled();
    expect(pushed).toEqual(['/fa/projects/new']);
  });
});

describe('which fields a draft filled', () => {
  it('lists them in fill order, the title first', () => {
    expect(filledFields({ outputLanguage: 'fa', initialProblem: 'p', title: 't' })).toEqual([
      'title',
      'initialProblem',
      'outputLanguage',
    ]);
    expect(filledFields({})).toEqual([]);
  });
});
