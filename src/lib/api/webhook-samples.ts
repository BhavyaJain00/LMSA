import { SIGNATURE_HEADER, SIGNATURE_TOLERANCE_SECONDS } from "@/lib/webhooks/signature";

/**
 * Receiver-side signature checks for the /developers page, in the languages
 * integrators use most. Each one follows `verifyWebhookSignature` in
 * `src/lib/webhooks/signature.ts`: parse `t` and every `v1`, refuse stale
 * timestamps, recompute HMAC-SHA256 over `<t>.<raw body>` with the whole
 * secret (including `whsec_`) and compare in constant time. The Node.js
 * sample is executed by the tests against real signed requests.
 */

const header = SIGNATURE_HEADER.toLowerCase();

export const NODE_VERIFY_SAMPLE = `import { createHmac, timingSafeEqual } from "node:crypto";

/** True when the ${SIGNATURE_HEADER} header matches the raw request body. */
export function verifyLearnLoopSignature(rawBody, header, secret, toleranceSeconds = ${SIGNATURE_TOLERANCE_SECONDS}) {
  let timestamp = null;
  const signatures = [];
  for (const part of String(header ?? "").split(",")) {
    const [key, value = ""] = part.trim().split("=");
    if (key === "t" && /^\\d+$/.test(value)) timestamp = Number(value);
    if (key === "v1") signatures.push(value);
  }
  if (timestamp === null || signatures.length === 0) return false;
  if (Math.abs(Date.now() / 1000 - timestamp) > toleranceSeconds) return false;
  const expected = createHmac("sha256", secret).update(\`\${timestamp}.\${rawBody}\`).digest();
  return signatures.some((signature) => {
    const given = Buffer.from(signature, "hex");
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}

// Express: keep the raw body, verify, then parse.
// app.post("/webhooks/learnloop", express.raw({ type: "application/json" }), (req, res) => {
//   const raw = req.body.toString("utf8");
//   if (!verifyLearnLoopSignature(raw, req.get("${SIGNATURE_HEADER}"), process.env.LEARNLOOP_WEBHOOK_SECRET)) return res.sendStatus(400);
//   const event = JSON.parse(raw);
//   res.sendStatus(200); // answer fast, handle event.type afterwards
// });`;

export const PYTHON_VERIFY_SAMPLE = `import hashlib
import hmac
import time


def verify_learnloop_signature(raw_body: bytes, header: str, secret: str, tolerance: int = ${SIGNATURE_TOLERANCE_SECONDS}) -> bool:
    timestamp, signatures = None, []
    for part in (header or "").split(","):
        key, _, value = part.strip().partition("=")
        if key == "t" and value.isdigit():
            timestamp = int(value)
        elif key == "v1":
            signatures.append(value)
    if timestamp is None or not signatures or abs(time.time() - timestamp) > tolerance:
        return False
    expected = hmac.new(secret.encode(), f"{timestamp}.".encode() + raw_body, hashlib.sha256).hexdigest()
    return any(hmac.compare_digest(expected, signature) for signature in signatures)


# Flask:
# @app.post("/webhooks/learnloop")
# def learnloop_webhook():
#     if not verify_learnloop_signature(request.get_data(), request.headers.get("${SIGNATURE_HEADER}"), os.environ["LEARNLOOP_WEBHOOK_SECRET"]):
#         abort(400)
#     event = request.get_json()
#     return "", 200`;

export const PHP_VERIFY_SAMPLE = `<?php
function verify_learnloop_signature(string $rawBody, ?string $header, string $secret, int $tolerance = ${SIGNATURE_TOLERANCE_SECONDS}): bool
{
    $timestamp = null;
    $signatures = [];
    foreach (explode(',', (string) $header) as $part) {
        [$key, $value] = array_pad(explode('=', trim($part), 2), 2, '');
        if ($key === 't' && ctype_digit($value)) $timestamp = (int) $value;
        if ($key === 'v1') $signatures[] = $value;
    }
    if ($timestamp === null || !$signatures || abs(time() - $timestamp) > $tolerance) return false;
    $expected = hash_hmac('sha256', $timestamp . '.' . $rawBody, $secret);
    foreach ($signatures as $signature) {
        if (hash_equals($expected, $signature)) return true;
    }
    return false;
}

$raw = file_get_contents('php://input');
if (!verify_learnloop_signature($raw, $_SERVER['HTTP_${header.toUpperCase().replace(/-/g, "_")}'] ?? null, getenv('LEARNLOOP_WEBHOOK_SECRET'))) {
    http_response_code(400);
    exit;
}
$event = json_decode($raw, true);
http_response_code(200);`;

export const VERIFY_SAMPLES = [
  { id: "node", label: "Node.js", code: NODE_VERIFY_SAMPLE },
  { id: "python", label: "Python", code: PYTHON_VERIFY_SAMPLE },
  { id: "php", label: "PHP", code: PHP_VERIFY_SAMPLE },
] as const;
