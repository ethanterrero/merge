# Pilot sign-in: owner steps

Merge signs people in with a 6-digit email code. For the closed pilot (decision D-11), sign-ups are off and the owner adds each tester by hand. This page covers the dashboard steps for the hosted project (`aeycmdjoplppvizvwhgs`). None of them is automated: `supabase db push` doesn't deploy email templates or auth settings to the hosted project.

Do the steps in this order. Steps 2 and 3 need sign-ups still on, so they come before step 5.

## 1. Paste both email templates

With "Confirm email" on, a new user's first code is sent with the **Confirm signup** template, and every later code with the **Magic Link** template. Both must contain `{{ .Token }}`, or the email carries a link the app can't handle.

Free-plan projects can't edit templates on the built-in sender, so set up custom SMTP first (README, Connecting Supabase). Then in Authentication → Email Templates:

| Dashboard template | Subject | Body (paste the whole file) |
| --- | --- | --- |
| Confirm signup | `Your Merge sign-in code` | [`supabase/templates/confirmation.html`](../../supabase/templates/confirmation.html) |
| Magic Link | `Your Merge sign-in code` | [`supabase/templates/magic_link.html`](../../supabase/templates/magic_link.html) |

Each template shows the code, says it expires in 10 minutes and says "If you didn't ask for this, ignore it." Neither contains `{{ .ConfirmationURL }}` or any other link.

If you already pasted `{{ .Token }}` into either template while finishing the sign-in plan, replace it with the file anyway, so the live template matches the repo. If you'd rather keep what's live, copy it into the repo file instead, so the two match.

The same files are wired into `supabase/config.toml` (`[auth.email.template.confirmation]` and `[auth.email.template.magic_link]`), which a local Supabase stack uses.

## 2. Check that a brand-new address gets a code

While sign-ups are still on, sign in from the app with an address that has never signed in before. The email should use the Confirm signup template and show a 6-digit code, not a link. Sign out and sign in again with the same address. That email uses the Magic Link template and should also show a code.

Until custom SMTP is set up, Supabase's built-in sender only delivers to members of the Supabase team, so use a team member's address. Delete the test user afterwards if you don't want to keep it.

## 3. Make sure your own email is a user

Once sign-ups are off, only existing users can sign in, so your own email must already be a user. It is if you've signed in once (for example in the sign-in plan's end-to-end test). Check Authentication → Users.

## 4. Keep "Confirm email" on

Authentication → Sign In / Providers → Email: "Confirm email" stays on. Email OTP Expiration stays at 600 seconds and Email OTP Length at 6.

## 5. Turn off sign-ups

Authentication → Sign In / Providers → User Signups: turn off **Allow new users to sign up**.

## 6. Add a tester

Authentication → Users → Add user → **Create new user**:

- Email: the tester's address.
- Password: if the form requires one, use a long random value you don't keep. Merge never asks for a password.
- Tick **Auto Confirm User**.

Don't use **Send invitation**. It emails a link from the Invite template, and the app can't handle links.

Auto-confirm matters. Supabase Auth treats an existing but unconfirmed user like a new one and sends them through sign-up. With sign-ups off, that fails, and the tester sees the "not on the pilot list" message even though you added them.

## 7. Verify

1. **A tester gets a code.** Sign in from the app as the tester from step 6. The email should show a 6-digit code (Magic Link template), and the code should sign them in.
2. **An unknown address is refused.** Sign in with an address that isn't a user. The app should say: "This email isn't on the Merge pilot list yet. Ask your pilot contact to add you." No email is sent.

   Record the exact HTTP status, error code and message once, from Logs → Auth in the dashboard (or the browser's network tab on the web build), and add them to the M-12 PR or the table below. The app matches on the code first and the message second, so a different message alone won't break it.

D-11 accepts that this message tells anyone whether an email is enrolled.

## Reference: the "sign-ups off" error

The app calls `signInWithOtp` with `shouldCreateUser: true`. With sign-ups off, Supabase Auth answers an email that isn't a confirmed user as follows (source: [`supabase/auth`](https://github.com/supabase/auth) at `ce9a8ee`, `internal/api/otp.go`, `magic_link.go` and `signup.go`; code descriptions from Supabase's [Auth error codes](https://supabase.com/docs/guides/auth/debugging/error-codes)):

| Request | HTTP status | `code` | Message |
| --- | --- | --- | --- |
| `shouldCreateUser: true` (what the app sends) | 422 | `signup_disabled` | `Signups not allowed for this instance` |
| `shouldCreateUser: false` | 422 | `otp_disabled` | `Signups not allowed for otp` |

supabase-js puts the code on `AuthApiError.code`. `sendCodeErrorMessage` in `apps/mobile/src/lib/authRules.ts` maps both codes, and any code-less error whose message contains "Signups not allowed", to the pilot-list message.

Observed on the hosted project: _not yet recorded (step 7.2)._
