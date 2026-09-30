import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  EMPTY_PAYLOAD_SHA256,
  amzDate,
  amzDateTime,
  awsUriEncode,
  canonicalHeaders,
  canonicalQueryString,
  credentialScope,
  deriveSigningKey,
  presignUrl,
  sha256Hex,
  signRequest,
  stringToSign,
  type SigV4Credentials,
  type SignRequestInput,
} from "@/lib/storage/sigv4";

/**
 * Vectors from the AWS documentation:
 *  - "Signature Version 4 test suite" (aws-sig-v4-test-suite),
 *  - "Examples of how to derive a signing key" and the IAM ListUsers
 *    walk-through of the signing process,
 *  - "Authenticating Requests: Using the Authorization Header" S3 examples,
 *  - "Authenticating Requests: Using Query Parameters" S3 presigned URL example.
 */

const SUITE: SigV4Credentials = { accessKeyId: "AKIDEXAMPLE", secretAccessKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY" };
const S3_DOCS: SigV4Credentials = { accessKeyId: "AKIAIOSFODNN7EXAMPLE", secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY" };
const SUITE_DATE = new Date("2015-08-30T12:36:00Z");
const S3_DATE = new Date("2013-05-24T00:00:00Z");

describe("SigV4 test suite", () => {
  it("signs get-vanilla", () => {
    const signed = signRequest({
      method: "GET",
      host: "example.amazonaws.com",
      path: "/",
      payloadHash: EMPTY_PAYLOAD_SHA256,
      credentials: SUITE,
      scope: { region: "us-east-1", service: "service" },
      date: SUITE_DATE,
    });
    assert.equal(signed.signature, "5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31");
    assert.equal(
      signed.authorization,
      "AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, SignedHeaders=host;x-amz-date, Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31",
    );
    assert.equal(signed.headers["x-amz-date"], "20150830T123600Z");
    assert.equal(signed.headers.host, undefined, "host is set by fetch from the URL");
  });

  it("sorts query parameters (get-vanilla-query-order-key-case)", () => {
    const signed = signRequest({
      method: "GET",
      host: "example.amazonaws.com",
      path: "/",
      query: [
        ["Param2", "value2"],
        ["Param1", "value1"],
      ],
      payloadHash: EMPTY_PAYLOAD_SHA256,
      credentials: SUITE,
      scope: { region: "us-east-1", service: "service" },
      date: SUITE_DATE,
    });
    assert.equal(signed.signature, "b97d918cfa904a5beff61c982a1b6f458b799221646efd99d3219ec94cdf2500");
  });
});

/** Cases of the published test suite: request → expected signature. */
const UNRESERVED = "-._~0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const SUITE_CASES: { name: string; request: Pick<SignRequestInput, "method" | "path" | "query" | "headers">; body?: string; signedHeaders?: string; signature: string }[] = [
  { name: "get-vanilla-empty-query-key", request: { method: "GET", path: "/", query: [["Param1", "value1"]] }, signature: "a67d582fa61cc504c4bae71f336f98b97f1ea3c7a6bfe1b6e45aec72011b9aeb" },
  { name: "get-vanilla-query-unreserved", request: { method: "GET", path: "/", query: [[UNRESERVED, UNRESERVED]] }, signature: "9c3e54bfcdf0b19771a7f523ee5669cdf59bc7cc0884027167c21bb143a40197" },
  { name: "get-vanilla-utf8-query", request: { method: "GET", path: "/", query: [["\u1234", "bar"]] }, signature: "2cdec8eed098649ff3a119c94853b13c643bcf08f8b0a1d91e12c9027818dd04" },
  { name: "get-unreserved", request: { method: "GET", path: `/${UNRESERVED}` }, signature: "07ef7494c76fa4850883e2b006601f940f8a34d404d0cfa977f52a65bbf5f24f" },
  { name: "get-utf8", request: { method: "GET", path: "/\u1234" }, signature: "8318018e0b0f223aa2bbf98705b62bb787dc9c0e678f255a891fd03141be5d85" },
  { name: "get-space", request: { method: "GET", path: "/example space/" }, signature: "652487583200325589f1fba4c7e578f72c47cb61beeca81406b39ddec1366741" },
  {
    name: "get-header-key-duplicate",
    request: { method: "GET", path: "/", headers: { "My-Header1": "value2,value2,value1" } },
    signedHeaders: "host;my-header1;x-amz-date",
    signature: "c9d5ea9f3f72853aea855b47ea873832890dbdd183b4468f858259531a5138ea",
  },
  {
    name: "get-header-value-order",
    request: { method: "GET", path: "/", headers: { "My-Header1": "value4,value1,value3,value2" } },
    signature: "08c7e5a9acfcfeb3ab6b2185e75ce8b1deb5e634ec47601a50643f830c755c01",
  },
  {
    name: "get-header-value-trim",
    request: { method: "GET", path: "/", headers: { "My-Header1": " value1", "My-Header2": ' "a   b   c"' } },
    signedHeaders: "host;my-header1;my-header2;x-amz-date",
    signature: "acc3ed3afb60bb290fc8d2dd0098b9911fcaa05412b367055dee359757a9c736",
  },
  { name: "post-vanilla", request: { method: "POST", path: "/" }, signature: "5da7c1a2acd57cee7505fc6676e4e544621c30862966e37dddb68e92efbe5d6b" },
  { name: "post-vanilla-query", request: { method: "POST", path: "/", query: [["Param1", "value1"]] }, signature: "28038455d6de14eafc1f9222cf5aa6f1a96197d7deb8263271d420d138af7f11" },
  { name: "post-header-key-case", request: { method: "post", path: "/", headers: { "MY-HEADER1": "value1" } }, signature: "c5410059b04c1ee005303aed430f6e6645f61f4dc9e1461ec8f8916fdf18852c" },
  { name: "post-header-value-case", request: { method: "POST", path: "/", headers: { "My-Header1": "VALUE1" } }, signature: "cdbc9802e29d2942e5e10b5bccfdd67c5f22c7c4e8ae67b53629efa58b974b7d" },
  {
    name: "post-x-www-form-urlencoded",
    request: { method: "POST", path: "/", headers: { "Content-Type": "application/x-www-form-urlencoded" } },
    body: "Param1=value1",
    signedHeaders: "content-type;host;x-amz-date",
    signature: "ff11897932ad3f4e8b18135d722051e5ac45fc38421b1da7b9d196a0fe09473a",
  },
];

describe("SigV4 test suite: canonicalisation cases", () => {
  for (const c of SUITE_CASES) {
    it(c.name, () => {
      const signed = signRequest({
        ...c.request,
        host: "example.amazonaws.com",
        payloadHash: c.body === undefined ? EMPTY_PAYLOAD_SHA256 : sha256Hex(c.body),
        credentials: SUITE,
        scope: { region: "us-east-1", service: "service" },
        date: SUITE_DATE,
      });
      assert.equal(signed.signature, c.signature);
      if (c.signedHeaders) assert.equal(signed.signedHeaders, c.signedHeaders);
    });
  }

  it("post-sts-header-before: a session token is sent and signed", () => {
    const sessionToken =
      "AQoDYXdzEPT//////////wEXAMPLEtc764bNrC9SAPBSM22wDOk4x4HIZ8j4FZTwdQWLWsKWHGBuFqwAeMicRXmxfpSPfIeoIYRqTflfKD8YUuwthAx7mSEI/qkPpKPi/kMcGdQrmGdeehM4IC1NtBmUpp2wUE8phUZampKsburEDy0KPkyQDYwT7WZ0wq5VSXDvp75YU9HFvlRd8Tx6q6fE8YQcHNVXAkiY9q6d+xo0rKwT38xVqr7ZD0u0iPPkUL64lIZbqBAz+scqKmlzm8FDrypNC9Yjc8fPOLn9FX9KSYvKTr4rvx3iSIlTJabIQwj2ICCR/oLxBA==";
    const signed = signRequest({
      method: "POST",
      host: "example.amazonaws.com",
      path: "/",
      payloadHash: EMPTY_PAYLOAD_SHA256,
      credentials: { ...SUITE, sessionToken },
      scope: { region: "us-east-1", service: "service" },
      date: SUITE_DATE,
    });
    assert.equal(signed.signedHeaders, "host;x-amz-date;x-amz-security-token");
    assert.equal(signed.headers["x-amz-security-token"], sessionToken);
    assert.equal(signed.signature, "85d96828115b5dc0cfc3bd16ad9e210dd772bbebba041836c64533a82be05ead");
  });
});

describe("signing process walk-through", () => {
  it("derives the documented signing keys", () => {
    const secret = "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY";
    assert.equal(deriveSigningKey(secret, new Date("2012-02-15T00:00:00Z"), { region: "us-east-1", service: "iam" }).toString("hex"), "f4780e2d9f65fa895f9c67b32ce1baf0b0d8a43505a000a1a9e090d414db404d");
    assert.equal(deriveSigningKey(secret, SUITE_DATE, { region: "us-east-1", service: "iam" }).toString("hex"), "c4afb1cc5771d871763a393e44b703571b55cc28424d1a5e86da6ed3c154a4b9");
  });

  it("IAM ListUsers: canonical request hash, string to sign and signature", () => {
    const scope = { region: "us-east-1", service: "iam" };
    const signed = signRequest({
      method: "GET",
      host: "iam.amazonaws.com",
      path: "/",
      query: [
        ["Version", "2010-05-08"],
        ["Action", "ListUsers"],
      ],
      headers: { "Content-Type": "application/x-www-form-urlencoded; charset=utf-8" },
      payloadHash: EMPTY_PAYLOAD_SHA256,
      credentials: SUITE,
      scope,
      date: SUITE_DATE,
    });
    assert.equal(
      signed.canonicalRequest,
      [
        "GET",
        "/",
        "Action=ListUsers&Version=2010-05-08",
        "content-type:application/x-www-form-urlencoded; charset=utf-8",
        "host:iam.amazonaws.com",
        "x-amz-date:20150830T123600Z",
        "",
        "content-type;host;x-amz-date",
        EMPTY_PAYLOAD_SHA256,
      ].join("\n"),
    );
    assert.equal(sha256Hex(signed.canonicalRequest), "f536975d06c0309214f805bb90ccff089219ecd68b2577efef23edd43b7e1a59");
    assert.equal(
      signed.stringToSign,
      ["AWS4-HMAC-SHA256", "20150830T123600Z", "20150830/us-east-1/iam/aws4_request", "f536975d06c0309214f805bb90ccff089219ecd68b2577efef23edd43b7e1a59"].join("\n"),
    );
    assert.equal(stringToSign(SUITE_DATE, scope, signed.canonicalRequest), signed.stringToSign);
    assert.equal(signed.signature, "5d672d79c15b13162d9279b0855cfba6789a8edb4c82c400e06b5924a6f2b5d7");
  });

  it("formats dates and the credential scope", () => {
    const date = new Date("2026-01-02T03:04:05.678Z");
    assert.equal(amzDateTime(date), "20260102T030405Z");
    assert.equal(amzDate(date), "20260102");
    assert.equal(credentialScope(date, { region: "auto", service: "s3" }), "20260102/auto/s3/aws4_request");
  });
});

describe("S3 header-signed examples", () => {
  const scope = { region: "us-east-1", service: "s3" };

  it("GET object with a Range header", () => {
    const signed = signRequest({
      method: "GET",
      host: "examplebucket.s3.amazonaws.com",
      path: "/test.txt",
      headers: { range: "bytes=0-9", "x-amz-content-sha256": EMPTY_PAYLOAD_SHA256 },
      payloadHash: EMPTY_PAYLOAD_SHA256,
      credentials: S3_DOCS,
      scope,
      date: S3_DATE,
    });
    assert.equal(signed.signedHeaders, "host;range;x-amz-content-sha256;x-amz-date");
    assert.equal(signed.signature, "f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41");
  });

  it("PUT object with a special character in the key", () => {
    const body = "Welcome to Amazon S3.";
    const hash = sha256Hex(body);
    assert.equal(hash, "44ce7dd67c959e0d3524ffac1771dfbba87d2b6b4b4e99e42034a8b803f8b072");
    const signed = signRequest({
      method: "PUT",
      host: "examplebucket.s3.amazonaws.com",
      path: "/test$file.text",
      headers: {
        date: "Fri, 24 May 2013 00:00:00 GMT",
        "x-amz-storage-class": "REDUCED_REDUNDANCY",
        "x-amz-content-sha256": hash,
      },
      payloadHash: hash,
      credentials: S3_DOCS,
      scope,
      date: S3_DATE,
    });
    assert.match(signed.canonicalRequest, /^PUT\n\/test%24file\.text\n/);
    assert.equal(signed.signedHeaders, "date;host;x-amz-content-sha256;x-amz-date;x-amz-storage-class");
    assert.equal(signed.signature, "98ad721746da40c64f1a55b78f14c238d841ea1380cd77a1b5971af0ece108bd");
  });

  it("GET bucket lifecycle (empty-valued sub-resource)", () => {
    const signed = signRequest({
      method: "GET",
      host: "examplebucket.s3.amazonaws.com",
      path: "/",
      query: [["lifecycle", ""]],
      headers: { "x-amz-content-sha256": EMPTY_PAYLOAD_SHA256 },
      payloadHash: EMPTY_PAYLOAD_SHA256,
      credentials: S3_DOCS,
      scope,
      date: S3_DATE,
    });
    assert.equal(signed.signature, "fea454ca298b7da1c68078a5d1bdbfbbe0d65c699e0f91ac7a200a0136783543");
  });

  it("GET bucket listing with query parameters", () => {
    const signed = signRequest({
      method: "GET",
      host: "examplebucket.s3.amazonaws.com",
      path: "/",
      query: [
        ["max-keys", "2"],
        ["prefix", "J"],
      ],
      headers: { "x-amz-content-sha256": EMPTY_PAYLOAD_SHA256 },
      payloadHash: EMPTY_PAYLOAD_SHA256,
      credentials: S3_DOCS,
      scope,
      date: S3_DATE,
    });
    assert.equal(signed.signature, "34b48302e7b5fa45bde8084f4b7868a86f0a534bc59db6670ed5711ef69dc6f7");
  });
});

describe("S3 presigned URL example", () => {
  it("matches the documented signature", () => {
    const { url, signature } = presignUrl({
      method: "GET",
      protocol: "https:",
      host: "examplebucket.s3.amazonaws.com",
      path: "/test.txt",
      credentials: S3_DOCS,
      scope: { region: "us-east-1", service: "s3" },
      date: S3_DATE,
      expiresSeconds: 86400,
    });
    assert.equal(signature, "aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404");
    assert.equal(
      url,
      "https://examplebucket.s3.amazonaws.com/test.txt?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20130524%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20130524T000000Z&X-Amz-Expires=86400&X-Amz-SignedHeaders=host&X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404",
    );
  });

  it("clamps the lifetime to 7 days", () => {
    const { url } = presignUrl({
      method: "GET",
      protocol: "https:",
      host: "b.example.com",
      path: "/k",
      credentials: S3_DOCS,
      scope: { region: "auto", service: "s3" },
      date: S3_DATE,
      expiresSeconds: 60 * 60 * 24 * 30,
    });
    assert.match(url, /X-Amz-Expires=604800&/);
  });
});

describe("encoding helpers", () => {
  it("encodes everything but unreserved characters", () => {
    assert.equal(awsUriEncode("a b/c~d_e.f-g*h+é"), "a%20b%2Fc~d_e.f-g%2Ah%2B%C3%A9");
    assert.equal(awsUriEncode("/videos/my file.mp4", false), "/videos/my%20file.mp4");
  });

  it("lower-cases, trims, collapses and sorts headers", () => {
    assert.deepEqual(canonicalHeaders({ "X-Amz-Date": "20260102T030405Z", Host: " example.com ", "Content-Type": "text/plain;   charset=utf-8" }), {
      canonical: "content-type:text/plain; charset=utf-8\nhost:example.com\nx-amz-date:20260102T030405Z\n",
      signedHeaders: "content-type;host;x-amz-date",
    });
  });

  it("signs extra presign parameters and the session token", () => {
    const input = {
      method: "GET",
      protocol: "https:",
      host: "b.example.com",
      path: "/videos/a b.mp4",
      credentials: { ...S3_DOCS, sessionToken: "tok/en+1=" },
      scope: { region: "auto", service: "s3" },
      date: S3_DATE,
      expiresSeconds: 60,
    };
    const plain = presignUrl(input);
    const withType = presignUrl({ ...input, query: [["response-content-type", "video/mp4"]] });
    assert.notEqual(plain.signature, withType.signature);
    const url = new URL(withType.url);
    assert.equal(url.pathname, "/videos/a%20b.mp4");
    assert.equal(url.searchParams.get("X-Amz-Security-Token"), "tok/en+1=");
    assert.equal(url.searchParams.get("response-content-type"), "video/mp4");
    assert.match(withType.canonicalRequest, /\nhost:b\.example\.com\n\nhost\nUNSIGNED-PAYLOAD$/);
    // Query parameters go out in canonical (sorted) order with the signature last.
    assert.deepEqual([...url.searchParams.keys()], ["X-Amz-Algorithm", "X-Amz-Credential", "X-Amz-Date", "X-Amz-Expires", "X-Amz-Security-Token", "X-Amz-SignedHeaders", "response-content-type", "X-Amz-Signature"]);
  });

  it("sorts by encoded key, then value", () => {
    assert.equal(
      canonicalQueryString([
        ["b", "2"],
        ["a", "z"],
        ["a", "y"],
        ["uploadId", "x/y="],
      ]),
      "a=y&a=z&b=2&uploadId=x%2Fy%3D",
    );
  });
});
