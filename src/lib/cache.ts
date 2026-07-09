// Next 16's revalidateTag takes a second `profile` argument tied to its
// partial (stale-while-revalidate) invalidation feature. `{ expire: 0 }`
// reproduces the pre-16 single-argument behavior exactly — immediate, full
// invalidation of every reader of the tag — rather than opting into deferred
// semantics. One source of truth for every revalidateTag call (design §3).
export const IMMEDIATE = { expire: 0 };
