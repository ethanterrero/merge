# Merge MVP product requirements

## Pilot
East Bay → San Francisco morning commute; initial focus on Alameda. The product is free during the pilot.

## Primary journey
1. Sign in and create a commuter profile (driver, passenger, or both).
2. Save origin, destination, recurring days, departure time, and preferences.
3. Discover eligible commuters via privacy-safe approximate map markers and ranked cards.
4. Request a connection with proposed pickup area and trip time.
5. Mutually accept, then confirm seat and any cargo reservation transactionally.
6. Coordinate pickup and complete the commute.

## Matching rules
- Driver detour <= 5 minutes relative to the original route, including pickup and drop-off.
- Departure window ±15 minutes (respect both parties' constraints).
- Display both drivers and passengers by default.
- Hard filters: available seats, mandatory ride preferences, blocks, visibility, and cargo compatibility.
- Cargo example: **medium, foldable scooter**. Request dimensions and weight; verify available secure storage and obtain driver approval.
- Prefer recurring schedule fit and carpools that reach HOV occupancy, but never guarantee eligibility or travel-time savings.

## Privacy and safety
- Discovery opt-in; no public exact home/work coordinates or real-time locations.
- Server-side matching, generalized map pins, rate-limited invitations, blocking and reporting.
- Reveal agreed pickup instructions only after mutual acceptance and booking confirmation.
- Review driver verification, insurance, regulations, accessibility, and women-only preference policy before real-world launch.

## Out of scope for v0.1
Payments, tips, live tracking, automatic multi-stop group formation, AI-based matching, and production HOV-time guarantees.

## Acceptance criteria for first milestone
- Expo starter launches in development.
- README, environment template, initial data model, and contribution instructions exist.
- No real user data or secrets are committed.

## Pilot blockers
- **Custom SMTP** (e.g. Resend or Postmark). Supabase's built-in sender only reaches project team members, so sign-in codes won't reach pilot testers without it.
- **In-app account deletion.** App Store guideline 5.1.1(v) requires it for any app that supports account creation. Google Play also requires in-app deletion, plus a web link (given in the Data safety form) where users can request deletion without the app.
