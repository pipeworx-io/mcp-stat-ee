interface McpToolDefinition {
  name: string;
  description: string;
  /** Human-facing one-liner (fleet #1967). Optional; consumers fall back to
   *  description. Kept in step with shared/src/types.ts — scripts/lib/
   *  check-inlined-types.mjs reports drift at publish time. */
  summary?: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
    anyOf?: Array<{ required: string[] }>;
    oneOf?: Array<{ required: string[] }>;
    allOf?: Array<{ required: string[] }>;
  };
  outputSchema?: Record<string, unknown>;
}

interface McpToolExport {
  tools: McpToolDefinition[];
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  meter?: { credits: number };
  cost?: Record<string, unknown>;
  provider?: string;
}

/**
 * Was this failure OUR OWN web service? — the other half of `internal-db-class.ts`.
 *
 * fleet #1089 pulled failures from our own Postgres out of `upstream_down` by
 * keying on the SQLSTATE inside PostgREST's four-key error envelope. That
 * covered the majority and structurally could not cover the rest: the rest
 * never reach Postgres, so they carry no SQLSTATE. What was left, measured over
 * the 24h to 2026-09-02T15:00Z (fleet #1096):
 *
 *     5  pipeworx-catalog  get_pack_tools     Pipeworx catalog error: 522 — error code: 522
 *     3  fleet             fleet_list_open …  upstream_down: Fleet task queue did not respond within 25s
 *
 * 521/522/523/526 are Cloudflare saying its edge could not reach an ORIGIN, and
 * in both of those rows the origin is ours — `gateway.pipeworx.io` for the
 * catalog pack (it self-fetches when the gateway hasn't injected a manifest),
 * our own Supabase for fleet. There is no third party anywhere in either call.
 * Same defect as #1089: our own outage filed under `upstream_down`, the one
 * class that means "the source is unreachable and there is nothing for us to
 * fix", which is why the problem-tools triage skips it.
 *
 * WHY NOT A WORDING RULE. The obvious fix is to match `fleet db error:` and
 * `Pipeworx catalog error:` in classifyToolError. Each is emitted from exactly
 * one site today, so it would work today. It would also rot the first time
 * somebody rewords a label — silently, and in the direction of hiding our own
 * outage, which is worse than the bug being fixed. Every prose rule in
 * error-class.ts has needed widening as packs invented new wording (#409/#450/
 * #584); that history is most of that file's comment budget.
 *
 * WHAT THIS KEYS ON INSTEAD: **the host the call actually reached.** A URL's
 * hostname is a fact about the call, not a guess about its prose. Two
 * consequences that a pack-level flag could not give us, and the reason the
 * flag was rejected:
 *
 *   - It describes the CALL, not the pack. `govcon-intel` fans out to our own
 *     Supabase AND to genuine third parties; `court-listener` holds our cache
 *     in Supabase and fetches courtlistener.com. An `internallyHosted: true` on
 *     either pack would relabel a real third-party outage as ours — inventing
 *     work, which is the same class of error in the opposite direction.
 *   - It covers every future internal pack for free, instead of one declared
 *     slug at a time.
 *
 * WHY IT SURVIVES A REWORD. The marker below is not matched as a literal by two
 * separate files. `markInternalOrigin()` writes it and `internalHostMetricsClass()`
 * reads it, both from the single exported `INTERNAL_ORIGIN_MARKER` constant in
 * this module — so changing the wording changes both sides in the same edit and
 * cannot desynchronise them. The pack's own label (`fleet db error:`,
 * `Pipeworx catalog error:`) is not read at all: reword it freely, the class is
 * unaffected. That is the property `stripClassPrefix` lacked when it drifted
 * from its own classifier three times and needed a CI gate to hold them
 * together.
 *
 * WHERE THE 5xx TEST LIVES. `markInternalOrigin` is called from the places that
 * hold the real `Response` — `httpError`/`httpErrorMessage` and the timeout
 * branch of `fetchWithTimeout` in `shared/src/http.ts` — so "is this an
 * availability failure" is decided from the actual status code, never re-derived
 * by scraping a number out of a sentence. A 404 from our own registry for a slug
 * that does not exist is a caller's bad argument and is deliberately NOT marked.
 */

/**
 * OUR OWN web service was unreachable — not an upstream, and never `upstream_down`.
 *
 * ONE value, not three, unlike `internal_db_*`. That split existed because a
 * slow query, an exhausted pool and an unknown SQLSTATE have different owners
 * and different fixes. Here there is only one story to tell — an origin we run
 * did not answer the edge — and one owner. A bucket with no distinct owner per
 * value is decoration; #724 is what happens when a class holds several
 * situations, and inventing sub-values ahead of a reason to act on them
 * differently is the same mistake with the sign flipped.
 *
 * METRICS ONLY, exactly like PLATFORM_KEY_ERROR_CLASS and the internal_db
 * values. `classifyToolError` still answers `upstream_down` for the retry and
 * hint paths, which only care whether retrying or a sibling tool might work —
 * and it might. Nothing a caller sees or is charged changes here.
 *
 * READ SIDE: this value is in BROKEN_TOOL_CLASSES, FAULT_CLASSES and
 * ALL_ERROR_CLASSES in `workers/registry-api/src/index.ts`. All three, or it
 * lands on no dashboard — fleet #721 is the warning, where the #719 split
 * worked on the write side and was invisible for weeks.
 */
const INTERNAL_SERVICE_UNREACHABLE_CLASS = 'internal_service_unreachable';

/**
 * The token that carries "this origin is ours" from the call site to the
 * classifier.
 *
 * Appended to the error message rather than attached to the Error object,
 * because the object does not survive the trip: 275 packs return `{ error:
 * string }` instead of throwing, the gateway reads `observedError` as a string,
 * and the fleet pack rebuilds its error from a captured status + body across a
 * retry loop. A property on an Error would be dropped by every one of those
 * paths and the class would work in tests and vanish in production.
 *
 * WORDING IS LOAD-BEARING, same rule as labelAge's note in authority.ts. This
 * string is appended to a pack's thrown Error message (shared/src/http.ts),
 * and a thrown Error's message is exactly what the gateway hands back to the
 * caller as `content[0].text` when nothing rewrites it (workers/gateway/src
 * catches the throw and sets `rawResult.message = stripClassPrefix(error)`,
 * which does not touch this suffix) — so the original wording,
 * " [pipeworx-hosted origin — our own service, not a third party]", was not a
 * theoretical leak: it shipped live on pipeworx-catalog's 522s, 7 times in 6
 * hours on 2026-09-02 (see tests/golden-internal-service.test.ts), verbatim
 * naming Pipeworx as the host. check:hosting-claims never caught it because it
 * did not scan shared/ at all (task #2009). Reworded to describe the
 * OBSERVATION (the origin did not answer) without a claim about who runs it —
 * the identical fix labelAge got: drop the possessive, keep the fact.
 */
const INTERNAL_ORIGIN_MARKER = ' [origin did not respond — retry before concluding the named source is down]';

/**
 * Supabase's data plane for a project is `<ref>.supabase.co`, where the ref is
 * exactly twenty lowercase letters (ours is `pqauisounztsgdgfkhke`).
 *
 * Matching the shape rather than listing the ref keeps this correct when we add
 * a project — `supabaseEnv` on a pack entry already points some packs at a
 * second one — while still excluding `status.supabase.co`, which is Supabase's
 * own status page and emphatically not our database. Verified 2026-09-02 by
 * `grep -rhoE '[a-z0-9-]+\.supabase\.(co|in)' mcps shared workers scripts`: the
 * only real project ref anywhere in the tree is ours, the rest are doc
 * placeholders (`abc`, `xyz`, `example`) which this pattern also excludes. Same
 * finding internal-db-class.ts relies on for the PostgREST envelope being ours
 * by construction.
 */
const SUPABASE_PROJECT_HOST = /^[a-z]{20}\.supabase\.(co|in)$/;

/**
 * Is this a host WE run?
 *
 * Deliberately NOT including `*.workers.dev`: plenty of third-party APIs are
 * hosted on workers.dev, so the suffix says where something runs and not who
 * owns it. Every internal call we actually make goes to a `pipeworx.io`
 * hostname or to our Supabase project, both of which are ownership facts.
 *
 * `workers/gateway/src/provenance.ts`'s `OUR_HOSTS` answers the same
 * question and DOES include `workers.dev` — a documented divergence
 * (task #2051), not a bug to converge. That list decides what a response may
 * cite as a data SOURCE, where a false negative (citing our own worker as an
 * external source) is the hosting-disclosure leak this whole file exists to
 * prevent, so it errs broad. This one decides who gets BLAMED for a 5xx in
 * outage metrics read by on-call, where a false positive (crediting our own
 * infra with a third party's outage) hides the real failure, so it errs
 * narrow. Same suffix, opposite direction, because they are never called for
 * the same reason.
 *
 * Returns false on anything unparseable rather than throwing — this runs inside
 * an error path, and an error path that can itself throw turns a diagnosable
 * failure into a mystery.
 */
function isPipeworxOrigin(url: string | URL | undefined | null): boolean {
  if (!url) return false;
  let host: string;
  try {
    host = new URL(url instanceof URL ? url.href : url).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (host === 'pipeworx.io' || host.endsWith('.pipeworx.io')) return true;
  return SUPABASE_PROJECT_HOST.test(host);
}

/**
 * Append the marker when this failure was OUR origin failing to answer.
 *
 * `status` is the HTTP status when there is one, and omitted for a timeout —
 * where there is no response at all, and "the origin did not answer" is the
 * whole observation. Statuses below 500 are left alone: a 404 from our own
 * registry for a slug that does not exist is the caller's argument, not our
 * outage, and marking it would put ordinary 404s on the incident dashboard.
 *
 * Idempotent, so a message that is wrapped and re-marked on the way up (the
 * fleet pack's retry loop re-throws through two layers) carries the marker once.
 */
function markInternalOrigin(
  message: string,
  url: string | URL | undefined | null,
  status?: number,
): string {
  if (status !== undefined && status < 500) return message;
  if (!isPipeworxOrigin(url)) return message;
  if (message.includes(INTERNAL_ORIGIN_MARKER)) return message;
  return message + INTERNAL_ORIGIN_MARKER;
}

/**
 * Which blob4 value a failure from our own web services books as, or undefined
 * if this is not one.
 *
 * Ordered AFTER `internalDbMetricsClass` at the call site: a PostgREST envelope
 * from our own Supabase is a strictly more specific statement about the same
 * row (which of our services, and why), and the two cannot disagree about
 * whether the failure is ours.
 */
function internalHostMetricsClass(error: string): string | undefined {
  return error.includes(INTERNAL_ORIGIN_MARKER) ? INTERNAL_SERVICE_UNREACHABLE_CLASS : undefined;
}


/**
 * One place to turn a failed `fetch` into an error a caller can act on.
 *
 * Nearly every pack was written the same way:
 *
 *     if (!res.ok) throw new Error(`Unsplash: ${res.status}`);
 *
 * which discards the response body — and the body is usually where the upstream
 * says what was actually wrong ("**symbol** not found: GBP", "parameter `year`
 * out of range", "unknown taxonomy id"). The caller gets a number, cannot
 * self-correct, and retries the same broken call. A 2026-07-31 sweep found this
 * shape in 481 of 1,400 packs, 47 of them PLATFORM-keyed.
 *
 * It also hides bugs one level down. Two of the first three packs audited had a
 * second defect that only existed because of this line: unsplash's rate-limit
 * branch sat BELOW a catch-all and was unreachable, and bea-gov parsed
 * `BEAAPI.Error.APIErrorDescription` below a `!res.ok` throw that made the
 * parsing dead code for every non-200.
 *
 * DELIBERATELY NOT A CLASSIFIER. It does not add `user_error:` /
 * `upstream_down:` prefixes. Those decide which tier a failure lands in, and the
 * `error` tier is what the daily problem-tools list is built from — it means
 * "Pipeworx has a defect". A 400 is genuinely ambiguous: often a caller's bad
 * argument, but sometimes a query WE built wrong (ted-eu comma-joined its CPV
 * values into something TED rejected, and that bug was found only because it sat
 * in `error`). Blanket-classifying 400s as caller mistakes would have hidden it.
 * A pack that KNOWS which it is should keep saying so explicitly; this helper is
 * for the 481 that say nothing at all.
 */

/** Longest upstream explanation we'll pass through. Enough for a real message,
 *  short enough that an HTML page or a stack trace can't swamp the error. */

const MAX_DETAIL = 300;

/**
 * Default bound for `fetchWithTimeout` when a pack doesn't state its own.
 *
 * 25s mirrors the number `epo-ops` landed on after measuring the real failure:
 * a degraded upstream that doesn't error, it just never answers, and a Worker
 * sits in `await fetch()` until ITS OWN execution budget kills the request —
 * which can take minutes, not seconds (epo_ops_search_patents measured 4-8
 * MINUTE hangs before this existed). 25s is short enough that a caller gets a
 * fast, actionable error instead of holding the connection, and long enough
 * that it doesn't false-trip on a merely-slow-but-alive upstream.
 */
const DEFAULT_FETCH_TIMEOUT_MS = 25_000;

/**
 * Read the body of a failed response and fold it into a throwable Error.
 *
 * Usage — note the `await`, which is the one thing that makes this a mechanical
 * change rather than a drop-in:
 *
 *     if (!res.ok) throw await httpError(res, 'Unsplash');
 *
 * Safe to call on any non-ok response: a body that is missing, empty, unreadable
 * or HTML degrades to exactly the old `Name: 404` string rather than throwing
 * something new from inside the error path.
 */
async function httpError(res: Response, name: string): Promise<Error> {
  return new Error(await httpErrorMessage(res, name));
}

/** The message text without constructing an Error — for packs that need to wrap
 *  it in their own envelope or add an explicit classification prefix. */
async function httpErrorMessage(res: Response, name: string): Promise<string> {
  // The one place a 5xx from a host WE run gets stamped as ours. `res.url` is
  // the URL the fetch actually resolved to (after redirects), so this is a fact
  // about the call rather than a guess from the `name` the pack passed in —
  // reword that label freely, the class does not move. See
  // internal-host-class.ts; no-op for every third-party upstream, which is why
  // this touches 481 packs' error text and changes none of it.
  return markInternalOrigin(
    `${name}: ${res.status}${detailSuffix(await readDetail(res))}`,
    res.url,
    res.status,
  );
}

/**
 * Just the upstream's own explanation — no name, no status.
 *
 * For a pack that has already said both in its own sentence. epo-ops reads
 * `EPO rejected this search as too large (HTTP 413) — ${httpErrorMessage(…)}`,
 * which rendered as `… (HTTP 413) — EPO: 413.` once the XML detail was being
 * dropped: the upstream named twice, the status twice, and the one thing EPO
 * actually said ("Not enough characters before truncation character") nowhere
 * (fleet #712). Returns '' when the body carries nothing readable, so a caller
 * can fall back to its own wording.
 */
async function upstreamDetail(res: Response): Promise<string> {
  return readDetail(res);
}

/**
 * Read a SUCCESSFUL response as JSON, failing loudly when it isn't JSON.
 *
 * `httpError` above only ever runs on `!res.ok`, which leaves the nastier half
 * of the problem unhandled: an upstream that answers **HTTP 200 with an HTML
 * page**. A bot wall, a login redirect, a maintenance interstitial and a CDN
 * error page are all 200s, so `res.ok` is true, and `res.json()` then throws
 * `Unexpected token '<', "<!DOCTYPE "... is not valid JSON`.
 *
 * That string is the problem. It names no upstream, carries no status, and
 * reads like a parser bug in Pipeworx — so it lands in the `error` tier, which
 * means "we have a defect", and the caller is told nothing they can act on.
 * data.govt.nz sat dead behind an Imperva challenge this way and every
 * status-code health check we own reported it green (7889a845). A zero-length
 * body has the same shape: `Unexpected end of JSON input`, seen this week on
 * uk-gazette (83% of external calls) and census.
 *
 * UNLIKE `httpError`, this one DOES classify, and the asymmetry is deliberate.
 * A 400 is genuinely ambiguous — often the caller's bad argument, sometimes a
 * query we built wrong — so blanket-classifying it would hide our own bugs.
 * There is no such ambiguity here: **no argument a caller can pass makes a JSON
 * API return an HTML page.** It is always the upstream, so `upstream_down:` is
 * a statement of fact rather than a guess, and it keeps these out of the
 * problem-tools list where they crowd out real defects.
 *
 *     const data = await parseJson<Feed>(res, 'UK Gazette');
 *
 * Call it only after the `!res.ok` check — on a failed response you want
 * `httpError`, which mines the body for the upstream's own explanation.
 */
async function parseJson<T>(res: Response, name: string): Promise<T> {
  let raw: string;
  try {
    raw = await res.text();
  } catch {
    throw new Error(
      `upstream_down: ${name} returned a body that could not be read (HTTP ${res.status}). ` +
        'The connection most likely dropped mid-response; retrying is reasonable.',
    );
  }

  const type = res.headers.get('content-type') ?? 'no content-type';

  if (!raw.trim()) {
    throw new Error(
      `upstream_down: ${name} answered HTTP ${res.status} with an EMPTY body where JSON was expected (${type}). ` +
        'Nothing about the request can cause this — it is an upstream fault, and the same call may well work on retry.',
    );
  }

  // Checked before parsing rather than in the catch, because knowing it is
  // markup is what turns "we failed to parse something" into "they served a
  // web page" — the second is diagnosable, the first is not.
  const head = raw.slice(0, 200).trimStart().toLowerCase();
  if (head.startsWith('<!doctype') || head.startsWith('<html') || head.startsWith('<?xml')) {
    const kind = head.startsWith('<?xml') ? 'an XML document' : 'an HTML page';
    // The summary, not the source. Pasting the first 120 characters of a web
    // page handed the agent `<!DOCTYPE html><html lang="en"…` — the same leak
    // this branch exists to describe (fleet #712).
    throw new Error(
      `upstream_down: ${name} answered HTTP ${res.status} with ${kind} instead of JSON (${type}). ` +
        'That is typically a bot wall, a login redirect or a maintenance page — it is returned as a SUCCESS, ' +
        `so status-code health checks read it as fine. No argument change will get past it. ` +
        `The page says: ${summarizeErrorBody(raw) || 'nothing readable'}`,
    );
  }

  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new Error(
      `upstream_down: ${name} answered HTTP ${res.status} with a body that is not valid JSON (${type}). ` +
        `It begins: ${stripMarkup(raw).slice(0, 120) || '(unreadable)'}`,
    );
  }
}

/**
 * `fetch`, but bounded — the fix for a systemic gap found 2026-08-30: a grep
 * audit of every pack's `mcps/*\/src/index.ts` found 1,339 of ~1,500 call
 * `fetch()` with NO timeout guard anywhere in the file. Two of those
 * (epo-ops, statcan) were confirmed live-hanging for 4-8 minutes before this
 * existed — every unguarded call carries the same risk, just unconfirmed.
 *
 * Mirrors the `epoFetch` wrapper `mcps/epo-ops/src/index.ts` shipped first:
 * bound the request with `AbortSignal.timeout`, and on a timeout/abort throw
 * an `upstream_down:` error that names the upstream and the bound rather than
 * letting the raw `TimeoutError`/`AbortError` (which names neither) propagate.
 * `upstream_down:` is deliberate, same reasoning as `parseJson` above — no
 * argument a caller passes can make an upstream hang, so it is always the
 * upstream's fault, and marking it that way keeps a slow API off the
 * problem-tools list where it would crowd out our own defects.
 *
 * Usage — a mechanical swap for a bare `fetch(url, init)`:
 *
 *     const res = await fetchWithTimeout(url, init, 'Some API');
 *
 * Pass `timeoutMs` as a fourth argument to override the default for a pack
 * with a known-slower upstream; the label should be the same short name you'd
 * pass to `httpError`/`httpErrorMessage` for that call.
 */
async function fetchWithTimeout(
  url: string | URL,
  init: RequestInit = {},
  name: string,
  timeoutMs: number = DEFAULT_FETCH_TIMEOUT_MS,
): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
      // States the OBSERVATION (no response in N seconds), not a diagnosis.
      // "appears to be degraded" is an inference about the vendor that we have
      // not checked, and it is wrong in a way that misdirects whoever reads it:
      // a timeout from a Worker can equally mean OUR egress is blocked.
      //
      // Measured today (2026-09-01, fleet #1047): every call to
      // mainnet.base.org failed from the x402 facilitator while the identical
      // request from a laptop returned 200. Base was entirely healthy; the
      // public RPC refuses Cloudflare Worker egress. Had this message fired
      // there it would have blamed Base by name, and the next person would have
      // waited for a vendor outage to clear that did not exist.
      // A timeout has no status to test — there is no response at all — so
      // `markInternalOrigin` is called without one: an origin we run that never
      // answered is an availability failure by definition. This is the half of
      // fleet #1096 with neither a SQLSTATE nor a status code to key on.
      throw new Error(
        markInternalOrigin(
          `upstream_down: ${name} did not respond within ${timeoutMs / 1000}s. ` +
            `That can be ${name} being slow or down, or this environment being unable to reach it ` +
            `(some hosts refuse datacenter/Worker egress) — retry shortly, and check reachability ` +
            `from elsewhere before concluding ${name} is down.`,
          url,
        ),
      );
    }
    throw err;
  }
}

function detailSuffix(detail: string): string {
  return detail ? ` — ${detail}` : '';
}

async function readDetail(res: Response): Promise<string> {
  let raw: string;
  try {
    raw = await res.text();
  } catch {
    // Body already consumed, or the connection died mid-read. The status alone
    // is still worth throwing — never let the error path throw its own error.
    return '';
  }
  return summarizeErrorBody(raw);
}

/**
 * Turn ANY error body — JSON, HTML, XML or plain text — into one short phrase
 * that never contains markup.
 *
 * This used to just drop an HTML or XML body on the floor, on the reasoning
 * that markup crowds out the status. That was half right. Dropping it loses the
 * one sentence a caller could have acted on: an `Access Denied` title, an SDMX
 * `<message:Error>` text, an OPS fault string. A 2026-08-30 support sweep
 * measured 13 of 291 caller-facing error rows carrying a raw page or document
 * verbatim, across 11 packs, and in every one of them the useful content —
 * "Access Denied", "Invalid country code", "SCRAPE_TIMEOUT" — was in there,
 * buried in markup the agent had to parse out of a string (fleet #712).
 *
 * So: extract the meaning, discard the markup. The output is passed through
 * `stripMarkup` unconditionally, which is what lets `check:error-body-leak`
 * assert mechanically that no caller-facing message can contain `<?xml`,
 * `<!DOCTYPE` or `<html`.
 */
function summarizeErrorBody(raw: string): string {
  if (!raw || !raw.trim()) return '';

  const head = raw.slice(0, 400).trimStart().toLowerCase();

  // An HTML error page (Cloudflare interstitial, nginx default, a login
  // redirect) says what it is in its <title>, and almost nowhere else.
  if (head.startsWith('<!doctype') || head.startsWith('<html')) {
    const title = htmlTitle(raw);
    return title
      ? `${title} (upstream returned an HTML error page, not an API response)`
      : 'upstream returned an HTML error page, not an API response';
  }

  // XML fault documents — EPO OPS, SDMX (`<message:Error>`), SOAP faults. The
  // human sentence sits in a child element whose tag name says what it is.
  if (head.startsWith('<?xml') || head.startsWith('<')) {
    const fault = xmlFaultText(raw);
    return fault
      ? `${stripMarkup(fault).slice(0, MAX_DETAIL)} (from the upstream's XML error document)`
      : 'upstream returned an XML error document with no readable message';
  }

  // Most JSON error bodies bury one human sentence among ids and echoed request
  // params. Prefer that sentence; fall back to the whole body when the shape is
  // unfamiliar, since an unfamiliar shape is exactly when we can least afford to
  // guess wrong and show nothing.
  const fromJson = messageFromJson(raw);
  return stripMarkup(fromJson ?? raw).slice(0, MAX_DETAIL);
}

/** The `<title>` of an HTML error page, or its first `<h1>` — the two places a
 *  bot wall, a 502 and an "Access Denied" all state what happened. */
function htmlTitle(raw: string): string | null {
  const head = raw.slice(0, 4000);
  for (const re of [/<title[^>]*>([\s\S]*?)<\/title>/i, /<h1[^>]*>([\s\S]*?)<\/h1>/i]) {
    const m = re.exec(head);
    const text = m ? stripMarkup(m[1]) : '';
    if (text) return text.slice(0, 160);
  }
  return null;
}

/** Tag names that carry the explanation in an XML fault document, namespace
 *  prefix optional (`<message:Error>`, `<com:Text>`, `<faultstring>`). */
const XML_FAULT_TAG_RE =
  /<(?:[A-Za-z0-9_.-]+:)?(?:text|message|description|faultstring|reason|detail|title|errormessage|error)\b[^>]*>([^<]{2,400})</i;

function xmlFaultText(raw: string): string | null {
  const head = raw.slice(0, 8000);
  const tagged = XML_FAULT_TAG_RE.exec(head);
  if (tagged && tagged[1].trim()) return tagged[1];

  // Nothing conventionally named — take the longest text node instead. A fault
  // document with one sentence in an oddly named element is still readable;
  // returning nothing at all is not.
  let best = '';
  for (const m of head.matchAll(/>([^<>]{8,400})</g)) {
    const text = m[1].trim();
    if (text.length > best.length) best = text;
  }
  return best || null;
}

/**
 * Remove every tag and stray angle bracket, then collapse whitespace.
 *
 * Applied to everything on the way out, including the JSON and plain-text
 * paths, because an upstream is free to embed markup in a JSON string field —
 * and a leak is a leak regardless of which branch produced it.
 */
function stripMarkup(s: string): string {
  return collapse(decodeEntities(s.replace(/<[^>]*>/g, ' ')).replace(/[<>]/g, ' '));
}

/** The handful of entities that show up in error-page titles. Decoded AFTER
 *  tags are stripped and BEFORE the angle-bracket sweep, so `&lt;script&gt;`
 *  in a title cannot decode into markup that survives — EMBL-EBI's ChEMBL 500
 *  page renders as `500 Internal Server Error &lt; EMBL-EBI` otherwise. */
function decodeEntities(s: string): string {
  return s
    .replace(/&(?:amp|#0*38);/gi, '&')
    .replace(/&(?:lt|#0*60);/gi, '<')
    .replace(/&(?:gt|#0*62);/gi, '>')
    .replace(/&(?:quot|#0*34);/gi, '"')
    .replace(/&(?:#0*39|apos|#x0*27);/gi, "'")
    .replace(/&nbsp;/gi, ' ');
}

/** The conventional "what went wrong" field, under any of the names upstreams
 *  actually use. Checked in order; first non-empty string wins. */
const MESSAGE_KEYS = [
  'message', 'error_message', 'errorMessage', 'detail', 'details',
  'description', 'error_description', 'reason', 'title', 'fault',
];

function messageFromJson(raw: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  return pickMessage(parsed, 0);
}

function pickMessage(node: unknown, depth: number): string | null {
  // Two levels covers `{error: {message}}` and `{errors: [{detail}]}`, the two
  // shapes that account for nearly all of them, without walking a large payload.
  if (depth > 2 || node == null) return null;

  if (typeof node === 'string') return node.trim() || null;

  if (Array.isArray(node)) {
    for (const item of node) {
      const found = pickMessage(item, depth + 1);
      if (found) return found;
    }
    return null;
  }

  if (typeof node !== 'object') return null;
  const obj = node as Record<string, unknown>;

  for (const key of MESSAGE_KEYS) {
    const v = obj[key];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  // `{error: …}` where error is itself an object or a string — the single most
  // common wrapper, so it is worth descending into by name rather than scanning
  // every key and risking picking up an echoed request parameter.
  for (const key of ['error', 'errors', 'fault', 'Error', 'data']) {
    if (key in obj) {
      const found = pickMessage(obj[key], depth + 1);
      if (found) return found;
    }
  }
  return null;
}

/** Errors are read in a single line of log output; newlines and runs of
 *  whitespace make a multi-line body unreadable there. */
function collapse(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}
/**
 * Statistics Estonia (andmed.stat.ee) PxWeb MCP. Keyless.
 *
 * PxWeb API: navigate the subject tree (items are type "l" = folder or "t" = table),
 * fetch table metadata, then POST a query to pull data.
 *
 * Table codes carry a ".px" suffix (the API serves them uppercase, e.g. "RV021.PX",
 * but the suffix is case-insensitive). The table id returned by the tree already
 * includes the suffix, so a full table path looks like
 *   rahvastik/rahvastikunaitajad-ja-koosseis/rahvaarv-ja-rahvastiku-koosseis/RV021.PX
 *
 * PxWeb enforces a per-query cell limit (~100k cells). Large tables (many years ×
 * age groups × counties) will be rejected unless you filter — use table_meta to read
 * the variables and pass a narrow {filter:"item", values:[...]} selection per dimension.
 */


// Bound every fetch() in this pack to a fixed timeout — an upstream that
// degrades without erroring would otherwise hold the Worker in `await fetch()`
// until its own execution budget kills the request (minutes, not seconds).
// Mirrors the epoFetch / usaspending retryFetch pattern (fleet #685).
async function pwFetch(url: string | URL, init?: RequestInit): Promise<Response> {
  return fetchWithTimeout(url, init ?? {}, 'Statistics Estonia');
}

const BASE = 'https://andmed.stat.ee/api/v1/en/stat';
const UA = 'pipeworx-mcp-stat-ee/1.0 (+https://pipeworx.io)';

// --- stat_ee_find_table tree-walk budget -----------------------------------
// The full subject tree is 486 folder listings deep-first (measured 2026-08-01:
// 7 folders at level 1, 57 at level 2, 223 at level 3, 184 at level 4, 14 at
// level 5) carrying ~5,000 tables. Fetching all of it takes ~26s at
// concurrency 16 — far past what a gateway caller will wait for.
//
// So the walk is relevance-guided: expand every folder for SEED_DEPTH levels,
// then descend only into folders whose own label or an ancestor's label already
// hit a query word. "wage" opens Economy > Wages and salaries and labour costs
// at level 2 and leaves the other 200-odd branches unfetched — 17 listings,
// ~2.4s, and it still reaches the tables at level 5.
//
// SEED_DEPTH 2 is the cheap seed (8 listings reveal every level-2 label). Some
// topics are only named deeper than that — "Unemployed persons" is a level-3
// folder under the neutrally-named "Labour market", so a seed that stops at
// level 2 never sees the word at all. Rather than make every call pay for the
// wide seed, findTable retries once at WIDE_SEED_DEPTH when the cheap pass
// comes back empty (65 listings, ~5s), reusing the first pass's cache.
const SEED_DEPTH = 2;
const WIDE_SEED_DEPTH = 3;
const DEFAULT_MAX_DEPTH = 5;   // deepest level that holds tables
const HARD_MAX_DEPTH = 6;
const MAX_LISTINGS = 220;      // hard cap on folder fetches per call
const CONCURRENCY = 12;        // parallel listings per round
const TIME_BUDGET_MS = 20_000; // stop and report truncated rather than hang

const WAGE_TABLE = 'majandus/palk-ja-toojeukulu/palk/luhiajastatistika/PA111.px';
/** PA111 indicator codes. The median is GR_W_D5 (the 5th decile) — there is no
 *  GR_W_MED, and guessing that name is a 400 from PxWeb, not an empty result. */
const WAGE_CODES = { GR_W_AVG: 'average_gross_monthly_eur', GR_W_D5: 'median_gross_monthly_eur', GR_W_AVG_SM: 'average_change_yoy_pct' } as const;

const tools: McpToolExport['tools'] = [
  {
    name: 'stat_ee_find_table',
    description: 'Search Statistics Estonia (Statistikaamet) for ESTONIA official statistics tables by plain-English keyword — "average monthly wage", "population", "GDP", "unemployment", "consumer price index", "births", "exports". Returns each matching table with its full ready-to-use path, its English label chain (e.g. "Economy > Wages and salaries and labour costs > Wages and salaries"), and whether it is a folder or a table. START HERE for any question about Estonian data. Set fetch_latest:true to also return the most recent figures from the top-matching table in one call — useful for "what is the current X in Estonia" questions. Otherwise hand the returned path to table_meta, then query_table, to get the figures. Searches English labels, so English words find the table even though the path ids themselves are Estonian slugs.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Plain-English words describing the statistic, e.g. "average monthly wage", "unemployment rate", "population by county". All words must appear somewhere in a match\'s label chain.' },
        path: { type: 'string', description: 'Optional sub-path to search under, e.g. "majandus" (Economy) or "rahvastik" (Population). Default searches the whole tree.' },
        limit: { type: 'number', description: 'Max matches to return (default 25, max 100).' },
        max_depth: { type: 'number', description: `Levels of the subject tree to walk below the starting path (default ${DEFAULT_MAX_DEPTH}, max ${HARD_MAX_DEPTH}). Tables sit 4-5 levels below the root.` },
        fetch_latest: { type: 'boolean', description: 'When true and the top match is a queryable table (.px), automatically fetches the most recent period\'s data from that table and includes it as "latest_data" in the response. Use this when you want the actual figure ("what is the average monthly wage in Estonia?") rather than just discovering the table path. Default false.' },
      },
      required: ['query'],
    },
  },
  {
    name: 'estonia_average_wage',
    description:
      "Estonia's average and MEDIAN monthly gross wage in ONE call, from Statistics Estonia " +
      "(Statistikaamet, table PA111), keyless, with the recent quarterly trend. PREFER for \"what is the " +
      "average wage in Estonia\", \"Estonian salary\", \"average monthly wage in Estonia according to " +
      "official statistics\", \"are Estonian wages rising\". GROSS (before income tax and the employee's " +
      "share of contributions) and per EMPLOYEE POSITION, so somebody holding two jobs is counted twice. " +
      "Use subjects/table_meta/query_table for breakdowns by economic activity or county.",
    inputSchema: {
      type: 'object',
      properties: {
        quarters: { type: 'number', description: 'How many recent quarters to include (1-40, default 8). Headline fields describe the newest.' },
      },
    },
  },
  {
    name: 'subjects',
    description: 'Browse Statistics Estonia (Statistikaamet) official ESTONIA national statistics — the subject tree of available tables, one level at a time. Items are type "l" (folder) or "t" (table, id ends in .px). Handy for listing everything under a path you already know; to go straight from an English question ("average monthly wage in Estonia") to a table path in one call, use stat_ee_find_table. Follow either with table_meta + query_table to pull the actual figures.',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Sub-path under /stat/ (default empty = root). e.g. "rahvastik/rahvastikunaitajad-ja-koosseis"' } },
    },
  },
  {
    name: 'table_meta',
    description: 'Table definition (dimensions, valid values) for a Statistics Estonia table. Use these to build a filtered query_table call.',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string', description: 'e.g. "rahvastik/rahvastikunaitajad-ja-koosseis/rahvaarv-ja-rahvastiku-koosseis/RV021.PX"' } },
      required: ['path'],
    },
  },
  {
    name: 'query_table',
    description: 'Pull ESTONIA official statistics figures from a Statistics Estonia (Statistikaamet) table — wages, population, GDP, prices, unemployment. body is a PxWeb query object; get valid dimension values from table_meta first. Filter selections to stay under the ~100k-cell limit.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Table path ending in .px, e.g. ".../RV021.PX"' },
        body: { type: 'object', description: '{query: [{code, selection: {filter, values}}], response: {format: "json-stat2"}}' },
      },
      required: ['path', 'body'],
    },
  },
];

async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case 'stat_ee_find_table':
      return findTable(args);
    case 'subjects': {
      const path = (args.path as string | undefined)?.replace(/^\/+|\/+$/g, '') ?? '';
      return statGet(path ? `/${path}` : '');
    }
    case 'table_meta':
      return statGet(`/${reqStr(args, 'path', '"rahvastik/rahvastikunaitajad-ja-koosseis/rahvaarv-ja-rahvastiku-koosseis/RV021.PX"').replace(/^\/+|\/+$/g, '')}`);
    case 'estonia_average_wage': {
      const quarters = Math.min(40, Math.max(1, Number(args.quarters) || 8));
      const res = await pwFetch(`${BASE}/${WAGE_TABLE}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': UA },
        body: JSON.stringify({
          query: [
            { code: 'Näitaja', selection: { filter: 'item', values: Object.keys(WAGE_CODES) } },
            { code: 'Tegevusala', selection: { filter: 'item', values: ['TOTAL'] } },
          ],
          response: { format: 'json-stat2' },
        }),
      });
      if (!res.ok) {
        const detail = await res.text().then((t) => t.replace(/\s+/g, ' ').trim().slice(0, 200));
        throw new Error(`Statistics Estonia rejected the wage query (${res.status}): ${detail}`);
      }
      const body = (await res.json()) as {
        value?: Array<number | null>;
        dimension?: Record<string, { category?: { index?: Record<string, number> } }>;
      };
      const dim = body.dimension ?? {};
      const periodIdx = dim.Vaatlusperiood?.category?.index ?? {};
      const indIdx = dim['Näitaja']?.category?.index ?? {};
      const values = body.value ?? [];
      const periods = Object.keys(periodIdx).sort((a, b) => periodIdx[a]! - periodIdx[b]!);
      if (!periods.length) throw new Error('Statistics Estonia returned no periods for PA111.');
      // json-stat2 is a flat array over dims in `id` order: Näitaja x Tegevusala(1) x Vaatlusperiood.
      const at = (code: string, period: string): number | null => {
        const i = indIdx[code];
        const p = periodIdx[period];
        if (i === undefined || p === undefined) return null;
        const v = values[i * periods.length + p];
        return typeof v === 'number' ? v : null;
      };
      const recent = periods.slice(-quarters).reverse();
      const row = (p: string): { period: string } & Record<string, number | null | string> => {
        const out: Record<string, number | null> = {};
        for (const [code, field] of Object.entries(WAGE_CODES)) out[field] = at(code, p);
        return { period: p, ...out };
      };
      const latest = row(recent[0]!);
      return {
        country: 'Estonia',
        as_of: latest.period as string,
        currency: 'EUR',
        average_gross_monthly_eur: latest.average_gross_monthly_eur,
        median_gross_monthly_eur: latest.median_gross_monthly_eur,
        average_change_yoy_pct: latest.average_change_yoy_pct,
        series: recent.map(row),
        table_id: 'PA111',
        source: 'Statistics Estonia (Statistikaamet)',
        interpretation:
          'GROSS wages — before income tax and the employee share of social contributions, so take-home pay ' +
          'is materially lower. Counted per EMPLOYEE POSITION, not per person, so somebody with two jobs is ' +
          'counted twice. The median sits well below the average because the distribution is right-skewed; ' +
          'quote the median if you mean "what a typical Estonian earns".',
      };
    }
    case 'query_table': {
      const path = reqStr(args, 'path', '"rahvastik/rahvastikunaitajad-ja-koosseis/rahvaarv-ja-rahvastiku-koosseis/RV021.PX"').replace(/^\/+|\/+$/g, '');
      const body = args.body;
      if (!body || typeof body !== 'object') throw new Error('body must be a PxWeb query object.');
      const res = await pwFetch(`${BASE}/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': UA },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const detail = await res.text().then((t) => t.replace(/\s+/g, ' ').trim().slice(0, 200));
        // PxWeb uses a bare 400 for three different caller mistakes here — a
        // table path that doesn't exist, a query naming a dimension or value the
        // table doesn't have, and a selection over the ~100k-cell limit — and it
        // rarely says which. Name all three rather than relay an empty body.
        if (res.status === 400) {
          throw new Error(
            `Statistics Estonia rejected this query for "${path}"${detail ? ` — ${detail}` : ''}. ` +
            `A 400 here is almost always one of: (1) the table path does not exist — ids are ESTONIAN ` +
            `slugs and the table code needs its .px suffix, e.g. ` +
            `"rahvastik/rahvastikunaitajad-ja-koosseis/rahvaarv-ja-rahvastiku-koosseis/RV021.PX"; ` +
            `(2) the query names a dimension code or value the table does not have; or (3) the selection ` +
            `exceeds the ~100k-cell limit. Call table_meta({path:"${path}"}) to read the exact dimension ` +
            `codes and values, then filter each dimension with {filter:"item", values:[...]}.`,
          );
        }
        throw new Error(`Statistics Estonia: ${res.status} ${detail}`);
      }
      return res.json();
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

interface TreeItem { id?: string; type?: string; text?: string; updated?: string }

/**
 * Keyword search over the subject tree.
 *
 * The pack's standing trap is that subject ids are ESTONIAN slugs while the
 * labels the API returns are ENGLISH. Browsing therefore asks an agent to guess
 * Estonian, and one wrong guess at any level dead-ends: the live failure this
 * tool exists to fix was a model that correctly produced "palk-ja-toojoumaksumus"
 * for "wages and labour cost" and hung it off the wrong parent (the real path is
 * majandus/palk-ja-toojeukulu). But the same asymmetry is the fix — English
 * labels mean an English question can be matched directly, and the walk hands
 * back the Estonian path so the caller never has to spell one.
 */
async function findTable(args: Record<string, unknown>): Promise<unknown> {
  const query = reqStr(args, 'query', '"average monthly wage"');
  const words = normalize(query).split(' ').filter(Boolean);
  if (!words.length) throw new Error('Argument "query" needs at least one searchable word, e.g. "average monthly wage".');

  const root = (args.path as string | undefined)?.replace(/^\/+|\/+$/g, '') ?? '';
  const limit = clampInt(args.limit, 25, 1, 100);
  const maxDepth = clampInt(args.max_depth, DEFAULT_MAX_DEPTH, 1, HARD_MAX_DEPTH);
  const fetchLatest = args.fetch_latest === true;

  const deadline = Date.now() + TIME_BUDGET_MS;
  // One cache across both passes, so the wide retry below only pays for the
  // listings the narrow pass didn't already fetch.
  const cache = new Map<string, TreeItem[]>();
  const state = { listings: 0, truncated: false, deepest: 0 };

  // Pass 1 is cheap: expand everything for SEED_DEPTH levels, then only folders
  // whose own or an ancestor's label already hit a query word. That answers
  // "wage" in ~17 listings because "Wages and salaries and labour costs" sits at
  // level 2. Pass 2 only runs when pass 1 found nothing — some subject areas
  // name the topic deeper than the seed reaches ("Unemployed persons" is a
  // level-3 folder under the neutrally-named "Labour market"), and paying for
  // the wider seed on every call would make the fast queries slow too.
  let hits = await walkTree(words, root, SEED_DEPTH, maxDepth, cache, state, deadline);
  if (!hits.length && !state.truncated && SEED_DEPTH < WIDE_SEED_DEPTH) {
    hits = await walkTree(words, root, WIDE_SEED_DEPTH, maxDepth, cache, state, deadline);
  }

  hits.sort((a, b) => b.score - a.score || a.path.length - b.path.length);
  const matches = hits.slice(0, limit).map(({ score, ...m }) => m);

  const { listings, truncated, deepest: deepestReached } = state;
  const searched = {
    root: root || '(whole subject tree)',
    folder_listings_fetched: listings,
    deepest_level_reached: deepestReached,
    max_depth: maxDepth,
  };

  let latestData: unknown;
  if (fetchLatest && matches.length > 0) {
    const topTable = matches.find((m) => m.type === 't');
    if (topTable) latestData = await fetchLatestFromTable(topTable.path);
  }

  if (!matches.length) {
    return {
      found: false,
      reason: 'no_matching_table',
      query,
      searched,
      truncated,
      hint:
        `No Statistics Estonia table label contains all of: ${words.map((w) => `"${w}"`).join(', ')}. ` +
        `Every word has to appear somewhere in a table's English label chain, so try fewer or broader words — ` +
        `"wage" instead of "average monthly gross wage", "population" instead of "resident population by county". ` +
        `The seven top-level areas are "majandus" (Economy — wages, prices, GDP, trade, industry, tourism), ` +
        `"rahvastik" (Population — population figures, births, deaths, migration), "sotsiaalelu" (Social life — ` +
        `labour market, unemployment, education, health, income, households), "keskkond" (Environment), ` +
        `"eri-valdkondade-statistika" (Multidomain statistics — integration, youth, Tallinn), "rahvaloendus" ` +
        `(Population and Housing Census — the 2000/2011/2021 census rounds) and "Lepetatud_tabelid" ` +
        `(Discontinued datasets). Pass one of those as "path" to search inside it, or call subjects() to browse ` +
        `a level at a time.`,
    };
  }

  return {
    found: true,
    query,
    match_count: matches.length,
    matches,
    ...(latestData !== undefined ? { latest_data: latestData } : {}),
    truncated,
    searched,
    next_step:
      `Pass a match's "path" (type "t" entries end in .px and are the queryable tables) to ` +
      `table_meta({path}) to read its dimension codes and values, then query_table({path, body}) to pull figures.`,
    ...(truncated
      ? {
          truncation_note:
            `The walk stopped at its budget (${MAX_LISTINGS} folder listings / ${TIME_BUDGET_MS / 1000}s), so parts ` +
            `of the tree below the areas listed in "searched" were not opened and this list may be incomplete. ` +
            `Narrow the search with "path" (e.g. "majandus") to search a subtree exhaustively.`,
        }
      : {}),
  };
}

interface PxVariable { code: string; text: string; values: string[]; valueTexts: string[]; time?: boolean; elimination?: boolean }

const TIME_CODE_RE = /^(TLIST|Aasta|Kuu|Kvartal)/i;
const TIME_TEXT_RE = /^(year|quarter|month|period)/i;

async function fetchLatestFromTable(path: string): Promise<unknown> {
  let vars: PxVariable[];
  try {
    const raw = await statGet(`/${path.replace(/^\/+/, '')}`);
    // PxWeb v1 returns a bare array for some endpoints and a wrapped object
    // {"variables": [...], "title": "..."} for others (table-level GET).
    if (Array.isArray(raw)) {
      vars = raw as PxVariable[];
    } else if (raw && typeof raw === 'object' && Array.isArray((raw as { variables?: unknown }).variables)) {
      vars = (raw as { variables: PxVariable[] }).variables;
    } else {
      return { error: 'Unexpected metadata format — could not determine table structure.' };
    }
  } catch (e) {
    return { error: `Could not fetch table metadata for ${path}: ${e instanceof Error ? e.message : String(e)}` };
  }

  // PxWeb marks time dimensions with `time: true`; fall back to name heuristics
  // when that field is absent (older PxWeb versions omit it).
  const isTime = (v: PxVariable) => v.time === true || TIME_CODE_RE.test(v.code) || TIME_TEXT_RE.test(v.text);
  const timeDims = vars.filter(isTime);
  if (!timeDims.length) {
    return { note: 'No time dimension identified; use table_meta + query_table to retrieve figures.', variables: vars };
  }

  const nonTimeCells = vars
    .filter((v) => !isTime(v))
    .reduce((acc, v) => acc * (v.values.length || 1), 1);
  if (nonTimeCells > 1000) {
    return {
      note: `This table has ${nonTimeCells} non-time dimension combinations — too many to auto-fetch. Call table_meta({path:"${path}"}) to read dimensions, then query_table with specific filters.`,
      table_path: path,
      variables: vars.map((v) => ({ code: v.code, text: v.text, n_values: v.values.length })),
    };
  }

  const query = timeDims.map((v) => ({ code: v.code, selection: { filter: 'top', values: ['1'] } }));

  try {
    const res = await pwFetch(`${BASE}/${path.replace(/^\/+/, '')}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': UA },
      body: JSON.stringify({ query, response: { format: 'json-stat2' } }),
    });
    if (!res.ok) {
      const detail = await res.text().then((t) => t.replace(/\s+/g, ' ').trim().slice(0, 200));
      return { error: `Data fetch failed for ${path}: ${res.status}${detail ? ` — ${detail}` : ''}` };
    }
    return await res.json();
  } catch (e) {
    return { error: `Data fetch failed for ${path}: ${e instanceof Error ? e.message : String(e)}` };
  }
}

interface Hit { path: string; type: string; label_chain: string; score: number; updated?: string }
interface WalkState { listings: number; truncated: boolean; deepest: number }

/** Breadth-first walk with a seed depth, a listing cap and a wall-clock deadline. */
async function walkTree(
  words: string[],
  root: string,
  seedDepth: number,
  maxDepth: number,
  cache: Map<string, TreeItem[]>,
  state: WalkState,
  deadline: number,
): Promise<Hit[]> {
  const hits: Hit[] = [];
  let frontier: Array<{ path: string; labels: string[]; matched: boolean }> = [
    { path: root, labels: root ? [root] : [], matched: false },
  ];

  for (let depth = 0; depth < maxDepth && frontier.length; depth++) {
    const expandable = depth < seedDepth ? frontier : frontier.filter((n) => n.matched);
    if (!expandable.length) break;

    // Cached listings are free — they don't count against the cap.
    const uncachedCost = expandable.filter((n) => !cache.has(n.path)).length;
    let batch = expandable;
    if (state.listings + uncachedCost > MAX_LISTINGS) {
      let budget = MAX_LISTINGS - state.listings;
      batch = expandable.filter((n) => cache.has(n.path) || budget-- > 0);
      state.truncated = true;
    }
    if (!batch.length) break;

    const next: typeof frontier = [];
    let ranOut = false;
    for (let i = 0; i < batch.length; i += CONCURRENCY) {
      if (Date.now() > deadline) {
        state.truncated = true;
        ranOut = true;
        break;
      }
      const slice = batch.slice(i, i + CONCURRENCY);
      const listed = await Promise.all(
        slice.map(async (n) => {
          const cached = cache.get(n.path);
          if (cached) return cached;
          state.listings++;
          const children = await listChildren(n.path);
          cache.set(n.path, children);
          return children;
        }),
      );
      listed.forEach((children, k) => {
        const node = slice[k];
        for (const c of children) {
          if (!c.id) continue;
          const label = c.text ?? c.id;
          const labels = [...node.labels, label];
          const path = node.path ? `${node.path}/${c.id}` : c.id;
          state.deepest = Math.max(state.deepest, labels.length);

          const score = scoreMatch(words, labels, c.type ?? 'l', c.updated);
          if (score > 0) hits.push({ path, type: c.type ?? 'l', label_chain: labels.join(' > '), score, updated: c.updated });
          if (c.type === 'l') next.push({ path, labels, matched: node.matched || hitsAnyWord(words, label) });
        }
      });
    }
    if (ranOut) break;
    // Matched folders still queued when we hit the depth ceiling means there is
    // more tree we chose not to open — say so rather than imply completeness.
    if (depth + 1 >= maxDepth && next.some((n) => n.matched)) state.truncated = true;
    frontier = next;
  }
  return hits;
}

async function listChildren(path: string): Promise<TreeItem[]> {
  try {
    const res = await pwFetch(`${BASE}${path ? `/${path}` : ''}`, {
      headers: { Accept: 'application/json', 'User-Agent': UA },
    });
    if (!res.ok) return [];
    const j = await res.json();
    return Array.isArray(j) ? (j as TreeItem[]) : [];
  } catch {
    // One unreachable branch shouldn't sink the whole search.
    return [];
  }
}

/** Lowercase, strip diacritics, and reduce punctuation to spaces. */
function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// Statistics Estonia labels a topic with whatever inflection reads best —
// "Unemployed persons", "Wages and salaries", "Live births" — while callers ask
// in another one ("unemployment", "wage", "birth rate"). Substring matching
// alone silently misses those, which reads to the caller as "Estonia has no
// unemployment data". A crude suffix strip covers the cases that matter.
const SUFFIXES = ['ements', 'ement', 'ments', 'ment', 'ations', 'ation', 'ings', 'ing', 'ies', 'ied', 'ed', 'es', 's'];

function stem(word: string): string {
  for (const suf of SUFFIXES) {
    if (word.endsWith(suf) && word.length - suf.length >= 4) return word.slice(0, word.length - suf.length);
  }
  return word;
}

/** Substring match on the word or its stem ("unemployment" finds "Unemployed"). */
function wordIn(word: string, hay: string): boolean {
  if (hay.includes(word)) return true;
  const s = stem(word);
  return s !== word && hay.includes(s);
}

function hitsAnyWord(words: string[], label: string): boolean {
  const hay = normalize(label);
  return words.some((w) => wordIn(w, hay));
}

/**
 * 0 = no match. Every word must appear somewhere in the label chain; a chain
 * that carries them all on its own leaf outranks one that only assembles them
 * from ancestors, and a queryable table outranks the folder holding it.
 *
 * Freshness is part of the rank, not a detail. Statistics Estonia keeps decades
 * of frozen census rounds in the same tree as the live series, and they match
 * the obvious words best: bare "population" hits POPULATION BY RELIGIOUS
 * AFFILIATION from the 2000 census before it hits the current population
 * figures. Someone asking about Estonia today means the maintained table, so a
 * table's own `updated` stamp breaks the tie.
 */
function scoreMatch(words: string[], labels: string[], type: string, updated?: string): number {
  const leaf = normalize(labels[labels.length - 1] ?? '');
  const chain = normalize(labels.join(' '));
  if (!words.every((w) => wordIn(w, chain))) return 0;

  let score = 10;
  const inLeaf = words.filter((w) => wordIn(w, leaf)).length;
  score += inLeaf * 20;
  if (inLeaf === words.length) score += 60;
  const phrase = words.join(' ');
  if (leaf.includes(phrase)) score += 40;
  // Table labels are prefixed with their code ("rv021 population by sex..."),
  // so the subject starts at the second token. A label that LEADS with the
  // query is about it; one that mentions it in passing ("deaths by cause per
  // 100,000 population") is not.
  if (leaf.replace(/^[a-z0-9]+ /, '').startsWith(phrase)) score += 25;
  if (type === 't') score += 15;
  score -= labels.length * 2;

  // Statistics Estonia keeps frozen vintages in the same tree as the live
  // series — census rounds ("Population and Housing Census 2000") and an
  // explicit "Discontinued datasets" branch. They match generic words as well
  // as the maintained tables do and their `updated` stamps get refreshed by
  // republication, so the label chain is the only thing that tells them apart.
  const ancestors = labels.slice(0, -1).map(normalize);
  if (ancestors.some((a) => /\b(19|20)\d{2}\b/.test(a))) score -= 25;
  if (ancestors.some((a) => a.includes('discontinued') || a.includes('archive'))) score -= 60;

  // Computed per call, never at module scope — a Worker's module-scope clock is
  // frozen at the epoch.
  const stamp = updated ? Date.parse(updated) : NaN;
  if (Number.isFinite(stamp)) {
    const years = (Date.now() - stamp) / (365.25 * 24 * 3600 * 1000);
    if (years <= 1.5) score += 30;
    else if (years <= 4) score += 12;
    else score -= 20;
  }
  return score;
}

function clampInt(v: unknown, dflt: number, min: number, max: number): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  if (!Number.isFinite(n)) return dflt;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

/**
 * PxWeb answers a path that doesn't exist with a bare `400 Bad Request` and no
 * body worth reading — and the trap that produces it is specific and repeatable:
 *
 *   the subject-tree ids are ESTONIAN slugs (`rahvastik`, `majandus`) even
 *   though the API is served under /en/ and returns ENGLISH labels
 *   ("Population", "Economy").
 *
 * So an agent reads "Population" off one call, passes `population` to the next,
 * and gets 400 with nothing to act on. That was 10 failures in the week of
 * 2026-07-29, 8 of them from registered callers — the top registered error on
 * the platform after BIS.
 *
 * Rather than relay the 400, walk up to the parent level, list what actually
 * exists there, and — the part that fixes the real failure — match the caller's
 * guess against the English labels so we can name the Estonian id they wanted.
 */
async function explain400(path: string): Promise<string> {
  const segments = path.replace(/^\/+/, '').split('/').filter(Boolean);
  const wanted = segments[segments.length - 1] ?? '';
  const parentPath = segments.slice(0, -1).join('/');

  let children: TreeItem[] = [];
  try {
    const res = await pwFetch(`${BASE}${parentPath ? `/${parentPath}` : ''}`, {
      headers: { Accept: 'application/json', 'User-Agent': UA },
    });
    if (res.ok) {
      const j = await res.json();
      if (Array.isArray(j)) children = j as TreeItem[];
    }
  } catch {
    // Parent lookup is best-effort; fall through to the generic hint below.
  }

  const where = parentPath ? `"${parentPath}"` : 'the root of the subject tree';
  if (!children.length) {
    return (
      `Subject path "${wanted}" does not exist under ${where}. Note that subject ids are ESTONIAN ` +
      `slugs (e.g. "rahvastik" = Population, "majandus" = Economy) even though the API returns ` +
      `English labels. Call subjects({path:"${parentPath}"}) to list the valid ids at that level.`
    );
  }

  // Did they pass an English label (or part of one) instead of the Estonian id?
  const guess = wanted.toLowerCase().replace(/[-_\s]+/g, ' ').trim();
  const hit = guess
    ? children.find((c) => {
        const label = (c.text ?? '').toLowerCase();
        return label === guess || label.startsWith(guess) || guess.startsWith(label);
      })
    : undefined;

  const listing = children
    .slice(0, 25)
    .map((c) => `  ${c.id}${c.type === 't' ? ' (table)' : ''} — ${c.text ?? ''}`)
    .join('\n');

  return (
    `Subject path "${wanted}" does not exist under ${where}.` +
    (hit
      ? ` You probably want id "${hit.id}", which is the one labelled "${hit.text}" — subject ids are ` +
        `ESTONIAN slugs even though the API returns English labels, so the label is not the id.`
      : ` Subject ids are ESTONIAN slugs (e.g. "rahvastik" = Population) even though the API returns ` +
        `English labels, so passing the English label will not work.`) +
    `\nValid ids at that level:\n${listing}` +
    (children.length > 25 ? `\n  …and ${children.length - 25} more` : '')
  );
}

async function statGet(path: string): Promise<unknown> {
  // No trailing slash on the bare base — andmed.stat.ee 302-redirects "/stat/" to "/stat".
  const res = await pwFetch(`${BASE}${path}`, { headers: { Accept: 'application/json', 'User-Agent': UA } });
  if (!res.ok) {
    // 400 here means "no such path", not a malformed request — turn it into
    // navigation the caller can act on. The wording deliberately trips
    // classifyToolError's user_error patterns: this is a caller mistake, and
    // logging it as our failure is what buried it behind BIS for a week.
    if (res.status === 400) throw new Error(await explain400(path));
    throw new Error(`Statistics Estonia: ${res.status} ${await res.text().then((t) => t.slice(0, 200))}`);
  }
  return res.json();
}

function reqStr(args: Record<string, unknown>, key: string, example: string): string {
  const v = args[key];
  if (typeof v !== 'string' || !v.trim()) throw new Error(`Required argument "${key}" is missing. Pass a string like ${example}.`);
  return v;
}

export default { tools, callTool, meter: { credits: 1 } } satisfies McpToolExport;
