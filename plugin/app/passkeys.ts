// Passkey sign-in (Carl, 2026-10-30: "each phone gets its own key you can revoke ... use Passkey"). Each device signs
// in with its own passkey and gets its own session; revoking a device ends its session at once. The old shared
// password link stays as a backup until the owner turns it off in Sign-in. Passkeys need the https address: a browser
// only offers them on a secure page.
//
// Kept in the gm-chat state folder: devices.json (each device's public key and a hash of its session, never the
// session itself) and auth.json ({ passwordSignIn }).
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import {
  generateAuthenticationOptions, generateRegistrationOptions, verifyAuthenticationResponse, verifyRegistrationResponse,
} from '@simplewebauthn/server'

type AuthenticatorTransportFuture = NonNullable<Parameters<typeof generateRegistrationOptions>[0]['excludeCredentials']>[number]['transports'] extends (infer T)[] | undefined ? T : never

type Device = { id: string; name: string; credentialID: string; publicKey: string; counter: number; transports?: AuthenticatorTransportFuture[]; created: number; lastSeen: number; session?: string }

export function passkeys(stateDir: string, isPassword: (given: string) => boolean) {
  const DEVICES = join(stateDir, 'devices.json'), AUTH = join(stateDir, 'auth.json')
  const COOKIE = 'gm_dev', MONTH = 30 * 86400
  const hash = (s: string) => createHash('sha256').update(s).digest('hex')
  const load = (): Device[] => { try { return JSON.parse(readFileSync(DEVICES, 'utf8')) } catch { return [] } }
  const save = (d: Device[]) => writeFileSync(DEVICES, JSON.stringify(d, null, 1) + '\n', { mode: 0o600 })
  const passwordOn = () => { try { return JSON.parse(readFileSync(AUTH, 'utf8')).passwordSignIn !== false } catch { return true } }
  const cookie = (req: IncomingMessage, k: string) => (req.headers.cookie ?? '').split(';').map(p => p.trim().split('=')).find(([n]) => n === k)?.slice(1).join('=') ?? ''
  // the challenge waiting for each ceremony, by a short-lived id kept in a cookie
  const pending = new Map<string, { challenge: string; at: number }>()
  const hold = (res: ServerResponse, challenge: string) => {
    for (const [k, v] of pending) if (Date.now() - v.at > 5 * 60_000) pending.delete(k)
    const id = randomBytes(16).toString('base64url'); pending.set(id, { challenge, at: Date.now() })
    res.setHeader('Set-Cookie', `gm_wa=${id}; HttpOnly; Secure; SameSite=Strict; Path=/auth; Max-Age=300`)
  }
  const take = (req: IncomingMessage) => { const id = cookie(req, 'gm_wa'); const p = pending.get(id); pending.delete(id); return p && Date.now() - p.at < 5 * 60_000 ? p.challenge : '' }

  // which device this request is signed in as (by its passkey session), if any
  function device(req: IncomingMessage): Device | undefined {
    const [id, token] = cookie(req, COOKIE).split('.')
    if (!id || !token) return undefined
    const d = load().find(x => x.id === id)
    if (!d?.session) return undefined
    const a = Buffer.from(hash(token)), b = Buffer.from(d.session)
    return a.length === b.length && timingSafeEqual(a, b) ? d : undefined
  }
  // signed in: a device's passkey session, or the shared password cookie while password sign-in is on
  const signedIn = (req: IncomingMessage) => !!device(req) || (passwordOn() && isPassword(cookie(req, 'gm_chat')))

  const startSession = (res: ServerResponse, devs: Device[], d: Device) => {
    const token = randomBytes(24).toString('base64url')
    d.session = hash(token); d.lastSeen = Date.now(); save(devs)
    res.setHeader('Set-Cookie', `${COOKIE}=${d.id}.${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${MONTH}`)
  }
  const host = (req: IncomingMessage) => String(req.headers.host ?? '').replace(/:\d+$/, '')
  // a passkey is bound to the page's origin: the https address, or localhost while testing on the Mac itself
  const origin = (req: IncomingMessage) => `${host(req) === 'localhost' ? 'http' : 'https'}://${req.headers.host}`
  const body = (req: IncomingMessage) => new Promise<any>((ok, bad) => { let s = ''; req.on('data', c => { s += c; if (s.length > 64_000) req.destroy() }); req.on('end', () => { try { ok(JSON.parse(s || '{}')) } catch (e) { bad(e) } }) })
  const json = (res: ServerResponse, code: number, v: unknown) => { res.statusCode = code; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(v)) }

  // /auth/*: returns true when it answered the request
  async function route(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const url = (req.url ?? '').split('?')[0]
    if (!url.startsWith('/auth/')) return false
    const o = req.headers.origin
    if (req.method !== 'GET' && o && new URL(o).host !== req.headers.host) { json(res, 403, { error: 'no' }); return true }
    const secure = req.headers['x-forwarded-proto'] === 'https' || o?.startsWith('https://') || host(req) === 'localhost'
    try {
      if (url === '/auth/state') { const me = device(req); json(res, 200, { signedIn: signedIn(req), device: me?.name ?? null, passwordSignIn: passwordOn(), secure, devices: signedIn(req) ? load().length : undefined }); return true }
      if (!secure && url !== '/auth/state') { json(res, 400, { error: 'Passkeys need the https address.' }); return true }

      if (url === '/auth/login/options' && req.method === 'POST') {
        const opts = await generateAuthenticationOptions({ rpID: host(req), userVerification: 'required' })
        hold(res, opts.challenge); json(res, 200, opts); return true
      }
      if (url === '/auth/login/verify' && req.method === 'POST') {
        const r = await body(req), devs = load(), d = devs.find(x => x.credentialID === r.id)
        if (!d) { json(res, 401, { error: "This passkey isn't on the list. It may have been removed." }); return true }
        const v = await verifyAuthenticationResponse({ response: r, expectedChallenge: take(req), expectedOrigin: origin(req), expectedRPID: host(req), requireUserVerification: true,
          credential: { id: d.credentialID, publicKey: Buffer.from(d.publicKey, 'base64url'), counter: d.counter, transports: d.transports } })
        if (!v.verified) { json(res, 401, { error: "That passkey didn't check out." }); return true }
        d.counter = v.authenticationInfo.newCounter; startSession(res, devs, d); json(res, 200, { ok: true, device: d.name }); return true
      }

      // everything below needs a signed-in device or the password
      if (!signedIn(req)) { json(res, 401, { error: 'Sign in first' }); return true }
      if (url === '/auth/register/options' && req.method === 'POST') {
        const devs = load()
        const opts = await generateRegistrationOptions({ rpName: 'Goddard OS', rpID: host(req), userName: 'owner', userDisplayName: 'Goddard OS owner',
          authenticatorSelection: { residentKey: 'required', userVerification: 'required' }, excludeCredentials: devs.map(d => ({ id: d.credentialID, transports: d.transports })) })
        hold(res, opts.challenge); json(res, 200, opts); return true
      }
      if (url === '/auth/register/verify' && req.method === 'POST') {
        const r = await body(req)
        const v = await verifyRegistrationResponse({ response: r.response, expectedChallenge: take(req), expectedOrigin: origin(req), expectedRPID: host(req), requireUserVerification: true })
        if (!v.verified || !v.registrationInfo) { json(res, 400, { error: "Couldn't save that passkey." }); return true }
        const c = v.registrationInfo.credential, devs = load()
        const d: Device = { id: randomBytes(9).toString('base64url'), name: String(r.name ?? 'This device').slice(0, 40) || 'This device', credentialID: c.id,
          publicKey: Buffer.from(c.publicKey).toString('base64url'), counter: c.counter, transports: c.transports, created: Date.now(), lastSeen: Date.now() }
        devs.push(d); startSession(res, devs, d); json(res, 200, { ok: true, device: d.name }); return true
      }
      if (url === '/auth/devices' && req.method === 'GET') { const me = device(req); json(res, 200, { devices: load().map(d => ({ id: d.id, name: d.name, created: d.created, lastSeen: d.lastSeen, active: !!d.session, me: d.id === me?.id })), passwordSignIn: passwordOn() }); return true }
      if (url === '/auth/devices/revoke' && req.method === 'POST') {
        const { id } = await body(req), devs = load(), rest = devs.filter(d => d.id !== id)
        if (rest.length === devs.length) { json(res, 404, { error: 'No such device' }); return true }
        if (!passwordOn() && !rest.length) { json(res, 400, { error: 'This is the last passkey and the password link is off. Turn the link back on first, or you lock yourself out.' }); return true }
        save(rest); json(res, 200, { ok: true }); return true
      }
      if (url === '/auth/password' && req.method === 'POST') {
        const { on } = await body(req)
        // the password link can only be turned off from a passkey session, so nobody locks themself out
        if (!on && !device(req)) { json(res, 400, { error: 'Sign in with a passkey on this device first, then turn the link off.' }); return true }
        writeFileSync(AUTH, JSON.stringify({ passwordSignIn: !!on }) + '\n', { mode: 0o600 }); json(res, 200, { ok: true, passwordSignIn: !!on }); return true
      }
      if (url === '/auth/signout' && req.method === 'POST') {
        const me = device(req), devs = load(), d = devs.find(x => x.id === me?.id)
        if (d) { delete d.session; save(devs) }
        res.setHeader('Set-Cookie', [`${COOKIE}=; Path=/; Max-Age=0`, 'gm_chat=; Path=/; Max-Age=0']); json(res, 200, { ok: true }); return true
      }
      json(res, 404, { error: 'no such route' }); return true
    } catch (e) { json(res, 400, { error: (e as Error).message }); return true }
  }
  return { route, signedIn, device, passwordOn, exists: () => existsSync(DEVICES) }
}
