"use client";

import { useEffect } from "react";
import { useStdbActions } from "@/lib/stdb";
import { flush, setTelemetrySink } from "./client";

/** Inside the SpacetimeDB provider: hands the usage counters a way to reach the module. */
export function TelemetryBridge() {
  const { trackActivity } = useStdbActions();
  useEffect(() => {
    setTelemetrySink(trackActivity);
    return () => {
      flush();
      setTelemetrySink(null);
    };
  }, [trackActivity]);
  return null;
}
