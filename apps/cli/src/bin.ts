#!/usr/bin/env node
import { processIO } from './io.ts';
import { run } from './main.ts';

process.exitCode = await run(process.argv.slice(2), processIO());
