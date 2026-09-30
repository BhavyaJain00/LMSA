import { apiRoute, listResponse, methodNotAllowed } from "@/lib/api/handler";
import { endpoints } from "@/lib/api/endpoints";
import { listPage } from "@/lib/api/pagination";
import { certificateStamps, serializeCertificate } from "@/lib/api/serializers";

/** GET /api/v1/certificates — issued certificates, filterable and paginated. */
export const GET = apiRoute(endpoints.listCertificates, async ({ db, query, url, baseUrl }) => {
  const rows = db.certificates.filter(
    (c) =>
      (!query.userId || c.userId === query.userId) &&
      (!query.courseId || c.courseId === query.courseId) &&
      (!query.batchId || c.batchId === query.batchId) &&
      (query.published === undefined || c.published === query.published),
  );
  return listResponse(listPage(rows, certificateStamps, query), url, (c) => serializeCertificate(c, { baseUrl }));
});

/** Other methods answer 405 with the JSON error envelope. */
const unsupported = methodNotAllowed("GET");
export const POST = unsupported;
export const PUT = unsupported;
export const PATCH = unsupported;
export const DELETE = unsupported;
