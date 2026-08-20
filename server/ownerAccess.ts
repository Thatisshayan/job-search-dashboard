export type OwnerIdentity = {
  openId: string;
  role: "admin" | "user";
};

export function isWorkspaceOwner(user: OwnerIdentity | null | undefined, configuredOwnerOpenId: string) {
  return Boolean(user && (user.openId === configuredOwnerOpenId || user.role === "admin"));
}
