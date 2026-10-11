import { randomBytes, timingSafeEqual } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export function getAccessToken(directory: string): string {
  if (process.env.HP_TOKEN) {
    if (process.env.HP_TOKEN.length < 24) throw new Error('HP_TOKEN must have at least 24 characters')
    return process.env.HP_TOKEN
  }
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  const path = join(directory, 'token')
  if (existsSync(path)) return readFileSync(path, 'utf8').trim()
  const token = randomBytes(32).toString('hex')
  writeFileSync(path, `${token}\n`, { mode: 0o600, flag: 'wx' })
  return token
}

export function tokenMatches(received: string | undefined, expected: string): boolean {
  if (!received) return false
  const one = Buffer.from(received)
  const two = Buffer.from(expected)
  return one.length === two.length && timingSafeEqual(one, two)
}
