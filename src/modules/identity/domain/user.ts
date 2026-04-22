export type UserStatus = 'active' | 'disabled' | 'deleted';

export type User = {
  id: string;
  email: string;
  emailVerified: boolean;
  displayName: string;
  status: UserStatus;
  createdAt: Date;
  updatedAt: Date;
};

export type UserWithPassword = User & {
  passwordHash: string | null;
};
