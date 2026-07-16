// Thin lifecycle-safe wrapper around chrome.debugger (CDP). One session per
// tab; only one debugger client can attach to a tab, so attach failures are
// surfaced with actionable messages (the usual culprit is an open DevTools).

export class CdpError extends Error {}

export interface CdpEvent {
  method: string;
  params: Record<string, unknown>;
}

export class CdpSession {
  readonly tabId: number;
  private isAttached = false;
  private eventListeners = new Set<(event: CdpEvent) => void>();
  private detachListeners = new Set<(reason: string) => void>();

  constructor(tabId: number) {
    this.tabId = tabId;
  }

  get attached(): boolean {
    return this.isAttached;
  }

  private handleEvent = (
    source: chrome.debugger.Debuggee,
    method: string,
    params?: object,
  ): void => {
    if (source.tabId !== this.tabId) return;
    const event: CdpEvent = { method, params: (params ?? {}) as Record<string, unknown> };
    for (const listener of this.eventListeners) listener(event);
  };

  private handleDetach = (source: chrome.debugger.Debuggee, reason: string): void => {
    if (source.tabId !== this.tabId) return;
    this.isAttached = false;
    this.removeChromeListeners();
    for (const listener of this.detachListeners) listener(reason);
  };

  async attach(): Promise<void> {
    try {
      await chrome.debugger.attach({ tabId: this.tabId }, "1.3");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (/already attached/i.test(message)) {
        throw new CdpError(
          "Another debugger is already attached to this tab. " +
            "Close DevTools (or any other automation tool) on the target tab and run again.",
        );
      }
      throw new CdpError(`Could not attach to the target tab: ${message}`);
    }
    this.isAttached = true;
    chrome.debugger.onEvent.addListener(this.handleEvent);
    chrome.debugger.onDetach.addListener(this.handleDetach);
    await this.send("Page.enable");
    await this.send("Runtime.enable");
  }

  async detach(): Promise<void> {
    this.removeChromeListeners();
    if (!this.isAttached) return;
    this.isAttached = false;
    try {
      await chrome.debugger.detach({ tabId: this.tabId });
    } catch {
      // Tab already closed or Chrome already detached us — nothing to leak.
    }
  }

  send<T = Record<string, unknown>>(
    method: string,
    params?: Record<string, unknown>,
  ): Promise<T> {
    if (!this.isAttached) {
      return Promise.reject(new CdpError("Debugger session is not attached"));
    }
    return chrome.debugger.sendCommand({ tabId: this.tabId }, method, params) as Promise<T>;
  }

  onCdpEvent(listener: (event: CdpEvent) => void): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  onDetached(listener: (reason: string) => void): () => void {
    this.detachListeners.add(listener);
    return () => this.detachListeners.delete(listener);
  }

  waitForEvent(method: string, timeoutMs: number): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        offEvent();
        offDetach();
      };
      const offEvent = this.onCdpEvent((event) => {
        if (event.method !== method) return;
        cleanup();
        resolve(event.params);
      });
      const offDetach = this.onDetached(() => {
        cleanup();
        reject(new CdpError(`Debugger detached while waiting for ${method}`));
      });
      const timer = setTimeout(() => {
        cleanup();
        reject(new CdpError(`Timed out after ${timeoutMs}ms waiting for ${method}`));
      }, timeoutMs);
    });
  }

  private removeChromeListeners(): void {
    chrome.debugger.onEvent.removeListener(this.handleEvent);
    chrome.debugger.onDetach.removeListener(this.handleDetach);
  }
}
