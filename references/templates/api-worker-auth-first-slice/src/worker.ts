import { createFetchHandler, createRuntimeStore } from "./runtime";
import type { Env } from "./types/env";

let cachedDatabaseUrl: string | null = null;
let cachedStore: ReturnType<typeof createRuntimeStore> | null = null;

function getStore(env: Env): ReturnType<typeof createRuntimeStore> {
  if (cachedStore && cachedDatabaseUrl === env.CONTROL_PLANE_DATABASE_URL) {
    return cachedStore;
  }

  cachedDatabaseUrl = env.CONTROL_PLANE_DATABASE_URL;
  cachedStore = createRuntimeStore(env);

  return cachedStore;
}

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return createFetchHandler({
      env,
      store: getStore(env),
    })(request);
  },
};
