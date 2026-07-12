import { describe, expect, it } from "vitest";

import { CommentStatus } from "@/lib/comments/status";
import {
  buildCommentTree,
  countVisibleComments,
  insertCommentNode,
  updateCommentNode,
  type CommentNode,
  type CommentRow,
} from "@/lib/comments/tree";

let counter = 0;
function row(overrides: Partial<CommentRow> & { id: string }): CommentRow {
  counter += 1;
  return {
    parentId: null,
    authorId: `author-${overrides.id}`,
    authorName: `Author ${overrides.id}`,
    authorImage: null,
    body: `Body ${overrides.id}`,
    status: CommentStatus.Visible,
    createdAt: new Date(2026, 0, 1, 0, 0, counter),
    editedAt: null,
    ...overrides,
  };
}

describe("buildCommentTree", () => {
  it("nests replies under their parent by parentId", () => {
    const rows = [
      row({ id: "a" }),
      row({ id: "b", parentId: "a" }),
      row({ id: "c", parentId: "b" }),
    ];

    const tree = buildCommentTree(rows);

    expect(tree).toHaveLength(1);
    expect(tree[0]!.id).toBe("a");
    expect(tree[0]!.children).toHaveLength(1);
    expect(tree[0]!.children[0]!.id).toBe("b");
    expect(tree[0]!.children[0]!.children).toHaveLength(1);
    expect(tree[0]!.children[0]!.children[0]!.id).toBe("c");
  });

  it("orders children by createdAt ascending", () => {
    const t0 = new Date("2026-01-01T00:00:00Z");
    const rows = [
      row({ id: "parent" }),
      row({
        id: "third",
        parentId: "parent",
        createdAt: new Date(t0.getTime() + 2000),
      }),
      row({
        id: "first",
        parentId: "parent",
        createdAt: new Date(t0.getTime()),
      }),
      row({
        id: "second",
        parentId: "parent",
        createdAt: new Date(t0.getTime() + 1000),
      }),
    ];

    const tree = buildCommentTree(rows);

    expect(tree[0]!.children.map((c) => c.id)).toEqual([
      "first",
      "second",
      "third",
    ]);
  });

  it("breaks createdAt ties by id (stable ordering)", () => {
    const same = new Date("2026-01-01T00:00:00Z");
    const rows = [
      row({ id: "parent" }),
      row({ id: "z-child", parentId: "parent", createdAt: same }),
      row({ id: "a-child", parentId: "parent", createdAt: same }),
    ];

    const tree = buildCommentTree(rows);

    expect(tree[0]!.children.map((c) => c.id)).toEqual(["a-child", "z-child"]);
  });

  it("shows body and author only for visible nodes", () => {
    const rows = [row({ id: "a", status: CommentStatus.Visible })];

    const [node] = buildCommentTree(rows);

    expect(node!.body).toBe("Body a");
    expect(node!.author).toEqual({
      id: "author-a",
      name: "Author a",
      image: null,
    });
  });

  it.each([CommentStatus.Deleted, CommentStatus.Held, CommentStatus.Rejected])(
    "redacts body/author for a top-level %s node with no visible descendants and prunes it",
    (status) => {
      const rows = [row({ id: "a", status })];

      const tree = buildCommentTree(rows);

      expect(tree).toHaveLength(0);
    },
  );

  it.each([CommentStatus.Deleted, CommentStatus.Held, CommentStatus.Rejected])(
    "keeps a %s node as a redacted placeholder when it has a visible descendant",
    (status) => {
      const rows = [
        row({ id: "parent", status }),
        row({ id: "child", parentId: "parent", status: CommentStatus.Visible }),
      ];

      const tree = buildCommentTree(rows);

      expect(tree).toHaveLength(1);
      const parent = tree[0]!;
      expect(parent.id).toBe("parent");
      expect(parent.status).toBe(status);
      expect(parent.body).toBe("");
      expect(parent.author).toBeNull();
      expect(parent.children).toHaveLength(1);
      expect(parent.children[0]!.id).toBe("child");
    },
  );

  it("prunes a non-visible leaf with no descendants at all", () => {
    const rows = [
      row({ id: "visible-parent", status: CommentStatus.Visible }),
      row({
        id: "held-leaf",
        parentId: "visible-parent",
        status: CommentStatus.Held,
      }),
    ];

    const tree = buildCommentTree(rows);

    expect(tree).toHaveLength(1);
    expect(tree[0]!.children).toHaveLength(0);
  });

  it("prunes a non-visible subtree whose descendants are ALL non-visible", () => {
    const rows = [
      row({ id: "root", status: CommentStatus.Deleted }),
      row({ id: "mid", parentId: "root", status: CommentStatus.Held }),
      row({ id: "leaf", parentId: "mid", status: CommentStatus.Rejected }),
    ];

    const tree = buildCommentTree(rows);

    expect(tree).toHaveLength(0);
  });

  it("keeps a multi-level chain of non-visible ancestors when a deep descendant is visible", () => {
    const rows = [
      row({ id: "grandparent", status: CommentStatus.Deleted }),
      row({
        id: "parent",
        parentId: "grandparent",
        status: CommentStatus.Deleted,
      }),
      row({ id: "child", parentId: "parent", status: CommentStatus.Visible }),
    ];

    const tree = buildCommentTree(rows);

    expect(tree).toHaveLength(1);
    expect(tree[0]!.id).toBe("grandparent");
    expect(tree[0]!.body).toBe("");
    expect(tree[0]!.children).toHaveLength(1);
    expect(tree[0]!.children[0]!.id).toBe("parent");
    expect(tree[0]!.children[0]!.children).toHaveLength(1);
    expect(tree[0]!.children[0]!.children[0]!.id).toBe("child");
  });

  // D5's orphan scenario: an edit flags a parent (turning it `rejected`)
  // that still has visible replies — those replies must stay attached
  // rather than becoming orphaned, which is why the read query fetches ALL
  // statuses instead of just visible+deleted.
  it("keeps a rejected parent with visible replies attached (D5 orphan scenario)", () => {
    const rows = [
      row({ id: "flagged-edit", status: CommentStatus.Rejected }),
      row({
        id: "reply",
        parentId: "flagged-edit",
        status: CommentStatus.Visible,
      }),
    ];

    const tree = buildCommentTree(rows);

    expect(tree).toHaveLength(1);
    expect(tree[0]!.id).toBe("flagged-edit");
    expect(tree[0]!.status).toBe(CommentStatus.Rejected);
    expect(tree[0]!.body).toBe("");
    expect(tree[0]!.author).toBeNull();
    expect(tree[0]!.children.map((c) => c.id)).toEqual(["reply"]);
  });

  it("returns an empty array for no rows", () => {
    expect(buildCommentTree([])).toEqual([]);
  });

  it("treats a dangling parentId (parent not in the row set) as top-level", () => {
    const rows = [row({ id: "a", parentId: "missing-parent" })];

    const tree = buildCommentTree(rows);

    expect(tree).toHaveLength(1);
    expect(tree[0]!.id).toBe("a");
  });
});

function node(overrides: Partial<CommentNode> & { id: string }): CommentNode {
  return {
    parentId: null,
    body: `Body ${overrides.id}`,
    status: CommentStatus.Visible,
    createdAt: `2026-01-01T00:00:0${overrides.id.length}.000Z`,
    editedAt: null,
    author: {
      id: `author-${overrides.id}`,
      name: `Author ${overrides.id}`,
      image: null,
    },
    children: [],
    ...overrides,
  };
}

describe("insertCommentNode", () => {
  it("appends a top-level node when parentId is null", () => {
    const tree = [node({ id: "a", createdAt: "2026-01-01T00:00:00.000Z" })];
    const inserted = node({ id: "b", createdAt: "2026-01-01T00:00:01.000Z" });

    const result = insertCommentNode(tree, null, inserted);

    expect(result.map((n) => n.id)).toEqual(["a", "b"]);
    // Immutable: the original tree is untouched.
    expect(tree).toHaveLength(1);
  });

  it("inserts a reply under its parent, sorted with existing children", () => {
    const tree = [
      {
        ...node({ id: "parent" }),
        children: [node({ id: "old", createdAt: "2026-01-01T00:00:00.000Z" })],
      },
    ];
    const reply = node({
      id: "new",
      parentId: "parent",
      createdAt: "2026-01-01T00:00:05.000Z",
    });

    const result = insertCommentNode(tree, "parent", reply);

    expect(result[0]!.children.map((n) => n.id)).toEqual(["old", "new"]);
  });

  it("finds a parent nested several levels deep", () => {
    const tree = [
      {
        ...node({ id: "a" }),
        children: [{ ...node({ id: "b" }), children: [node({ id: "c" })] }],
      },
    ];
    const reply = node({ id: "d", parentId: "c" });

    const result = insertCommentNode(tree, "c", reply);

    expect(
      result[0]!.children[0]!.children[0]!.children.map((n) => n.id),
    ).toEqual(["d"]);
  });
});

describe("updateCommentNode", () => {
  it("patches the body/editedAt of the matching node only", () => {
    const tree = [{ ...node({ id: "a" }), children: [node({ id: "b" })] }];

    const result = updateCommentNode(tree, "b", {
      body: "edited",
      editedAt: "2026-01-02T00:00:00.000Z",
    });

    expect(result[0]!.body).toBe(`Body a`);
    expect(result[0]!.children[0]!.body).toBe("edited");
    expect(result[0]!.children[0]!.editedAt).toBe("2026-01-02T00:00:00.000Z");
  });
});

describe("countVisibleComments", () => {
  it("counts only visible nodes across the whole tree", () => {
    const tree = [
      {
        ...node({ id: "a" }),
        children: [
          node({
            id: "b",
            status: CommentStatus.Deleted,
            body: "",
            author: null,
          }),
          node({ id: "c" }),
        ],
      },
    ];

    expect(countVisibleComments(tree)).toBe(2);
  });

  it("returns 0 for an empty tree", () => {
    expect(countVisibleComments([])).toBe(0);
  });
});
