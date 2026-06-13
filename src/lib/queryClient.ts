import { QueryClient } from "@tanstack/react-query";
import type { AppError } from "../api/types";

/** Shared so stores/modals can invalidate queries outside React components. */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      // Always run the query (the Tauri invoke) rather than pausing while the
      // browser thinks we're offline — a fast network error then surfaces as an
      // error state the pages can render, instead of an endless spinner.
      networkMode: "offlineFirst",
      // Don't hammer retries when there's simply no connection.
      retry: (count, error) => {
        const code = (error as unknown as AppError)?.code;
        if (code === "network" || code === "not_logged_in") return false;
        return count < 2;
      },
    },
  },
});
