// Few-shot examples embedded in the moderation system prompt (design §5.2:
// "keep a few-shot example set in the repo pairing allowed heated comments
// against flagged equivalents ... so it can be tuned against real comments
// post-launch"). Contrast pairs share a take, differing only on the axis
// that actually matters (profanity, targeting, spam) — this is what teaches
// the model that intensity alone is never the flag trigger.
export const MODERATION_EXAMPLES: {
  comment: string;
  verdict: "allow" | "flag";
  reason: string;
}[] = [
  {
    comment:
      "That defense was an absolute disaster, worst half I've seen all season.",
    verdict: "allow",
    reason:
      "Harsh but clean criticism of team performance, not a targeted attack.",
  },
  {
    comment:
      "That defense was a f***ing disaster, worst f***ing half I've seen all season.",
    verdict: "flag",
    reason: "Same take as the allowed example, but contains profanity.",
  },
  {
    comment: "Lol your team choked again, same as every year. Get used to it.",
    verdict: "allow",
    reason:
      "Trash talk / banter about a team's performance, not a personal attack on a commenter.",
  },
  {
    comment:
      "The coach should be fired tonight, that was the worst play-calling I've ever seen.",
    verdict: "allow",
    reason: "Harsh criticism of a coach's decisions, language stays clean.",
  },
  {
    comment:
      "You're such an idiot for even posting this, nobody with a brain agrees with you.",
    verdict: "flag",
    reason:
      "Targeted personal attack on another commenter, not on a player/team/take.",
  },
  {
    comment: "That QB is a clown, he can't read a defense to save his life.",
    verdict: "allow",
    reason:
      "Harsh criticism of a player's on-field performance, not a slur or targeted attack.",
  },
  {
    comment:
      "Check out this site, guaranteed 10x your money in a week: totally-legit-crypto.example",
    verdict: "flag",
    reason: "Spam/scam link.",
  },
  {
    comment:
      "Here's the box score if anyone wants the full breakdown: stats.example.com/game/123",
    verdict: "allow",
    reason: "Ordinary, relevant link — not spammy or malicious.",
  },
  {
    comment:
      "Can't believe they showed that on the broadcast, way too explicit for a family show.",
    verdict: "flag",
    reason: "References NSFW/sexual content.",
  },
];
