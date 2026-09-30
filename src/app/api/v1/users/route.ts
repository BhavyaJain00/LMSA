import { apiRoute, dataResponse, listResponse } from "@/lib/api/handler";
import { endpoints } from "@/lib/api/endpoints";
import { matchesText } from "@/lib/api/lookups";
import { listPage } from "@/lib/api/pagination";
import { serializeUser, userStamps } from "@/lib/api/serializers";
import { createMember } from "@/lib/api/users";

/** GET /api/v1/users — members, searchable and paginated. */
export const GET = apiRoute(endpoints.listUsers, async ({ db, query, url, baseUrl }) => {
  const rows = db.users.filter(
    (u) =>
      matchesText(query.q, u.name, u.email, u.username) &&
      (!query.email || u.email.toLowerCase() === query.email) &&
      (!query.role || u.roles.includes(query.role)) &&
      (query.enabled === undefined || u.enabled === query.enabled),
  );
  return listResponse(listPage(rows, userStamps, query), url, (user) => serializeUser(user, { baseUrl }));
});

/** POST /api/v1/users — create a member. */
export const POST = apiRoute(endpoints.createUser, async (ctx) => {
  const { user, passwordLinkSent } = await createMember(ctx.db, ctx.body);
  await ctx.audit("api.user.create", { type: "user", id: user.id }, { email: user.email, roles: user.roles.join(", "), passwordLinkSent });
  return dataResponse(serializeUser(user, { baseUrl: ctx.baseUrl }), 201);
});
