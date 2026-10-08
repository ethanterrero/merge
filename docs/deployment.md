# Deployment plan (future)

## Planned Vercel hosting

We intend to evaluate **Vercel** for a future public website or web application. No Vercel project or deployment exists yet.

The repository is already an npm workspace monorepo. When a web frontend is introduced, prefer `apps/web` with a documented build command and output directory. Import the GitHub repository into Vercel and set the project root directory to `apps/web`. Enable preview deployments for PRs and production deployments from protected `main` only after checks pass.

Keep deployment secrets in Vercel environment settings, never in Git. Validate domain ownership, access control, and privacy before making a production site public.

## Native mobile

Vercel is **not** the native iOS/Android binary distribution mechanism. Continue using Expo for local development; evaluate EAS Build and app-store distribution separately when mobile release readiness is established.

## Decision checklist

- Decide whether `apps/web` is a marketing site, web client, or both.
- Pick the framework and deployment target based on actual web requirements.
- Configure preview vs production environments and environment-variable scopes.
- Add web build/test checks before connecting automatic production deployment.
- Validate analytics, monitoring, error reporting, and rollback procedures.

References: https://vercel.com/docs/monorepos and https://docs.expo.dev/guides/publishing-websites/
