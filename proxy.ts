import { clerkMiddleware } from "@clerk/nextjs/server";

// Clerk's middleware runs on every request so that auth() works in route handlers.
// Next.js 16 calls this file proxy.ts (it was middleware.ts in earlier versions).
export default clerkMiddleware();

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
