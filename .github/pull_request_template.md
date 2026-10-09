## Summary

## Testing
- [ ] `npm run typecheck`
- [ ] `npm test`
- [ ] `npm run lint`
- [ ] `npm run db:test`, or CI's `database` job if you don't have Docker (DB changes)

## Database changes (if any)
- [ ] New migrations are numbered above every migration on `main` (rename on your last rebase if needed), and no migration already on `main` is edited, renamed or deleted
- [ ] `database.types.ts` is the `database-types` artifact from this branch's latest CI run, not hand-edited or from `npm run db:types`
- [ ] New tables have RLS enabled, with SQL tests in `supabase/tests/`

## Safety/privacy impact
- [ ] Exact origins, destinations and pickup points never reach another member's client
- [ ] Before a ride is confirmed, others see only first name and last initial, role, approximate (~0.5 mi) areas, ride preferences and verification flags
- [ ] The UI never reveals who said "no", or tells "no" apart from "not answered"
- [ ] Blocked pairs and suspended members never appear to each other
- [ ] No credentials, keys, tokens or real personal data are committed

## Screenshots (if UI changes)
