export function viewedBefore({ reviewer, viewedAtBy = {}, viewedBy = [], eventAt }) {
  const normalizedReviewer = String(reviewer || "").trim();
  const reviewerViewedAt = viewedAtBy[normalizedReviewer];
  if (!normalizedReviewer || !reviewerViewedAt || !eventAt) return false;
  const hasViewed = viewedBy.some((viewer) => String(viewer).trim() === normalizedReviewer);
  const viewedTime = new Date(reviewerViewedAt).getTime();
  const eventTime = new Date(eventAt).getTime();
  return hasViewed && Number.isFinite(viewedTime) && Number.isFinite(eventTime) && viewedTime < eventTime;
}

// Draft re-check uses the same rule: a reviewer only sees the re-check indicator when they
// had already viewed the document before the new draft was created.
export function viewedBeforeDraft({ reviewer, viewedAtBy = {}, viewedBy = [], draftedAt }) {
  return viewedBefore({ reviewer, viewedAtBy, viewedBy, eventAt: draftedAt });
}
