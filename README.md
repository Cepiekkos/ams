# Northstar Academic Document System

Northstar is a responsive academic content operations workspace built with React and Vite. It covers the end-to-end document lifecycle: local user selection, document intake and metadata, search and filtering, collections and taxonomy, review and approval workflows, version history, comments, local roles, activity/audit history, notifications, reports, archive handling, and administrator settings.

## Academic approval workflow

The local workflow is intentionally gated:

1. **Faculty** creates or uploads a document and submits it for review.
2. **Department Head** sees the submission in the department review queue. Approval sends it to the Dean; a revision request sends it back to Faculty with a required reason.
3. **Dean** sees the document only after Department Head approval. Approval returns it to Faculty as **Approved - Ready to Publish**; a revision request sends it back to Faculty and then through Department Head again.
4. **Faculty** can publish only after both review stages have approved the current version.
5. **Administrator** is the only role that can open **Team & permissions** and **Admin settings**, or change user roles. Faculty, Department Heads, and Deans do not see those administration surfaces and cannot manage another user's permissions or workspace configuration.

The local bootstrap allows an Administrator to be created only while no Administrator exists. Once one exists, new users can only be created as Faculty, Department Head, or Dean; role changes are performed by the Administrator.

Documents are only visible in the next role's review queue after the current role approves them. When the Dean requests a revision after Department Head approval, the Department Head receives a re-check indicator when the revised document returns. Re-check and revision indicators only appear for a reviewer who had already checked the document before the revision was requested; a user in the same role who never saw the previous version does not see them, because the indicator exists to explain why a document they already reviewed came back to them.

## Publishing and archive behavior

After Dean approval, Faculty publishing records the document as published and moves it to **Archive** automatically. The archived record retains its publication timestamp, file, versions, comments, and audit history. Faculty can still open the published/archived record and download its uploaded file; downloading does not change its workflow status. **All documents** includes every visible record regardless of status, including pending, published, draft, and archived records; **Archive** remains the focused archived-only view. Published totals and reports still include archived published records. The Faculty owner can restore an archived document as a new draft for another workflow cycle.

## Run locally

```bash
npm install
npm run dev
```

The production bundle is generated with `npm run build` and can be served from any static host.

## Included product surfaces

- **Dashboard** with operational metrics, review workload, workspace health, recent activity, and recent documents.
- **Document library** with responsive tables, search, status/category filters, sorting, upload metadata, and local persistence.
- **Workflow drawer** for submit/review/approve actions, version creation, comments, permissions, archive, and audit history.
- **Workspace administration** for team roles, notifications, reports, taxonomy, collections, and settings.
- **Adobe Experience Manager boundary** with a stable metadata mapping and a credential-free local export fallback.

## Persistence and integration

This frontend uses the reusable `src/storage.js` adapter backed by `localStorage`. Data is stored as one versioned workspace document (`northstar-workspace`, currently schema version 4). A fresh workspace starts empty and is populated through the login, upload, metadata, workflow, and team screens. The Admin settings page provides JSON export/import and a full local reset. File uploads are converted to data URLs and stored with metadata; metadata-only records are also supported.

The **Settings → Adobe Experience Manager** panel is an adapter contract and local fallback. It accepts an editable author base URL and token field, but the static app never calls AEM or claims that it is connected. Exporting the workspace is the safe credential-free integration boundary. A future live adapter can be enabled by wiring configuration into a server-side proxy:

```text
VITE_AEM_BASE_URL=https://author.example.com
VITE_AEM_TOKEN=replace-with-server-managed-token
```

Tokens should not be exposed in a client-only deployment; the token field is only a local configuration placeholder and is not secure. Use a backend route or Adobe integration service for authenticated asset delivery. The app intentionally keeps the fallback local and browser-based.

## Exact limitations and connecting a backend

- There is no production authentication, SSO, authorization boundary, encryption, multi-user sync, or server-side audit immutability. Login only selects/creates a browser-local user.
- `localStorage` has browser/device quota limits. Large files may exceed quota; use object storage and store a document URL/reference in an API-backed adapter for production.
- Local roles and workflow controls are UI behavior, not security controls. A backend must enforce permissions on every request.
- AEM base URL/token fields do not create a connection. AEM upload, refresh, retries, and conflict handling are intentionally not implemented.
- Browser downloads work only for uploaded files whose data URL remains in local storage; metadata-only records do not have a downloadable file until a file is uploaded.

To connect a backend later, keep the UI contract and replace the functions in `src/storage.js` with an async adapter backed by your API (for example `listDocuments`, `createDocument`, `updateDocument`, `downloadDocument`, `exportWorkspace`, and `importWorkspace`). Add an authenticated server route for file upload/download, persist file references rather than data URLs, and return users, roles, audit events, notifications, and settings from the API. The AEM mapping should remain a server-side integration implementation; never ship an AEM token in a static Vite bundle.

## Deployment notes

This is a static React/Vite frontend. For production, serve the `dist` directory from a static host and place any authenticated AEM calls behind a server-side proxy or integration service. The current local adapter uses `localStorage` and browser downloads; replace that adapter with API calls when connecting a real identity provider, document store, or AEM author instance.
