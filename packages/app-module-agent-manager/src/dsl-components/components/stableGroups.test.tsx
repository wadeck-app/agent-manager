import { render } from '@testing-library/react';
import { UrlParamContext, type UrlParamService } from '@wadeck-app/dsl-ui';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { row } from '../logic/fixtures.js';
import type { CustomGroupDto } from '../shared.js';
import * as useCustomGroupsModule from '../workspace/useCustomGroups.js';
import { AgentWorkspace } from './AgentWorkspace.js';

afterEach(() => vi.restoreAllMocks());

const service: UrlParamService = { get: () => null, set: () => undefined };

describe('AgentWorkspace and the custom groups', () => {
  it('passes the groups through unchanged: a parent re-render does not give the hook a new array (no re-run of the server layout effect)', () => {
    const seen: (readonly CustomGroupDto[])[] = [];
    const actual = useCustomGroupsModule.useCustomGroups;
    vi.spyOn(useCustomGroupsModule, 'useCustomGroups').mockImplementation((rows, groups, send) => {
      seen.push(groups);
      return actual(rows, groups, send);
    });
    const sessions = [row()];
    // No groups given (a page whose source has none yet): the default must be one stable array
    // A new element each time: a parent re-render, not a React bail-out on the same element
    const ui = (): React.ReactElement => (
      <UrlParamContext.Provider value={service}>
        <AgentWorkspace sessions={sessions} />
      </UrlParamContext.Provider>
    );
    const { rerender } = render(ui());
    rerender(ui());
    rerender(ui());
    expect(seen.length).toBeGreaterThanOrEqual(3);
    expect(new Set(seen).size).toBe(1);
    // Groups given by the page are passed as they are
    const groups: CustomGroupDto[] = [{ id: 'g', name: 'G', color: null, collapsed: false, order: 0, sort: 'manual', bodyColor: null }];
    seen.length = 0;
    const withGroups = (): React.ReactElement => (
      <UrlParamContext.Provider value={service}>
        <AgentWorkspace sessions={sessions} customGroups={groups} />
      </UrlParamContext.Provider>
    );
    const second = render(withGroups());
    second.rerender(withGroups());
    expect(new Set(seen)).toEqual(new Set([groups]));
  });
});
