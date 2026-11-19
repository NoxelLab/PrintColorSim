import type { ErrorCode, Requests, Response } from './protocol';

export class EngineError extends Error {
  constructor(public code: ErrorCode) {
    super(code);
  }
}

const worker = new Worker(new URL('../worker/worker.ts', import.meta.url), { type: 'module' });
const pending = new Map<number, { resolve(result: unknown): void; reject(error: EngineError): void }>();
let sequence = 0;

worker.onmessage = ({ data }: MessageEvent<Response>) => {
  const request = pending.get(data.id);
  pending.delete(data.id);
  if (data.ok) request?.resolve(data.result);
  else request?.reject(new EngineError(data.error));
};
worker.onerror = () => {
  for (const request of pending.values()) request.reject(new EngineError('failed'));
  pending.clear();
};

export function call<K extends keyof Requests>(type: K, payload: Requests[K]['payload'], transfer: Transferable[] = []) {
  return new Promise<Requests[K]['result']>((resolve, reject) => {
    const id = ++sequence;
    pending.set(id, { resolve: resolve as (result: unknown) => void, reject });
    worker.postMessage({ id, type, ...payload }, transfer);
  });
}
