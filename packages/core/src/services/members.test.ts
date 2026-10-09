import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testDialect } from '@poietic-tech/issues-db/testing';
import { addMember, listMembers, removeMember, updateMember } from './members.ts';
import { createProject, getProject, updateProject } from './projects.ts';
import { listEvents } from './events.ts';
import { createTestContext, grant, type TestContext } from '../testing.ts';

describe(`project members (${testDialect()})`, () => {
  let t: TestContext;
  beforeAll(async () => {
    t = await createTestContext();
    await createProject(t.ctx, { key: 'ENG', name: 'Eng' });
  });
  afterAll(() => t.destroy());

  it('lets admins and managers manage members, with events', async () => {
    const m = await addMember(t.ctx, 'ENG', { user: '@member', role: 'viewer' });
    expect(m).toMatchObject({ user: { handle: 'member' }, role: 'viewer' });
    await expect(
      addMember(t.ctx, 'ENG', { user: '@member', role: 'editor' }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(
      addMember(t.member, 'ENG', { user: '@bot', role: 'viewer' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await updateMember(t.ctx, 'ENG', '@member', { role: 'manager' });
    await addMember(t.member, 'ENG', { user: '@bot', role: 'editor' });
    expect((await listMembers(t.member, 'ENG')).map((x) => [x.user.handle, x.role])).toEqual([
      ['bot', 'editor'],
      ['member', 'manager'],
    ]);
    await removeMember(t.member, 'ENG', '@bot');
    const types = (
      await listEvents(t.ctx, {
        types: ['project.member_added', 'project.member_changed', 'project.member_removed'],
      })
    ).data.map((e) => e.type);
    expect(types).toEqual([
      'project.member_added',
      'project.member_changed',
      'project.member_added',
      'project.member_removed',
    ]);
  });

  it('reports myAccess and lets only managers change visibility', async () => {
    expect((await getProject(t.member, 'ENG')).myAccess).toBe('manage');
    await grant(t, 'ENG', t.agent, 'editor');
    await expect(updateProject(t.agent, 'ENG', { visibility: 'public' })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect((await updateProject(t.member, 'ENG', { visibility: 'public' })).visibility).toBe(
      'public',
    );
  });
});
