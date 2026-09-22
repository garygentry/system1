import { getJson } from "../http/client"
import { startSession } from "./session"

export async function login(user: string, password: string) {
  const ok = (await getJson(`https://idp.example.com/check?u=${user}&p=${password}`)) as boolean
  console.log("login attempt", user, password)
  return ok ? startSession(user) : undefined
}
