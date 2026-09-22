import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import type { DecisionRequest, DecisionResponse } from "../model/types.js"

/**
 * Recorded answers, content-addressed so a fixture can only ever replay for the
 * exact request that produced it.
 *
 * Layout: `<dir>/<namespace>/<sha256>.json`, where namespace is a spec name or
 * `adhoc`. There is deliberately no fallback: a miss is a miss (decision 0010),
 * because an invented answer is indistinguishable from a real one downstream.
 */
export const FIXTURE_VERSION = 1

export interface FixtureRecord {
  v: typeof FIXTURE_VERSION
  key: string
  recordedAt: string
  request: DecisionRequest
  response: DecisionResponse
}

/**
 * The fixture key: sha256 of the canonical JSON of `{model, state, questions}`.
 *
 * `model` is the *requested* id, so upgrading the model misses the cache instead
 * of silently replaying the previous model's answers.
 */
export function fixtureKey(request: DecisionRequest): string {
  const { model, state, questions } = request
  return createHash("sha256").update(canonicalJson({ model, state, questions })).digest("hex")
}

/** JSON with object keys sorted at every depth, so key order never changes a hash. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value))
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys)
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((k) => [k, sortKeys((value as Record<string, unknown>)[k])]),
    )
  }
  return value
}

const NAMESPACE = /^[a-z0-9][a-z0-9._-]*$/

export class FixtureStore {
  constructor(readonly dir: string) {}

  path(namespace: string, key: string): string {
    if (!NAMESPACE.test(namespace)) {
      throw new Error(`Invalid fixture namespace "${namespace}" (lowercase letters, digits, . _ -)`)
    }
    return join(this.dir, namespace, `${key}.json`)
  }

  lookup(namespace: string, request: DecisionRequest): FixtureRecord | undefined {
    const file = this.path(namespace, fixtureKey(request))
    if (!existsSync(file)) return undefined
    const record = JSON.parse(readFileSync(file, "utf8")) as FixtureRecord
    return record.v === FIXTURE_VERSION ? record : undefined
  }

  record(
    namespace: string,
    request: DecisionRequest,
    response: DecisionResponse,
    now = new Date(),
  ): FixtureRecord {
    const key = fixtureKey(request)
    const record: FixtureRecord = {
      v: FIXTURE_VERSION,
      key,
      recordedAt: now.toISOString(),
      request,
      response,
    }
    const file = this.path(namespace, key)
    mkdirSync(dirname(file), { recursive: true })
    // Write-then-rename so a crash never leaves a truncated fixture behind.
    const temp = `${file}.${process.pid}.tmp`
    writeFileSync(temp, `${JSON.stringify(record, null, 2)}\n`)
    renameSync(temp, file)
    return record
  }
}
