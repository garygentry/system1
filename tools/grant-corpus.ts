/**
 * Cases for the template grant scan (0020, plan m11-adopt item 7), run against
 * all three copies of it: `templateGrants` in validate.ts, and the templates'
 * own `grants.ts` and `grants.py` (tools/templates.test.ts). `ok` is whether
 * the text may ship in a template; `python` marks Python source.
 */
const MARK = "system1: runtime egress"
const TS_OFF = `export const EGRESS: "on" | "off" = "off" // ${MARK}`
const PY_OFF = `EGRESS: Final = "off"  # ${MARK}`

export interface GrantCase {
  text: string
  ok: boolean
  python?: boolean
}

export const GRANT_CASES: GrantCase[] = [
  // What the templates do.
  { ok: true, text: `${TS_OFF}\nif (mode === "live" && EGRESS !== "on") x()` },
  {
    ok: true,
    text: `${TS_OFF}\nconst r = createPolicyRuntime({\n  mode,\n  ...(root ? { root } : {}),\n  module: import.meta.url,\n  // Last.\n  egress: EGRESS,\n})`,
  },
  {
    ok: true,
    text: `${TS_OFF}\ncreatePolicyRuntime({ mode, module: import.meta.url, egress: EGRESS })`,
  },
  {
    ok: true,
    text: `${TS_OFF}\nconst r = createPolicyRuntime({\n  mode,\n  module: import.meta.url,\n  egress: EGRESS, // last\n})`,
  },
  { ok: true, text: `expect(EGRESS).toBe("off")\nassert.equal(EGRESS, "off", "msg")` },
  { ok: true, text: `assert.equal(policy.EGRESS, "off")` },
  { ok: true, text: `/**\n  EGRESS is the grant: egress: on\n*/` },
  { ok: true, python: true, text: `EGRESS: Final[str] = "off"  # ${MARK}` },
  { ok: true, python: true, text: `EGRESS: typing.Final = "off"  # ${MARK}` },
  {
    ok: true,
    python: true,
    text: `def f():\n    """Return early unless EGRESS is on."""\n    """\n    EGRESS = on, egress: on\n    """`,
  },
  { ok: true, python: true, text: `self.assertEqual(policy.EGRESS, "off")` },
  { ok: true, python: true, text: `argv = [\n    "--module",\n    os.path.abspath(__file__),\n]` },
  { ok: true, text: `const EGRESS = "off" as const // ${MARK}` },
  { ok: true, text: `import { EGRESS, triage } from "./policy.ts"\nassert.equal(EGRESS, "off")` },
  { ok: true, text: `import {\n  EGRESS,\n  type Outcome,\n  triage,\n} from "./policy.ts"` },
  { ok: true, text: `const SKIP = EGRESS === "off" ? false : "EGRESS is on"` },
  {
    ok: true,
    text: `return fallBack("egress-off", "runtime egress is off (this module's EGRESS line)")`,
  },
  {
    ok: true,
    text: `// Note on egress: it is the user's call\n// When EGRESS = "on", it sends.\n/**\n * egress: on\n */`,
  },
  { ok: true, python: true, text: `${PY_OFF}\nif not replay and EGRESS != "on":\n    pass` },
  {
    ok: true,
    python: true,
    text: `from policy import EGRESS, QUESTIONS\nLIVE_SKIP = EGRESS != "off"`,
  },
  { ok: true, python: true, text: `from policy import (\n    EGRESS,\n    QUESTIONS,\n)` },
  {
    ok: true,
    python: true,
    text: `# Runtime egress: off until you switch it.\n# see docs (egress)`,
  },
  { ok: true, python: true, text: `self.assertEqual(EGRESS, "off")` },
  { ok: true, python: true, text: `"""The \`EGRESS\` line below."""` },

  // Grants, in the spellings reviews found.
  { ok: false, text: `export const EGRESS: "on" | "off" = "on" // ${MARK}` },
  { ok: false, text: `let EGRESS = "off" // ${MARK}` },
  { ok: false, text: `EGRESS = "off" // ${MARK}` },
  { ok: false, text: `const EGRESS = "off" && "on" // ${MARK}` },
  { ok: false, text: `${TS_OFF}\n// ${MARK}` },
  { ok: false, text: `EGRESS = 'on'` },
  { ok: false, text: `EGRESS = "off"` },
  { ok: false, text: `const g = process.env.EGRESS` },
  {
    ok: false,
    text: `${TS_OFF}\nconst SEND = process.env.X === "1"\nf({ egress: EGRESS === "off" && SEND ? "on" : EGRESS })`,
  },
  {
    ok: false,
    text: `${TS_OFF}\nf({\n  egress: EGRESS\n    === "off" && SEND ? "on" : "off",\n})`,
  },
  { ok: false, text: `${TS_OFF}\nf({\n  egress: EGRESS,\n  ...o,\n})` },
  { ok: false, text: `${TS_OFF} const SEND = 1` },
  { ok: false, text: `import { EGRESS } from "./settings.ts" // ${MARK}` },
  { ok: false, text: `import { EGRESS } from "./settings.ts"\nf({ egress: EGRESS })` },
  { ok: false, text: `const { EGRESS } = settings` },
  { ok: false, text: `[EGRESS] = ["on"]` },
  { ok: false, text: `function mk(EGRESS: "on" | "off") { return 1 }` },
  { ok: false, text: `for (const EGRESS of xs) run()` },
  { ok: false, text: `o["egress"] = "on"` },
  { ok: false, text: `options.egress = "on"` },
  { ok: false, text: `function r(egress) { f({ egress, x }) }` },
  { ok: false, text: `createPolicyRuntime({ egress: "on" })` },
  { ok: false, text: `createPolicyRuntime({ egress: mine })` },
  { ok: false, text: `createDecider({ egressConsent: true })` },
  { ok: false, text: `${TS_OFF}\ncreatePolicyRuntime({ mode, egress: "on" })` },
  { ok: false, text: `${TS_OFF}\nf({ mode, egress: EGRESS })` },
  {
    ok: false,
    text: `${TS_OFF}\nconst base = {\n  mode,\n  egress: EGRESS,\n}\nconst r = createPolicyRuntime({ ...base, ...o })`,
  },
  { ok: false, text: `${TS_OFF}\nconst BASE = { mode, egress: EGRESS }` },
  {
    ok: false,
    text: `${TS_OFF}\nconst make = (o) => createPolicyRuntime({ ...o, ...hooks })\nmake({ mode, egress: EGRESS })`,
  },
  { ok: false, text: `${TS_OFF}\nf(\n  {\n    egress: EGRESS,\n  },\n  overrides,\n)` },
  { ok: false, text: `${TS_OFF}\nconst r = createPolicyRuntime({\n  egress: EGRESS,\n  ...o,\n})` },
  { ok: false, text: `createPolicyRuntime(opts)` },
  { ok: false, text: `${TS_OFF}\ncreatePolicyRuntime({ mode, egress: EGRESS })` },
  { ok: false, text: `${TS_OFF}\ncreatePolicyRuntime({ module: "bundled", egress: EGRESS })` },
  {
    ok: false,
    text: `${TS_OFF}\ncreatePolicyRuntime({\n  module: process.argv[1],\n  egress: EGRESS,\n})`,
  },
  { ok: false, text: `/* @__PURE__ */ createPolicyRuntime({ mode, egress: "on" })` },
  { ok: false, text: `/** @type {X} */ const opts = { mode, egress: "on" }` },
  { ok: false, text: `const x = 2\n  * 1; createPolicyRuntime({ mode, egress: "on" })` },
  { ok: false, text: 'const o = { [`egress`]: "on" }' },
  { ok: false, text: `const o = { get egress() { return "on" as const } }` },
  { ok: false, text: `const o = { eg\\u0072ess: "on" }` },
  { ok: false, text: 'const q = `"`; createPolicyRuntime({ mode, egress: "on" }) // "' },
  { ok: false, python: true, text: `x = fr"{setattr(policy, 'EGRESS', 'on')}"` },
  { ok: false, python: true, text: `argv = [\n    "--module",\n    "/tmp/other.py",\n]` },
  { ok: false, python: true, text: `EGRESS: Final = 'on'  # ${MARK}` },
  { ok: false, python: true, text: `EGRESS = "off"  # ${MARK}` },
  { ok: false, python: true, text: `EGRESS: Final = "off" and "on"  # ${MARK}` },
  { ok: false, python: true, text: `EGRESS: Final = os.environ.get("X", "off")  # ${MARK}` },
  { ok: false, python: true, text: `EGRESS += "x"` },
  { ok: false, python: true, text: `EGRESS, other = load()` },
  { ok: false, python: true, text: `run(egress="on")` },
  { ok: false, python: true, text: `g = os.environ["EGRESS"]` },
  { ok: false, python: true, text: `setattr(policy, "EGRESS", "on")` },
]
