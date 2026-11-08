/** Spaces calls so a shared free-tier key (about 40 requests a minute) is not hit by several jobs at once. */
export class RateGate {
  private nextAt = 0;

  constructor(
    private readonly perMinute: number,
    private readonly now: () => number = Date.now,
    private readonly sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  ) {}

  async wait(): Promise<void> {
    if (this.perMinute <= 0) return;
    const gap = 60_000 / this.perMinute;
    const start = Math.max(this.now(), this.nextAt);
    this.nextAt = start + gap;
    const delay = start - this.now();
    if (delay > 0) await this.sleep(delay);
  }
}
