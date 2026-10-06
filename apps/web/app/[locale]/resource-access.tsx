'use client';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
export const ResourceAccessContext = createContext(false);
export function useReadOnlyAccess() {
  return useContext(ResourceAccessContext);
}
export function ProjectAccessBoundary({
  projectId,
  workspaceId: providedWorkspaceId,
  children,
}: {
  projectId: string;
  workspaceId?: string;
  children: ReactNode;
}) {
  const params = useSearchParams();
  const pathname = usePathname();
  const workspaceId = providedWorkspaceId ?? params.get('workspaceId');
  const [access, setAccess] = useState<'VIEW' | 'EDIT' | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/auth/session', { cache: 'no-store', signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error('Session unavailable');
        const identity = (await response.json()) as {
          user: { role: string };
          workspaces: { id: string }[];
        };
        if (identity.user.role === 'super_admin') return 'EDIT' as const;
        const selectedWorkspace = workspaceId ?? identity.workspaces[0]?.id;
        if (!selectedWorkspace) return null;
        const r = await fetch(
          `/api/auth/access?workspaceId=${encodeURIComponent(selectedWorkspace)}&projectId=${encodeURIComponent(projectId)}`,
          { cache: 'no-store', signal: controller.signal },
        );
        if (!r.ok) return null;
        const result = (await r.json()) as { access: 'VIEW' | 'EDIT' | null };
        return result.access;
      })
      .then((value) => {
        if (!controller.signal.aborted) setAccess(value);
      })
      .catch(() => {
        if (!controller.signal.aborted) setAccess(null);
      });
    return () => controller.abort();
  }, [workspaceId, projectId, pathname]);
  return (
    <ResourceAccessContext.Provider value={access !== 'EDIT'}>
      {access === 'VIEW' && (
        <p className="notice resource-read-only" role="status">
          {pathname.startsWith('/fa')
            ? 'دسترسی شما به این پروژه فقط مشاهده است.'
            : 'You have view-only access to this project.'}
        </p>
      )}
      {children}
    </ResourceAccessContext.Provider>
  );
}
