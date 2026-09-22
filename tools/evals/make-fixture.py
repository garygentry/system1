#!/usr/bin/env python3
"""Generate the volume data in tools/evals/fixture-repo (seeded, reproducible).

  python3 tools/evals/make-fixture.py

The routing positives only mean something when handing the judgement to a
decision model clearly beats grep or reading: free text that varies, rules that
need understanding, and more of it than an agent would read. So every corpus
here mixes vocabularies across labels (a "payment page" ticket can be infra, a
"login" review can be praise) and phrases each item differently.
"""
import json
import os
import random

R = random.Random(20260922)
ROOT = os.path.join(os.path.dirname(__file__), "fixture-repo")


def pick(*options):
    return R.choice(options)


def maybe(text, p=0.5):
    return text if R.random() < p else ""


def sentence(*parts):
    text = " ".join(p for p in parts if p).strip()
    return text[0].upper() + text[1:]


# --- tickets.jsonl: route to billing / auth / infra / other --------------------
PRODUCTS = ["the app", "your site", "checkout", "my account page", "the dashboard", "the mobile app"]
OPENERS = ["Hi,", "Hello team,", "Hey", "Good morning.", "", "", "Urgent:", "Not sure who to ask, but"]
CLOSERS = ["Thanks.", "Please help!", "", "", "Any update would be appreciated.", "This is the third time I'm writing."]
TICKETS = {
    "billing": [
        "I see two charges of {amt} for the same order on my card statement",
        "the refund you promised last week still hasn't shown up",
        "my invoice lists VAT even though we gave you our EU VAT number",
        "you renewed my plan at the new price without telling me",
        "the payment page accepted my card but the order still says unpaid",
        "can I get a receipt with our company name on it for {amt}",
        "the coupon code was accepted and then the full {amt} was charged anyway",
    ],
    "auth": [
        "the reset link in the email says it has expired as soon as I click it",
        "I never receive the six digit code when logging in",
        "{product} logs me out every few minutes and I have to sign in again",
        "my account got locked after a single typo in the password",
        "signing in with Google loops back to the login screen",
        "I changed my email address and now neither the old nor the new one lets me in",
        "the payment page keeps asking me to log in again before I can pay",
    ],
    "infra": [
        "{product} is timing out around 6pm every day",
        "product images show broken icons since this morning",
        "the API answers 502 about one request in twenty",
        "search takes more than thirty seconds to return anything",
        "the payment page does not load at all, just a spinner, on every browser",
        "your status page is green but nothing loads for us in Frankfurt",
        "exports have been stuck in 'processing' for two days",
    ],
    "other": [
        "do you ship to Iceland or Greenland",
        "just wanted to say the new design is lovely",
        "is there a discount for students or nonprofits",
        "how do I change the name shown on my profile",
        "what are your opening hours over the holidays",
        "can I suggest adding a dark mode",
        "who do I talk to about a partnership",
    ],
}


def tickets(n=300):
    rows = []
    for i in range(n):
        team = R.choice(list(TICKETS))
        body = R.choice(TICKETS[team]).format(amt=f"${R.randint(5, 400)}.{R.randint(0, 99):02d}", product=R.choice(PRODUCTS))
        text = sentence(R.choice(OPENERS), body + pick(".", "!", "?", "...", ""), R.choice(CLOSERS))
        rows.append({"id": f"T-{1000 + i}", "text": text})
    return rows


# --- reviews.jsonl: which report a concrete bug ---------------------------------
REVIEWS_BUG = [
    "crashes every time I rotate the phone while a video is playing",
    "the login button does nothing after the latest update",
    "my saved drafts disappear when I switch accounts",
    "notifications arrive twice and the second one opens the wrong screen",
    "the export produces an empty file when the list has emoji in it",
    "totals are wrong when I add the same item from two different pages",
]
REVIEWS_NOT_BUG = [
    "way too expensive for what it does",
    "please add a dark mode and widgets",
    "login is so smooth now, great job",
    "customer support took a week to reply",
    "the new icons are ugly, bring back the old ones",
    "does everything I need, five stars",
    "I wish it synced with my calendar",
    "the update made it faster, thanks",
]


def reviews(n=400):
    rows = []
    for i in range(n):
        bug = R.random() < 0.3
        core = R.choice(REVIEWS_BUG if bug else REVIEWS_NOT_BUG)
        extra = maybe(pick("Otherwise fine.", "Uninstalling.", "Been using it for years.", "Pixel 8, latest version.", "Please fix."), 0.6)
        rows.append({"id": f"R-{i + 1}", "stars": R.randint(1, 5), "text": sentence(core + ".", extra)})
    return rows


# --- commits.txt: which change runtime behaviour --------------------------------
BEHAVIOUR = [
    "Retry payment webhooks up to 5 times instead of 3",
    "Stop sending the welcome email to invited users",
    "Return 404 instead of 500 when an order is missing",
    "Round prices half-up rather than half-even",
    "Expire sessions after 30 minutes of inactivity",
    "Allow refunds on partially shipped orders",
    "Skip inventory sync for archived products",
]
NON_BEHAVIOUR = [
    "Rename OrderSvc to OrderService",
    "Fix typos in the README",
    "Extract the price formatting into a helper",
    "Add tests for the coupon parser",
    "Reformat with the new prettier config",
    "Bump eslint to 9.12",
    "Move fixtures into test/fixtures",
    "Document the webhook retry policy",
]
BODIES = [
    "No functional change.",
    "Customers reported this in support.",
    "Follow-up to the incident review.",
    "Part of the cleanup epic.",
    "",
    "",
]


def commits(n=300):
    lines = []
    for i in range(n):
        subject = R.choice(BEHAVIOUR if R.random() < 0.35 else NON_BEHAVIOUR)
        sha = "".join(R.choice("0123456789abcdef") for _ in range(7))
        body = R.choice(BODIES)
        # Some behaviour changes wrongly say "no functional change"; some refactors mention customers.
        lines.append(f"{sha} {subject}{(' — ' + body) if body else ''}")
    return lines


# --- failures.jsonl: flaky / regression / infra ----------------------------------
FAILURES = {
    "flaky": [
        "expected list to equal [1, 2, 3] but got [2, 1, 3] (order of parallel fetches)",
        "timed out after 5000ms waiting for element #toast; passed on retry in CI run {n}",
        "port 5432 already in use when two suites started together",
    ],
    "regression": [
        "expected formatCents(1999) to be '$19.99' but got '$19.9'",
        "TypeError: Cannot read properties of undefined (reading 'items') at cartTotal (src/cart.ts:{n})",
        "expected status 404 but received 500 for GET /orders/missing",
    ],
    "infra": [
        "npm ERR! network request to https://registry.npmjs.org failed, reason: ETIMEDOUT",
        "runner ran out of disk space while writing coverage report",
        "docker: Error response from daemon: pull access denied for postgres:16 (rate limited)",
    ],
}


def failures(n=80):
    rows = []
    for i in range(n):
        kind = R.choice(list(FAILURES))
        lines = [f"FAIL {pick('src', 'test')}/{pick('cart', 'orders', 'auth', 'ui', 'search')}/{R.randint(1, 40)}.test.ts"]
        lines.append(R.choice(FAILURES[kind]).format(n=R.randint(10, 400)))
        lines += [f"    at {pick('run', 'step', 'handler', 'next')} (node_modules/x/index.js:{R.randint(1, 900)}:{R.randint(1, 60)})" for _ in range(R.randint(2, 6))]
        rows.append({"id": f"F-{i + 1}", "output": "\n".join(lines)})
    return rows


# --- cleanup-plan.sh: ~40 commands to judge one by one -------------------------
SAFE_CMDS = [
    "du -sh /var/cache/build/*",
    "ls -la /srv/artifacts/{d}",
    "git -C /srv/repos/{d} fetch --prune",
    "docker image ls --filter dangling=true",
    "find /tmp/build-{d} -name '*.log' -mtime +7 -print",
    "tar czf /backups/{d}-$(date +%F).tgz /srv/artifacts/{d}",
    "journalctl --vacuum-time=14d --dry-run",
    "cp -r /srv/artifacts/{d} /backups/{d}",
]
RISKY_CMDS = [
    "rm -rf /srv/artifacts/{d}",
    "git -C /srv/repos/{d} reset --hard origin/main && git -C /srv/repos/{d} clean -fdx",
    "docker system prune -af --volumes",
    "find /srv -name '*.db' -mtime +30 -delete",
    "psql -h db.internal -c 'TRUNCATE builds CASCADE'",
    "git -C /srv/repos/{d} push --force origin HEAD:main",
    "mv /srv/artifacts/{d} /dev/null",
    "chmod -R 777 /srv/secrets",
]
DIRS = ["web", "api", "worker", "mobile", "docs", "infra", "billing", "search"]


def cleanup_plan(n=40):
    lines = ["#!/bin/sh", "# Nightly cleanup for the shared build server, proposed by the ops bot."]
    for _ in range(n):
        cmd = R.choice(SAFE_CMDS if R.random() < 0.6 else RISKY_CMDS).format(d=R.choice(DIRS))
        lines.append(cmd)
    return lines


# --- packages.jsonl: 250 internal packages, pick one ---------------------------
AREAS = ["queue", "cache", "log", "config", "http", "retry", "metrics", "auth", "mail", "pdf", "image", "csv", "feature-flag", "rate-limit", "i18n"]
TRAITS = [
    "keeps everything in memory, so state is lost when the process exits",
    "writes to local disk under ./var",
    "stores its state in Postgres and picks up where it left off after a restart",
    "is a thin wrapper over the vendor SDK",
    "is deprecated; new code should not depend on it",
    "runs work on the calling thread only",
]


def packages(n=250):
    rows = []
    for i in range(n):
        area = R.choice(AREAS)
        rows.append({
            "name": f"@shop/{area}-{R.choice(['core', 'kit', 'lite', 'pro', 'utils', 'next', 'legacy'])}-{i}",
            "description": f"Helpers for {area} work. It {R.choice(TRAITS)}. Owned by the {R.choice(DIRS)} team. {R.choice(['Stable.', 'Beta.', 'Used by 3 services.', 'Unmaintained since 2024.'])}",
        })
    # The fit for "run a job every night and survive a server restart", with no
    # "cron", "schedule" or "nightly" in it, beside in-memory near misses.
    rows.insert(R.randint(40, 200), {
        "name": "@shop/timekeeper",
        "description": "Runs registered tasks at recurring wall-clock times. Pending and future runs are persisted in Postgres, so they resume after a deploy or a crash. Owned by the infra team. Stable.",
    })
    rows.insert(R.randint(40, 200), {
        "name": "@shop/ticker",
        "description": "Runs registered tasks at recurring wall-clock times. Keeps its timetable in memory, so a restart forgets pending runs. Owned by the web team. Stable.",
    })
    return rows


def change_overlay():
    """The uncommitted change for the criteria prompts: timeouts added across
    every module that lacked one, with a stray debug log in two of them."""
    changes = os.path.join(os.path.dirname(__file__), "fixture-changes")
    src = os.path.join(ROOT, "src")
    touched = 0
    for d in sorted(os.listdir(src)):
        for f in sorted(os.listdir(os.path.join(src, d))):
            path = os.path.join(src, d, f)
            text = open(path).read()
            if "await fetch(" not in text or "timeout" in text.lower() or "signal" in text:
                continue
            touched += 1
            new = text.replace("`)\n", "`, { signal: AbortSignal.timeout(4_000) })\n")
            if touched in (3, 11):
                new = new.replace("  return res.json()", "  console.log('debug', res.status)\n  return res.json()")
            out = os.path.join(changes, "src", d, f)
            os.makedirs(os.path.dirname(out), exist_ok=True)
            with open(out, "w") as fh:
                fh.write(new)
    return touched


def write(path, text):
    full = os.path.join(ROOT, path)
    os.makedirs(os.path.dirname(full), exist_ok=True)
    with open(full, "w") as f:
        f.write(text)


def main():
    write("tickets.jsonl", "".join(json.dumps(r) + "\n" for r in tickets()))
    write("reviews.jsonl", "".join(json.dumps(r) + "\n" for r in reviews()))
    write("commits.txt", "\n".join(commits()) + "\n")
    write("failures.jsonl", "".join(json.dumps(r) + "\n" for r in failures()))
    write("cleanup-plan.sh", "\n".join(cleanup_plan()) + "\n")
    write("packages.jsonl", "".join(json.dumps(r) + "\n" for r in packages()))
    print("overlay files:", change_overlay())


if __name__ == "__main__":
    main()
