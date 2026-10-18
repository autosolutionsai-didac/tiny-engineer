#!/usr/bin/env node
import { run } from "../src/cli-hub.js";

await run(process.argv.slice(2));
