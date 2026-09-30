import { NextResponse } from "next/server";
import { ApiError } from "@/lib/api/errors";

/**
 * Unknown /api/v1 paths answer with the API's JSON error envelope instead of
 * the site's HTML 404 page.
 */
function unknownEndpoint(request: Request): Response {
  const { pathname } = new URL(request.url);
  const error = new ApiError(404, "not_found", `There is no API endpoint ${request.method} ${pathname.slice(0, 200)}. See /developers for the list of endpoints.`);
  return NextResponse.json(error.toBody(), { status: 404, headers: { "Cache-Control": "no-store" } });
}

export const GET = unknownEndpoint;
export const POST = unknownEndpoint;
export const PUT = unknownEndpoint;
export const PATCH = unknownEndpoint;
export const DELETE = unknownEndpoint;
