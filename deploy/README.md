# ExoBrain production deployment

Both access modes remain available:

- [Guest access / 游客免登录](https://exobrain.sharmoon.cc.cd/)
- [Account and password / 账号登录](https://exobrain.sharmoon.cc.cd/admin/)

The knowledge-base privacy release uses application image
`exobrain:20261016-kb-privacy`, frontend release `20261016-kb-privacy`, Java 21,
and timezone `Asia/Shanghai`. The backend uses Spring Boot 3.5.8, Spring AI 1.1.0,
MyBatis and PostgreSQL 17 with pgvector; the UI uses React 19, TypeScript and
Ant Design. This guide contains reusable configuration, not production credentials.

The templates use `/opt/exobrain` as the installation directory; adjust matching
Nginx paths if choosing another directory. In the supplied configuration Nginx
and the application bind to loopback, and PostgreSQL has no published port.
Route the public hostname through the configured HTTPS gateway / Cloudflare
Tunnel; keep the internal application and database behind that gateway.

## Public experience and administration

The same UI source is built twice, with separate asset directories and API bases.

The account workspace uses an explicit application login page and server-side
sessions. `ADMIN` can manage accounts and system LLM / Embedding models; `USER`
can use enabled models and manage their own Agents, knowledge bases and chats.
Published Agents and knowledge bases are read-only for ordinary users. Accounts
are created by administrators; self-registration is not provided. Administrators
retain access to legacy unowned system assistants and non-visitor history.
Administrator roles do not grant access to another account's private knowledge
bases, documents, assistants or conversations. Unowned private knowledge bases
are denied until an operator establishes their actual owner; published demo
knowledge bases remain manageable by administrators. Guest history continues to use its
separate visitor cookie and is not merged into a signed-in account.

Nginx no longer uses HTTP Basic. Cached browser Basic credentials do not establish
an application session. The login HTML and assets are public; the backend checks
session, role and resource access on private API and SSE requests, independently
of which navigation items the UI displays.

| Route | Access | Purpose |
| --- | --- | --- |
| `/` | Public | Project demo, public knowledge-base overview, personal chats and example conversations |
| Explicit routes under `/api/demo/` | Public, subject to backend ownership and resource checks | Demo agent, public documents, visitor chats and curated read-only history |
| `GET /api/demo/documents/<document-uuid>/content` | Public knowledge bases only | Read-only Markdown source from an allowlisted knowledge base |
| `/sse/demo/connect/<session-uuid>` | Owning visitor only | Live updates for that visitor's editable chat |
| `/admin/` | Public login page; workspace requires login | Account UI; `/admin` redirects here |
| `POST /api/auth/login` or `/admin/api/auth/login` | Same-origin, rate limited | Account/password login |
| `/api/admin/users`, `/api/admin/models` and gateway aliases | `ADMIN` session | Account and model management |
| `/admin/api/`, `/admin/sse/` | Account session and resource permission | Account UI's API and SSE routes |
| Other `/api/`, `/sse/` outside the published demo routes | Account session and resource permission | Authenticated application routes |

SSE proxy buffering is disabled. The application sends comment heartbeats every
15 seconds so slow model responses do not leave the Cloudflare connection idle.
Credentials are provisioned outside Git in the installation's `secrets/`
directory; do not include them in frontend builds or container images.
`application-dev.yaml` is excluded from packaged JARs. Keep backend authentication
on every private API / SSE route even though the login page is public.

Production uses an HttpOnly, Secure, SameSite=Lax cookie named
`__Host-exobrain_session`, with Path `/` and a default lifetime of 12 hours.
Cookie tokens are hashed in the database; passwords use PBKDF2. Login returns
`data: {user, csrfToken}`. Send `X-CSRF-Token` on authenticated writes. Logout
revokes that session; changing a password, role or enabled status revokes the
account's sessions. The last enabled administrator cannot be disabled or demoted.
Authenticated streams recheck sessions every 15 seconds. Set
`APP_AUTH_PUBLIC_ORIGIN` to the actual HTTPS origin; keep secure cookies enabled
in production.

For API scripts, save cookies from `POST /api/auth/login` (JSON fields `username`
and `password`), read the response's CSRF value, then send both cookie and
`X-CSRF-Token` on writes. `GET /api/auth/me` returns the current identity;
`POST /api/auth/logout` ends the session. Keep request files and cookies outside
the repository and do not place experience-account credentials in public docs.

## Account and model upgrade

Back up the database, documents, Compose and gateway configuration, private
runtime settings and persistent model encryption key before upgrading. Apply
only the additive migrations to an existing database; do not run the seed SQL:

```bash
cd /opt/exobrain
docker compose exec -T postgres psql -U exobrain -d exobrain -v ON_ERROR_STOP=1 < deploy/migrations/20261014-accounts.sql
docker compose exec -T postgres psql -U exobrain -d exobrain -v ON_ERROR_STOP=1 < deploy/migrations/20261014-models.sql
docker compose exec -T postgres psql -U exobrain -d exobrain -v ON_ERROR_STOP=1 < deploy/migrations/20261016-storage-cleanup.sql
docker compose exec -T postgres psql -U exobrain -d exobrain -v ON_ERROR_STOP=1 < deploy/migrations/20261017-03-body-index.sql
docker compose exec -T postgres psql -U exobrain -d exobrain -v ON_ERROR_STOP=1 < deploy/migrations/20261017-05-runs.sql
docker compose exec -T postgres psql -U exobrain -d exobrain -v ON_ERROR_STOP=1 < deploy/migrations/20261017-06-ingestion.sql
docker compose exec -T postgres psql -U exobrain -d exobrain -v ON_ERROR_STOP=1 < deploy/migrations/20261017-07-durable-runs.sql
docker compose exec -T postgres psql -U exobrain -d exobrain -v ON_ERROR_STOP=1 -c \
  'GRANT SELECT, INSERT, UPDATE, DELETE ON exobrain_user, exobrain_login_session, exobrain_resource_acl, exobrain_model, exobrain_model_state, exobrain_kb_embedding, exobrain_storage_cleanup, exobrain_index_revision, exobrain_kb_index_state, exobrain_run, exobrain_run_event, exobrain_ingestion_job, exobrain_chat_run_job TO exobrain_app;'
```

The migration files may be placed in a release staging directory instead; adjust
the input paths accordingly. All migrations are additive and repeatable: they add
accounts, sessions, ownership, model definitions, knowledge-base bindings, the
versioned body index (revision + per-knowledge-base active state + chunk source
columns), execution records, the ingestion job table and the durable conversation run queue,
without recreating business tables. `20261017-03-body-index.sql` must run before
`20261017-06-ingestion.sql` because the ingestion worker publishes through the
revision tables it creates; `20261017-07-durable-runs.sql` needs `20261017-05-runs.sql`
(it references `exobrain_run`).
revision tables it creates. Existing rows are untouched: chunks without a
revision stay on the legacy title index, and knowledge bases without an active
revision keep their previous retrieval behaviour until an explicit rebuild.
Private knowledge bases require recorded ownership even for administrators;
the explicit public catalog remains shared. Data is not reassigned between users
during this upgrade. On a fresh installation, initialize the base
schema, apply these migrations and grant the application role access before the
first application start.

Provision `secrets/bootstrap-admin-password` with the chosen initial password
(6–128 characters) and `secrets/models-encryption-key` containing 32
random bytes encoded as Base64. Both files must be owned by `10001:10001`, mode
`400`. Keep them outside Git and mount them read-only as shown in `compose.yaml`.
The account bootstrap creates `admin` only when the user table is empty; later
starts do not reset passwords. Preserve the existing admin password when
migrating from the earlier gateway login if continuity is desired.

Generate the model encryption key once, back it up securely and retain it on
every subsequent deployment. Replacing it makes existing encrypted API keys
unreadable. The first model bootstrap imports the old DeepSeek and Embedding
settings and a disabled Zhipu entry, and binds old knowledge bases to
`legacy-embedding`. Later startups preserve settings changed in the UI.

Administrators can add, edit, test, enable and disable models in “系统模型”. LLM
protocols are `deepseek`, `openai` and `zhipuai`; Embedding protocols are `openai`
and `ollama`. OpenAI-compatible base URLs include the API root, typically `/v1`;
Zhipu uses `/api/paas/v4`. Keys are write-only in the API and encrypted with
AES-GCM. Ordinary users receive only enabled model choices without keys or
endpoint URLs. Disabled or unknown models do not fall back to static clients.

Each knowledge base binds its Embedding model at creation. Changing the default
affects new knowledge bases only. The vector schema requires 1024 dimensions;
a bound model's protocol, model name and dimensions cannot be changed. Updating
its endpoint is for a compatible service exposing the same model and vector
space, such as an endpoint migration. To change the provider/model or vector
space, create a new model and knowledge base and import the documents again.
Deleting default or referenced models is blocked.

## Knowledge-base privacy and deletion

New knowledge bases belong to the creating account and are private by default.
The UI separates “我的知识库” from “公开演示库”; the API's `publicResource` flag
comes from the configured publication allowlist, independently of write access.
No upload automatically publishes a private knowledge base. Using the same
login account shares the same workspace; use different accounts for isolation.

Authorization covers lists, document upload/preview/deletion, assistant bindings,
conversations, SSE and each knowledge-tool execution. Administrators cannot use
another account's private assistant or conversation to retrieve knowledge.
Generic database/file-system tools are rejected in account runtime configurations;
the SQL example bean is absent in production so it cannot bypass ownership checks.

The details page's “删除知识库” action requires confirmation. Deletion atomically
removes relational documents, vector chunks, the Embedding binding and resource
ownership, and removes the deleted ID from assistant bindings. Existing chat
records remain available to their owners. File cleanup is queued in the same
transaction using `exobrain_storage_cleanup`, and starts after commit. A rollback
keeps both database records and original files. Cleanup uses canonical knowledge
base/document IDs, not client-controlled metadata paths, and does not follow
symbolic links into another resource.

Apply `20261016-storage-cleanup.sql` and its application-role grant before starting
this release. A failed physical cleanup remains queued and retries every minute,
including after restart; inspect application warnings and the queue if storage
permissions or disk errors prevent removal. Uploaded originals are not served
directly, and deleted documents are immediately unavailable through all APIs.
Previously created backups and saved chat text are not purged by this action.

## Build

Use JDK 21 for both compilation and runtime; set `JAVA_HOME` and `PATH` to the
installed JDK 21 before running the included Maven wrapper (Maven 3.9.11).
The selection below is the reusable backend regression command. The separate
model example tests call external models and are not part of this routine build.
Previously recorded release results are listed under [Verification record](#verification-record);
the commands here are instructions, not a claim that tests were rerun during this
documentation update.

Run from the repository root in PowerShell:

```powershell
Set-Location jchatmind
.\mvnw.cmd clean package '-Dtest=JChatMindFactoryTest,SseServiceImplTest,Document*Test,RagServiceImplTest,ProductionToolsTest,Demo*Test,Auth*Test,AccountResourceControllerTest,PasswordHasherTest,LoginRateLimiterTest,ResourceAccessTest,ScopedToolCallbackTest,ChatSubmissionSnapshotTest,Model*Test,StorageCleanupServiceTest'

Set-Location ../ui
npm ci
npm run lint

$env:VITE_PUBLIC_DEMO = 'true'
$env:VITE_API_BASE_URL = '/api/demo'
$env:VITE_SSE_BASE_URL = '/sse/demo'
npm run build -- --base=/ --outDir=dist-public

$env:VITE_PUBLIC_DEMO = 'false'
$env:VITE_API_BASE_URL = '/admin/api'
$env:VITE_SSE_BASE_URL = '/admin/sse'
npm run build -- --base=/admin/ --outDir=dist-admin
```

These `VITE_*` values are compiled into the assets. Changing a container
environment variable after building cannot switch a public build into an
administration build. The `/admin/` asset base also sets the router basename.

The `Document*Test` selection includes the document facade and preview tests;
`Demo*Test` includes the public route and resource-access checks. The results for
this release are recorded in the [verification record](#verification-record).

Build `exobrain:20261016-kb-privacy` using `deploy/Dockerfile` and a clean staging
context containing the resulting JAR as `app.jar`. The image runs Temurin 21 as
UID 10001. Install the contents of the two frontend output directories as follows:

```text
/opt/exobrain/releases/20261016-kb-privacy/
  ui/       <- ui/dist-public/ contents
  admin/    <- ui/dist-admin/ contents
```

The `current` symlink selects this release directory. Nginx serves the public UI
from `current/ui` and the administration UI from `current/admin`. Switch both
builds together to avoid mismatched assets and API routes.

Set `services.app.image` in the installation's Compose configuration to
`exobrain:20261016-kb-privacy`. Deploy the application image, matching Nginx
configuration and both frontend builds together. Apply migrations and provision
the persistent private files before starting the new application; verify private
APIs reject anonymous requests before publishing the public login page.

The session list, conversation header and curated examples display the Agent
associated with each saved `agentId`, using the current authorized Agent catalog,
on desktop and mobile. This is not a historical snapshot of the Agent's name or
configuration. Missing associations, unavailable Agents and catalog loading
failures have distinct labels; no default Agent is substituted. If an association
is missing or removed, history remains readable and the conversation cannot
submit messages with an empty Agent ID. A catalog-name lookup failure alone does
not disable a conversation that still has a saved Agent ID.

## Public resources and retained history

Configure the demo publication lists in the private production YAML. The UUIDs
below are placeholders: replace them with existing, deliberately published
records. This example contains no model, database or gateway credentials.

```yaml
app:
  demo:
    agent-id: "11111111-1111-4111-8111-111111111111"
    public-kb-ids:
      - "22222222-2222-4222-8222-222222222222"
    showcase-session-ids:
      - "33333333-3333-4333-8333-333333333333"
```

Start with `showcase-session-ids: []` until the selected sessions have completed
and been reviewed. The demo agent's `allowed_kbs` must be a subset of
`public-kb-ids`. Management selections in `allowed_tools` are preserved in the
database, subject to the account runtime's tool restrictions. Public requests clear
only their freshly loaded runtime DTO's optional-tool list; the executor repeats
this restriction after loading its own configuration. Selecting database, email
or other tools in stored Agent settings therefore does not disable the public agent
or enable those tools for visitors; unsafe database and file-system tools are also
rejected in account runs. The isolated demo executor registers only
`KnowledgeTool`, `getDate`, `directAnswer` and `terminate`; it does not register
file, database, email, city or weather tools.
The application and JVM timezone are `Asia/Shanghai`, including the date tool.

Create a dedicated knowledge base containing only reviewed, public Markdown
project documentation. The repository includes the three documents used by the
current public knowledge base:

- [Project overview](../docs/public-demo/01_exobrain_overview.md)
- [RAG principles](../docs/public-demo/02_rag_principles.md)
- [Java backend questions](../docs/public-demo/03_java_backend_faq.md)

Upload only these three content documents. The [test checklist](../docs/public-demo/99_test_questions.md)
and [demo Agent system prompt](../docs/public-demo/agent-system-prompt.md) are
maintenance references and must not be indexed as knowledge-base content.

Indexing behaviour depends on which policy the knowledge base is on, and the two
must not be mixed:

- **`body-v1` (new knowledge bases).** Text is normalized (UTF-8, BOM removed,
  CRLF/CR to LF), the source SHA-256 and line range of every chunk are stored,
  and retrieval returns the chunk body together with its document, heading path
  and line range. Chunks are sized from the `app.retrieval.*` budget (target and
  overlap estimated tokens, bounded characters) and embedded with the
  knowledge base's bound 1024-dimension model. Publishing is atomic per revision:
  a candidate is built, its document set, source hashes, model and active revision
  are re-checked, and only then does it become the active revision.
- **`legacy-title-v1` (existing knowledge bases that were never rebuilt).** The
  section title is embedded and the section body is stored as the retrieved text.
  Those rows have no revision and no line range, so a citation can only open the
  whole document. They keep working until an explicit rebuild; the service never
  switches an existing knowledge base silently.

Uploads are queued: `POST /api/documents/upload` commits the document record and
an ingestion job in one transaction and returns `documentId` plus a job id with
status `QUEUED`. The worker parses and embeds outside the database transaction and
publishes the index when it succeeds; the document list shows the job status, and
a failed job can be retried by the owner. A document that is still `QUEUED` or
`RUNNING` is previewable but not yet retrievable. Parsing does not cover
PDF/Word or whole-document embedding.

Do not copy private knowledge bases or production configuration into the public
knowledge base. Listing or uploading a file elsewhere does not publish it:
the knowledge base must be explicitly allowlisted. Public document **list**
responses contain identifiers, filenames, types and sizes; storage paths and
document metadata are omitted. The separate content endpoint below returns
Markdown source only for documents in an allowlisted public knowledge base.
Knowledge retrieval checks the public knowledge-base ID again when the tool
executes.

## Markdown preview

Click a Markdown filename or the preview action in a knowledge base's document
list to open the read-only viewer. Users can switch between rendered Markdown
and its source. Both access modes support original UTF-8 `.md` and `.markdown`
files, with case-insensitive extensions and a maximum file size of **2 MiB
(2,097,152 bytes)**. Preview does not edit the file or change its vector index.

- `GET /api/demo/documents/<document-uuid>/content` reads documents whose actual
  knowledge-base ID belongs to `app.demo.public-kb-ids`. The backend checks that
  membership before reading the stored file.
- `GET /api/documents/<document-uuid>/content` and its gateway alias
  `/admin/api/documents/<document-uuid>/content` require an application session
  and access to the document's knowledge base. An ordinary user can preview their
  own or published documents. Administrators may manage their own private and
  explicitly published documents, but cannot access another account's private files.

Successful responses use `ApiResponse` with
`data: {documentId, filename, content}`. `content` is the original Markdown text
after removal of an optional UTF-8 BOM, and `filename` is a display filename
without a storage path. Internal file paths
and document storage metadata are not exposed by these responses. Reading a
document by UUID does not grant guests access to private knowledge bases.

The HTTP status and JSON `code` agree on preview errors. Missing documents or
unavailable or unsafe source paths return 404; the public route also returns 404
for documents outside its publication list. Files larger than 2 MiB return 413,
unsupported formats return 415, and invalid UTF-8 returns 422.

The Nginx public allowlist includes only the exact
`/api/demo/documents/<document-uuid>/content` path for this feature, with a canonical
UUID in `8-4-4-4-12` hexadecimal form. Do not expose an upload route, a general
documents prefix or the document storage directory to enable preview.

## Visitor history and example conversations

Personal chat history is stored in PostgreSQL and scoped to the browser's
`exobrain_demo` cookie. The cookie is HttpOnly, uses Secure on HTTPS, uses
SameSite=Lax and lasts 30 days; the database stores its ownership hash. The public
UI establishes this cookie before mounting the consumers that load chat data.
The same cookie can reload its own history after an application restart. A
different browser, a cleared cookie or a new identity after expiry cannot list,
read, modify, execute or subscribe to those chats. Losing the cookie does not
itself delete the database records. Visitors' tests are not automatically
published to other visitors or converted into per-account private history.

The current guest limits include 20 retained sessions per visitor, messages up
to 4000 characters, one in-flight execution per session, and per-visitor message
rate limits of at least 3 seconds between sends and at most 60 per hour. Keep both
the application limits and the gateway message-rate limit when updating the
deployment.

To publish example conversations, create sessions through `/api/demo/chat-sessions`
and ask questions about the public project documents. Review the actual questions,
answers and tool results, then add only those session UUIDs to
`showcase-session-ids`. The public gallery labels these records “示例对话”
(example conversations); they demonstrate actual runs against the public project
documents. The session must belong to the
configured demo agent and have visitor ownership; administration-created history
cannot be published through this route.

- `GET /api/demo/showcase` returns `{showcases: [{id, agentId, title}]}`.
- `GET /api/demo/showcase/<session-uuid>` returns `{id, agentId, title, chatMessages}`.

Both responses use the normal `ApiResponse` envelope. System messages are
excluded. Tool calls and results remain visible only for the safe tool names,
and knowledge-tool arguments must reference an allowlisted public knowledge base.
Published examples are read-only, including for their original visitor: sending,
renaming, deletion and SSE subscription are denied. Start a new personal chat to
try an example yourself. These endpoints never expose a site-wide history list.

## Gateway path checks

Keep the strict checks in `nginx.conf` when deploying or changing routes. Nginx
and Tomcat normalize special URL paths differently. The gateway rejects matrix
parameters and dangerous encoded path forms, including `;`, `%3b`, `%5c` and
nested encoding via `%25`, before anonymous proxying. For example,
`/api/demo/..;/agents` must be rejected rather than reaching `/api/agents`.

Anonymous API and SSE requests must also match the explicit normalized-path
allowlists. The gateway forwards the normalized `$uri` and the query string;
unrecognized public paths return 404. UUID paths are restricted before they reach
the backend, which still enforces visitor ownership and publication lists.

**When adding a public API, update the corresponding Nginx path allowlist as well
as the backend route.** Keep `/api/demo/chat-messages` under its dedicated rate
limit. Do not replace the allowlist with an unrestricted anonymous prefix proxy.
Verify ordinary demo requests, unknown paths, encoded traversal attempts and
unauthenticated administration requests before publishing a gateway change.
For preview, also check public and private document UUIDs, malformed and missing
IDs, unsupported formats, invalid UTF-8, the 2 MiB boundary, and denied write
methods. Confirm that both management content routes still require authentication
and that errors do not disclose storage paths.

The read-only paths added by tasks 05 and 06 are already inside that allowlist:
`GET /api/demo/chat-sessions/<uuid>/runs`, `GET /api/demo/runs/<uuid>` and
`GET /api/demo/documents/<uuid>/ingestion` are matched explicitly, while unknown
`/api/demo/...` paths (including a non-UUID run id) still return 404. The account
equivalents (`GET /api/chat-sessions/<uuid>/runs`, `GET /api/runs/<uuid>`,
`GET /api/documents/<uuid>/ingestion` and the `/admin/api/...` aliases) require a
session and re-check ownership on every request, so they need no anonymous
allowlist entry. The configuration was syntax-checked with `nginx -t` after the
change; a candidate gateway still has to be probed with real requests before a
release.

## Verification record

The `20261016-kb-privacy` release completed deployment and API verification on
2026-10-16 (Asia/Shanghai):

- Java 21 packaging and the selected Maven suite reported 153 tests: 149 passed,
  no failures or errors, and 4 skipped because the Windows host could not create
  symbolic links. Frontend lint, TypeScript and both guest / account builds passed.
- The actual release JAR passed 32 storage checks in an isolated Linux Java 21
  container, without skips: 12 preview checks and 20 deletion checks, including
  secure directory handles and file, document-directory and knowledge-directory
  symbolic links that must not redirect access or deletion.
- The same JAR passed 272 checks against isolated real PostgreSQL. These covered
  administrator and user isolation across knowledge, documents, assistants,
  conversations and SSE; forged file metadata; database/file cleanup; detached
  assistant bindings; retained chat history; and deletion-transaction rollback.
- Local Chrome checked the final frontend's Markdown preview and exact source,
  canceling deletion, a simulated failed DELETE followed by successful retry,
  immediate sidebar removal, persistent deletion after reload, and public
  resources remaining read-only. All content containers fit a 390 × 844 viewport.
  The new-knowledge form explicitly identifies the new resource as private.
- The candidate gateway and public HTTPS gateway each passed 263 privacy/deletion
  checks and 60 existing public/login checks. Uploaded private originals were
  inaccessible to other accounts, including administrators; deleting the owning
  knowledge base removed its files, indexes, model binding, ownership and Agent
  references. Public Markdown and the three curated examples remained available.
- Online Chrome confirmed the administrator cannot list or open the existing
  experience account's private knowledge, while user management and the LLM /
  Embedding catalogs still work. The ordinary account retained its original
  private knowledge and completed create, cancel and confirm-delete for a new
  temporary knowledge base. The original catalog was unchanged after reload.
  Logout returned to an empty login form. Guest Markdown preview and exact-source
  switching passed at 390 × 844 without page-wide horizontal overflow.
- All 106 pre-existing rows retained their hashes, including both knowledge bases,
  3 documents, 18 chunks, 10 conversations, 62 messages, 2 accounts and the existing
  model/ownership settings. All three original files and private runtime settings
  retained their hashes. Verification-created API accounts and resources were
  removed. The consistent pre-release snapshot, including the persistent model
  encryption key, is retained at
  `/opt/exobrain/backups/pre-kb-privacy-20261016-140313`.
- The final service check at 14:36 Beijing time found healthy application and
  database services, active Nginx and cloudflared, no application ERROR or WARN
  entries since startup, and an empty file-cleanup queue. Browser-created test
  knowledge was also removed, and the 106 original rows and three files retained
  their hashes after the browser checks.

The following records describe earlier releases and their access model at the
time; they are retained as historical results.

The `20261014-accounts` release completed verification on 2026-10-15
(Asia/Shanghai):

- Java 21 packaging and the selected Maven regression suite reported 142 tests:
  139 passed, no failures or errors, and 3 skipped because this Windows environment
  could not create symbolic links.
- Frontend lint, TypeScript checks, both guest / account builds and browser
  fixtures passed.
- The final release JAR passed 303 integration checks against isolated real
  PostgreSQL and a synthetic model provider. The candidate gateway passed 60
  checks, and public HTTPS verification passed 100 checks, including actual date
  tool execution, a private Markdown upload and preview, denial of that private
  document through the public route, role separation, guest isolation, and
  rejection of a replayed session cookie after logout.
- Real browser checks confirmed account/password login, a `USER` workspace
  without administrator navigation, and denial when opening user management
  directly. A real greeting completed through SSE with its Agent label visible.
  Shared knowledge bases remained read-only; the Markdown source matched the
  API text exactly at 390 × 844 without page-wide horizontal overflow. Logout
  returned to an empty login form.
- Real browser administrator checks confirmed the user-management controls and
  distinct `ADMIN` / `USER` roles, the LLM and Embedding catalogs, and an Embedding
  editor with a blank API-key field and 1024 dimensions. Administrator logout
  also returned to an empty login form. The browser console contained one expected
  initial unauthenticated `auth/me` HTTP 401, no unexpected errors and no warnings.
- At 01:13 Beijing time, the application and PostgreSQL were healthy, and Nginx
  and cloudflared were active. Application logs contained no ERROR entries;
  eight expected WARN entries came from API tests without SSE subscribers.
- All 86 pre-existing rows retained their hashes: 2 Agents, 1 knowledge base,
  3 documents, 18 indexed chunks and 62 messages. The public knowledge base
  retained its three documents, 1024-dimensional vectors and `legacy-embedding`
  binding. Verification-created API resources and the browser test chat were
  removed after checking them. The dedicated browser session and local integration
  fixture processes were stopped, and temporary private login scripts were deleted.

The `20261014-md-preview` release on 2026-10-14 completed the following checks:

- The selected backend regression suite reported 59 tests: 56 passed, no failures
  or errors, and 3 skipped because this Windows environment could not create
  symbolic links.
- A separate storage probe loaded the implementation from the actual release JAR
  in an isolated Linux Java 21 container. All 12 checks passed without skips,
  confirming `SecureDirectoryStream` support and covering UTF-8/BOM decoding,
  the exact 2 MiB limit and overflow, invalid UTF-8, traversal, absolute and
  cross-document paths, file and directory symbolic links, unsupported formats,
  and missing files.
- Frontend lint, TypeScript checks and both public / administration builds passed.
  Local browser fixtures checked the 375px layout, complete 2 MiB source display,
  rendered/source switching, safe HTML and link handling, canceled and late
  responses, error retry, and retained administration controls.
- The candidate gateway and the published gateway each passed 33 preview and
  access checks through loopback. All three public Markdown documents matched
  their original disk text through both the guest and authenticated management
  APIs. Existing messages and private runtime settings were verified unchanged.
- Public HTTPS verification passed all 33 preview checks, including exact source
  equality for all three public documents through guest and management APIs,
  `Cache-Control: no-store`, authentication and publication-list enforcement.
  The existing public-demo HTTPS regression suite was also rerun: all 35 checks
  passed, covering read-only examples, visitor isolation, private-history denial
  and administration authentication.
- Real Chrome checks passed for both guest and administration preview: rendered
  original Markdown, character-for-character equality between the source view
  and API content, Escape to close, and retained upload / delete controls in
  administration. The guest view had no horizontal overflow at 390 × 844. Both
  browser sessions recorded zero console errors and zero warnings.

No unpublished document instance existed in this deployment during verification,
so denial for an actual private document was not exercised live. Backend tests
cover that permission boundary.

The earlier 2026-10-14 deployment baseline and the subsequent
`20261014-agent-labels-r2` frontend update recorded these historical results:

- The selected backend regression suite passed 34 tests without failures or errors.
- Frontend lint, type checking and both public / administration builds passed.
- Gateway checks covered 26 cases; public HTTPS checks covered 32 cases, including
  authentication, visitor separation, restricted resources and read-only examples.
- Browser checks covered real knowledge retrieval, visible tool calls, history
  reload, curated examples, and a 390 × 844 mobile viewport.
- The Agent-label update additionally checked different saved Agent associations,
  missing-association labels and disabled sending, without a database migration.

Revalidate affected behavior after subsequent code or deployment changes using
the commands and route checks in this guide.

## Runtime and updates

`compose.yaml` starts PostgreSQL 17 with pgvector and the application. Separate
persistent volumes hold SQL data and documents. The application uses a
non-superuser database role and a non-root container user. The `prod` profile
disables demonstration city/weather tools, which return a fixed city and simulated
weather rather than live location or weather data. Optional email tools remain
administration capabilities, isolated from the public runtime. The generic SQL
example is disabled in production and account runtimes reject both database and
file-system examples because they do not enforce per-account resource ownership.

Provision these files before the first start:

- `secrets/db-password`: PostgreSQL bootstrap password; root:999, mode 440.
- `secrets/app-db-password`: application DB password; root:999, mode 440.
- `secrets/application-prod.yaml`: private application, model and embedding configuration; 10001:10001, mode 400.
- `secrets/bootstrap-admin-password`: initial application admin password; 10001:10001, mode 400.
- `secrets/models-encryption-key`: persistent 32-byte Base64 model encryption key; 10001:10001, mode 400.
- `init.sql`: application schema from `db/jchatmind.sql`, with optional tools disabled in the seed agent.

Schema and role setup run only when the PostgreSQL data volume is first created.
Never re-run the seed SQL on an existing database or use `down -v` for updates.
The configured embedding model must produce the schema's 1024 dimensions.

Before updates, briefly pause application writes and back up PostgreSQL, the
documents volume, runtime settings and the persistent model encryption key in
the same quiet window. Retain the previous image, frontend release
and gateway configuration for rollback. Rollback must preserve existing database
and document volumes; never remove the additive account/model tables just to
restore an earlier binary. Restore a matching gateway and UI together with it.
When restoring a pre-account binary that relies on HTTP Basic at the gateway,
first restore the protected gateway configuration, validate it with `nginx -t`,
and **restart Nginx with `systemctl restart nginx` before starting the old
backend**. A graceful reload is insufficient for this rollback: old workers may
retain connections using the account release's public gateway routes, while the
old backend has no application-session enforcement. Retain the database,
documents and persistent `secrets/models-encryption-key` throughout rollback;
never regenerate the key.

If rolling back an initial account/model migration that failed before model
bootstrap, remove only the newly added `exobrain_agent_model_fk` constraint when
it was absent before the upgrade; an empty catalog must not block the old
application's Agent writes. Preserve the model tables and reapply the migration
before retrying the new release.

```bash
cd /opt/exobrain
docker compose up -d
docker compose ps
nginx -t
# Routine updates only; the pre-account rollback above requires a restart.
systemctl reload nginx
systemctl is-active cloudflared
```

After an update, verify the public home and demo catalog without credentials,
explicit login/logout, role separation, a real public knowledge search and date-tool
call, separate-cookie isolation, SSE, and the curated read-only history. Check
Markdown preview and source switching in both the public and management builds,
including rejection of private documents through the public content endpoint.
Also verify that a `USER` cannot call account/model management endpoints or read
another user's chats, documents or SSE. Confirm that shared resources are
read-only, account disable/password reset revokes active sessions, administrator
model changes affect actual requests and existing knowledge-base bindings remain
unchanged when a new default Embedding model is selected.

## Outbound tunnel connectivity

The public hostname is served through a Cloudflare Tunnel connector
(`cloudflared`, systemd unit, token file `/etc/cloudflared/token`). Its only job
is outbound reachability to the Cloudflare edge (TCP/UDP 7844); the application
itself is reachable at `127.0.0.1:18082` and does not depend on the tunnel.

On 2026-11-02 the site returned Cloudflare `Error 1033` for about eight hours:
`cloudflared` was running but every connector failed with
`TLS handshake with edge error: EOF`. The unit had been routing its edge traffic
through a local proxy (`iptables -t nat OUTPUT ... --dport 7844 -j REDIRECT
--to-ports 7892`, applied by `cloudflared-proxy-route`), and that proxy had no
nodes left (`proxy-providers` subscription never fetched), so the handshake
could not complete.

Current configuration: the connector talks to the edge **directly** over
HTTP/2, and the redirect/proxy hop is gone.

```bash
cat /etc/systemd/system/cloudflared.service.d/override.conf   # --protocol http2
ls /etc/systemd/system/cloudflared.service.d/                 # proxy-route.conf moved to backup
iptables -t nat -S OUTPUT | grep 7844                         # no redirect rule
tail -20 /var/log/cloudflared.log                             # want "Registered tunnel connection ... protocol=http2"
```

Diagnose in this order: `systemctl is-active cloudflared`; grep the log for
`Registered tunnel connection` (4 connectors expected) versus
`TLS handshake with edge error`; test direct TCP `7844` to an edge IP (for
example `198.41.192.167`) with the redirect rules removed; check
`cloudflared --version` preflight output, which reports DNS, UDP, TCP and API
reachability. `Error 1033` means no healthy connector; a reachable connector with
a broken origin shows `502` instead.

Two checks separate a gateway fault from an origin or provider fault, and both
must pass before calling the deployment healthy:

- `curl -sS -o /dev/null -w '%{http_code}' https://<host>/` and `/health` return
  `200` (through the tunnel), and `curl http://127.0.0.1:18082/health` returns
  `200` (bypassing the tunnel).
- A real guest question completes. A reachable site with a dead model provider
  still shows a page, but every run ends `FAILED / EXECUTION_FAILED` in about
  ten seconds, which is the model client's connect timeout. Compare
  `exobrain_run_event` (`MODEL_CALL`, `FAILED`) with the resolver answer for the
  configured model base URL: on 2026-11-02 the LLM relay domain had been
  released and resolved to a domain-parking address, so every model call timed
  out while retrieval and the UI stayed healthy.

When the provider endpoint has to change, edit the private
`secrets/application-prod.yaml` (model base URL and key), back it up first, then
restart only the application container. The model catalog in the database and
that YAML must agree on endpoint and key; a key valid for one provider returns
`401 Invalid token` at another.

Rollback to the proxy path (only useful when that proxy has working nodes):
restore `/root/backups/cloudflared-*/systemd-dropin/proxy-route.conf.disabled`
as `proxy-route.conf`, revert `override.conf` from the same backup directory,
`systemctl daemon-reload`, `systemctl restart cloudflared`. Never regenerate the
tunnel token; it is not part of this repository.
