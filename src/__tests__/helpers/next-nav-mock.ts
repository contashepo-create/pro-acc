/** Mock for next/navigation used by UI tests. */

const router = {
  push: jest.fn(),
  replace: jest.fn(),
  prefetch: jest.fn(),
  back: jest.fn(),
  forward: jest.fn(),
  refresh: jest.fn(),
};

export function useRouter() {
  return router;
}

/** Shared router instance so tests can assert on the same mock the component used. */
export const __router = router;

export function usePathname() {
  return '/dashboard';
}

export function useSearchParams() {
  return new URLSearchParams();
}

export function useParams() {
  return {};
}

export function redirect() {
  throw new Error('redirect() called in test');
}
