type DeviceDetails = {
  adapterInfo?: { vendor?: string; architecture?: string };
  limits?: { maxBufferSize?: number; maxStorageBufferBindingSize?: number };
  lost: Promise<{ reason: string; message: string }>;
  addEventListener(type: 'uncapturederror', listener: (event: { error: { message: string } }) => void): void;
};

// Session-only diagnostics: never include prompts or send these to a server.
export class GpuDiagnostics {
  stage = 'loading';
  private loss = '';
  private validation = '';
  private hardware = '';
  constructor(private profile: string, private dtype: string, private runtime: string) {}

  observe(value: unknown) {
    if (!value || typeof value !== 'object') return;
    const device = value as DeviceDetails;
    if (typeof device.lost?.then !== 'function' || typeof device.addEventListener !== 'function') return;
    const info = device.adapterInfo, limits = device.limits;
    this.hardware = `adapter=${info?.vendor || 'unknown'}/${info?.architecture || 'unknown'}; maxBuffer=${limits?.maxBufferSize ?? 'unknown'}; maxBinding=${limits?.maxStorageBufferBindingSize ?? 'unknown'}`;
    void device.lost.then(info => { this.loss = `${info.reason}: ${info.message}`; });
    device.addEventListener('uncapturederror', event => {
      const kind = event.error.constructor.name;
      this.validation = `${kind === 'Object' ? '' : kind + ': '}${event.error.message}`.slice(0, 1200);
    });
  }

  assertAvailable() {
    if (this.loss) throw new Error('The WebGPU device was lost. Reload Lunumi before retrying.');
  }

  describe(error: unknown) {
    const message = error instanceof Error ? error.message : 'WebGPU inference failed on this device.';
    return `${message}\nGPU details: profile=${this.profile}; export=${this.dtype}; runtime=${this.runtime}; stage=${this.stage}; ${this.hardware || 'device not available'}; deviceLost=${this.loss || 'not reported'}; validation=${this.validation || 'not reported'}`;
  }
}
