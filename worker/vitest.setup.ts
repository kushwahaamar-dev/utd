import { vi } from "vitest";

// The app's server modules mark themselves with "server-only"; outside Next it is just a marker.
vi.mock("server-only", () => ({}));

// Tests run without the free-tier spacing between model calls.
process.env.NEMOTRON_RPM = "0";
