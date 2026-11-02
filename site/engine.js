// A small client for the worker: requests carry ids, an old answer can never be mistaken for a new one,
// and cancelling is "throw the worker away and start another", which is the only way to stop Python mid-call.
// Trusted Types: a worker can only be started from a script URL that went through a policy. This one accepts nothing but the
// blob: URL this file makes from the page's own worker.js, so no other script can be started from here.
const workerPolicy = window.trustedTypes ? window.trustedTypes.createPolicy("b90-worker", { createScriptURL: (u) => { if (!/^blob:/.test(u)) throw new TypeError("only blob URLs may start the engine"); return u; } }) : null;

export class Engine {
  constructor(onStatus = () => {}) {
    this.onStatus = onStatus;
    this.pending = new Map();
    this.seq = 0;
    this.version = "";
    this.ready = null;
  }

  async start() {
    const base = new URL("./", location.href).href;
    const src = (await (await fetch("./worker.js")).text()).replaceAll("__BASE__", base);
    const url = URL.createObjectURL(new Blob([src], { type: "text/javascript" }));
    this.worker = new Worker(workerPolicy ? workerPolicy.createScriptURL(url) : url, { type: "module" });
    this.worker.onmessage = ({ data }) => {
      if (data.type === "status") return this.onStatus(data.text);
      const p = this.pending.get(data.id);
      if (!p) return;                                  // a request that was cancelled: its answer is dropped
      this.pending.delete(data.id);
      data.ok ? p.resolve(data.result) : p.reject(new Error(data.error));
    };
    this.broken = false;
    const crashed = (e) => { this.broken = true; this.#failAll(new Error((e && e.message) || "The engine stopped.")); };
    this.worker.onerror = crashed;
    this.worker.onmessageerror = crashed;
    this.ready = this.call("init").then((v) => (this.version = v));
    this.ready.catch(() => {});                          // a failed start is reported to whoever asked, not as an unhandled rejection
    return this.ready;
  }

  async call(op, args) {
    if (op !== "init") {
      if (this.broken && !this.restarting) {           // a crashed engine is replaced by the next request, once
        this.worker.terminate();
        this.restarting = this.start().finally(() => { this.restarting = null; });
      }
      await (this.restarting || this.ready);             // a request made while the engine restarts waits for it
    }
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ id, op, args });
    });
  }

  async json(op, args) {
    return JSON.parse(await this.call(op, args));
  }

  #failAll(err) {
    for (const p of this.pending.values()) p.reject(err);
    this.pending.clear();
  }

  /** Stop whatever is running. Pending calls fail with a Cancelled error; a fresh engine is started. */
  async cancel() {
    this.worker.terminate();
    const err = new Error("Cancelled");
    err.cancelled = true;
    this.#failAll(err);
    return this.start();
  }
}
