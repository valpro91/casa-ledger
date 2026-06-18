# Casa Ledger

A private rental-management app for tracking rent, HOA, repairs and documents
across your properties. Built with React + Vite, with **Firebase** for login and a
shared database so you and your wife both see the same data, live. The free
Firebase plan does not pause on inactivity.

---

## What you'll set up (≈15 minutes)

1. A free **Firebase** project (login + database).
2. Push this repo to **GitHub**.
3. Deploy — either **GitHub Pages** (included workflow) or **Vercel** (one click).

You only need to do step 1 once.

---

## 1. Firebase: database + the two logins

1. Go to [console.firebase.google.com](https://console.firebase.google.com) →
   **Add project**. Give it a name (e.g. `casa-ledger`). You can disable Google
   Analytics. The free **Spark** plan is fine — no credit card needed.

2. **Register a web app.** On the project overview, click the **web icon** `</>`.
   Give it a nickname, **don't** check Firebase Hosting, click Register. Firebase
   shows you a `firebaseConfig` block — keep that tab open, you'll copy values from
   it in step 6.

3. **Enable Authentication.** Left sidebar → **Build → Authentication → Get
   started** → **Sign-in method** → enable **Email/Password** → Save.

4. **Create your two accounts.** Authentication → **Users** → **Add user** → enter
   your email + a password. Repeat for your wife. (There's no public signup form in
   the app, so these are the only two accounts that exist.)

5. **Create the database.** Build → **Firestore Database → Create database** →
   start in **production mode** → pick a location near you → Enable.

6. **Lock it down with rules.** Firestore Database → **Rules** tab → replace the
   contents with [`firestore.rules`](firestore.rules) from this repo, **editing the
   two email addresses** to match the accounts you just made → **Publish**.
   These rules are what restrict all data access to only your two emails — even
   though the API key is public.

7. **Enable file storage (for document uploads).** Build → **Storage → Get
   started**. Firebase Storage requires the **Blaze** (pay-as-you-go) plan — it
   has a generous free allowance but needs a card on file. Then **Storage →
   Rules** and paste [`storage.rules`](storage.rules) from this repo, **editing
   the two emails** to match your accounts → **Publish**.

8. **Grab your config.** Project **Settings (gear icon) → General →
   Your apps → SDK setup and configuration**. You need five values:
   - `apiKey` → `VITE_FIREBASE_API_KEY`
   - `authDomain` → `VITE_FIREBASE_AUTH_DOMAIN`
   - `projectId` → `VITE_FIREBASE_PROJECT_ID`
   - `appId` → `VITE_FIREBASE_APP_ID`
   - `storageBucket` → `VITE_FIREBASE_STORAGE_BUCKET`

---

## 2. Run it locally (optional but nice for testing)

```bash
npm install
cp .env.example .env.local      # then paste your four values into .env.local
npm run dev
```

Open the local URL it prints and sign in with one of the accounts you created.

---

## 3a. Deploy with GitHub Pages

1. Create a new GitHub repo (e.g. `casa-ledger`) and push this folder to it.
2. In the repo: **Settings → Secrets and variables → Actions → New repository
   secret.** Add five secrets:
   - `VITE_FIREBASE_API_KEY`
   - `VITE_FIREBASE_AUTH_DOMAIN`
   - `VITE_FIREBASE_PROJECT_ID`
   - `VITE_FIREBASE_APP_ID`
   - `VITE_FIREBASE_STORAGE_BUCKET`
3. **Settings → Pages → Build and deployment → Source: GitHub Actions.**
4. If your repo is **not** named `casa-ledger`, edit `.github/workflows/deploy.yml`
   and change `BASE: /casa-ledger/` to `/<your-repo-name>/`.
5. Push to `main` (or **Actions → Deploy → Run workflow**). When it finishes, your
   app is live at `https://<your-username>.github.io/<repo-name>/`.

> **One Firebase setting for the live URL:** Authentication → **Settings →
> Authorized domains → Add domain**, and add your Pages domain
> (`<your-username>.github.io`). Without this, login is blocked on the live site.

## 3b. Deploy with Vercel (simpler, recommended if you use it)

1. Push this repo to GitHub.
2. [vercel.com](https://vercel.com) → **Add New Project** → import the repo.
3. Add the five `VITE_FIREBASE_*` environment variables in the project settings.
4. Deploy. Leave `BASE` unset (defaults to `/`). Then add your Vercel domain to
   Firebase **Authorized domains** as above.

Every `git push` redeploys automatically.

---

## AI document auto-fill

On the **Documents** page, **Upload & auto-fill** lets you pick a PDF or photo;
Claude reads it and pre-fills the title, type, property and expiry date for you to
confirm. The file itself is saved to your Firebase Storage and linked on the entry.

To turn it on, open **Settings → AI document assistant** and paste a Claude API
key (create one at [console.anthropic.com](https://console.anthropic.com/settings/keys)).

**How the key is handled — please read.** This app has no server, so the browser
calls Claude directly using the key you paste. The key is stored in your private
Firestore database (shared between your two accounts, locked to your two emails by
the rules) and is **never** baked into the public site. The trade-off of having no
server is that the key lives in your browser at runtime. That's fine for a private
two-person app, but treat the key as a shared secret and rotate it from the
Anthropic console if it's ever exposed. (Backups exported from Settings deliberately
strip the key.) Each Claude call costs roughly a cent or less per document.

## Adding it to your phone

Open the deployed URL in Safari/Chrome → **Share → Add to Home Screen**. It opens
full-screen like a native app.

---

## How your data works

- Everything lives in one Firestore document: `app/shared`, stored as JSON.
- Saves are debounced and use last-write-wins; a live listener keeps both of you
  in sync within a second of any change.
- Access is restricted to your two emails by `firestore.rules` — not by hiding the
  API key (which is public by design).
- **Backups:** Settings → Export downloads a JSON snapshot any time.

## Project structure

```
src/
  App.jsx        UI + the Dashboard (and the Root auth gate)
  Login.jsx      sign-in screen
  firebase.js    Firebase init + load/save/subscribe + auth + file upload
  ai.js          Claude document analysis (suggest title/type/property/expiry)
firestore.rules  database security (your two emails only)
storage.rules    file-storage security (your two emails only)
.github/workflows/deploy.yml   GitHub Pages build & deploy
```
