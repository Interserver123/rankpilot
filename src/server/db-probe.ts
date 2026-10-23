import { safeMessage } from "./schema";

/**
 * Step-by-step Postgres connection test for Cloudflare Workers (raw TCP via cloudflare:sockets):
 * connect → TLS → startup → SCRAM-SHA-256 login. It reports the first step that fails and the
 * server's own error text. Never returns the password, user name or connection string.
 */
export interface ProbeResult { host: string; ok: boolean; steps: string[]; error?: string }

const te = new TextEncoder();
const td = new TextDecoder();

type Sock = { readable: ReadableStream<Uint8Array>; writable: WritableStream<Uint8Array>; opened: Promise<unknown>; startTls(o: { servername: string }): Sock; close(): Promise<void> };

const withTimeout = <T,>(p: Promise<T>, ms: number, what: string) =>
  Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`timed out after ${ms / 1000}s: ${what}`)), ms))]);

type Bytes = Uint8Array<ArrayBuffer>;
function concat(...parts: Uint8Array[]): Bytes {
  const out = new Uint8Array(new ArrayBuffer(parts.reduce((n, p) => n + p.length, 0)));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
const i32 = (n: number): Bytes => new Uint8Array([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);
const cstr = (s: string): Bytes => concat(te.encode(s), new Uint8Array([0]));
const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));

class Conn {
  buf = new Uint8Array(0);
  reader: ReadableStreamDefaultReader<Uint8Array>;
  writer: WritableStreamDefaultWriter<Uint8Array>;
  constructor(public sock: Sock) { this.reader = sock.readable.getReader(); this.writer = sock.writable.getWriter(); }
  async fill(n: number) {
    while (this.buf.length < n) {
      const { value, done } = await withTimeout(this.reader.read(), 8000, "waiting for the database");
      if (done) throw new Error("connection closed by the server");
      this.buf = concat(this.buf, value);
    }
  }
  async take(n: number) { await this.fill(n); const out = this.buf.slice(0, n); this.buf = this.buf.slice(n); return out; }
  /** One backend message: type byte + payload. */
  async message() {
    const head = await this.take(5);
    const len = new DataView(head.buffer).getInt32(1);
    return { type: String.fromCharCode(head[0]!), body: await this.take(len - 4) };
  }
  send(bytes: Uint8Array) { return this.writer.write(bytes); }
}

function errorText(body: Uint8Array): string {
  // ErrorResponse: repeated (fieldType byte, cstring); 'M' is the human message, 'C' the SQLSTATE.
  let i = 0, msg = "", code = "";
  while (i < body.length && body[i] !== 0) {
    const f = String.fromCharCode(body[i]!); i++;
    let j = i; while (j < body.length && body[j] !== 0) j++;
    const v = td.decode(body.slice(i, j)); i = j + 1;
    if (f === "M") msg = v; if (f === "C") code = v;
  }
  return `${msg || "unknown error"}${code ? ` (${code})` : ""}`;
}

async function hmac(key: Bytes, data: Bytes) {
  const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, data));
}

async function scram(c: Conn, password: string, steps: string[]) {
  const nonce = b64(crypto.getRandomValues(new Uint8Array(18)));
  const first = `n=*,r=${nonce}`;
  const initial = concat(te.encode(`n,,${first}`));
  const body = concat(cstr("SCRAM-SHA-256"), i32(initial.length), initial);
  await c.send(concat(new Uint8Array([0x70]), i32(body.length + 4), body));
  const m1 = await c.message();
  if (m1.type === "E") throw new Error(errorText(m1.body));
  const serverFirst = td.decode(m1.body.slice(4));
  const attrs = Object.fromEntries(serverFirst.split(",").map((p) => [p[0]!, p.slice(2)]));
  const salt = new Uint8Array(Array.from(atob(attrs.s!), (ch) => ch.charCodeAt(0)));
  const pk = await crypto.subtle.importKey("raw", te.encode(password.normalize("NFKC")), "PBKDF2", false, ["deriveBits"]);
  const salted = new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: Number(attrs.i) }, pk, 256));
  const clientKey = await hmac(salted, te.encode("Client Key"));
  const stored = new Uint8Array(await crypto.subtle.digest("SHA-256", clientKey));
  const withoutProof = `c=biws,r=${attrs.r}`;
  const authMessage = concat(te.encode(`${first},${serverFirst},${withoutProof}`));
  const sig = await hmac(stored, authMessage);
  const proof = clientKey.map((b, i) => b ^ sig[i]!);
  const final = concat(te.encode(`${withoutProof},p=${b64(proof)}`));
  await c.send(concat(new Uint8Array([0x70]), i32(final.length + 4), final));
  steps.push("password proof sent");
  for (;;) {
    const m = await c.message();
    if (m.type === "E") throw new Error(errorText(m.body));
    if (m.type === "R" && new DataView(m.body.buffer, m.body.byteOffset).getInt32(0) === 0) return;
  }
}

export async function probePostgres(rawUrl: string): Promise<ProbeResult> {
  const steps: string[] = [];
  let host = "?";
  try {
    const u = new URL(rawUrl);
    host = `${u.hostname}:${u.port || 5432}`;
    const user = decodeURIComponent(u.username), password = decodeURIComponent(u.password);
    const database = decodeURIComponent(u.pathname.slice(1) || "postgres");
    // @ts-expect-error cloudflare:sockets only exists inside the Workers runtime
    const { connect } = (await import(/* webpackIgnore: true */ "cloudflare:sockets")) as { connect: (a: string, o: object) => Sock };
    let sock = connect(host, { secureTransport: "starttls" });
    await withTimeout(sock.opened, 8000, "opening the connection");
    steps.push("1 server reachable");
    let c = new Conn(sock);
    const wantsTls = u.searchParams.get("sslmode") !== "disable";
    let answer: number | undefined;
    if (wantsTls) {
      await c.send(concat(i32(8), i32(80877103)));
      answer = (await c.take(1))[0];
    }
    if (answer === 0x53) {
      c.reader.releaseLock(); c.writer.releaseLock();
      sock = sock.startTls({ servername: u.hostname });
      c = new Conn(sock);
      steps.push("2 encryption (TLS) started");
    } else {
      steps.push(wantsTls ? "2 server does not offer TLS (plain connection)" : "2 TLS skipped (sslmode=disable)");
    }
    const startup = concat(i32(196608), cstr("user"), cstr(user), cstr("database"), cstr(database), cstr("client_encoding"), cstr("UTF8"), new Uint8Array([0]));
    await c.send(concat(i32(startup.length + 4), startup));
    const m = await c.message();
    if (m.type === "E") throw new Error(errorText(m.body));
    if (m.type !== "R") throw new Error(`unexpected reply "${m.type}" from server`);
    const auth = new DataView(m.body.buffer, m.body.byteOffset).getInt32(0);
    steps.push(`3 server accepted the user name (login method ${auth === 10 ? "SCRAM-SHA-256" : auth})`);
    if (auth === 10) { await scram(c, password, steps); steps.push("4 password accepted — login works"); }
    else if (auth === 0) steps.push("4 logged in without a password");
    else throw new Error(`unsupported login method ${auth}`);
    await sock.close().catch(() => {});
    return { host, ok: true, steps };
  } catch (e) {
    return { host, ok: false, steps, error: safeMessage(e instanceof Error ? e.message : String(e)) };
  }
}
