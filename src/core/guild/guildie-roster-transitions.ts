export type GuildieRosterState = {
  identityId: string;
  rankIndex: number;
};

export type GuildieRosterTransition = {
  code: "guildie.joined" | "guildie.left" | "guildie.rank.modified";
  identityId: string;
};

export function guildieRosterTransitions(
  before: ReadonlyMap<string, GuildieRosterState>,
  after: ReadonlyMap<string, GuildieRosterState>,
): GuildieRosterTransition[] {
  const transitions: GuildieRosterTransition[] = [];
  for (const [identityId, afterState] of after) {
    const previous = before.get(identityId);
    if (!previous) transitions.push({ code: "guildie.joined", identityId });
    else if (previous.rankIndex !== afterState.rankIndex) {
      transitions.push({ code: "guildie.rank.modified", identityId });
    }
  }
  for (const identityId of before.keys()) {
    if (!after.has(identityId)) transitions.push({ code: "guildie.left", identityId });
  }
  return transitions;
}
