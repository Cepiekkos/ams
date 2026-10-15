import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Archive, ArchiveRestore, ArrowDownToLine, ArrowLeft, ArrowUpRight, Bell, Check, ChevronDown, CircleHelp, LogOut,
  Clock3, Download, FileText, Folder, LayoutDashboard, ListFilter, Menu, MoreHorizontal,
  Pencil, Plus, Search, Settings, ShieldCheck, Sparkles, Tag, Trash2, Upload, UserRound,
  Users, X, Zap
} from "lucide-react";
import "./styles.css";
import {
  createId, defaultWorkspace, displayDate, displayTime, downloadDocument, exportWorkspace,
  fileToData, importWorkspace, readWorkspace, resetWorkspace, writeWorkspace
} from "./storage";
import { viewedBefore, viewedBeforeDraft } from "./workflow";

const STATUSES = ["Draft", "Pending Department Head Review", "Pending Dean Review", "Faculty Revision Requested", "Approved - Ready to Publish", "Published", "Archived"];
const CATEGORIES = ["Student resources", "Governance", "Academic affairs", "Programme documentation", "Reports"];
const ROLES = ["Administrator", "Faculty", "Department Head", "Dean"];
const WORKFLOW_STAGES = ["faculty", "department-head", "dean", "published"];
const now = () => new Date().toISOString();
const initials = (name) => name.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase();
const legacyRoleMap = { Reviewer: "Department Head", Contributor: "Faculty", Viewer: "Faculty" };
function visibleToUser(document, user) {
  if (!user) return false;
  if (user.role === "Administrator") return true;
  if (document.status === "Archived") return true;
  if (user.role === "Faculty") return document.owner === user.name || document.status === "Published";
  if (user.role === "Department Head") return ["department-head", "published"].includes(document.workflow?.stage);
  if (user.role === "Dean") return ["dean", "published"].includes(document.workflow?.stage);
  return false;
}
function reviewQueueFor(document, user) {
  if (!user) return false;
  if (user.role === "Administrator") return false;
  if (user.role === "Faculty") return document.owner === user.name && ["Pending Department Head Review", "Pending Dean Review", "Faculty Revision Requested", "Approved - Ready to Publish"].includes(document.status);
  if (user.role === "Department Head") return document.workflow?.stage === "department-head";
  if (user.role === "Dean") return document.workflow?.stage === "dean";
  return false;
}
function reviewQueueLabel(user) {
  return "Review queue";
}
function reviewQueueNote(user, count) {
  if (!count) return user?.role === "Faculty" ? "No submitted documents are waiting" : "No documents are waiting for review";
  if (user?.role === "Faculty") return "Track documents moving through approval";
  return "Documents waiting for your decision";
}
function canPublish(document, user) {
  if (user?.role !== "Faculty" || document.owner !== user.name) return false;
  // Normal publish path: document has been approved through the full flow
  const isPublishable = document.status === "Approved - Ready to Publish" && document.workflow?.stage === "faculty";

  // Republish path (from Draft): allowed ONLY when the document was
  // published before OR all required reviewers have approved it.
  // A draft that was never published and not approved by everyone must
  // still go through the normal Department Head -> Dean -> Faculty flow.
  // "publishedAt" and "archivedFrom" markers are the only reliable
  // signals that the document actually went through a publish cycle.
  const wasPublishedBefore = document.workflow?.archivedFrom?.status === "Published";
  const allReviewersApproved =
    document.workflow?.reviewHistory?.departmentHead?.approved === true &&
    document.workflow?.reviewHistory?.dean?.approved === true;
  const canRepublishFromDraft = document.status === "Draft" && document.workflow?.stage === "faculty" && (wasPublishedBefore || allReviewersApproved);

  return isPublishable || canRepublishFromDraft;
}
function isPublished(document) {
  // A document is only considered "Published" if its actual status is Published
  // OR if it's Archived and came from a Published state.
  // Leftover publishedAt/archivedFrom markers on a Draft document must NOT
  // make it appear as published.
  if (document.status === "Published") return true;
  if (document.status === "Archived") return Boolean(document.publishedAt) || document.workflow?.archivedFrom?.status === "Published";
  return false;
}
function hasDepartmentHeadReview(document, reviewer) {
  const history = document.workflow?.reviewHistory?.departmentHead;
  return Boolean(reviewer ? (history?.viewer === reviewer || history?.reviewer === reviewer || history?.viewedBy?.includes(reviewer)) : (history?.viewed || history?.reviewed || document.workflow?.departmentHeadApproved));
}
function hasDeanReview(document, reviewer) {
  const history = document.workflow?.reviewHistory?.dean;
  return Boolean(reviewer ? (history?.viewer === reviewer || history?.reviewer === reviewer || history?.viewedBy?.includes(reviewer)) : (history?.viewed || history?.reviewed));
}
function reviewerViewedBeforeDraft(document, reviewer) {
  const draftedAt = document.workflow?.draftedAfterReview?.time;
  return viewedBeforeDraft({
    reviewer,
    viewedAtBy: document.workflow?.viewedAtBy || {},
    viewedBy: document.workflow?.viewedBy || [],
    draftedAt
  });
}
function reviewerApprovedBeforeDraft(document, reviewer) {
  const draftedAt = document.workflow?.draftedAfterReview?.time;
  if (!draftedAt) return false;
  const history = document.workflow?.reviewHistory || {};
  const dh = history.departmentHead;
  if (dh?.reviewer === reviewer && dh?.time && new Date(dh.time).getTime() < new Date(draftedAt).getTime()) return true;
  const dean = history.dean;
  if (dean?.reviewer === reviewer && dean?.time && new Date(dean.time).getTime() < new Date(draftedAt).getTime()) return true;
  return false;
}
function reviewerNeedsDraftRecheck(document, reviewer) {
  if (!document.workflow?.draftedAfterReview) return false;
  if (document.status === "Archived") return false;
  return Boolean(reviewerViewedBeforeDraft(document, reviewer) || reviewerApprovedBeforeDraft(document, reviewer));
}
// Same rule as the draft logic: the "Returned for revision" indicator only appears for a
// reviewer who had already checked/approved the document BEFORE the revision was requested.
// A different user in the same role who never saw the previous version gets no indicator.
function reviewerViewedBeforeRevision(document, reviewer) {
  const revisionAt = document.workflow?.recheckReason?.type === "revision" ? document.workflow.recheckReason.time : "";
  return viewedBefore({
    reviewer,
    viewedAtBy: document.workflow?.viewedAtBy || {},
    viewedBy: document.workflow?.viewedBy || [],
    eventAt: revisionAt
  });
}
function reviewerNeedsRevision(document, role, reviewer) {
  const stage = role === "Department Head" ? "department-head" : "dean";
  return Boolean(document.workflow?.stage === stage && document.workflow?.recheckReason?.type === "revision" && reviewerViewedBeforeRevision(document, reviewer));
}
// Same rule for the "Revision requested by ..." callout: the document owner always sees it
// (they need the reason to revise), while any other user only sees it when they had already
// checked the document BEFORE that revision was requested. Terminal records hide it so the
// callout never lingers as stale context.
function reviewerViewedBeforeLastRevision(document, reviewer) {
  return viewedBefore({
    reviewer,
    viewedAtBy: document.workflow?.viewedAtBy || {},
    viewedBy: document.workflow?.viewedBy || [],
    eventAt: document.workflow?.lastRevision?.time
  });
}
function reviewerShouldSeeRevisionReason(document, user) {
  if (!document.workflow?.lastRevision) return false;
  if (user?.name === document.owner) return true;
  if (isPublished(document) || document.status === "Archived") return false;
  return reviewerViewedBeforeLastRevision(document, user?.name);
}
function reviewHistoryKey(role) {
  return role === "Department Head" ? "departmentHead" : role === "Dean" ? "dean" : null;
}
function reviewerNeedsRecheck(document, role, reviewer) {
  return reviewerNeedsDraftRecheck(document, reviewer) || reviewerNeedsRevision(document, role, reviewer);
}
function recheckLabel(document) {
  return document.workflow?.draftedAfterReview ? "Drafted — re-check" : "Returned for revision";
}
function App() {
  const [workspace, setWorkspace] = useState(() => {
    const loaded = readWorkspace();
    return loaded;
  });
  const [user, setUser] = useState(() => { try { const stored = JSON.parse(localStorage.getItem("northstar-current-user")); return stored ? { ...stored, role: legacyRoleMap[stored.role] || stored.role } : null; } catch { return null; } });
  const [activeView, setActiveView] = useState("Overview"), [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("All statuses"), [categoryFilter, setCategoryFilter] = useState("All categories"), [fileFilter, setFileFilter] = useState("All records"), [tagFilter, setTagFilter] = useState("");
  const [sortBy, setSortBy] = useState("Recently updated"), [selectedId, setSelectedId] = useState(null);
  const [modal, setModal] = useState(null), [toast, setToast] = useState(""), [mobileNav, setMobileNav] = useState(false), [workspaceMenu, setWorkspaceMenu] = useState(false);
  useEffect(() => writeWorkspace(workspace), [workspace]);
  useEffect(() => { if (user) localStorage.setItem("northstar-current-user", JSON.stringify(user)); else localStorage.removeItem("northstar-current-user"); }, [user]);
  useEffect(() => { if (toast) { const timer = setTimeout(() => setToast(""), 3200); return () => clearTimeout(timer); } }, [toast]);
  const notify = (message) => setToast(message);
  const record = (title, sub = "") => setWorkspace((w) => ({ ...w, activity: [{ id: createId("event"), title, sub, time: now(), actor: user?.name || "Local user" }, ...w.activity].slice(0, 100), notifications: [{ id: createId("notice"), text: title, time: now(), read: false }, ...w.notifications].slice(0, 50) }));
  const updateDocument = (id, patch, event = "Document updated") => { setWorkspace((w) => ({ ...w, documents: w.documents.map((doc) => { if (doc.id !== id) return doc; const draftTransition = doc.status !== "Draft" && patch.status === "Draft"; const workflow = draftTransition ? { ...(doc.workflow || {}), ...(patch.workflow || {}), draftedAfterReview: { from: "Faculty", reason: "This document was changed back to Draft and returned for another check.", time: now() } } : patch.workflow; return { ...doc, ...patch, ...(workflow ? { workflow } : {}), updatedAt: now() }; }) })); record(event, workspace.documents.find((doc) => doc.id === id)?.title || ""); };
  const markDocumentViewed = (id, role, reviewer) => { const normalizedReviewer = String(reviewer || "").trim(); if (!normalizedReviewer) return; setWorkspace((w) => ({ ...w, documents: w.documents.map((doc) => { if (doc.id !== id) return doc; const workflow = doc.workflow || {}; const viewedBy = workflow.viewedBy || []; const viewedAtBy = workflow.viewedAtBy || {}; if (viewedBy.includes(normalizedReviewer)) return doc; const viewedAt = now(); return { ...doc, workflow: { ...workflow, viewedBy: [...viewedBy, normalizedReviewer], viewedAtBy: { ...viewedAtBy, [normalizedReviewer]: viewedAt } } }; }) })); };
  const createDocument = (values) => { const id = `DOC-${Math.max(1041, ...workspace.documents.map((d) => Number(d.id.replace(/\D/g, "")) || 0)) + 1}`; const doc = { id, ...values, owner: user.name, status: "Draft", updatedAt: now(), version: "v0.1", versions: ["v0.1"], versionHistory: [{ version: "v0.1", date: now(), user: user.name, action: "Created", changes: "Initial draft" }], comments: [], revisionRequests: [], workflow: { stage: "faculty", departmentHeadApproved: false, departmentHeadRecheck: false, deanRecheck: false, reviewHistory: { departmentHead: null, dean: null }, lastRevision: null }, starred: false, color: "purple" }; setWorkspace((w) => ({ ...w, documents: [doc, ...w.documents] })); record("Document created by Faculty", values.title); setModal(null); setSelectedId(id); notify("Document created as a draft"); };
  const visibleDocuments = workspace.documents.filter((document) => visibleToUser(document, user));
  const activeDocuments = visibleDocuments.filter((document) => document.status !== "Archived");
  const archivedDocuments = visibleDocuments.filter((document) => document.status === "Archived");
  const counts = { total: visibleDocuments.length, published: visibleDocuments.filter(isPublished).length, archived: archivedDocuments.length, review: activeDocuments.filter((d) => reviewQueueFor(d, user)).length, drafts: visibleDocuments.filter((d) => d.status === "Draft" || d.status === "Faculty Revision Requested").length };
  const libraryDocuments = activeView === "Archive" ? archivedDocuments : visibleDocuments;
  const filtered = useMemo(() => libraryDocuments.filter((doc) => !tagFilter || (doc.tags || []).some((tag) => tag.toLowerCase() === tagFilter.toLowerCase())).filter((doc) => [doc.title, doc.id, doc.owner, ...(doc.tags || [])].join(" ").toLowerCase().includes(query.toLowerCase())).filter((doc) => statusFilter === "All statuses" || (statusFilter === "Published" ? isPublished(doc) : doc.status === statusFilter)).filter((doc) => categoryFilter === "All categories" || doc.category === categoryFilter).filter((doc) => fileFilter === "All records" || (fileFilter === "Uploaded files" ? Boolean(doc.file?.dataUrl) : !doc.file?.dataUrl)).sort((a, b) => sortBy === "Name" ? a.title.localeCompare(b.title) : sortBy === "Status" ? a.status.localeCompare(b.status) : b.updatedAt.localeCompare(a.updatedAt)), [libraryDocuments, tagFilter, query, statusFilter, categoryFilter, fileFilter, sortBy]);
  const enterOverview = (account) => { setUser(account); setActiveView("Overview"); setQuery(""); setTagFilter(""); setStatusFilter("All statuses"); setCategoryFilter("All categories"); setFileFilter("All records"); setSortBy("Recently updated"); setSelectedId(null); setModal(null); setMobileNav(false); };
  if (!user) return <Login users={workspace.users} onLogin={enterOverview} onCreate={(account) => { setWorkspace((w) => ({ ...w, users: [...w.users, account], members: [...w.members, { ...account, color: "purple", activity: "Active now" }] })); enterOverview(account); }} />;
  const selected = workspace.documents.find((doc) => doc.id === selectedId);
  const nav = (view, filters = {}) => { setActiveView(view); setStatusFilter(filters.status || "All statuses"); setCategoryFilter(filters.category || "All categories"); setQuery(filters.query || ""); setTagFilter(filters.tag || ""); setFileFilter(filters.file || "All records"); setSelectedId(null); setMobileNav(false); };
  const exportJson = (name, data) => { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([data], { type: "application/json" })); a.download = name; a.click(); notify("Export downloaded"); };
  return <div className="app-shell">
    <aside className={`sidebar ${mobileNav ? "sidebar-open" : ""}`}><div className="brand"><div className="brand-mark"><Sparkles size={16} /></div><span>northstar</span><button className="close-nav" onClick={() => setMobileNav(false)}><X size={17} /></button></div>
      <div className="workspace-switcher-wrap"><button className={`workspace-switcher ${workspaceMenu ? "open" : ""}`} onClick={() => setWorkspaceMenu((open) => !open)} aria-expanded={workspaceMenu} aria-haspopup="menu"><div className="workspace-avatar">AC</div><div><strong>{workspace.settings.workspaceName}</strong><span>Local workspace</span></div><ChevronDown size={15} /></button>{workspaceMenu && <div className="workspace-menu" role="menu"><div className="workspace-menu-current"><span className="workspace-avatar small">AC</span><div><strong>{workspace.settings.workspaceName}</strong><span>Current workspace</span></div><Check size={15} /></div><button role="menuitem" onClick={() => { setWorkspaceMenu(false); nav("Overview"); }}><LayoutDashboard size={15} /> Open overview</button>{user.role === "Administrator" && <button role="menuitem" onClick={() => { setWorkspaceMenu(false); nav("Admin settings"); }}><Settings size={15} /> Workspace settings</button>}<div className="workspace-menu-note">Local browser workspace</div></div>}</div>
      <nav><p className="nav-label">Workspace</p><NavItem icon={LayoutDashboard} label="Overview" active={activeView === "Overview"} onClick={() => nav("Overview")} /><NavItem icon={FileText} label="All documents" badge={counts.total} active={activeView === "All documents"} onClick={() => nav("All documents")} /><NavItem icon={Folder} label="Collections" active={activeView === "Collections"} onClick={() => nav("Collections")} /><NavItem icon={Tag} label="Taxonomy" active={activeView === "Taxonomy"} onClick={() => nav("Taxonomy")} /><p className="nav-label spaced">Manage</p><NavItem icon={ShieldCheck} label={reviewQueueLabel(user)} badge={counts.review} active={activeView === "Review queue"} onClick={() => nav("Review queue")} />{user.role === "Administrator" && <NavItem icon={Users} label="Team & permissions" active={activeView === "Team & permissions"} onClick={() => nav("Team & permissions")} />}<NavItem icon={Archive} label="Archive" active={activeView === "Archive"} onClick={() => nav("Archive")} /><NavItem icon={Zap} label="Reports" active={activeView === "Reports"} onClick={() => nav("Reports")} /></nav>
      <div className="sidebar-bottom">{user.role === "Administrator" && <NavItem icon={Settings} label="Admin settings" active={activeView === "Admin settings"} onClick={() => nav("Admin settings")} />}<NavItem icon={CircleHelp} label="Help center" onClick={() => notify("This local workspace has no support connection")} /></div>
      <div className="profile"><div className="profile-avatar">{user.initials}</div><div><strong>{user.name}</strong><span>{user.role}</span></div><button className="profile-logout" onClick={() => setUser(null)} aria-label="Log out"><LogOut size={15} /><span>Log out</span></button></div>
    </aside>
    <main className="main-content"><header className="topbar"><button className="mobile-menu" onClick={() => setMobileNav(true)}><Menu size={21} /></button><div className="breadcrumbs"><span>{activeView === "Overview" ? "Workspace" : "Manage"}</span><span>/</span><strong>{activeView}</strong></div><div className="top-actions"><button className="icon-button notification-button" onClick={() => { setWorkspace((w) => ({ ...w, notifications: w.notifications.map((n) => ({ ...n, read: true })) })); notify(workspace.notifications.filter((n) => !n.read).length ? "Notifications marked read" : "No new notifications"); }}><Bell size={18} />{workspace.notifications.some((n) => !n.read) && <i />}</button><button className="help-button"><CircleHelp size={16} /> Local mode</button><div className="top-avatar">{user.initials}</div></div></header>
      {activeView === "Overview" && <Overview counts={counts} documents={visibleDocuments} activity={workspace.activity} settings={workspace.settings} user={user} onSelect={setSelectedId} onCreate={() => setModal("create")} onViewAll={() => nav("All documents")} onViewActivity={() => nav("Reports")} onOpenTotal={() => nav("All documents")} onOpenPublished={() => nav("Archive", { status: "Published" })} onOpenReview={() => nav("Review queue")} onOpenUploads={() => nav("All documents", { file: "Uploaded files" })} onOpenHealth={(target) => nav(target)} />}
      {["All documents", "Review queue", "Archive"].includes(activeView) && <DocumentLibrary documents={activeView === "Review queue" ? filtered.filter((d) => reviewQueueFor(d, user)) : filtered} query={query} setQuery={setQuery} statusFilter={statusFilter} setStatusFilter={setStatusFilter} categoryFilter={categoryFilter} setCategoryFilter={setCategoryFilter} fileFilter={fileFilter} setFileFilter={setFileFilter} sortBy={sortBy} setSortBy={setSortBy} onCreate={() => setModal("create")} onSelect={setSelectedId} onBack={() => nav("Overview")} activeView={activeView} user={user} tagFilter={tagFilter} />}
      {activeView === "Collections" && <Collections documents={visibleDocuments} onSelect={(category) => nav("All documents", { category })} onBack={() => nav("Overview")} />}
      {activeView === "Taxonomy" && <Taxonomy documents={visibleDocuments} onSelect={(tag) => nav("All documents", { tag })} onBack={() => nav("Overview")} />}
      {activeView === "Team & permissions" && user.role === "Administrator" && <TeamMembers workspace={workspace} setWorkspace={setWorkspace} notify={notify} onBack={() => nav("Overview")} />}
      {activeView === "Reports" && <Reports documents={visibleDocuments} activity={workspace.activity} onExport={() => exportJson("northstar-report.json", JSON.stringify({ generatedAt: now(), counts, documents: workspace.documents }, null, 2))} onOpen={(filter) => nav("All documents", filter)} onOpenPublished={() => nav("Archive", { status: "Published" })} onOpenReview={() => nav("Review queue")} onBack={() => nav("Overview")} />}
      {activeView === "Admin settings" && user.role === "Administrator" && <SettingsView workspace={workspace} setWorkspace={setWorkspace} onExport={() => exportJson("northstar-workspace.json", exportWorkspace(workspace))} onImport={(text) => { try { setWorkspace(importWorkspace(text)); notify("Workspace imported"); } catch (error) { notify(error.message); } }} onReset={() => { setWorkspace(resetWorkspace()); setUser(null); notify("Workflow workspace reset"); }} notify={notify} onBack={() => nav("Overview")} />}
    </main>
    {selected && <DocumentDrawer document={selected} user={user} members={workspace.members} onClose={() => setSelectedId(null)} onViewed={markDocumentViewed} onUpdate={updateDocument} onDelete={() => setModal("delete")} onRestore={() => { updateDocument(selected.id, { status: "Draft", publishedAt: null, workflow: { ...selected.workflow, stage: "faculty", departmentHeadRecheck: false, deanRecheck: false, recheckReason: null, lastRevision: null, archivedFrom: null } }, "Published document changed back to Draft"); setSelectedId(null); notify("Document restored as a draft"); }} onNotify={notify} />}
    {modal === "create" && <CreateModal onClose={() => setModal(null)} onCreate={createDocument} />}
    {modal === "delete" && selected && <DeleteModal document={selected} onClose={() => setModal(null)} onDelete={() => { updateDocument(selected.id, { status: "Archived", workflow: { ...selected.workflow, stage: "archived", archivedFrom: { status: selected.status, stage: selected.workflow?.stage || "faculty" }, draftedAfterReview: null, recheckReason: null, departmentHeadRecheck: false, deanRecheck: false } }, "Document archived"); setModal(null); setSelectedId(null); notify("Document archived"); }} />}
    {toast && <div className="toast" role="status"><Check size={16} /> {toast}</div>}
  </div>;
}
function Login({ users, onLogin, onCreate }) { const [mode, setMode] = useState("select"); const [selected, setSelected] = useState(users[0]?.name || ""); const [name, setName] = useState(""); const [role, setRole] = useState("Faculty"); const account = users.find((item) => item.name === selected); const roleOptions = users.some((item) => item.role === "Administrator") ? ROLES.filter((item) => item !== "Administrator") : ROLES; return <main className="login-shell"><div className="login-card"><div className="brand login-brand"><div className="brand-mark"><Sparkles size={16} /></div><span>northstar</span></div><span className="eyebrow">Academic content operations</span><h1>Local workspace sign in</h1><p>This is a browser-only local workspace. Choose or create a user with the workflow role they perform.</p>{mode === "select" ? <><label className="field"><span>Choose local user</span><select value={selected} onChange={(e) => setSelected(e.target.value)}>{users.map((item) => <option key={item.name} value={item.name}>{item.name} · {item.role}</option>)}</select></label><button className="primary-button full-button" disabled={!account} onClick={() => account && onLogin(account)}><UserRound size={16} /> {account ? `Continue as ${account.name}` : "Create a local user to continue"}</button><button className="secondary-button full-button" onClick={() => setMode("create")}>Create local user</button></> : <><label className="field"><span>Your name</span><input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Taylor Smith" /></label><label className="field"><span>Workflow role</span><select value={role} onChange={(e) => setRole(e.target.value)}>{roleOptions.map((item) => <option key={item}>{item}</option>)}</select></label><button className="primary-button full-button" disabled={!name.trim()} onClick={() => onCreate({ name: name.trim(), role, initials: initials(name.trim()) })}><Plus size={16} /> Create and continue</button><button className="secondary-button full-button" onClick={() => setMode("select")}>Back to users</button></>}<small>Administrator is reserved for managing Team & permissions. Faculty upload and revise. Department Heads review Faculty submissions. Deans review Department Head approvals. Local identity is stored in this browser; connect a backend for production access control.</small></div></main>; }
function BackButton({ onClick }) { return <button className="back-button" onClick={onClick}><ArrowLeft size={15} /> Back to Overview</button>; }
function NavItem({ icon: Icon, label, badge, active, onClick }) { return <button className={`nav-item ${active ? "active" : ""}`} onClick={onClick}><Icon size={17} /><span>{label}</span>{badge > 0 && <em>{badge}</em>}</button>; }
function StatCard({ label, value, note, tone, icon: Icon, onClick }) { return <button className={`stat-card ${onClick ? "stat-card-action" : ""}`} onClick={onClick} aria-label={`${label}: ${value}. Open related documents`}><div className={`stat-icon ${tone}`}><Icon size={19} /></div><div className="stat-main"><span>{label}</span><strong>{value}</strong><small>{note}</small></div><ArrowUpRight className="stat-arrow" size={16} /></button>; }
function Overview({ counts, documents, activity, settings, user, onSelect, onCreate, onViewAll, onViewActivity, onOpenTotal, onOpenPublished, onOpenReview, onOpenUploads, onOpenHealth }) { const storage = documents.reduce((sum, doc) => sum + (doc.file?.size || 0), 0); const uploadedFiles = documents.filter((doc) => doc.file?.dataUrl).length; const coverage = documents.length ? Math.round(documents.filter((d) => d.title && d.category && d.tags?.length).length / documents.length * 100) : 0; const lifecycleTotal = counts.total; const reviewCompletion = lifecycleTotal ? Math.round((counts.published + counts.archived) / lifecycleTotal * 100) : 0; const aemConfigured = Boolean(settings.aemBaseUrl.trim() && settings.aemToken.trim()); return <div className="page"><div className="page-heading"><div><p className="eyebrow">{new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" })}</p><h1>Good morning, {user.name.split(" ")[0]} <span>✦</span></h1><p className="heading-sub">A live view of your locally stored academic content.</p></div>{user.role === "Faculty" && <button className="primary-button" onClick={onCreate}><Plus size={17} /> New document</button>}</div><section className="stats-grid"><StatCard label="Total documents" value={counts.total} note={`${counts.drafts} drafts`} tone="purple" icon={FileText} onClick={onOpenTotal} /><StatCard label="Published" value={counts.published} note={`${Math.round(counts.published / (lifecycleTotal || 1) * 100)}% of lifecycle`} tone="green" icon={Check} onClick={onOpenPublished} /><StatCard label={reviewQueueLabel(user)} value={counts.review} note={reviewQueueNote(user, counts.review)} tone="orange" icon={Clock3} onClick={onOpenReview} /><StatCard label="Uploaded files" value={uploadedFiles} note={`${(storage / 1024 / 1024).toFixed(1)} MB in browser storage`} tone="blue" icon={Zap} onClick={onOpenUploads} /></section><div className="overview-grid"><section className="panel recent-panel"><PanelHeader title="Recent documents" sub="Latest updates from your workspace" action={<button className="text-button" onClick={onViewAll}>View all <ArrowUpRight size={15} /></button>} /><div className="mini-table">{[...documents].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 5).map((doc) => <DocumentRow key={doc.id} doc={doc} user={user} onClick={() => onSelect(doc.id)} compact />)}</div></section><section className="panel activity-panel"><PanelHeader title="Activity" sub="Recent local audit events" action={<button className="text-button" onClick={onViewActivity}>Open reports <ArrowUpRight size={15} /></button>} /><div className="activity-list">{activity.slice(0, 5).map((item) => <div className="activity-item" key={item.id}><div className="activity-icon purple"><Check size={15} /></div><div><strong>{item.title}</strong><span>{item.sub}</span><small>{displayTime(item.time)}</small></div></div>)}{!activity.length && <div className="empty-state"><p>No activity yet. Changes will appear here.</p></div>}</div></section></div><section className="panel quick-panel"><PanelHeader title="Workspace health" sub="Derived from current metadata" action={<span className="health-chip"><i /> Local storage active</span>} /><div className="health-grid"><HealthItem label="Metadata coverage" value={`${coverage}%`} progress={coverage} color="purple" onClick={() => onOpenHealth("Reports")} note={`${coverage}% of documents have title, category and tags`} /><HealthItem label="Review completion" value={`${reviewCompletion}%`} progress={reviewCompletion} color="green" onClick={() => onOpenHealth("Review queue")} note={`${counts.published + counts.archived} of ${lifecycleTotal} documents completed`} /><HealthItem label="AEM connection" value={aemConfigured ? "Configured" : "Fallback"} progress={aemConfigured ? 100 : 0} color="blue" onClick={() => onOpenHealth("Admin settings")} note={aemConfigured ? "Adapter settings are saved locally" : "Configure AEM in Admin settings to enable a connection"} /></div></section></div>; }
function PanelHeader({ title, sub, action }) { return <div className="panel-header"><div><h2>{title}</h2><p>{sub}</p></div>{action}</div>; }
function HealthItem({ label, value, progress, color, note, onClick }) { return <button className={`health-item ${onClick ? "health-item-action" : ""}`} onClick={onClick} aria-label={`${label}: ${value}`}><div><span>{label}</span><strong>{value}</strong></div><div className="progress"><i className={color} style={{ width: `${progress}%` }} /></div><small>{note || `${Math.round(progress)}% of target`}</small><ArrowUpRight size={14} /></button>; }
function DocumentLibrary({ documents, query, setQuery, statusFilter, setStatusFilter, categoryFilter, setCategoryFilter, fileFilter, setFileFilter, sortBy, setSortBy, onCreate, onSelect, onBack, activeView, user, tagFilter }) { const title = activeView === "Review queue" ? "Review queue" : activeView === "Archive" ? "Archive" : "All documents"; const description = activeView === "Review queue" ? `${reviewQueueLabel(user)} · ${reviewQueueNote(user, documents.length)}` : activeView === "Archive" ? "Archived documents are retained with their versions and audit history." : tagFilter ? `Showing every document tagged “${tagFilter}”.` : "Search, organize and manage every academic document in one place."; return <div className="page"><BackButton onClick={onBack} /><div className="page-heading library-heading"><div><p className="eyebrow">Content library</p><h1>{title}</h1><p className="heading-sub">{description}</p></div>{user.role === "Faculty" && activeView !== "Archive" && <button className="primary-button" onClick={onCreate}><Upload size={17} /> Upload document</button>}</div><section className="panel library-panel"><div className="library-toolbar"><div className="search-box"><Search size={17} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by title, ID, owner or tag..." /></div><div className="toolbar-actions"><Select value={statusFilter} onChange={setStatusFilter} options={["All statuses", ...STATUSES]} /><Select value={categoryFilter} onChange={setCategoryFilter} options={["All categories", ...CATEGORIES]} /><Select value={fileFilter} onChange={setFileFilter} options={["All records", "Uploaded files", "Metadata-only"]} /><Select value={sortBy} onChange={setSortBy} options={["Recently updated", "Name", "Status"]} /></div></div><div className="table-wrap"><table><thead><tr><th>Document</th><th>Status</th><th>Owner</th><th>Last updated</th><th>Version</th><th /></tr></thead><tbody>{documents.map((doc) => <DocumentRow key={doc.id} doc={doc} user={user} onClick={() => onSelect(doc.id)} />)}</tbody></table>{!documents.length && <EmptyState query={query || tagFilter} />}</div></section></div>; }
function Select({ value, onChange, options }) { return <label className="select-wrap"><ListFilter size={15} /><select value={value} onChange={(e) => onChange(e.target.value)}>{options.map((option) => <option key={option}>{option}</option>)}</select><ChevronDown size={14} /></label>; }
function DocumentRow({ doc, user, onClick, compact }) { const ownerInitials = initials(doc.owner); const draftRecheck = user?.role !== 'Faculty' && reviewerNeedsDraftRecheck(doc, user?.name); const revisionRecheck = reviewerNeedsRevision(doc, user?.role, user?.name); return compact ? <button className="mini-row" onClick={onClick}><FileBadge type={doc.type} color={doc.color} /><span className="row-title"><strong>{doc.title}</strong><small>{doc.id} · {doc.category}</small></span>{draftRecheck && <span className="recheck-indicator">Drafted — re-check</span>}{revisionRecheck && <span className="recheck-indicator">Returned for revision</span>}<StatusPill status={doc.status} published={isPublished(doc)} /><small className="row-time">{displayDate(doc.updatedAt)}</small></button> : <tr onClick={onClick}><td><div className="document-cell"><FileBadge type={doc.type} color={doc.color} /><div><strong>{doc.title}</strong><span>{doc.id} · {doc.category}</span></div></div></td><td><StatusPill status={doc.status} published={isPublished(doc)} />{draftRecheck && <span className="recheck-indicator">Drafted — re-check</span>}{revisionRecheck && <span className="recheck-indicator">Returned for revision</span>}</td><td><div className="owner"><span className="owner-avatar">{ownerInitials}</span>{doc.owner}</div></td><td className="muted">{displayDate(doc.updatedAt)}</td><td className="version">{doc.version}</td><td><MoreHorizontal size={17} /></td></tr>; }
function FileBadge({ type, color }) { return <div className={`file-badge ${color}`}><FileText size={17} /><small>{type}</small></div>; }
function StatusPill({ status, published = false }) { const label = published ? "Published" : status; return <span className={`status-pill ${label.toLowerCase().replace(" ", "-")}`}><i />{label}</span>; }
function EmptyState({ query }) { return <div className="empty-state"><div className="empty-icon"><Search size={22} /></div><h3>No documents found</h3><p>{query ? `No results for “${query}”.` : "There are no documents in this view yet."}</p></div>; }
function DocumentDrawer({ document, user, members, onClose, onViewed, onUpdate, onDelete, onRestore, onNotify }) {
  const [tab, setTab] = useState("Overview");
  const [editing, setEditing] = useState(false);
  const [comment, setComment] = useState("");
  const [revisionReason, setRevisionReason] = useState("");
  const [fields, setFields] = useState(document);
  useEffect(() => setFields(document), [document]);
  useEffect(() => { if (onViewed) onViewed(document.id, user.role, user.name); }, [document.id, user.role, user.name]);
  const save = () => {
    const previouslyReviewed = hasDepartmentHeadReview(document) || hasDeanReview(document);
    const existingDrafted = document.workflow?.draftedAfterReview;
    const workflow = {
      ...document.workflow,
      departmentHeadRecheck: previouslyReviewed ? hasDepartmentHeadReview(document) : document.workflow?.departmentHeadRecheck,
      deanRecheck: previouslyReviewed ? hasDeanReview(document) : document.workflow?.deanRecheck,
      ...(document.status === "Draft" && previouslyReviewed && !existingDrafted ? {
        draftedAfterReview: { from: "Faculty", reason: "This document was drafted after a previous review and returned for another check.", time: now() },
        recheckReason: { type: "draft", from: "Faculty", reason: "This document was drafted after a previous review and returned for another check.", time: now() }
      } : {})
    };
    const changed = fields.title !== document.title || fields.category !== document.category || JSON.stringify(fields.tags) !== JSON.stringify(document.tags);
    let patch = { title: fields.title, category: fields.category, tags: fields.tags, workflow };
    if (changed) {
      const [major, minor] = (document.version || "v0.1").replace("v","").split(".").map(Number);
      const newMinor = (minor || 1) + 1;
      const newVersion = `v${major}.${newMinor}`;
      const nowT = now();
      const history = [{ version: newVersion, date: nowT, user: user.name, action: "Metadata updated", changes: `Title: "${document.title}" → "${fields.title}"; Category: "${document.category}" → "${fields.category}"` }, ...(document.versionHistory || [])];
      patch = { ...patch, version: newVersion, versions: [newVersion, ...(document.versions || [])], versionHistory: history };
    }
    onUpdate(document.id, patch);
    setEditing(false);
    onNotify("Document details saved");
  };
  const addComment = () => { if (!comment.trim()) return; onUpdate(document.id, { comments: [...(document.comments || []), { author: user.name, text: comment.trim(), time: "Just now" }] }, "Comment added"); setComment(""); onNotify("Comment added"); };
  const canReview = (user.role === "Department Head" && document.workflow?.stage === "department-head") || (user.role === "Dean" && document.workflow?.stage === "dean");
  const canEdit = user.role === "Faculty" && user.name === document.owner && document.workflow?.stage === "faculty" && document.status !== "Approved - Ready to Publish";
  const readyToPublish = canPublish(document, user);
  const isRepublish = readyToPublish && document.status === "Draft";
  const submitForReview = user.role === "Faculty" && user.name === document.owner && ["Draft", "Faculty Revision Requested"].includes(document.status) && !isRepublish;
  const action = submitForReview ? "Send to Department Head" : canReview ? `Approve for ${user.role === "Department Head" ? "Dean" : "Faculty"}` : readyToPublish ? (isRepublish ? "Republish document" : "Publish document") : "";
  const performAction = () => {
    if (submitForReview) {
      const reviewHistory = document.workflow?.reviewHistory || {};
      const recheck = hasDepartmentHeadReview(document);
      const draftedReturn = document.status === "Draft" && (hasDepartmentHeadReview(document) || hasDeanReview(document));
      const recheckReason = draftedReturn ? { type: "draft", from: "Faculty", reason: "This document was saved as a draft after a previous review and returned for another check.", time: now() } : document.workflow?.recheckReason || null;
      onUpdate(document.id, { status: "Pending Department Head Review", workflow: { ...document.workflow, stage: "department-head", departmentHeadRecheck: recheck, deanRecheck: Boolean(document.workflow?.deanRecheck || hasDeanReview(document)), draftedAfterReview: draftedReturn ? (document.workflow?.draftedAfterReview || { from: "Faculty", reason: recheckReason.reason, time: recheckReason.time }) : document.workflow?.draftedAfterReview || null, recheckReason, lastRevision: document.workflow?.lastRevision || null } }, "Faculty submitted document to Department Head");
      onNotify("Document sent to Department Head");
    } else if (user.role === "Department Head" && canReview) {
      markDocumentViewed(document.id, user.role, user.name);
      const reviewHistory = document.workflow?.reviewHistory || {};
      onUpdate(document.id, { status: "Pending Dean Review", workflow: { ...document.workflow, stage: "dean", departmentHeadApproved: true, departmentHeadRecheck: false, deanRecheck: hasDeanReview(document), draftedAfterReview: document.workflow?.draftedAfterReview || null, recheckReason: document.workflow?.recheckReason || null, reviewHistory: { ...reviewHistory, departmentHead: { ...(reviewHistory.departmentHead || {}), reviewed: true, approved: true, reviewer: user.name, time: now() } } } }, "Department Head approved document for Dean");
      onNotify("Document sent to Dean");
    } else if (user.role === "Dean" && canReview) {
      markDocumentViewed(document.id, user.role, user.name);
      const reviewHistory = document.workflow?.reviewHistory || {};
      onUpdate(document.id, { status: "Approved - Ready to Publish", workflow: { ...document.workflow, stage: "faculty", departmentHeadRecheck: false, deanRecheck: false, draftedAfterReview: null, recheckReason: null, reviewHistory: { ...reviewHistory, dean: { ...(reviewHistory.dean || {}), reviewed: true, approved: true, reviewer: user.name, time: now() } } } }, "Dean approved document for publication");
      onNotify("Dean approved the document; Faculty can publish it");
    } else if (readyToPublish) {
      const next = `v${(document.versions?.length || 1) + 1}.0`;
      const nowT = now();
      const history = [{ version: next, date: nowT, user: user.name, action: isRepublish ? "Republished" : "Published", changes: "Document published and archived" }, ...(document.versionHistory || [])];
      onUpdate(document.id, { status: "Archived", publishedAt: nowT, version: next, versions: [next, ...(document.versions || [])], versionHistory: history, workflow: { ...document.workflow, stage: "archived", archivedFrom: { status: "Published", stage: "published" }, draftedAfterReview: null, recheckReason: null, departmentHeadRecheck: false, deanRecheck: false } }, "Faculty published and archived approved document");
      onNotify("Document published and moved to Archive");
    }
  };
  const requestRevision = () => {
    if (!canReview || !revisionReason.trim()) return;
    const reason = { from: user.role, reason: revisionReason.trim(), time: now() };
    const reviewHistory = document.workflow?.reviewHistory || {};
    const reviewerKey = user.role === "Department Head" ? "departmentHead" : "dean";
    onUpdate(document.id, { status: "Faculty Revision Requested", workflow: { ...document.workflow, stage: "faculty", departmentHeadRecheck: user.role === "Department Head" ? hasDepartmentHeadReview(document) : document.workflow?.departmentHeadRecheck, deanRecheck: user.role === "Dean" ? hasDeanReview(document) : document.workflow?.deanRecheck, draftedAfterReview: null, recheckReason: { type: "revision", from: user.role, reason: reason.reason, time: reason.time }, lastRevision: reason, reviewHistory: { ...reviewHistory, [reviewerKey]: { ...(reviewHistory[reviewerKey] || {}), reviewed: true, approved: false, reviewer: user.name, time: now() } } }, revisionRequests: [...(document.revisionRequests || []), reason] }, `${user.role} requested Faculty revision`);
    setRevisionReason("");
    onNotify("Revision request sent to Faculty");
  };
  return <div className="drawer-overlay" onClick={onClose}><aside className="drawer" onClick={(e) => e.stopPropagation()}>
    <div className="drawer-top"><span>Document details</span><button className="icon-button" onClick={onClose}><X size={18} /></button></div>
    <div className="drawer-hero"><FileBadge type={document.type} color={document.color} /><div><h2>{document.title}</h2><span>{document.id} · {document.file?.name || document.size}</span></div></div>
    {(action || document.file?.dataUrl) && <div className="drawer-actions"><button className="secondary-button" onClick={() => onNotify(downloadDocument(document) ? "Download started" : "No file data is stored for this record")}><Download size={15} /> Download</button>{action && <button className="primary-button" onClick={performAction}><Check size={15} /> {action}</button>}</div>}
    {canReview && <div className="revision-box"><label className="field"><span>Request revision from Faculty</span><textarea value={revisionReason} onChange={(e) => setRevisionReason(e.target.value)} placeholder="Explain what must be corrected before approval." rows="3" /></label><button className="secondary-button" disabled={!revisionReason.trim()} onClick={requestRevision}>Return for revision</button></div>}
    <div className="drawer-tabs">{["Overview", "Comments", "Permissions"].map((item) => <button className={tab === item ? "active" : ""} key={item} onClick={() => setTab(item)}>{item}{item === "Comments" && document.comments?.length ? ` (${document.comments.length})` : ""}</button>)}</div>
    <div className="drawer-content">
      {reviewerShouldSeeRevisionReason(document, user) && <div className="revision-callout"><strong>Revision requested by {document.workflow.lastRevision.from}</strong><p>{document.workflow.lastRevision.reason}</p></div>}
      {user.role !== 'Faculty' && reviewerNeedsDraftRecheck(document, user.name) && <div className="revision-callout"><strong>Drafted document returned for re-check</strong><p>{document.workflow.draftedAfterReview.reason}</p></div>}
      {reviewerNeedsRevision(document, "Department Head", user.name) && user.role === "Department Head" && <div className="revision-callout"><strong>Document returned for revision</strong><p>{document.workflow.recheckReason?.reason || "The document was returned for revision and needs another check."}</p></div>}
      {reviewerNeedsRevision(document, "Dean", user.name) && user.role === "Dean" && <div className="revision-callout"><strong>Document returned for revision</strong><p>{document.workflow.recheckReason?.reason || "The document was returned for revision and needs another check."}</p></div>}
      {tab === "Overview" && <><div className="detail-section">{editing ? <><label className="field"><span>Title</span><input value={fields.title} onChange={(e) => setFields({ ...fields, title: e.target.value })} /></label><label className="field"><span>Category</span><select value={fields.category} onChange={(e) => setFields({ ...fields, category: e.target.value })}>{CATEGORIES.map((item) => <option key={item}>{item}</option>)}</select></label><label className="field"><span>Tags</span><input value={fields.tags.join(", ")} onChange={(e) => setFields({ ...fields, tags: e.target.value.split(",").map((tag) => tag.trim()).filter(Boolean) })} /></label><button className="primary-button" onClick={save}>Save fields</button></> : <><div className="section-title"><h3>Overview</h3>{canEdit && <button className="text-button" onClick={() => setEditing(true)}><Pencil size={13} /> Edit</button>}</div><Detail label="Status"><StatusPill status={document.status} published={isPublished(document)} /></Detail><Detail label="Workflow stage"><span>{document.workflow?.stage || "faculty"}</span></Detail><Detail label="Category"><span>{document.category}</span></Detail><Detail label="Owner"><span>{document.owner}</span></Detail><Detail label="Last updated"><span>{displayTime(document.updatedAt)}</span></Detail><Detail label="File"><span>{document.file?.name || "Metadata-only record"}</span></Detail></>}</div><div className="detail-section"><div className="section-title"><h3>Tags</h3></div><div className="tag-list">{(document.tags || []).map((tag) => <span key={tag}>#{tag}</span>)}</div></div><div className="detail-section"><div className="section-title"><h3>Version history</h3><span className="inline-count">{document.versionHistory?.length || document.versions?.length || 1} versions</span></div><div className="version-list">{(document.versionHistory && document.versionHistory.length ? document.versionHistory : [{ version: document.version, date: document.updatedAt, user: document.owner, action: "Current", changes: "" }]).map((v, index) => <Version key={`${v.version}-${index}`} version={v.version} date={displayDate(v.date)} user={v.user} action={v.action} changes={v.changes} current={index === 0} />)}</div></div><div className="aem-callout"><div className="aem-logo">A</div><div><strong>AEM mapping contract</strong><p>Local metadata mapping is ready. The app never claims a live connection without configured settings.</p></div></div></>}
      {tab === "Comments" && <><div className="comment-list">{(document.comments || []).map((item, index) => <div className="comment" key={`${item.author}-${index}`}><div className="owner-avatar">{initials(item.author)}</div><div><strong>{item.author}</strong><small>{item.time}</small><p>{item.text}</p></div></div>)}{!document.comments?.length && <EmptyState />}</div><div className="comment-compose"><textarea value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Add a review comment..." rows="3" /><button className="primary-button" onClick={addComment}>Post comment</button></div></>}
      {tab === "Permissions" && <Permissions owner={document.owner} members={members} />}
    </div>
    {user.role === "Faculty" && user.name === document.owner && document.status === "Archived" && <button className="secondary-button full-button" onClick={onRestore}><ArchiveRestore size={15} /> Restore as draft</button>}
    {user.role === "Faculty" && user.name === document.owner && document.status !== "Archived" && <button className="danger-button" onClick={onDelete}><Trash2 size={15} /> Archive document</button>}
  </aside></div>;
}
function Detail({ label, children }) { return <div className="detail-row"><span>{label}</span>{children}</div>; }
function Version({ version, date, user, current, action, changes }) { return <div className="version-row"><div className={`version-dot ${current ? "current" : ""}`}><Check size={11} /></div><div><strong>{version} {current && <em>Current</em>}</strong><span>{date} · {user}{action && ` · ${action}`}</span>{changes && <small className="version-changes">{changes}</small>}</div></div>; }
function Permissions({ owner, members }) { return <div className="detail-section permissions"><h3>Access control</h3><Detail label="Owner"><span>{owner}</span></Detail><Detail label="Faculty"><span>{members.filter((m) => m.role === "Faculty").length} local users</span></Detail><Detail label="Department Heads"><span>{members.filter((m) => m.role === "Department Head").length} local users</span></Detail><Detail label="Deans"><span>{members.filter((m) => m.role === "Dean").length} local users</span></Detail><Detail label="External sharing"><span>Disabled</span></Detail><small className="settings-note">Local roles are UI permissions only; connect an identity provider for production enforcement.</small></div>; }
function CreateModal({ onClose, onCreate }) { const [values, setValues] = useState({ title: "", type: "PDF", category: "Student resources", tags: "", size: "Metadata only", file: null }); const [fileName, setFileName] = useState(""); const inputRef = useRef(null); const change = (key, value) => setValues((v) => ({ ...v, [key]: value })); const onFile = async (file) => { if (!file) return; change("file", await fileToData(file)); setFileName(file.name); change("title", values.title || file.name.replace(/\.[^.]+$/, "")); change("type", file.name.split(".").pop().toUpperCase()); change("size", `${Math.max(1, Math.round(file.size / 1024))} KB`); }; return <div className="modal-overlay"><div className="modal"><div className="modal-header"><div><span className="eyebrow">New content</span><h2>Upload document</h2></div><button className="icon-button" onClick={onClose}><X size={18} /></button></div><div className="drop-zone" onClick={() => inputRef.current?.click()}><input ref={inputRef} type="file" hidden onChange={(e) => onFile(e.target.files?.[0])} /><Upload size={22} /><strong>{fileName || "Choose a file or create metadata-only record"}</strong><span>File data is stored locally in this browser.</span><button className="text-button" type="button">Browse files</button></div><div className="form-grid"><label className="field full"><span>Document title</span><input autoFocus value={values.title} onChange={(e) => change("title", e.target.value)} placeholder="e.g. Faculty handbook 2025" /></label><label className="field"><span>File type</span><input value={values.type} onChange={(e) => change("type", e.target.value.toUpperCase())} /></label><label className="field"><span>Category</span><select value={values.category} onChange={(e) => change("category", e.target.value)}>{CATEGORIES.map((item) => <option key={item}>{item}</option>)}</select></label><label className="field full"><span>Tags <small>Separate with commas</small></span><input value={values.tags} onChange={(e) => change("tags", e.target.value)} placeholder="handbook, undergraduate, 2025" /></label></div><div className="modal-footer"><button className="secondary-button" onClick={onClose}>Cancel</button><button className="primary-button" disabled={!values.title.trim()} onClick={() => onCreate({ ...values, tags: values.tags.split(",").map((tag) => tag.trim()).filter(Boolean) })}><Plus size={16} /> Create draft</button></div></div></div>; }
function DeleteModal({ document, onClose, onDelete }) { return <div className="modal-overlay"><div className="modal small-modal"><div className="warning-icon"><Trash2 size={20} /></div><h2>Archive document?</h2><p><strong>{document.title}</strong> will leave the active library. Its versions and audit history are retained.</p><div className="modal-footer"><button className="secondary-button" onClick={onClose}>Cancel</button><button className="danger-button filled" onClick={onDelete}>Archive document</button></div></div></div>; }
function Collections({ documents, onSelect, onBack }) { const groups = [...new Set(documents.map((d) => d.category))]; return <div className="page"><BackButton onClick={onBack} /><div className="page-heading"><div><p className="eyebrow">Workspace organization</p><h1>Collections</h1><p className="heading-sub">Curated views derived from document categories.</p></div></div><div className="collection-grid">{groups.map((category, index) => <button className="collection-card" key={category} onClick={() => onSelect(category)}><div className={`collection-icon ${["purple", "blue", "green", "orange", "rose"][index % 5]}`}><Folder size={21} /></div><div><h3>{category}</h3><p>{documents.filter((d) => d.category === category).length} documents</p></div><ArrowUpRight size={17} /></button>)}</div></div>; }
function Taxonomy({ documents, onSelect, onBack }) { const tags = [...new Set(documents.flatMap((d) => d.tags || []))]; return <div className="page"><BackButton onClick={onBack} /><div className="page-heading"><div><p className="eyebrow">Content governance</p><h1>Taxonomy</h1><p className="heading-sub">{tags.length} terms currently used across your workspace.</p></div></div><section className="panel taxonomy-panel"><div className="term-grid">{tags.map((tag) => <button className="term-card" key={tag} onClick={() => onSelect(tag)}><div className="term-icon"><Tag size={15} /></div><div><strong>{tag}</strong><span>{documents.filter((d) => d.tags?.includes(tag)).length} documents</span></div><ArrowUpRight size={15} /></button>)}</div>{!tags.length && <EmptyState />}</section></div>; }
function TeamMembers({ workspace, setWorkspace, notify, onBack }) { const updateRole = (name, role) => { if (role === "Administrator" && workspace.members.some((member) => member.role === "Administrator" && member.name !== name)) { notify("Only one Administrator is supported in this local workspace"); return; } setWorkspace((w) => ({ ...w, members: w.members.map((m) => m.name === name ? { ...m, role } : m), users: w.users.map((m) => m.name === name ? { ...m, role } : m) })); notify("Role saved locally"); }; return <div className="page"><BackButton onClick={onBack} /><div className="page-heading"><div><p className="eyebrow">Workspace access</p><h1>Team & permissions</h1><p className="heading-sub">Only the Administrator can view this page or change workflow roles.</p></div></div><section className="panel members-panel"><PanelHeader title={<>Members <span className="inline-count">{workspace.members.length}</span></>} sub="Local role assignments" />{workspace.members.map((member) => <div className="member-row" key={member.name}><span className={`member-avatar ${member.color}`}>{member.initials}</span><div><strong>{member.name}</strong><span>{member.activity}</span></div><select className="member-role" value={member.role} onChange={(e) => updateRole(member.name, e.target.value)}>{ROLES.map((role) => <option key={role}>{role}</option>)}</select></div>)}</section></div>; }
function Reports({ documents, activity, onExport, onOpen, onOpenPublished, onOpenReview, onBack }) { const published = documents.filter(isPublished).length; const pending = documents.filter((d) => ["Pending Department Head Review", "Pending Dean Review"].includes(d.status)).length; const metadata = documents.filter((d) => d.title && d.category && d.tags?.length).length; return <div className="page"><BackButton onClick={onBack} /><div className="page-heading"><div><p className="eyebrow">Insights & audit</p><h1>Reports</h1><p className="heading-sub">Metrics calculated from stored workspace data.</p></div><button className="secondary-button" onClick={onExport}><Download size={15} /> Export report</button></div><div className="report-grid"><ReportCard label="Publication rate" value={`${documents.length ? Math.round(published / documents.length * 100) : 0}%`} progress={documents.length ? published / documents.length * 100 : 0} color="green" note={`${published} published documents`} onClick={onOpenPublished} /><ReportCard label="Pending review" value={pending} progress={documents.length ? pending / documents.length * 100 : 0} color="orange" note={`${pending} documents awaiting a reviewer`} onClick={onOpenReview} /><ReportCard label="Metadata coverage" value={`${documents.length ? Math.round(metadata / documents.length * 100) : 0}%`} progress={documents.length ? metadata / documents.length * 100 : 0} color="purple" note="Title, category and tags complete" onClick={() => onOpen()} /></div><section className="panel audit-panel"><PanelHeader title="Audit history" sub={`${activity.length} local events recorded`} /><div className="audit-list">{activity.slice(0, 30).map((item) => <div className="audit-row" key={item.id}><Check size={15} /><div><strong>{item.title}</strong><span>{item.sub} · {item.actor}</span></div><time>{displayTime(item.time)}</time></div>)}</div></section></div>; }
function ReportCard({ label, value, progress, color, note, onClick }) { return <button className="panel report-card report-card-action" onClick={onClick} aria-label={`${label}: ${value}. Open related documents`}><span className="report-label">{label}</span><strong>{value}</strong><div className="progress"><i className={color} style={{ width: `${progress}%` }} /></div><small>{note}</small><ArrowUpRight size={15} /></button>; }
function SettingsView({ workspace, setWorkspace, onExport, onImport, onReset, notify, onBack }) { const [settings, setSettings] = useState(workspace.settings); const fileRef = useRef(null); const save = () => { setWorkspace((w) => ({ ...w, settings })); notify("Settings saved locally"); }; const configured = Boolean(settings.aemBaseUrl.trim() && settings.aemToken.trim()); return <div className="page"><BackButton onClick={onBack} /><div className="page-heading"><div><p className="eyebrow">Workspace configuration</p><h1>Admin settings</h1><p className="heading-sub">Configure local behavior and the AEM adapter contract.</p></div></div><div className="settings-grid"><section className="panel settings-card"><div className="settings-title"><div className="settings-symbol"><Settings size={18} /></div><div><h2>Workspace profile</h2><p>Saved in this browser</p></div></div><label className="field"><span>Workspace name</span><input value={settings.workspaceName} onChange={(e) => setSettings({ ...settings, workspaceName: e.target.value })} /></label><label className="field"><span>Review SLA</span><select value={settings.reviewSla} onChange={(e) => setSettings({ ...settings, reviewSla: e.target.value })}><option>1 business day</option><option>2 business days</option><option>5 business days</option></select></label><button className="primary-button" onClick={save}>Save changes</button><div className="settings-title" style={{ marginTop: 28 }}><div className="settings-symbol"><Download size={18} /></div><div><h2>Workspace data</h2><p>Portable local backup and reset</p></div></div><button className="secondary-button full-button" onClick={onExport}><ArrowDownToLine size={15} /> Export workspace JSON</button><input ref={fileRef} type="file" hidden accept=".json" onChange={(e) => { const file = e.target.files?.[0]; if (file) file.text().then(onImport); }} /><button className="secondary-button full-button" onClick={() => fileRef.current?.click()}><Upload size={15} /> Import workspace JSON</button><button className="danger-button" onClick={() => { if (window.confirm("Reset all local documents and users? This removes previous workflow data and starts a clean Faculty → Department Head → Dean workspace.")) onReset(); }}>Reset workflow workspace</button><small className="settings-note">Use this once after upgrading from the old workflow so previous demo documents and roles do not affect the new queues.</small></section><section className="panel settings-card"><div className="settings-title"><div className="settings-symbol aem-symbol">A</div><div><h2>Adobe Experience Manager</h2><p>Adapter configuration, not a live connection</p></div><span className="connected-chip" style={configured ? {} : { background: "#fff3e3", color: "#bd7b32" }}><i /> {configured ? "Configured" : "Fallback only"}</span></div><div className="integration-status"><ShieldCheck size={19} /><div><strong>{configured ? "Configuration saved locally" : "No live connection configured"}</strong><span>{configured ? "The adapter contract has a base URL and token value." : "Metadata export remains the only active integration."}</span></div></div><label className="field"><span>Author base URL</span><input value={settings.aemBaseUrl} onChange={(e) => setSettings({ ...settings, aemBaseUrl: e.target.value })} placeholder="https://author.example.com" /></label><label className="field"><span>Integration token</span><input type="password" value={settings.aemToken} onChange={(e) => setSettings({ ...settings, aemToken: e.target.value })} placeholder="Backend-managed token (not secure here)" /></label><button className="primary-button" onClick={save}>Save AEM settings</button><small className="settings-note">This frontend does not call AEM. Do not put production secrets in a static client; use a server-side proxy and replace the local adapter contract.</small></section></div></div>; }
createRoot(document.getElementById("root")).render(<App />);
