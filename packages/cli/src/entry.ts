#!/usr/bin/env node
// The published `decide` entry. Turning on the compile cache must happen before
// the CLI's modules load, so the CLI itself is imported dynamically.
import module from "node:module"

module.enableCompileCache?.()
await import("./bin.js")
