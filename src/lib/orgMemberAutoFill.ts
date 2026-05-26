export interface OrgMemberAutoFillSource {
  name: string;
  position: string;
  rank: string;
  phone: string;
  email: string;
  photo_url: string;
  is_leader: boolean;
  border_color?: string;
}

export type OrgMemberAutoFillDraft = OrgMemberAutoFillSource & {
  id: string;
  team_id: string;
  sort_order: number;
};

export interface OrgManagerAutoFillSource {
  name: string;
  role?: string;
  phone: string;
  email: string;
  photo_url: string;
}

export type OrgManagerAutoFillDraft = OrgManagerAutoFillSource;

function normalizePersonName(name: string) {
  return name.replace(/\s+/g, "");
}

export function findUniqueOrgMemberAutoFill(
  name: string,
  sources: readonly OrgMemberAutoFillSource[],
): OrgMemberAutoFillSource | null {
  const normalizedName = normalizePersonName(name);
  if (!normalizedName) return null;
  const matches = sources.filter((source) => normalizePersonName(source.name) === normalizedName);
  return matches.length === 1 ? matches[0] : null;
}

export function applyOrgMemberAutoFill<T extends OrgMemberAutoFillDraft>(
  draft: T,
  name: string,
  sources: readonly OrgMemberAutoFillSource[],
  borderColors: Record<string, string> = {},
): T {
  const match = findUniqueOrgMemberAutoFill(name, sources);
  if (!match) return { ...draft, name };

  return {
    ...draft,
    name: match.name,
    position: match.position,
    rank: match.rank,
    phone: match.phone,
    email: match.email,
    photo_url: match.photo_url,
    is_leader: match.is_leader,
    border_color: match.border_color ?? borderColors[match.name] ?? draft.border_color,
  };
}

export function findUniqueOrgManagerAutoFill(
  name: string,
  sources: readonly OrgManagerAutoFillSource[],
): OrgManagerAutoFillSource | null {
  const normalizedName = normalizePersonName(name);
  if (!normalizedName) return null;
  const matches = sources.filter((source) => normalizePersonName(source.name) === normalizedName);
  return matches.length === 1 ? matches[0] : null;
}

export function applyOrgManagerAutoFill<T extends OrgManagerAutoFillDraft>(
  draft: T,
  name: string,
  sources: readonly OrgManagerAutoFillSource[],
): T {
  const match = findUniqueOrgManagerAutoFill(name, sources);
  if (!match) return { ...draft, name };

  return {
    ...draft,
    name: match.name,
    role: match.role ?? draft.role,
    phone: match.phone,
    email: match.email,
    photo_url: match.photo_url,
  };
}
