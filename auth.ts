import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import LinkedIn from "next-auth/providers/linkedin";

// Credentials are read from the environment:
//   AUTH_SECRET                             signs the session cookie
//   AUTH_GOOGLE_ID / AUTH_GOOGLE_SECRET     Google OAuth client
//   AUTH_LINKEDIN_ID / AUTH_LINKEDIN_SECRET LinkedIn OpenID Connect app
export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [Google, LinkedIn],
  session: { strategy: "jwt" },
});
