'use client';

/**
 * Shared data-fetching hooks for dashboard pages, built on React Query
 * (which was installed and provider-wrapped but previously unused).
 *
 * Replaces the copy-pasted `useState + useEffect + fetchData()` pattern:
 *
 *   const { data, isLoading, error, refetch } = useApiList<Account[]>('/api/accounts');
 *
 * Benefits over the manual pattern: request de-duplication, cache reuse
 * across navigation, automatic refetch after invalidation, and unified
 * error handling.
 */

import {
  useQuery,
  useMutation,
  useQueryClient,
  type UseQueryOptions,
} from '@tanstack/react-query';
import { apiFetch } from '@/lib/api-client';

interface ApiEnvelope<T> {
  success: boolean;
  data?: T;
  message?: string;
}

export class ApiRequestError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
  }
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await apiFetch(url);
  let body: ApiEnvelope<T> | null = null;
  try {
    body = await res.json();
  } catch {
    /* non-JSON response */
  }
  if (!res.ok || !body?.success) {
    throw new ApiRequestError(body?.message || `فشل تحميل البيانات (${res.status})`, res.status);
  }
  return body.data as T;
}

/**
 * GET a tenant API list/detail endpoint with caching.
 * The query key is the URL, so pages sharing an endpoint share the cache.
 */
export function useApiList<T = unknown>(
  url: string | null,
  options?: Omit<UseQueryOptions<T, ApiRequestError>, 'queryKey' | 'queryFn'>
) {
  return useQuery<T, ApiRequestError>({
    queryKey: ['api', url],
    queryFn: () => fetchJson<T>(url as string),
    enabled: url !== null && (options?.enabled ?? true),
    staleTime: 30_000,
    retry: (failureCount, err) =>
      err.status >= 500 && failureCount < 2, // never retry 4xx
    ...options,
  });
}

/**
 * Mutation helper for POST/PUT/PATCH/DELETE with automatic list invalidation.
 *
 *   const createAccount = useApiMutation('/api/accounts', 'POST', { invalidate: ['/api/accounts'] });
 *   await createAccount.mutateAsync({ name: '...' });
 */
export function useApiMutation<TInput = unknown, TOutput = unknown>(
  url: string,
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE' = 'POST',
  opts?: { invalidate?: string[] }
) {
  const queryClient = useQueryClient();
  return useMutation<TOutput, ApiRequestError, TInput>({
    mutationFn: async (input: TInput) => {
      const res = await apiFetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: input === undefined ? undefined : JSON.stringify(input),
      });
      let body: ApiEnvelope<TOutput> | null = null;
      try {
        body = await res.json();
      } catch {
        /* non-JSON response */
      }
      if (!res.ok || !body?.success) {
        throw new ApiRequestError(body?.message || `فشل تنفيذ العملية (${res.status})`, res.status);
      }
      return body.data as TOutput;
    },
    onSuccess: () => {
      for (const key of opts?.invalidate ?? []) {
        queryClient.invalidateQueries({ queryKey: ['api', key] });
      }
    },
  });
}
