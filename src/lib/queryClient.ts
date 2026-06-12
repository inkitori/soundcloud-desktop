import { QueryClient } from "@tanstack/react-query";

/** Shared so stores/modals can invalidate queries outside React components. */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
    },
  },
});
