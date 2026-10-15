const STORAGE_KEY = "northstar-workspace";
export const STORAGE_VERSION = 4;

export const defaultWorkspace = {
  version: STORAGE_VERSION,
  documents: [],
  members: [],
  activity: [],
  notifications: [],
  settings: { workspaceName: "Academic Content", reviewSla: "2 business days", aemBaseUrl: "", aemToken: "" },
  users: []
};

function clone(value) { return JSON.parse(JSON.stringify(value)); }
const roleMap = { Reviewer: "Department Head", Contributor: "Faculty", Viewer: "Faculty" };
function normalizeRole(role) { return roleMap[role] || role; }
function normalizeDocument(document) {
  const workflow = document.workflow || {};
  const publishedLegacy = document.status === "Published" && !document.publishedAt;
  const normalizedStatus = publishedLegacy ? "Archived" : document.status === "In review" ? "Pending Department Head Review" : document.status;
  const stage = publishedLegacy ? "archived" : workflow.stage || (document.status === "In review" ? "department-head" : "faculty");
  const version = document.version || "v0.1";
  const versions = document.versions || [version];
  let versionHistory = document.versionHistory || [];
  if (!Array.isArray(versionHistory) || versionHistory.length === 0) {
    // Seed legacy documents with a minimal history for backwards compatibility
    versionHistory = [
      { version, date: document.updatedAt || document.publishedAt || new Date().toISOString(), user: document.owner || "System", action: document.status === "Archived" || publishedLegacy ? "Published" : "Created", changes: "Migration seed from existing document record" }
    ];
  }
  return {
    ...document,
    status: normalizedStatus,
    publishedAt: document.publishedAt || (publishedLegacy ? document.updatedAt || new Date().toISOString() : null),
    version,
    versions,
    versionHistory,
    workflow: {
      stage,
      departmentHeadApproved: Boolean(workflow.departmentHeadApproved),
      departmentHeadRecheck: Boolean(workflow.departmentHeadRecheck),
      deanRecheck: Boolean(workflow.deanRecheck),
      reviewHistory: workflow.reviewHistory || { departmentHead: null, dean: null },
      recheckReason: workflow.recheckReason || null,
      draftedAfterReview: workflow.draftedAfterReview || null,
      viewedBy: workflow.viewedBy || [],
      viewedAtBy: workflow.viewedAtBy || {},
      lastRevision: workflow.lastRevision || null,
      // Only set archivedFrom if explicitly provided — do NOT auto-inject
      // "Published" marker, as it would make every restored draft look
      // like it was published before and enable the republish path.
      archivedFrom: workflow.archivedFrom || null
    },
    revisionRequests: document.revisionRequests || []
  };
}
function normalizeWorkspace(workspace) {
  const membersByName = new Map();
  (workspace.members || []).forEach((member) => {
    const normalized = { ...member, role: normalizeRole(member.role) };
    membersByName.set(member.name, { ...(membersByName.get(member.name) || {}), ...normalized });
  });
  const usersByName = new Map();
  (workspace.users || []).forEach((user) => {
    const normalized = { ...user, role: normalizeRole(user.role) };
    usersByName.set(user.name, { ...(usersByName.get(user.name) || {}), ...normalized });
  });
  usersByName.forEach((user, name) => {
    if (!membersByName.has(name)) membersByName.set(name, { ...user, color: "purple", activity: "Active locally" });
  });
  membersByName.forEach((member, name) => {
    if (!usersByName.has(name)) usersByName.set(name, { name: member.name, role: member.role, initials: member.initials });
  });
  return {
    ...workspace,
    members: [...membersByName.values()],
    users: [...usersByName.values()],
    documents: (workspace.documents || []).map(normalizeDocument)
  };
}
export function createId(prefix = "id") { return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`; }
export function readWorkspace() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) { const initial = clone(defaultWorkspace); localStorage.setItem(STORAGE_KEY, JSON.stringify(initial)); return initial; }
    const parsed = JSON.parse(raw);
    return normalizeWorkspace({ ...clone(defaultWorkspace), ...parsed, version: STORAGE_VERSION, settings: { ...defaultWorkspace.settings, ...(parsed.settings || {}) } });
  } catch { return clone(defaultWorkspace); }
}
export function writeWorkspace(workspace) { localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...workspace, version: STORAGE_VERSION })); }
export function exportWorkspace(workspace) { return JSON.stringify({ ...workspace, version: STORAGE_VERSION, exportedAt: new Date().toISOString() }, null, 2); }
export function importWorkspace(text) {
  const incoming = JSON.parse(text);
  if (!incoming || !Array.isArray(incoming.documents) || !Array.isArray(incoming.members)) throw new Error("Invalid Northstar workspace export.");
  return normalizeWorkspace({ ...clone(defaultWorkspace), ...incoming, version: STORAGE_VERSION, settings: { ...defaultWorkspace.settings, ...(incoming.settings || {}) } });
}
export function resetWorkspace() { const initial = clone(defaultWorkspace); writeWorkspace(initial); return initial; }
export async function fileToData(file) {
  if (!file) return null;
  return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve({ name: file.name, type: file.type, size: file.size, dataUrl: reader.result }); reader.onerror = reject; reader.readAsDataURL(file); });
}
export function downloadDocument(doc) {
  if (!doc.file?.dataUrl) return false;
  const a = document.createElement("a"); a.href = doc.file.dataUrl; a.download = doc.file.name || doc.title; a.click(); return true;
}
export function displayDate(value) { const date = new Date(value); return Number.isNaN(date.getTime()) ? "Unknown" : date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }); }
export function displayTime(value) { const date = new Date(value); return Number.isNaN(date.getTime()) ? "Unknown" : date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }); }
