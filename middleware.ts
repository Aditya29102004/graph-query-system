// import { type NextRequest } from "next/server";
// import { updateSession } from "@/app/lib/supabase/middleware";

// export async function middleware(request: NextRequest) {
//   return updateSession(request);
// }

// export const config = {
//   matcher: [
//     /*
//      * Skip static assets and images; run for everything else so auth cookies stay fresh.
//      */
//     "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
//   ],
//   runtime: "nodejs", // Force Node.js runtime instead of Edge
// };
