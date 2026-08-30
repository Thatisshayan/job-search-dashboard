import { trpc } from "@/lib/trpc";

/**
 * `dashboard.accessStatus` is a protectedProcedure, so an anonymous public visitor's
 * call rejects with UNAUTHORIZED rather than resolving `{ isOwner: false }`. Treat any
 * error the same as "not the owner" instead of surfacing it — this dashboard is public
 * by design and most visitors are expected to hit this path.
 */
export function useIsOwner() {
  const query = trpc.dashboard.accessStatus.useQuery(undefined, {
    retry: false,
  });
  return { isOwner: query.data?.isOwner ?? false, isLoading: query.isLoading };
}
