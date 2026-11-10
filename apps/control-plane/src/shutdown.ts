/** Runs `handler` on every SIGTERM or SIGINT. The handler stays installed: `deploy/control-plane/local-process.sh`
 * repeats a stop while a worker finishes a long operation, and a second signal must find the handler
 * again, not the default action that would end the process in the middle of that operation. */
export function onShutdownSignal(handler: () => void): void {
  process.on('SIGTERM', handler)
  process.on('SIGINT', handler)
}
