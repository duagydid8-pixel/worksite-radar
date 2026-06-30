# XERP Worker Registration Local Helper

This helper connects the browser app to XERP worker-registration Excel files on this Windows PC.

## Start

```powershell
npm run xerp:worker
```

The helper listens on:

```text
http://127.0.0.1:8791
```

## Supported XERP Sites

- `PH4`: `평택 P4-PH4 초순수`
- `PH2`: `평택 P4-PH2 초순수`

`P5-PH1` is not included because it uses different credentials.

## Login

The helper does not store XERP usernames or passwords. It launches a visible Chromium profile dedicated to this feature. If XERP asks for login, log in inside that visible browser window, then click `XERP 가져오기` again in Worksite Radar.

The Chromium profile is stored under:

```text
%LOCALAPPDATA%\worksite-radar\xerp-worker-registration-profile
```

## Browser Install

If the helper reports that Chromium is missing, run:

```powershell
npm run playwright:install
```

or:

```powershell
npx playwright install chromium
```

## Flow

1. Start the helper with `npm run xerp:worker`.
2. Open Worksite Radar.
3. Go to `기술인 및 관리자 명단`.
4. Use the PH4 or PH2 tab.
5. Click `XERP 가져오기`.
6. Log in to XERP if prompted.
7. Click `XERP 가져오기` again after login.
8. Review the import summary.
9. Click `적용`.

Manual Excel upload remains available.
