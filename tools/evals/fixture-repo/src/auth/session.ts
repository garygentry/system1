const sessions = new Map<string, { user: string; expires: number }>()

export function startSession(user: string): string {
  const id = crypto.randomUUID()
  sessions.set(id, { user, expires: Date.now() + 3_600_000 })
  return id
}

export function currentUser(id: string): string | undefined {
  const s = sessions.get(id)
  return s && s.expires > Date.now() ? s.user : undefined
}
