import { NextResponse } from "next/server";
import { buildOpenApiDocument } from "@/lib/api/openapi";

/**
 * The OpenAPI 3.1 document for REST API v1. Public (it describes the contract,
 * not any data) so client generators and the /developers page can read it
 * without a key.
 */
export function GET(): Response {
  return NextResponse.json(buildOpenApiDocument(), {
    headers: { "Cache-Control": "public, max-age=300", "Access-Control-Allow-Origin": "*" },
  });
}
