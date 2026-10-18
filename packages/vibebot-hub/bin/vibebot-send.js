#!/usr/bin/env node
import { main } from "../src/send.js";

await main(process.argv.slice(2));
