export const FEEDBACK_LABELS = [
  'function_bug',
  'ui_issue',
  'slow_performance',
  'missing_feature',
  'other',
] as const;

export type FeedbackLabel = typeof FEEDBACK_LABELS[number];

export type HistoricalFeedback = {
  artifactId: string;
  artifactTitle: string;
  label: FeedbackLabel;
  comment: string | null;
  createdAt: Date;
};

export type Feedback = {
  id: string;
  artifactId: string;
  userId: string;
  label: FeedbackLabel;
  comment: string | null;
  createdAt: Date;
};
