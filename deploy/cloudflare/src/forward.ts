/**
 * @cloudflare/containers' Container.fetch routes to the port named in the `cf-container-target-port` header when it is
 * present. That header is meant for the Worker's own switchPort(), so a client-supplied one is dropped: the tracker is
 * only reachable on the container's default port.
 */
export const TARGET_PORT_HEADER = 'cf-container-target-port';

export function withoutTargetPort(request: Request): Request {
  if (!request.headers.has(TARGET_PORT_HEADER)) return request;
  const headers = new Headers(request.headers);
  headers.delete(TARGET_PORT_HEADER);
  return new Request(request, { headers });
}
