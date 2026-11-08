import { vi } from "vitest";

// The app's server modules mark themselves with "server-only"; outside Next it is just a marker.
vi.mock("server-only", () => ({}));
