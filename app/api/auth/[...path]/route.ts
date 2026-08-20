import { getNeonAuth } from "@/src/security/neon-auth-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type AuthRouteContext = { params: Promise<{ path: string[] }> };
type AuthRouteHandler = (request: Request, context: AuthRouteContext) => Response | Promise<Response>;

function createAuthRouteHandler(method: "GET" | "POST"): AuthRouteHandler {
  return async (request, context) => {
    // Do not initialize Neon Auth while Next.js imports this module during build.
    // A real request resolves the production configuration and still fails closed
    // when Neon Auth is unavailable.
    const neonAuth = getNeonAuth();
    const handlers = neonAuth.handler() as unknown as Record<"GET" | "POST", AuthRouteHandler>;
    return handlers[method](request, context);
  };
}

export const GET = createAuthRouteHandler("GET");
export const POST = createAuthRouteHandler("POST");
