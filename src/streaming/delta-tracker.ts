export class DeltaTracker {
  private lastText = "";
  private lastThinking = "";

  nextText(value: string): string {
    const delta = this.diff(this.lastText, value);
    this.lastText = value;
    return delta;
  }

  nextThinking(value: string): string {
    const delta = this.diff(this.lastThinking, value);
    this.lastThinking = value;
    return delta;
  }

  reset(): void {
    this.lastText = "";
    this.lastThinking = "";
  }

  private diff(previous: string, current: string): string {
    if (!previous) {
      return current;
    }

    if (current.startsWith(previous)) {
      return current.slice(previous.length);
    }

    return current;
  }
}
