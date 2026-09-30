import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  EMPTY_PAYLOAD_SHA256,
  awsUriEncode,
  canonicalQueryString,
  presignUrl,
  sha256Hex,
  signRequest,
  type SigV4Credentials,
} from "@/lib/storage/sigv4";

/**
 * Vectors from the AWS documentation:
 *  - "Signature Version 4 test suite" (get-vanilla, get-vanilla-query-order-key-case),
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
