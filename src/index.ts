import app from "./app";
import type { AppBindings } from "./types";

export { RepositoryObject } from "./services/repository-object";

export default {
  fetch: app.fetch
} satisfies ExportedHandler<AppBindings>;
