// violations-suppress: ts/no-barrel-index app-core requires the backend entry of an app-module to be src/backend/index.ts (app-core-cli check)
import type { ModuleContext } from '@wadeck-app/app-core-sdk';
import { createRouteKit } from './routeKit.js';
import type { ModuleOptions } from './replyRoutes.js';
import { registerSessionsRoutes } from './sessionsRoutes.js';

/**
 * backendEntryPath target declared by app-core-cli: called once at module load with the module context.
 * Routes become /api/modules/agent-manager/<subPath> and are removed automatically on unload.
 * Fed by the Claude Code session registry and transcripts; replies go through the core ReplyService (socket transport). `options` is for tests: app-core passes only ctx.
 */
export default function (ctx: ModuleContext, options: ModuleOptions = {}): void {
  registerSessionsRoutes(createRouteKit(ctx), options);
}
