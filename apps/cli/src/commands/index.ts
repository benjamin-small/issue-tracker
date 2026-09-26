import type { Command } from 'commander';
import type { CliIO } from '../io.ts';
import {
  labelCommand,
  projectCommand,
  statusCommand,
  tokenCommand,
  userCommand,
  viewCommand,
} from './admin.ts';
import { commentCommand, eventCommand, linkCommand } from './collab.ts';
import { issueCommand } from './issues.ts';
import { fieldCommand } from './fields.ts';
import {
  apiCommand,
  authCommand,
  commandsCommand,
  dbCommand,
  initCommand,
  schemaCommand,
  serveCommand,
  whoamiCommand,
} from './system.ts';

/** Every top-level command, in help order. */
export function adminCommands(io: CliIO, program: () => Command): Command[] {
  return [
    issueCommand(io),
    commentCommand(io),
    linkCommand(io),
    projectCommand(io),
    statusCommand(io),
    labelCommand(io),
    fieldCommand(io),
    viewCommand(io),
    eventCommand(io),
    userCommand(io),
    tokenCommand(io),
    authCommand(io),
    whoamiCommand(io),
    initCommand(io),
    dbCommand(io),
    serveCommand(io),
    schemaCommand(io),
    apiCommand(io),
    commandsCommand(io, program),
  ];
}
