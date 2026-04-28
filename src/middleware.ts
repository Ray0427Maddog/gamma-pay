import { NextRequest, NextResponse } from "next/server";

export function middleware(req: NextRequest) {
  const basicAuth = req.headers.get("authorization");
  const password = process.env.APP_PASSWORD;

  if (!password) {
    return new NextResponse("Missing app password", { status: 500 });
  }

  if (basicAuth) {
    const authValue = basicAuth.split(" ")[1];
    const [user, pass] = atob(authValue).split(":");

    if (user === "gamma" && pass === password) {
      return NextResponse.next();
    }
  }

  return new NextResponse("Gamma Pay login", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="Gamma Pay (Staff Only)"',
    },
  });
}

export const config = {
  matcher: ["/((?!api/webhook).*)"],
};