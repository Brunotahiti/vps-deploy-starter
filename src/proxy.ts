import { NextResponse, type NextRequest } from "next/server";

const PROTECTED = ["/pos", "/admin", "/onboarding", "/kds"];
const PUBLIC_POS = ["/pos/login"];

/** Garde de routes : redirige vers la connexion si aucune session n'est présente (vérification réelle côté serveur). */
export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC_POS.some((p) => pathname === p)) return NextResponse.next();
  if (PROTECTED.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
    const hasSession = req.cookies.has("mr_session");
    if (!hasSession) {
      const hasTerminal = req.cookies.has("mr_terminal");
      const url = req.nextUrl.clone();
      url.pathname = hasTerminal ? "/pos/login" : "/login";
      url.searchParams.set("next", pathname);
      return NextResponse.redirect(url);
    }
  }
  return NextResponse.next();
}

export const config = { matcher: ["/pos/:path*", "/admin/:path*", "/onboarding/:path*", "/kds/:path*"] };
