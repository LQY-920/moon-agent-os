export type ArtifactKind = string; // 运行时按 registry 校验
export type ArtifactStatus = 'ready' | 'retired';
export type ArtifactOrigin = 'user_intent' | 'iteration' | 'fork' | 'install';
export type ArtifactVisibility = 'private' | 'public';

export type Artifact = {
  id: string;
  userId: string;
  kind: ArtifactKind;
  title: string;
  payload: unknown;
  status: ArtifactStatus;
  origin: ArtifactOrigin;
  parentArtifactId: string | null;
  createdAt: Date;
  visibility: ArtifactVisibility;
};

export const ARTIFACT_STATUSES: readonly ArtifactStatus[] = ['ready', 'retired'] as const;
export const ARTIFACT_ORIGINS: readonly ArtifactOrigin[] = ['user_intent', 'iteration', 'fork', 'install'] as const;