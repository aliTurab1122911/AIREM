import { useCallback, useEffect, useState } from "react";
import { api } from "../../lib/api";
import type { AccountDashboard } from "./types";

export function useDashboard() {
  const [data, setData] = useState<AccountDashboard | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await api.accountDashboard());
    } catch (error) {
      setError(
        error instanceof Error ? error : new Error("Unable to load dashboard"),
      );
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  return { data, error, loading, refresh: load };
}

// Independent hooks let reports and notification surfaces avoid fetching unrelated data.
export const useUsageHistory = () =>
  useAccountResource("usageHistory", api.usageHistory);
export const useNotifications = () =>
  useAccountResource("notifications", api.notifications);
function useAccountResource<K extends "usageHistory" | "notifications">(
  key: K,
  fetcher: () => Promise<AccountDashboard[K]>,
) {
  const [data, setData] = useState<AccountDashboard[K] | null>(null);
  useEffect(() => {
    let active = true;
    void fetcher().then((value) => {
      if (active) setData(value);
    });
    return () => {
      active = false;
    };
  }, [fetcher]);
  return data;
}
