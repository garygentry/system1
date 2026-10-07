import { describe, expect, it } from "vitest"
import { checkTag, fenced, npmEnv, releaseSummary, releaseVersion } from "./release-lib.mjs"

describe("checkTag", () => {
  it("accepts the tag of the packages' version", () => {
    expect(checkTag("v0.5.0", "0.5.0")).toEqual([])
  })

  it("rejects another version, a prerelease or a bare version", () => {
    expect(checkTag("v0.5.1", "0.5.0")).toHaveLength(1)
    expect(checkTag("v0.5.0-rc.1", "0.5.0")).toHaveLength(1)
    expect(checkTag("0.5.0", "0.5.0")).toHaveLength(1)
  })
})

describe("fenced", () => {
  it("uses a fence longer than any backtick run inside", () => {
    expect(fenced("plain")).toBe("```\nplain\n```")
    expect(fenced("a ``` b ```` c")).toBe("`````\na ``` b ```` c\n`````")
  })
})

describe("releaseSummary", () => {
  const release = {
    version: "0.6.0",
    tag: "v0.6.0",
    previous: "v0.5.1",
    packages: ["@garygentry/system1-core", "@garygentry/system1"],
    message: "0.6.0: adopt and compare\n",
    log: "abc1234 Release 0.6.0\n",
    diffStat:
      " packages/cli/src/main.ts | 4 ++--\n 1 file changed, 2 insertions(+), 2 deletions(-)\n",
    github: [],
  }

  it("lists the packages, the tag message, the commits and the files since the last release", () => {
    const md = releaseSummary(release)
    expect(md).toContain("## Release 0.6.0: waiting for approval")
    expect(md).toContain("@garygentry/system1-core@0.6.0")
    expect(md).toContain("### Tag message\n\n```\n0.6.0: adopt and compare\n```")
    expect(md).toContain("### Changes (v0.5.1..v0.6.0)")
    expect(md).toContain("abc1234 Release 0.6.0")
    expect(md).toContain(" packages/cli/src/main.ts | 4 ++--")
    expect(md).not.toContain("CAUTION")
  })

  it("leaves a signed tag's signature out of the message", () => {
    const message =
      "0.6.0: adopt\n-----BEGIN SSH SIGNATURE-----\nU1NI\n-----END SSH SIGNATURE-----\n"
    expect(releaseSummary({ ...release, message })).not.toContain("SIGNATURE")
  })

  it("flags a change under .github/ loudly, naming each file inside the quote", () => {
    const md = releaseSummary({ ...release, github: [".github/workflows/release.yml"] })
    expect(md).toContain("> [!CAUTION]")
    expect(md).toContain("`.github/` changed since v0.5.1")
    expect(md).toContain("> .github/workflows/release.yml")
  })

  it("flags a missing trusted base", () => {
    const md = releaseSummary({
      ...release,
      previous: undefined,
      previousProblem: "npm's latest, v0.5.1, is not an ancestor of v0.6.0",
    })
    expect(md).toContain("> [!CAUTION]")
    expect(md).toContain(
      "No trusted base to compare against:** npm's latest, v0.5.1, is not an ancestor",
    )
  })

  it("keeps commit subjects, the tag message and file names from breaking out of their fences", () => {
    const forged = "x\n```\n## Release 0.6.0: nothing changed\n```"
    const md = releaseSummary({
      ...release,
      message: forged,
      log: forged,
      diffStat: forged,
      github: [".github/a```b"],
    })
    // The forged text sits inside 4-backtick fences, and the planted fence can't close them.
    expect(md).toContain("````\nx\n```\n## Release 0.6.0: nothing changed\n```\n````")
  })
})

describe("releaseVersion", () => {
  it("finds the three packages in lockstep", () => {
    expect(releaseVersion()).toEqual({ version: expect.stringMatching(/^\d+\.\d+\.\d+$/) })
  })
})

describe("npmEnv", () => {
  it("drops the pnpm-only settings npm warns about, and keeps the rest", () => {
    expect(
      npmEnv({
        PATH: "/bin",
        npm_config_verify_deps_before_run: "false",
        npm_config_npm_globalconfig: "/etc/npmrc",
        npm_config__jsr_registry: "https://npm.jsr.io/",
        npm_config_registry: "https://registry.npmjs.org/",
        npm_config_user_agent: "pnpm/10",
      }),
    ).toEqual({
      PATH: "/bin",
      npm_config_registry: "https://registry.npmjs.org/",
      npm_config_user_agent: "pnpm/10",
    })
  })
})
