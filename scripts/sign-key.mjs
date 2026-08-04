/**
 * Issue licence keys for the paid tier, by hand, from this machine.
 *
 *   node scripts/sign-key.mjs --init                    # once: make a keypair
 *   node scripts/sign-key.mjs --kind early --days 90 --email a@b.com
 *   node scripts/sign-key.mjs --kind pro --id ord_123 --email a@b.com
 *   node scripts/sign-key.mjs --verify LMD1.…
 *
 * There is no service behind this, and that is the point: at a hundred early
 * slots, issuing by hand costs about two hours in total and forces the seller to
 * read every signup, which at this stage is the most valuable thing available.
 * Automate it when the volume argues for it, not before.
 *
 * The private key and the ledger live in ~/.localmd, outside the repository, so
 * neither can be committed by accident. The ledger exists for one reason: when
 * an early slot expires, its holder is the warmest lead there is, and you cannot
 * write to them if you did not write down who they were.
 */
import { generateKeyPairSync, createPrivateKey, createPublicKey, sign, verify } from 'node:crypto'
import { readFileSync, writeFileSync, appendFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

const HOME = process.env.LOCALMD_LICENCE_DIR || join(homedir(), '.localmd')
const KEY_PATH = join(HOME, 'signing-key.pem')
const LEDGER = join(HOME, 'issued.csv')
const PREFIX = 'LMD1'

const args = process.argv.slice(2)
const flag = (name) => {
  const i = args.indexOf(`--${name}`)
  return i === -1 ? undefined : (args[i + 1] ?? '')
}
const has = (name) => args.includes(`--${name}`)

const b64url = (buf) => Buffer.from(buf).toString('base64url')

function die(msg) {
  console.error(`✗ ${msg}`)
  process.exit(1)
}

/* ── one-time setup ──────────────────────────────────────────────────────── */

if (has('init')) {
  if (existsSync(KEY_PATH)) {
    die(`${KEY_PATH} already exists. Refusing to overwrite it — every key ever issued was signed with it.`)
  }
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  mkdirSync(HOME, { recursive: true, mode: 0o700 })
  writeFileSync(KEY_PATH, privateKey.export({ format: 'pem', type: 'pkcs8' }), { mode: 0o600 })

  // A JWK's `x` for Ed25519 is already base64url of the raw 32 bytes — exactly
  // what `crypto.subtle.importKey('raw', …)` wants on the other side.
  const raw = publicKey.export({ format: 'jwk' }).x
  console.log(`\n  private key → ${KEY_PATH}  (back this up; losing it means every future`)
  console.log(`                 key must be re-issued under a new public key)\n`)
  console.log(`  Paste this into PUBLIC_KEY in src/lib/licence.ts:\n`)
  console.log(`    const PUBLIC_KEY = '${raw}'\n`)
  process.exit(0)
}

/* ── reading the key back ────────────────────────────────────────────────── */

function readPrivate() {
  if (!existsSync(KEY_PATH)) die(`no signing key at ${KEY_PATH} — run with --init first`)
  return createPrivateKey(readFileSync(KEY_PATH))
}

/** The public half, re-derived. `--init` prints it once and then it is gone from
 *  the scrollback; the value itself is public, so there is no reason to make
 *  losing that one line mean anything. */
if (has('pubkey')) {
  console.log(createPublicKey(readPrivate()).export({ format: 'jwk' }).x)
  process.exit(0)
}

if (has('verify')) {
  const key = flag('verify')
  const [prefix, payload, sig] = String(key).split('.')
  if (prefix !== PREFIX || !payload || !sig) die('not a licence key')
  const pub = createPublicKey(readPrivate())
  const ok = verify(
    null,
    Buffer.from(`${PREFIX}.${payload}`),
    pub,
    Buffer.from(sig, 'base64url'),
  )
  console.log(ok ? '✓ signed by this key' : '✗ NOT signed by this key')
  if (ok) console.log(JSON.parse(Buffer.from(payload, 'base64url').toString()))
  process.exit(ok ? 0 : 1)
}

/* ── issuing ─────────────────────────────────────────────────────────────── */

const kind = flag('kind') || 'early'
if (kind !== 'pro' && kind !== 'early') die(`--kind must be pro or early, got "${kind}"`)

const email = flag('email')
if (!email) die('--email is required — the ledger is how an expiring slot becomes a sale')

const days = flag('days') === undefined ? (kind === 'early' ? 90 : undefined) : Number(flag('days'))
if (days !== undefined && (!Number.isInteger(days) || days < 1)) die('--days must be a whole number of days')

const iso = (d) => d.toISOString().slice(0, 10)
const today = new Date()
const issued = iso(today)
const expires =
  days === undefined ? null : iso(new Date(today.getTime() + days * 86_400_000))

// Default id is date + a short random tail: unique enough to name one sale in a
// support thread, and it carries no information about the buyer.
const id = flag('id') || `${issued.replace(/-/g, '')}-${Math.random().toString(36).slice(2, 8)}`

// Baked into the signed payload, so "Licensed to …" shows in the app and a key
// posted publicly carries its owner's name. Defaults to the email; `--to` for a
// buyer who would rather show a name.
const to = flag('to') || email

const payload = b64url(Buffer.from(JSON.stringify({ id, kind, issued, expires, to })))
const signature = b64url(sign(null, Buffer.from(`${PREFIX}.${payload}`), readPrivate()))
const licenceKey = `${PREFIX}.${payload}.${signature}`

// The key travels in the URL fragment, which browsers never send to a server —
// so it stays out of access logs, referrers and any CDN in between.
//
// An explicit .html path rather than a pretty /claim: this is the shape already
// verified to resolve in production (see public/oauth/callback.html), and a link
// that 404s is a slot the buyer cannot claim.
const claimUrl = `https://localmd.app/claim.html#${licenceKey}`

mkdirSync(HOME, { recursive: true, mode: 0o700 })
if (!existsSync(LEDGER)) appendFileSync(LEDGER, 'id,kind,email,issued,expires,key\n')
appendFileSync(LEDGER, `${id},${kind},${email},${issued},${expires ?? ''},${licenceKey}\n`)

console.log(`\n  ${kind}${expires ? ` · expires ${expires}` : ' · no expiry'} · ${id}`)
console.log(`  ledger → ${LEDGER}\n`)
console.log(`  Send this link:\n`)
console.log(`    ${claimUrl}\n`)
