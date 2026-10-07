import { Container, getContainer } from '@cloudflare/containers';
import { containerEnv, type WorkerEnv } from './container-env.ts';
import { withoutTargetPort } from './forward.ts';

interface Env extends WorkerEnv {
  TRACKER: DurableObjectNamespace<TrackerContainer>;
}

/**
 * One tracker process. A single Durable Object id ("main") means at most one container at a time — the single
 * writer Litestream requires. An open live-update stream counts as activity and keeps it awake.
 */
export class TrackerContainer extends Container<Env> {
  override defaultPort = 3000;
  override sleepAfter = '30m';
  // The class requests `http://<pingEndpoint>`, so this is host "container" plus path "/healthz".
  override pingEndpoint = 'container/healthz';

  constructor(ctx: ConstructorParameters<typeof Container>[0], env: Env) {
    super(ctx, env);
    this.envVars = containerEnv(env);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return getContainer(env.TRACKER, 'main').fetch(withoutTargetPort(request));
  },
} satisfies ExportedHandler<Env>;
