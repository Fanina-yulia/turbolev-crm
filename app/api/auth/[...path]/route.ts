import { proxyNeonAuthRequest } from "@/src/security/neon-auth-transport";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ path: string[] }> };

const ALLOWED_AUTH_PATHS = new Set([
  "sign-in/email",
  "sign-out",
  "get-session",
]);

async function handler(request: Request, context: Context) {
  const { path } = await context.params;
  const authPath = path.join("/");
  if (!ALLOWED_AUTH_PATHS.has(authPath)) {
    return Response.json({ ok: false, error: "AUTH_ENDPOINT_NOT_EXPOSED" }, { status: 404 });
  }

  if (authPath === "sign-in/email" && request.method !== "POST") {
    return Response.json({ ok: false, error: "METHOD_NOT_ALLOWED" }, { status: 405 });
  }
  if (authPath === "sign-out" && request.method !== "POST") {
    return Response.json({ ok: false, error: "METHOD_NOT_ALLOWED" }, { status: 405 });
  }
  if (authPath === "get-session" && request.method !== "GET") {
    return Response.json({ ok: false, error: "METHOD_NOT_ALLOWED" }, { status: 405 });
  }

  return proxyNeonAuthRequest(request, path);
}

export const GET = handler;
export const POST = handler;
