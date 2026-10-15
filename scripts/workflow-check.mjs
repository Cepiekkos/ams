import assert from "node:assert/strict";
import { viewedBefore, viewedBeforeDraft } from "../src/workflow.js";

const viewedAt = "2026-10-14T01:00:00.000Z";
const draftedAt = "2026-10-14T01:01:00.000Z";
const publishedToDraftAt = "2026-10-14T02:01:00.000Z";
const revisionRequestedAt = "2026-10-14T03:01:00.000Z";

// Draft re-check: only reviewers who viewed the document before the draft was created qualify.
assert.equal(viewedBeforeDraft({ reviewer: "Department Head", viewedBy: ["Department Head"], viewedAtBy: { "Department Head": viewedAt }, draftedAt }), true);
assert.equal(viewedBeforeDraft({ reviewer: "Dean", viewedBy: ["Department Head"], viewedAtBy: {}, draftedAt }), false);
assert.equal(viewedBeforeDraft({ reviewer: "Department Head", viewedBy: ["Department Head"], viewedAtBy: { "Department Head": draftedAt }, draftedAt }), false);
assert.equal(viewedBeforeDraft({ reviewer: "Department Head", viewedBy: ["Department Head"], viewedAtBy: { "Department Head": draftedAt }, draftedAt: viewedAt }), false);
assert.equal(viewedBeforeDraft({ reviewer: "Dean", viewedBy: ["Dean"], viewedAtBy: { Dean: viewedAt }, draftedAt: publishedToDraftAt }), true);
assert.equal(viewedBeforeDraft({ reviewer: "Dean", viewedBy: ["Dean"], viewedAtBy: { Dean: publishedToDraftAt }, draftedAt: publishedToDraftAt }), false);
assert.equal(viewedBeforeDraft({ reviewer: "Dean", viewedBy: ["Dean"], viewedAtBy: { Dean: "2026-10-14T02:02:00.000Z" }, draftedAt: publishedToDraftAt }), false);

for (const reviewer of ["Faculty", "Department Head", "Dean", "Administrator"]) {
  assert.equal(viewedBeforeDraft({ reviewer, viewedBy: [reviewer], viewedAtBy: { [reviewer]: viewedAt }, draftedAt: publishedToDraftAt }), true);
  assert.equal(viewedBeforeDraft({ reviewer, viewedBy: [reviewer], viewedAtBy: { [reviewer]: "2026-10-14T02:02:00.000Z" }, draftedAt: publishedToDraftAt }), false);
}

// Revision re-check applies the identical timestamp rule against the revision request:
// the indicator appears only for a reviewer who checked/approved the document BEFORE the
// revision was requested, so they know why it came back to them.
const dhWhoApproved = "Alice (Department Head)";
const otherDepartmentHead = "Ben (Department Head)";

// Department Head who approved before the Dean's revision request qualifies.
assert.equal(viewedBefore({ reviewer: dhWhoApproved, viewedBy: [dhWhoApproved], viewedAtBy: { [dhWhoApproved]: viewedAt }, eventAt: revisionRequestedAt }), true);
// Dean who checked before requesting the revision also qualifies when the document returns to the Dean stage.
assert.equal(viewedBefore({ reviewer: "Dean", viewedBy: ["Dean"], viewedAtBy: { Dean: publishedToDraftAt }, eventAt: revisionRequestedAt }), true);
// Another user in the same role who never checked the document before gets no indicator.
assert.equal(viewedBefore({ reviewer: otherDepartmentHead, viewedBy: [dhWhoApproved], viewedAtBy: { [dhWhoApproved]: viewedAt, [otherDepartmentHead]: "2026-10-14T03:30:00.000Z" }, eventAt: revisionRequestedAt }), false);
// Viewing at the exact same time as the revision request does not qualify.
assert.equal(viewedBefore({ reviewer: dhWhoApproved, viewedBy: [dhWhoApproved], viewedAtBy: { [dhWhoApproved]: revisionRequestedAt }, eventAt: revisionRequestedAt }), false);
// Viewing only after the revision was requested does not qualify.
assert.equal(viewedBefore({ reviewer: dhWhoApproved, viewedBy: [dhWhoApproved], viewedAtBy: { [dhWhoApproved]: "2026-10-14T03:30:00.000Z" }, eventAt: revisionRequestedAt }), false);
// A never-viewed document (no viewedAtBy entry) never shows the indicator.
assert.equal(viewedBefore({ reviewer: otherDepartmentHead, viewedBy: [], viewedAtBy: {}, eventAt: revisionRequestedAt }), false);

console.log("Workflow timestamp checks passed for all roles: viewed-before-draft and viewed-before-revision qualify; unviewed, equal-time, and post-event views do not.");
