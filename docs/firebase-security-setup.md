# Firebase and Supabase Security Setup

This app now treats the browser as untrusted. Admin access is granted only when all of these are true:

- The user signs in with Firebase Auth.
- The Firebase email is verified.
- Firestore has an `admin_users/{uid}` document for that user.
- The Supabase `extract-additional-work` Edge Function receives a Firebase ID token from an allowed admin UID.

## Firebase admin account

1. In Firebase Console, enable Authentication with Email/Password.
2. Create the admin user and verify the email address.
3. Copy the user's Firebase UID.
4. In Firestore, create `admin_users/{uid}`. The document can be empty.
5. Deploy rules:

```bash
firebase deploy --only firestore:rules,storage
```

## Supabase Edge Function secrets

Set these Supabase secrets before deploying `extract-additional-work`:

```bash
supabase secrets set OPENAI_API_KEY=...
supabase secrets set FIREBASE_PROJECT_ID=p4-ph4
supabase secrets set FIREBASE_ADMIN_UIDS=uid1,uid2
supabase secrets set WORKSITE_ALLOWED_ORIGINS=https://worksite-radar.vercel.app
```

For local testing, add localhost origins as needed:

```bash
supabase secrets set WORKSITE_ALLOWED_ORIGINS=https://worksite-radar.vercel.app,http://localhost:8080,http://localhost:8081
```

Then deploy:

```bash
supabase functions deploy extract-additional-work
```

## Key rotation

The old Firebase and AI-related values were previously present in git history. Rotate any keys that were real, then restrict browser API keys in Firebase/Google Cloud to the deployed domain and localhost development origins.
