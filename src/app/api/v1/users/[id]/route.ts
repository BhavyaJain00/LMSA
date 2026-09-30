import { apiRoute, dataResponse, methodNotAllowed } from "@/lib/api/handler";
import { endpoints } from "@/lib/api/endpoints";
import { findUser } from "@/lib/api/lookups";
import { serializeUser } from "@/lib/api/serializers";
import { updateMember } from "@/lib/api/users";

/** GET /api/v1/users/{id} — one member. */
export const GET = apiRoute(endpoints.getUser, async ({ db, params, baseUrl }) => dataResponse(serializeUser(findUser(db, params.id!), { baseUrl })));

/** PATCH /api/v1/users/{id} — update the fields sent. */
export const PATCH = apiRoute(endpoints.updateUser, async (ctx) => {
  const { user, changed } = await updateMember(ctx.db, ctx.params.id!, ctx.body);
  if (changed.length) {
    await ctx.audit("api.user.update", { type: "user", id: user.id }, { fields: changed.join(", ") });
    if (changed.includes("roles")) await ctx.audit("user.roles", { type: "user", id: user.id }, { roles: user.roles.join(", "), via: "api" });
    if (changed.includes("enabled")) await ctx.audit(user.enabled ? "user.enable" : "user.disable", { type: "user", id: user.id }, { via: "api" });
  }
  return dataResponse(serializeUser(user, { baseUrl: ctx.baseUrl }));
});

/** Other methods answer 405 with the JSON error envelope. */
const unsupported = methodNotAllowed("GET", "PATCH");
export const POST = unsupported;
export const PUT = unsupported;
export const DELETE = unsupported;
